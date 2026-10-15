"use server";

import { revalidatePath } from "next/cache";
import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { uploadRegisterPhoto } from "@/lib/storage";
import {
  extractDailyProductionSafely,
  ExtractionRejected,
  type ExtractedFlockRow,
} from "@/lib/extraction/dailyProduction";
import { getReferenceExamples } from "@/lib/extraction/references";
import { reextractFlaggedFlocks, impliedFields, type FlockRecheckRequest } from "@/lib/extraction/reextract";
import type { RecheckableField } from "@/lib/extraction/dailyProduction";
import { getActiveLabels, matchFlockLabel } from "@/lib/extraction/flockMatch";
import { insertDailyProductionRow } from "@/lib/extraction/writeDailyProduction";
import {
  resolveFieldsLocally,
  applyMortalityChecksum,
  applyChainCorrections,
  applyBirdTransferDetection,
  applyPageChecksum,
  applyWrittenHdCheck,
  assertAutoCorrectionNotesConsistent,
  excludeAlreadyAutoCorrectedFields,
  dedupeNotes,
  type RawFlockInput,
  type PreviousDayData,
  type ResolvedFlock,
  type LocallyResolvedFlock,
  type MortalityChecksumInput,
} from "@/lib/extraction/pipeline";
import { compareLabels } from "@/lib/naturalSort";
import { extractAndSaveLedgerFeed, type FlockSectionTotals, type LedgerFeedResult } from "@/lib/extraction/ledgerFeedPipeline";

export interface UploadOutcome {
  error: string | null;
  // Set only alongside a "database write failed" error — the real
  // Postgres/driver error text, for the owner to relay when reporting a
  // bug. Never shown as the primary error (that stays plain/friendly), only
  // as a secondary technical-detail line.
  technicalDetail: string | null;
  photoUrl: string | null;
  date: string | null;
  pageNotes: string | null;
  // One page-level checksum issue, if the section subtotals the register
  // itself writes didn't match what the flock rows summed to — shown ONCE
  // on the upload result, not copied onto every flock (owner report,
  // 2026-09-28: the previous design flagged an entire correct page over
  // one misread subtotal). Also persisted to daily_production_page_issues
  // so it's still visible on /flagged later, not just on this response.
  pageIssue: string | null;
  written: {
    label: string;
    flagged: boolean;
    flagReason: string | null;
    // True if a first-pass flag triggered an automatic second-pass recheck
    // (whether or not that recheck actually resolved it) — surfaced so the
    // owner knows a row was already double-checked by the AI before it
    // reached them, not just flagged and left alone.
    autoRechecked: boolean;
  }[];
  // Labels the model read that don't match any flock active on that date,
  // even after forgiving-formatting matching (see lib/extraction/flockMatch.ts).
  // These are NOT discarded — their raw numbers are saved to
  // unresolved_extractions (visible on /flagged, "Unmatched flock labels")
  // so the owner can manually point them at the right flock without ever
  // having to re-read the photo or re-type the numbers. This array is just
  // the as-written labels, for the immediate on-screen summary.
  unresolved: string[];
  // Bal-bird values the day-to-day chain check auto-corrected (see
  // balBirdChain.ts) — saved clean, not flagged, but surfaced here so the
  // owner sees exactly what changed and why without having to go looking.
  autoCorrections: {
    label: string;
    date: string;
    field: string;
    from: number;
    to: number;
    note: string;
  }[];
  // Owner request, 2026-10-19: the egg ledger/feed box step runs AFTER
  // Daily Production above and is best-effort — null means it never even
  // ran (shouldn't happen) or threw before producing a result; check
  // ledgerFeedIssue for that case. Never affects `error`/the rest of this
  // outcome, which always reflects Daily Production alone.
  ledgerFeed: LedgerFeedResult | null;
  // Set when the ledger/feed step failed or timed out — the SAME text
  // recorded to ledger_extraction_issues, so the owner sees it here too,
  // without it being treated as this upload's own `error`.
  ledgerFeedIssue: string | null;
}

const EMPTY: UploadOutcome = {
  error: null, technicalDetail: null, photoUrl: null, date: null,
  pageNotes: null, pageIssue: null, written: [], unresolved: [], autoCorrections: [],
  ledgerFeed: null, ledgerFeedIssue: null,
};

