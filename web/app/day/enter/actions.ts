"use server";

import { withTransaction, pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { insertDailyProductionRow } from "@/lib/extraction/writeDailyProduction";
import { writeEggLedgerSection, writeFeedBox } from "@/lib/extraction/writeLedgerFeed";
import type { ResolvedEggLedgerSection } from "@/lib/extraction/eggLedgerResolve";
import type { ResolvedFeedBox } from "@/lib/extraction/feedBoxResolve";
import type { EntryCategory } from "@/lib/eggstock-types";
import { answerCategory, answerLabel, checkDay, derive, parseDay, problems, reasonsFor, signedEggs, type LedgerDay } from "@/lib/day/manualDay";

export interface DayState {
  ok: boolean;
  message: string;
  problems?: string[]; // what does not tie (saved anyway, flagged)
  date?: string;
}

const SOURCE = "manual entry";

function resolvedLedger(section: "big" | "small", l: LedgerDay, produced: number, totalLine: number | null, computedClosing: number | null): ResolvedEggLedgerSection {
  return {
    section,
    openingBalanceEggs: l.opening,
    openingBalanceEggsOriginal: null,
    totalEggsProduced: produced,
    totalEggsProducedOriginal: null,
    totalLineEggs: totalLine,
    totalLineEggsOriginal: null,
    closingBalanceEggs: l.closing ?? computedClosing,
    closingBalanceEggsOriginal: null,
    // the writer stores deductions negative: amountEggs is the magnitude of what LEFT, so eggs ADDED are passed as a negative magnitude
    deductions: l.lines.map((ln) => ({
      labelAsWritten: ln.label.trim() || `${answerLabel(ln.answer)} (${signedEggs(ln) >= 0 ? "+" : "-"})`,
      amountEggs: -signedEggs(ln),
      amountEggsOriginal: null,
      categoryGuess: answerCategory(ln.answer) as EntryCategory,
      confidence: 1,
    })),
    autoCorrectionNote: null,
  };
}

/**
 * Saves the day the owner typed: the SAME writers the photo reader uses (insertDailyProductionRow, writeFeedBox, writeEggLedgerSection,
 * which also create the sales rows), so a manual day and a read day look the same in every table. The day's rows are tagged
 * "manual entry". Anything that does not tie is saved anyway and FLAGGED (the app never rejects a day); nothing is guessed.
 */
export async function saveManualDay(_prev: DayState | null, formData: FormData): Promise<DayState> {
  try {
    const day = parseDay(String(formData.get("payload") ?? ""));
    if (!day) return { ok: false, message: "The page could not be read. Reload it and try again; nothing was saved." };
    const checks = checkDay(day);
    const hard = checks.filter((c) => c.level === "error");
    if (hard.length) return { ok: false, message: hard.map((c) => c.text).join(" ") };
    const withData = day.flocks.filter((f) => f.mortality != null || f.feed != null || f.eggs != null || f.birds != null);
    if (withData.length === 0) return { ok: false, message: "No flock has any figures yet. Type the eggs and deaths first." };
    const { rows: ex } = await pool.query(`SELECT count(*)::int AS n FROM daily_production WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`, [ACTIVE_FARM, day.date]);
    if (ex[0].n > 0 && formData.get("replace") !== "yes") return { ok: false, message: `${day.date} is already saved. Tick “Replace the saved day” if this typed page is the right one.` };
    const x = derive(day);
    const mainIds = day.flocks.filter((f) => f.group === "main").map((f) => f.flockId);
    const youngIds = day.flocks.filter((f) => f.group === "young").map((f) => f.flockId);
    const flags: string[] = [];

    await withTransaction(async (client) => {
      for (const f of withData) {
        const r = await insertDailyProductionRow(client, ACTIVE_FARM, day.date, f.flockId, {
          displayLabelAsWritten: f.label,
          shedCode: null,
          mortality: f.mortality,
          feedBags: f.group === "main" ? f.feed : null,
          noFeedColumn: f.group === "young",
          eggsTotal: f.eggs,
          birdPopulation: f.birds,
          hdPercentWritten: null,
          confidence: null,
          sourcePhotoUrl: null,
          sectionsFound: null,
          pageNotes: "Typed in the app (Enter a day by hand).",
          extraReasons: reasonsFor(checks, f.flockId),
        });
        await client.query(`UPDATE daily_production SET source_tag = $2 WHERE id = $1`, [r.rowId, SOURCE]);
        if (r.reasons.length) flags.push(`${f.label}: ${r.reasons.join("; ")}`);
      }
      // feed box: ONE box for the whole right page (group ALL), as in the register since 21 Aug
      if (day.feed.opening != null || day.feed.produced != null || day.feed.mill != null || day.feed.shed != null) {
        const resolved: ResolvedFeedBox = {
          flockGroup: "ALL",
          openingBalanceBags: day.feed.opening, openingBalanceBagsOriginal: null,
          producedBags: day.feed.produced, producedBagsOriginal: null,
          totalBags: x.feedTotal, totalBagsOriginal: null,
          consumedBags: x.feedConsumed, consumedBagsOriginal: null,
          millInventoryBags: day.feed.mill, millInventoryBagsOriginal: null,
          shedInventoryBags: day.feed.shed, shedInventoryBagsOriginal: null,
          closingBalanceBags: day.feed.mill != null || day.feed.shed != null ? (day.feed.mill ?? 0) + (day.feed.shed ?? 0) : x.feedClosing,
          closingBalanceBagsOriginal: null,
          autoCorrectionNote: null,
        };
        const w = await writeFeedBox(client, ACTIVE_FARM, day.date, null, resolved, mainIds);
        await client.query(`UPDATE daily_feed_bag_stock SET source_tag = $2 WHERE id = $1`, [w.id, SOURCE]);
        if (w.flagged) flags.push(`Feed box: ${w.flagReason}`);
      }
      for (const [sec, led, v, ids] of [["big", day.big, x.big, mainIds], ["small", day.small, x.small, youngIds]] as const) {
        if (led.opening == null && led.lines.length === 0 && v.produced === 0) continue;
        const w = await writeEggLedgerSection(client, ACTIVE_FARM, day.date, null, resolvedLedger(sec, led, v.produced, v.totalLine, v.closing), ids);
        await client.query(`UPDATE daily_egg_stock_summary SET source_tag = $2 WHERE id = $1`, [w.id, SOURCE]);
        if (w.flagged) flags.push(`${sec === "big" ? "Big" : "Small"} egg ledger: ${w.flagReason}`);
      }
      // chick rows: the day's rows are replaced by what was typed
      await client.query(`DELETE FROM chick_daily_mortality WHERE farm_code = $1 AND date = $2`, [ACTIVE_FARM, day.date]);
      let pos = 0;
      for (const c of day.chick) {
        pos++;
        await client.query(`INSERT INTO chick_daily_mortality (farm_code, date, row_position, label_as_written, deaths, source) VALUES ($1,$2,$3,$4,$5,$6)`, [ACTIVE_FARM, day.date, pos, c.label, c.deaths, SOURCE]);
      }
    });

    const bad = problems(checks).map((c) => c.text);
    return {
      ok: true,
      date: day.date,
      problems: [...bad, ...flags.filter((f) => !bad.some((b) => f.includes(b.slice(0, 20))))],
      message: `${day.date} is saved: ${withData.length} flock rows, the feed box, the egg ledgers and the chick rows${bad.length ? `. ${bad.length} thing${bad.length === 1 ? "" : "s"} did not tie and ${bad.length === 1 ? "is" : "are"} flagged for review.` : ". Everything ties."}`,
    };
  } catch (e) {
    return { ok: false, message: `The day could not be saved just now (${e instanceof Error ? e.message.slice(0, 120) : "unknown error"}). Nothing on this screen was lost; try again in a moment.` };
  }
}
