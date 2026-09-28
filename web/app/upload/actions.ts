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
import { checkBalBirdChain } from "@/lib/extraction/balBirdChain";
import { checkPageChecksums, buildPageIssueText, type SectionFlock } from "@/lib/extraction/pageChecksum";
import { compareLabels } from "@/lib/naturalSort";

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
}

const EMPTY: UploadOutcome = {
  error: null, technicalDetail: null, photoUrl: null, date: null,
  pageNotes: null, pageIssue: null, written: [], unresolved: [], autoCorrections: [],
};

// Every error shown to the end user must be plain, non-technical text —
// this app is used daily by a farm manager, not a developer. Full technical
// detail (SDK error text, stack traces) is logged server-side via
// console.error, visible in Vercel's function logs. It's also returned
// alongside the friendly message (as `detail`) so a DB-write failure can
// additionally show it as a technical-detail line on the page — owner
// report, 2026-09-28: "please retry" with no detail left the owner unable
// to say anything more specific when reporting a stuck upload.
function logAndFriendly(
  context: string,
  err: unknown,
  friendly: string
): { friendly: string; detail: string } {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[upload] ${context}:`, err);
  return { friendly, detail };
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
      "Photo couldn't be uploaded — please try again."
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
    const { friendly } = logAndFriendly(
      "extraction call failed",
      err,
      "Couldn't read the register from that photo — please try again, or enter this page manually on the Daily Production screen."
    );
    return { ...EMPTY, photoUrl, error: friendly };
  }

  // The date on the page is authoritative if legible; the date the
  // supervisor picked at upload time is the fallback.
  const date = extraction.date && extraction.date_confidence > 0.5 ? extraction.date : dateHint;

  // Diagnostic only — sections_found doesn't gate anything, but is worth
  // having in the logs while we build confidence in the multi-section fix.
  console.log(`[upload] extraction found ${flocks.length} flock(s) across ${extraction.sections_found} table section(s) for ${date}`);

  const activeLabels = date === dateHint ? precheckLabels : await getActiveLabels(pool, ACTIVE_FARM, date);

  // Page checksum, rebuilt (owner report, 2026-09-28: the previous version
  // summed every flock against every subtotal indiscriminately, so one
  // section's misread subtotal flagged the OTHER section's correct flocks
  // too — see pageChecksum.ts and docs/DECISIONS.md for exactly where that
  // came from). Computed against every flock the model found (matched or
  // not — the page's own arithmetic doesn't care whether a label matched a
  // known flock), section-by-section. A finding becomes ONE page-level
  // issue (never copied onto every flock row) — see the transaction below.
  const sectionFlocks: SectionFlock[] = flocks.map((f) => ({
    label: f.display_label_as_written,
    section: f.section,
    mortality: f.mortality,
    feed_bags: f.feed_bags,
    eggs_total: f.eggs_total,
    bird_population: f.bird_population,
  }));
  const checksumFindings = checkPageChecksums(sectionFlocks, extraction.section_subtotals ?? []);
  const pageIssueText = buildPageIssueText(checksumFindings);
  if (pageIssueText) {
    console.warn(`[upload] page checksum issue: ${pageIssueText}`);
  }

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

  try {
    await withTransaction(async (client) => {
      if (pageIssueText) {
        await client.query(
          `INSERT INTO daily_production_page_issues (farm_code, date, source_photo_url, issue_text)
           VALUES ($1, $2, $3, $4)`,
          [ACTIVE_FARM, date, photoUrl, pageIssueText]
        );
      }

      for (const flock of flocks) {
        const match = matchFlockLabel(flock.display_label_as_written, activeLabels);

        if (!match.flockInternalId) {
          // No flock matches this label, even after forgiving-formatting
          // normalization — genuinely don't know which flock this is. The
          // raw numbers are never discarded: they're saved here so the
          // owner can manually match them on /flagged without re-reading
          // the photo. daily_production.flock_internal_id is NOT NULL
          // (Phase 1, owner-approved), so this table is the only place a
          // row like this CAN live until it's resolved.
          await client.query(
            `INSERT INTO unresolved_extractions
                 (farm_code, register_type, date, display_label_as_written,
                  mortality, feed_bags, eggs_total, bird_population, hd_percent_written,
                  ocr_confidence, source_photo_url, sections_found, page_notes)
             VALUES ($1,'daily_production',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              ACTIVE_FARM,
              date,
              flock.display_label_as_written,
              flock.mortality,
              flock.feed_bags,
              flock.eggs_total,
              flock.bird_population,
              flock.hd_percent,
              JSON.stringify(flock.confidence),
              photoUrl,
              extraction.sections_found,
              extraction.page_notes,
            ]
          );
          unresolved.push(flock.display_label_as_written);
          continue;
        }

        // Day-to-day bal-bird chain check (owner-verified, 2026-09-28: held
        // exactly for all 10 flocks across two consecutive real pages) —
        // only applies against the IMMEDIATELY PRECEDING calendar day; a
        // gap (e.g. a skipped upload) means there's nothing to check against.
        const { rows: prevRows } = await client.query(
          `SELECT bird_population, eggs_total, hd_percent_written
             FROM daily_production
            WHERE flock_internal_id = $1 AND date = $2::date - 1 AND deleted_at IS NULL
            LIMIT 1`,
          [match.flockInternalId, date]
        );
        const prev = prevRows[0] as
          | { bird_population: number | null; eggs_total: number | null; hd_percent_written: string | null }
          | undefined;

        const chain = checkBalBirdChain({
          eggsTotal: flock.eggs_total,
          todayMortality: flock.mortality,
          todayExtractedBalBird: flock.bird_population,
          todayWrittenHd: flock.hd_percent,
          previousBalBird: prev?.bird_population ?? null,
          previousEggs: prev?.eggs_total ?? null,
          previousWrittenHd: prev?.hd_percent_written !== undefined && prev?.hd_percent_written !== null
            ? Number(prev.hd_percent_written)
            : null,
        });

        let birdPopulationForSave = flock.bird_population;
        let birdPopulationOriginal: number | null = null;
        let autoCorrectionNote: string | null = null;
        let suppressBirdPopulationIncreaseFlag = false;
        const chainExtraReasons: string[] = [];

        if (chain.kind === "auto_correct") {
          birdPopulationOriginal = flock.bird_population;
          birdPopulationForSave = chain.correctedBalBird;
          autoCorrectionNote = chain.note;
          autoCorrections.push({
            label: flock.display_label_as_written,
            date,
            field: "bird_population",
            from: flock.bird_population as number,
            to: chain.correctedBalBird,
            note: chain.note,
          });
        } else if (chain.kind === "flag_previous") {
          // Today's own reading stays as extracted — it's the previous
          // day's SAVED row that looks wrong. Never rewritten automatically;
          // flagged with a suggestion for the owner to confirm.
          suppressBirdPopulationIncreaseFlag = true;
          await client.query(
            `UPDATE daily_production
                SET flagged = true,
                    flag_reason = CASE
                        WHEN flag_reason IS NULL OR flag_reason = '' THEN $2
                        ELSE flag_reason || '; ' || $2
                    END
              WHERE flock_internal_id = $1 AND date = $3::date - 1 AND deleted_at IS NULL`,
            [match.flockInternalId, chain.note, date]
          );
        } else if (chain.kind === "flag_today") {
          chainExtraReasons.push(chain.note);
        }

        const { rowId, reasons, hdPercentNote, stableReasons } = await insertDailyProductionRow(
          client,
          ACTIVE_FARM,
          date,
          match.flockInternalId,
          {
            displayLabelAsWritten: flock.display_label_as_written,
            // shed_code is no longer extracted (owner decision, 2026-09-18)
            // — the column stays for manual entry, extraction just doesn't
            // populate it.
            shedCode: null,
            mortality: flock.mortality,
            feedBags: flock.feed_bags,
            eggsTotal: flock.eggs_total,
            birdPopulation: birdPopulationForSave,
            hdPercentWritten: flock.hd_percent,
            confidence: flock.confidence,
            sourcePhotoUrl: photoUrl,
            sectionsFound: extraction.sections_found,
            pageNotes: extraction.page_notes,
            eggsTotalReadings: flock.eggs_total_readings,
            birdPopulationReadings: flock.bird_population_readings,
            birdPopulationOriginal,
            autoCorrectionNote,
            suppressBirdPopulationIncreaseFlag,
            extraReasons: chainExtraReasons,
          }
        );

        if (reasons.length > 0) {
          const fields = impliedFields(reasons);
          if (fields.length > 0) {
            pendingRechecks.push({
              rowId,
              flockLabel: flock.display_label_as_written,
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
          label: flock.display_label_as_written,
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
      "Photo was read, but something went wrong saving the results — please try again."
    );
    return { ...EMPTY, photoUrl, error: friendly, technicalDetail: detail };
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
  };
}