// Every error shown to the end user must be plain, non-technical text —
// this app is used daily by a farm manager, not a developer. Full technical
// detail (SDK error text, stack traces) is logged server-side via
// console.error, visible in Vercel's function logs. It's also returned
// alongside the friendly message (as `detail`) so a DB-write failure can
// additionally show it as a technical-detail line on the page — owner
// report, 2026-09-28: "please retry" with no detail left the owner unable
// to say anything more specific when reporting a stuck upload.
// Owner report, 2026-10-12, production: a "database write failed" error
// could originate from any of several stages inside the Daily Production
// pipeline (loop 1's per-flock resolution, stage 3's mortality checksum,
// stage 4's chain correction, stage 5's transfer detection, stage 6's page
// checksum, stage 7's HD check, or the actual INSERT loop) with nothing in
// the surfaced message saying which — diagnosing the 2026-10-12 crash
// required re-reading the whole file end to end. `stage` names the broad
// phase that failed, prefixed onto `detail` (the only place a human sees
// it — the `friendly` message stays plain, same as before), so a future
// failure here points at itself instead of requiring the same investigation
// again.
function logAndFriendly(
  context: string,
  err: unknown,
  friendly: string,
  stage: string
): { friendly: string; detail: string } {
  const rawDetail = err instanceof Error ? err.message : String(err);
  const detail = `failed in: ${stage} — ${rawDetail}`;
  console.error(`[upload] ${context}:`, err);
  return { friendly, detail };
}

// Every pipeline correction note (mortality-swap, bal-bird chain, eggs
// checksum) is written as "<original> corrected to <current>: <reasoning>"
// — see mortalityFeedSwap.ts / balBirdChain.ts / pipeline.ts's stage 4 —
// so the specific note for one field's correction can always be picked out
// of a flock's combined autoCorrectionNotes list by that exact substring,
// without pipeline.ts having to tag each note by field itself.
function findCorrectionNote(notes: string[], from: number, to: number): string {
  const marker = `${from} corrected to ${to}`;
  return notes.find((n) => n.includes(marker)) ?? notes.join(" ");
}

export async function uploadAndExtractDailyProduction(
  _prev: UploadOutcome | null,
  formData: FormData
): Promise<UploadOutcome> {
  const file = formData.get("photo");
  const dateHint = formData.get("date");
  if (!(file instanceof File) || file.size === 0) {
    return { ...EMPTY, error: "Choose a photo first" };
  }
  if (typeof dateHint !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateHint)) {
    return { ...EMPTY, error: "Pick the date shown on the register page" };
  }

  let photoUrl: string;
  try {
    photoUrl = await uploadRegisterPhoto(file, "production", dateHint);
  } catch (err) {
    const { friendly } = logAndFriendly(
      "storage upload failed",
      err,
      "Photo couldn't be uploaded — please try again.",
      "photo storage"
    );
    return { ...EMPTY, error: friendly };
  }

  // Fetched once, before extraction, using the owner-supplied date hint —
  // needed to bound how many flocks a "sane" extraction could plausibly
  // return (owner report, 2026-09-28: a runaway extraction returned 2774+
  // "flocks" for a 10-flock page). Flock counts essentially never change
  // day to day, so the hint is a fine stand-in for whatever date the model
  // eventually reads off the page; if that turns out to differ, the labels
  // used for actual matching below are re-fetched for the real date.
  const precheckLabels = await getActiveLabels(pool, ACTIVE_FARM, dateHint);

  const photoMediaType = file.type || "image/jpeg";
  let photoBase64: string;
  let extraction;
  let flocks: ExtractedFlockRow[];
  try {
    photoBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const safe = await extractDailyProductionSafely(
      photoBase64,
      photoMediaType,
      precheckLabels.length
    );
    extraction = safe.extraction;
    flocks = safe.flocks;
  } catch (err) {
    // Photo is already stored even though extraction failed — matches the
    // spec's rule 1 (store the photo regardless of downstream outcome).
    // ExtractionRejected's own message is already plain and friendly (it's
    // written for the owner, not logged-and-swapped like other errors) —
    // and critically, nothing has been written to the DB at this point, no
    // transaction has even been opened, so "never attempt to save it" holds
    // unconditionally for a rejected extraction.
    if (err instanceof ExtractionRejected) {
      console.warn(`[upload] extraction rejected: ${err.message}`);
      return { ...EMPTY, photoUrl, error: err.message };
    }
    // Owner report, 2026-09-30, production: this branch previously dropped
    // `detail` entirely, so an actual unexpected bug (e.g. the "X is not
    // iterable" crash traced to dailyProduction.ts/flockMatch.ts) looked
    // identical on screen to an ordinary "the model couldn't read this
    // photo" outcome — no way for the owner to tell the difference, or to
    // report anything more specific than "please try again". Everything
    // that reaches this branch (not ExtractionRejected, which already has
    // its own honest message above) is either a genuine API/network error
    // or an unanticipated bug — never silently indistinguishable from a
    // normal OCR failure again: technicalDetail is now always included,
    // same as the "database write failed" branch below already does.
    const { friendly, detail } = logAndFriendly(
      "extraction call failed",
      err,
      "Something went wrong reading this photo — please try again. If it keeps happening, report the technical detail below; this may not be about photo quality.",
      "extraction call"
    );
    return { ...EMPTY, photoUrl, error: friendly, technicalDetail: detail };
  }

  // The date on the page is authoritative if legible; the date the
  // supervisor picked at upload time is the fallback.
  const date = extraction.date && extraction.date_confidence > 0.5 ? extraction.date : dateHint;

  // Diagnostic only — sections_found doesn't gate anything, but is worth
  // having in the logs while we build confidence in the multi-section fix.
  console.log(`[upload] extraction found ${flocks.length} flock(s) across ${extraction.sections_found} table section(s) for ${date}`);

  const activeLabels = date === dateHint ? precheckLabels : await getActiveLabels(pool, ACTIVE_FARM, date);

  const written: UploadOutcome["written"] = [];
  const unresolved: string[] = [];
  const autoCorrections: UploadOutcome["autoCorrections"] = [];

  // First-pass results that ended up flagged with at least one recheckable
  // field, collected across the whole photo so the second pass can batch
  // every flagged flock from this upload into ONE call — re-sending the
  // full reference set once per flagged flock (instead of once per upload)
  // would multiply the expensive part of that call for no benefit, since a
  // single handwriting-heavy page can flag several flocks at once.
  interface PendingRecheck {
    rowId: number;
    flockLabel: string;
    fields: RecheckableField[];
    confidence: Record<string, number>;
    reasons: string[];
    hdPercentNote: string | null;
    // App-side reasons (readings-disagreement, the chain check's own note,
    // ...) that fn_validate_daily_production has no way to reproduce — must
    // be re-merged after a reval overwrites `reasons`, the same way
    // hdPercentNote is preserved, or a recheck that touches an unrelated
    // field would silently wipe a legitimate first-pass flag. Returned
    // directly by insertDailyProductionRow rather than recomputed here, so
    // there's exactly one place that decides what counts as "stable".
    stableReasons: string[];
  }
  const pendingRechecks: PendingRecheck[] = [];
  // Set inside the transaction below (stage 4 needs every flock's stage-3
  // output first) — hoisted out here so the final return can still read it.
  let pageIssueText: string | null = null;

  // Owner request, 2026-10-19: accumulated inside the Daily Production
  // transaction below (same per-upload section tagging as the flocks
  // themselves), then handed to the SEPARATE ledger/feed step that runs
  // only after that transaction has committed — see the end of this
  // function. flockIds empty means "nothing resolved for this section",
  // which the ledger/feed resolve functions treat as "no cross-check data".
  const sectionTotals: Record<"main" | "continuation", { flockIds: string[]; eggsSum: number; feedBagsSum: number }> = {
    main: { flockIds: [], eggsSum: 0, feedBagsSum: 0 },
    continuation: { flockIds: [], eggsSum: 0, feedBagsSum: 0 },
  };

  try {
    await withTransaction(async (client) => {
      // Bug 9 (owner report, 2026-09-29): re-uploading a date must not leave
      // that date's previous page-issue banner(s) sitting alongside the new
      // extraction's own — soft-deleted unconditionally, before this
      // upload's own findings are known, so a re-upload that turns out
      // clean doesn't leave a stale banner behind either.
      await client.query(
        `UPDATE daily_production_page_issues
            SET deleted_at = now()
          WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
        [ACTIVE_FARM, date]
      );

      // Same reasoning as the page-issues cleanup above, for flock_movements
      // rows this reader generates from margin notes: a re-upload of this
      // date must not leave a STALE, still-unresolved candidate sitting
      // alongside a fresh one. flock_movements has no deleted_at column
      // (unlike page issues), so this is a hard delete — but only ever of
      // rows this exact mechanism wrote AND the owner hasn't touched yet
      // (reviewed_by_owner = false). A movement the owner has already
      // resolved for this date (e.g. confirmed "shifted to Anil farm") is
      // real, owner-confirmed history and must survive a re-upload
      // untouched — never deleted or regenerated from here.
      await client.query(
        `DELETE FROM flock_movements
          WHERE farm_code = $1 AND date = $2
            AND source = 'register margin note + bird-count chain'
            AND reviewed_by_owner = false`,
        [ACTIVE_FARM, date]
      );

      // ===== Stage 2, per flock (pipeline.ts) — needs only this flock's
      // own raw reading, so it runs for every flock the model found —
      // matched or not, same as the page checksums below: the page's own
      // arithmetic doesn't care whether a label matched a known flock.
      // Previous-day data is fetched here too (not in a later loop) so it
      // only needs ONE DB round-trip per flock — stage 4 (the chain) reuses
      // it below without a second query. =====
      interface LocalWithContext {
        local: LocallyResolvedFlock;
        previousDay: PreviousDayData | null;
        flockInternalId: string | null;
      }
      const localResults: LocalWithContext[] = [];

      for (const flock of flocks) {
        const match = matchFlockLabel(flock.display_label_as_written, activeLabels);

        const rawInput: RawFlockInput = {
          displayLabelAsWritten: flock.display_label_as_written,
          section: flock.section,
          mortality: flock.mortality,
          feedBags: flock.feed_bags,
          eggsTotal: flock.eggs_total,
          eggsIi: flock.eggs_ii,
          birdPopulation: flock.bird_population,
          birdPopulationReadings: flock.bird_population_readings,
          hdPercentWritten: flock.hd_percent,
          confidence: flock.confidence,
          marginNote: flock.margin_note,
        };
        const local = resolveFieldsLocally(rawInput);

        // Fetched here, not just for the chain check below but ALSO for
        // stage 3's mortality-checksum ranking tiebreak — only applies
        // against the IMMEDIATELY PRECEDING calendar day; a gap (e.g. a
        // skipped upload) means there's nothing to check against.
        let previousDay: PreviousDayData | null = null;
        if (match.flockInternalId) {
          const { rows: prevRows } = await client.query(
            `SELECT bird_population
               FROM daily_production
              WHERE flock_internal_id = $1 AND date = $2::date - 1 AND deleted_at IS NULL
              LIMIT 1`,
            [match.flockInternalId, date]
          );
          const prev = prevRows[0] as { bird_population: number | null } | undefined;
          if (prev) {
            previousDay = { birdPopulation: prev.bird_population };
          }
        }

        localResults.push({ local, previousDay, flockInternalId: match.flockInternalId });
      }

      // ===== Stage 3 (pipeline.ts) — mortality's own page-checksum
      // correction, needing EVERY OTHER flock's stage-2 output at once, so
      // it runs AFTER the loop above but BEFORE stage 4 (the day-to-day
      // chain, which must never consume an unvalidated mortality value —
      // see pipeline.ts's header comment and mortalityChecksum.ts for the
      // real production case this exists for). chainImpliedMortality is
      // supplied purely as a disambiguation signal for stage 3's own
      // ranking tiebreak, never as its primary evidence. =====
      const chainInputByLabel = new Map<string, MortalityChecksumInput>(
        localResults.map(({ local, previousDay }) => [
          local.displayLabelAsWritten,
          {
            label: local.displayLabelAsWritten,
            section: local.section,
            chainImpliedMortality:
              previousDay?.birdPopulation !== null && previousDay?.birdPopulation !== undefined && local.birdPopulation !== null
                ? previousDay.birdPopulation - local.birdPopulation
                : null,
          },
        ])
      );
      const mortalityCorrectedByLabel = new Map(
        applyMortalityChecksum(
          localResults.map((r) => r.local),
          extraction.section_subtotals ?? [],
          chainInputByLabel
        ).map((f) => [f.displayLabelAsWritten, f])
      );

      // ===== Stage 4, per flock (pipeline.ts) — needs the PREVIOUS DAY's
      // saved row for this same flock (already fetched above, reused here
      // rather than queried a second time) and whatever mortality stage 3
      // has already settled on. Stage 4 is a no-op for an unmatched flock
      // (previousDay is null — nothing to look up). =====
      interface ChainResult {
        resolved: ResolvedFlock;
        flockInternalId: string | null;
      }
      const chainResults: ChainResult[] = [];

      for (const { local, previousDay, flockInternalId } of localResults) {
        const correctedLocal = mortalityCorrectedByLabel.get(local.displayLabelAsWritten) ?? local;
        const { resolved } = applyChainCorrections(correctedLocal, previousDay);
        chainResults.push({ resolved, flockInternalId });
      }

      // ===== Stage 5 (pipeline.ts, owner request 2026-10-12) — needs every
      // flock's stage-4 output at once, to pair up transfer candidates
      // across the whole page before deciding what (if anything) to flag.
      // Never touches bird_population or a previous day's row — see
      // birdTransfer.ts. =====
      const transferredFlocks = applyBirdTransferDetection(chainResults.map((c) => c.resolved));

      // ===== Stage 6 (pipeline.ts) — needs every flock's stage-5 output at
      // once, so it runs AFTER the per-flock loop above, never interleaved
      // with it (the bug this pipeline exists to structurally prevent: a
      // checksum computed before every flock's own corrections are in still
      // counts a flock's OLD number in its section sum, producing a
      // residual false mismatch equal to the correction itself). =====
      const checksumResult = applyPageChecksum(transferredFlocks, extraction.section_subtotals ?? []);
      // Stage 7 (applyWrittenHdCheck) — must run AFTER stage 6, never
      // before: eggs_total may have just been auto-corrected there, and
      // the true calculated HD this check compares against depends on the
      // FINAL eggs_total/bird_population, not an earlier stage's. Owner
      // request, 2026-10-01 — scoped to hd_percent_written only, does not
      // touch applyPageChecksum's own logic above.
      const finalFlocks = applyWrittenHdCheck(checksumResult.resolved);
      pageIssueText = checksumResult.pageIssueText;
      if (pageIssueText) {
        console.warn(`[upload] page checksum issue: ${pageIssueText}`);
        await client.query(
          `INSERT INTO daily_production_page_issues (farm_code, date, source_photo_url, issue_text)
           VALUES ($1, $2, $3, $4)`,
          [ACTIVE_FARM, date, photoUrl, pageIssueText]
        );
      }

      const chainByLabel = new Map(chainResults.map((c) => [c.resolved.displayLabelAsWritten, c]));

      for (const flock of finalFlocks) {
        const ctx = chainByLabel.get(flock.displayLabelAsWritten);
        const flockInternalId = ctx?.flockInternalId ?? null;

        // Owner request, 2026-10-19: which flocks belong to the "big"
        // ledger/"BAB-1-7" feed box (main section) vs. the "small"
        // ledger/"BAB-8-10" feed box (continuation section) for the
        // upcoming, separate ledger/feed step — reusing the SAME per-upload
        // section tagging this extraction already did, rather than storing
        // a section column on daily_production itself (that table must
        // behave exactly as it does today). Unresolved flocks (no match)
        // are never counted — only what's actually about to be saved to
        // daily_production counts as "the flock side" of that cross-check.
        if (flockInternalId) {
          const acc = sectionTotals[flock.section];
          acc.flockIds.push(flockInternalId);
          if (flock.eggsTotal !== null) acc.eggsSum += flock.eggsTotal;
          if (flock.feedBags !== null) acc.feedBagsSum += flock.feedBags;
        }

        if (flock.mortalityOriginal !== null) {
          autoCorrections.push({
            label: flock.displayLabelAsWritten,
            date,
            field: "mortality",
            from: flock.mortalityOriginal,
            to: flock.mortality as number,
            note: findCorrectionNote(flock.autoCorrectionNotes, flock.mortalityOriginal, flock.mortality as number),
          });
        }
        if (flock.birdPopulationOriginal !== null) {
          autoCorrections.push({
            label: flock.displayLabelAsWritten,
            date,
            field: "bird_population",
            from: flock.birdPopulationOriginal,
            to: flock.birdPopulation as number,
            note: findCorrectionNote(flock.autoCorrectionNotes, flock.birdPopulationOriginal, flock.birdPopulation as number),
          });
        }
        if (flock.eggsTotalOriginal !== null) {
          autoCorrections.push({
            label: flock.displayLabelAsWritten,
            date,
            field: "eggs_total",
            from: flock.eggsTotalOriginal,
            to: flock.eggsTotal as number,
            note: findCorrectionNote(flock.autoCorrectionNotes, flock.eggsTotalOriginal, flock.eggsTotal as number),
          });
        }
        if (flock.hdPercentWrittenOriginal !== null) {
          autoCorrections.push({
            label: flock.displayLabelAsWritten,
            date,
            field: "hd_percent_written",
            from: flock.hdPercentWrittenOriginal,
            to: flock.hdPercentWritten as number,
            note: findCorrectionNote(flock.autoCorrectionNotes, flock.hdPercentWrittenOriginal, flock.hdPercentWritten as number),
          });
        }

        if (!flockInternalId) {
          // No flock matches this label, even after forgiving-formatting
          // normalization — genuinely don't know which flock this is. The
          // numbers are never discarded: they're saved here (already run
          // through stage 2/3/5's own cleanup) so the owner can manually
          // match them on /flagged without re-reading the photo.
          // daily_production.flock_internal_id is NOT NULL (Phase 1,
          // owner-approved), so this table is the only place a row like
          // this CAN live until it's resolved.
          await client.query(
            `INSERT INTO unresolved_extractions
                 (farm_code, register_type, date, display_label_as_written,
                  mortality, feed_bags, eggs_total, bird_population, hd_percent_written,
                  ocr_confidence, source_photo_url, sections_found, page_notes)
             VALUES ($1,'daily_production',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              ACTIVE_FARM,
              date,
              flock.displayLabelAsWritten,
              flock.mortality,
              flock.feedBags,
              flock.eggsTotal,
              flock.birdPopulation,
              flock.hdPercentWritten,
              JSON.stringify(flock.confidence),
              photoUrl,
              extraction.sections_found,
              extraction.page_notes,
            ]
          );
          unresolved.push(flock.displayLabelAsWritten);
          continue;
        }

        // Owner request, 2026-10-15: stage 5 (applyBirdTransferDetection)
        // decided this flock's unexplained bird-count change deserves a
        // flock_movements row, not just the flag message already in
        // extraFlagReasons — write it now, inside this same transaction, so
        // it can never exist without the daily_production row it's about
        // also existing (and vice versa). counterpartLabel (if any) is
        // resolved through chainByLabel — built from THIS SAME upload's own
        // flock resolution, never a fresh query — since the counterpart is
        // necessarily a flock this same upload already processed (margin
        // notes only ever pair flocks on the same page).
        if (flock.movementCandidate) {
          const mc = flock.movementCandidate;
          const counterpartFlockId = mc.counterpartLabel
            ? chainByLabel.get(mc.counterpartLabel)?.flockInternalId ?? null
            : null;
          const movementType =
            mc.unexplainedDelta < 0
              ? counterpartFlockId
                ? "transfer_out"
                : "unexplained_out"
              : counterpartFlockId
                ? "transfer_in"
                : "unexplained_in";
          const registerNote = mc.marginNote
            ? `Margin note ${mc.marginNote}`
            : mc.counterpartLabel
              ? `Paired with ${mc.counterpartLabel}'s own margin note`
              : "No margin note; source not known";
          await client.query(
            `INSERT INTO flock_movements
                 (farm_code, date, flock_internal_id, birds_change, movement_type,
                  counterpart_flock_id, register_note, source, needs_review, reviewed_by_owner)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'register margin note + bird-count chain', true, false)`,
            [ACTIVE_FARM, date, flockInternalId, mc.unexplainedDelta, movementType, counterpartFlockId, registerNote]
          );
        }

        // Owner report, 2026-10-03, production: BAB-2, 2026-08-05 —
        // auto_correction_note described one value, the saved
        // bird_population was a different one, unexplained. Traced to the
        // second-pass recheck independently overwriting a field the
        // chain/swap/checksum logic had already corrected with real
        // corroborating evidence, via an entirely separate UPDATE that
        // never touched the note describing the first correction. Thrown
        // here, right before persisting, as a hard backstop — never
        // silently save a value its own note doesn't describe.
        assertAutoCorrectionNotesConsistent(flock);

        const { rowId, reasons, hdPercentNote, stableReasons } = await insertDailyProductionRow(
          client,
          ACTIVE_FARM,
          date,
          flockInternalId,
          {
            displayLabelAsWritten: flock.displayLabelAsWritten,
            // shed_code is no longer extracted (owner decision, 2026-09-18)
            // — the column stays for manual entry, extraction just doesn't
            // populate it.
            shedCode: null,
            mortality: flock.mortality,
            mortalityOriginal: flock.mortalityOriginal,
            feedBags: flock.feedBags,
            eggsTotal: flock.eggsTotal,
            eggsTotalOriginal: flock.eggsTotalOriginal,
            birdPopulation: flock.birdPopulation,
            birdPopulationOriginal: flock.birdPopulationOriginal,
            hdPercentWritten: flock.hdPercentWritten,
            hdPercentWrittenOriginal: flock.hdPercentWrittenOriginal,
            confidence: flock.confidence,
            sourcePhotoUrl: photoUrl,
            sectionsFound: extraction.sections_found,
            pageNotes: extraction.page_notes,
            autoCorrectionNote: flock.autoCorrectionNotes.length > 0 ? dedupeNotes(flock.autoCorrectionNotes).join(" ") : null,
            suppressBirdPopulationIncreaseFlag: flock.suppressBirdPopulationIncreaseFlag,
            extraReasons: flock.extraFlagReasons,
          }
        );

        if (reasons.length > 0) {
          // Owner report, 2026-10-03, production — the actual fix (see
          // pipeline.ts's excludeAlreadyAutoCorrectedFields doc comment
          // for the full incident): a field already auto-corrected with
          // real corroborating evidence must never be handed to the
          // second pass, which would re-extract it blind and, if
          // accepted, silently overwrite it without ever touching the
          // note that describes the first correction.
          const fields = excludeAlreadyAutoCorrectedFields(impliedFields(reasons), flock);
          if (fields.length > 0) {
            pendingRechecks.push({
              rowId,
              flockLabel: flock.displayLabelAsWritten,
              fields,
              confidence: { ...flock.confidence },
              reasons,
              hdPercentNote,
              stableReasons,
            });
            // Finalized below, after the batched second pass — the row is
            // already saved with its first-pass flagged/flag_reason from
            // insertDailyProductionRow, which the second pass may overwrite.
            continue;
          }
        }

        written.push({
          label: flock.displayLabelAsWritten,
          flagged: reasons.length > 0,
          flagReason: reasons.length > 0 ? reasons.join("; ") : null,
          autoRechecked: false,
        });
      }

      // Second pass — one batched call covering every flagged flock from
      // this photo, only if at least one confirmed reference photo is
      // available. Most uploads never reach this at all: references are
      // expensive (multiple extra images per call), so they're attached
      // only to the recheck, never to the first pass.
      if (pendingRechecks.length > 0) {
        const references = await getReferenceExamples(client, ACTIVE_FARM);
        let resultsByLabel = new Map<string, Awaited<ReturnType<typeof reextractFlaggedFlocks>>[number]>();
        if (references.length > 0) {
          try {
            const requests: FlockRecheckRequest[] = pendingRechecks.map((p) => ({
              flockLabel: p.flockLabel,
              fields: p.fields,
            }));
            const results = await reextractFlaggedFlocks(photoBase64, photoMediaType, requests, references);
            resultsByLabel = new Map(results.map((r) => [r.flockLabel, r]));
          } catch (err) {
            // A failed recheck call leaves every pending row flagged with
            // its original first-pass reasons — same end state as if no
            // recheck had been attempted, just logged for diagnostics.
            console.error("[upload] second-pass recheck failed:", err);
          }
        }

        for (const pending of pendingRechecks) {
          let reasons = pending.reasons;
          // Defaults to preserving whatever the first pass already computed
          // — only overwritten below if this recheck actually touched an
          // HD%-related field and re-ran validation. Without this, a
          // recheck for an unrelated field (e.g. mortality) would wipe out
          // a legitimate quiet note from the first pass by writing null.
          let hdPercentNote = pending.hdPercentNote;
          const recheck = resultsByLabel.get(pending.flockLabel);
          const autoRechecked = references.length > 0;

          if (recheck) {
            const confidence = pending.confidence;
            const acceptedFields: string[] = [];
            const acceptedValues: (number | null)[] = [];
            for (const f of pending.fields) {
              const newVal = recheck.values[f];
              const newConf = recheck.confidence[f] ?? 0;
              const oldConf = confidence[f] ?? 0;
              // Only accept the recheck's value if it actually resolved to
              // reasonable confidence AND is at least as confident as the
              // original read — a recheck that comes back just as unsure
              // shouldn't silently overwrite the original value.
              if (newVal !== undefined && newConf >= 0.6 && newConf >= oldConf) {
                acceptedFields.push(f);
                acceptedValues.push(newVal);
                confidence[f] = newConf;
              }
            }

            if (acceptedFields.length > 0) {
              // hd_percent is a recheckable field conceptually (the
              // register's own "%" column), but the daily_production.hd_percent
              // column is GENERATED ALWAYS now — a recheck's accepted value
              // writes to hd_percent_written instead.
              const dbColumn = (f: string) => (f === "hd_percent" ? "hd_percent_written" : f);
              const setClause = acceptedFields.map((f, i) => `${dbColumn(f)} = $${i + 2}`).join(", ");
              await client.query(
                `UPDATE daily_production SET ${setClause}, ocr_confidence = $${acceptedFields.length + 2} WHERE id = $1`,
                [pending.rowId, ...acceptedValues, JSON.stringify(confidence)]
              );

              const { rows: revalRows } = await client.query(
                `SELECT * FROM fn_validate_daily_production($1)`,
                [pending.rowId]
              );
              reasons = revalRows[0].reasons;
              hdPercentNote = revalRows[0].hd_percent_note;
              const stillLow = Object.entries(confidence).filter(([, v]) => v < 0.6);
              for (const [field] of stillLow) reasons.push(`low OCR confidence on ${field}`);
              // fn_validate_daily_production only knows its own SQL-side
              // rules — re-merge the app-side reasons it can't reproduce,
              // same reasoning as preserving hdPercentNote above.
              reasons.push(...pending.stableReasons);
            }
          }

          await client.query(
            `UPDATE daily_production SET flagged = $2, flag_reason = $3, hd_percent_note = $4 WHERE id = $1`,
            [pending.rowId, reasons.length > 0, reasons.length > 0 ? reasons.join("; ") : null, hdPercentNote]
          );
          written.push({
            label: pending.flockLabel,
            flagged: reasons.length > 0,
            flagReason: reasons.length > 0 ? reasons.join("; ") : null,
            autoRechecked,
          });
        }
      }

      if (written.length > 0) {
        // Flagged rows never feed this mirror — an unreviewed OCR read
        // (e.g. a misread digit) must not silently push a wrong number into
        // the live flock register before the owner has had a chance to
        // catch it on /flagged. A flagged row is excluded both as the
        // source of the update AND from the "is there a later reading"
        // check below, since an unreviewed later row shouldn't be able to
        // block an earlier CONFIRMED-clean reading from applying either.
        // Soft-deleted rows (owner request, 2026-09-28) are excluded on the
        // same basis — wrong/duplicate data must not feed analytics.
        await client.query(
          `UPDATE flocks f
              SET current_bird_count = dp.bird_population
             FROM daily_production dp
            WHERE dp.flock_internal_id = f.flock_internal_id
              AND dp.date = $1
              AND dp.bird_population IS NOT NULL
              AND dp.flagged = false
              AND dp.deleted_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM daily_production later
                   WHERE later.flock_internal_id = f.flock_internal_id
                     AND later.date > $1 AND later.bird_population IS NOT NULL
                     AND later.flagged = false
                     AND later.deleted_at IS NULL
              )`,
          [date]
        );
      }
    });
  } catch (err) {
    const { friendly, detail } = logAndFriendly(
      "database write failed",
      err,
      "Photo was read, but something went wrong saving the results — please try again.",
      "daily production pipeline"
    );
    return { ...EMPTY, photoUrl, error: friendly, technicalDetail: detail };
  }

  // ===== Separate, best-effort step (owner request, 2026-10-19) — runs
  // ONLY after Daily Production has already committed above, reading the
  // SAME photo's egg stock ledger(s) and feed bag box(es). A failure or
  // timeout here is caught here and recorded as a visible, re-runnable
  // issue; it never affects the Daily Production result already decided
  // (and returned on error above) — this step runs completely outside that
  // transaction and that try/catch. =====
  let ledgerFeedResult: LedgerFeedResult | null = null;
  let ledgerFeedIssue: string | null = null;
  try {
    const toTotals = (acc: { flockIds: string[]; eggsSum: number; feedBagsSum: number }): FlockSectionTotals => ({
      flockIds: acc.flockIds,
      eggsSum: acc.flockIds.length > 0 ? acc.eggsSum : null,
      feedBagsSum: acc.flockIds.length > 0 ? acc.feedBagsSum : null,
    });
    ledgerFeedResult = await extractAndSaveLedgerFeed(
      ACTIVE_FARM,
      date,
      photoUrl,
      photoBase64,
      photoMediaType,
      toTotals(sectionTotals.main),
      toTotals(sectionTotals.continuation)
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[upload] ledger/feed extraction failed for ${date}:`, err);
    // Named the same way as the Daily Production pipeline's own
    // technicalDetail (see logAndFriendly above) — this step has its own
    // separate failure surface (ledgerFeedIssue, never `error`), but a
    // future failure here deserves the same "which stage" visibility.
    ledgerFeedIssue = `Ledger/feed box not read (failed in: ledger/feed pipeline): ${detail}. Re-run the upload to try again.`;
    try {
      await pool.query(
        `INSERT INTO ledger_extraction_issues (farm_code, date, source_photo_url, issue_text)
         VALUES ($1, $2, $3, $4)`,
        [ACTIVE_FARM, date, photoUrl, ledgerFeedIssue]
      );
    } catch (issueErr) {
      console.error(`[upload] failed to even record the ledger/feed issue for ${date}:`, issueErr);
    }
  }
  if (ledgerFeedResult) {
    revalidatePath("/egg-stock");
    revalidatePath("/feed-bag-stock");
  }

  revalidatePath("/production");
  revalidatePath("/flagged");
  revalidatePath("/records");

  // `written` is built in whatever order the model read flocks off the
  // photo (plus rechecked rows appended after the main loop), not flock
  // order — sort both result lists to natural label order for display.
  written.sort((a, b) => compareLabels(a.label, b.label));
  unresolved.sort(compareLabels);

  return {
    error: null,
    technicalDetail: null,
    photoUrl,
    date,
    pageNotes: extraction.page_notes,
    pageIssue: pageIssueText,
    written,
    unresolved,
    autoCorrections,
    ledgerFeed: ledgerFeedResult,
    ledgerFeedIssue,
  };
}
