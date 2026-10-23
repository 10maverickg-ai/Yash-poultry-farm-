// Offline benchmark runner: runs the NEW reader (+ correction stages) on a
// local photo and scores it against saved values exported to JSON
// (benchmark-data/*.json) — no DATABASE_URL, no production writes, never
// touches READER_V2_ENABLED. Usage (from web/):
//   ANTHROPIC_API_KEY="$READER_TEST_KEY" ANTHROPIC_BASE_URL=https://api.anthropic.com \
//     npx tsx scripts/run-reader-benchmark-offline.ts <date> <photo.jpg> <out.json> [--skip-old] [--cache raw.json] [--no-reread]
// --cache <file>  replay the raw orientation + half-page reads from <file> if
//                 it exists (saving vision calls while iterating on the
//                 correction logic), otherwise read live and save them there.
// --no-reread     disable the zoomed re-reads (shows what the pure repair
//                 stages alone achieve).
import fs from "node:fs";
import path from "node:path";
import { getAnthropicClient } from "../lib/extraction/anthropicClient";
import { runBenchmarkForDate, type ScoreSummary } from "../lib/extraction/readerV2/benchmark";
import { jsonSavedData } from "../lib/extraction/readerV2/savedData";
import { detectPageOrientation } from "../lib/extraction/readerV2/pageOrientation";
import { extractPageHalf } from "../lib/extraction/readerV2/pageHalfRegion";
import type { PipelineDeps } from "../lib/extraction/readerV2/halfPipeline";
import { liveCorrectionDeps, type CorrectionDeps } from "../lib/extraction/readerV2/corrections";

// $ per million tokens (input, output) — Sonnet-class pricing; override
// with PRICE_IN / PRICE_OUT if the account's rates differ.
const PRICE_IN = Number(process.env.PRICE_IN ?? 3);
const PRICE_OUT = Number(process.env.PRICE_OUT ?? 15);

function pct(t: { comparable: number; correct: number }) {
  return t.comparable === 0 ? "n/a" : `${t.correct}/${t.comparable} (${((100 * t.correct) / t.comparable).toFixed(1)}%)`;
}

function printScore(name: string, s: ScoreSummary) {
  console.log(`  ${name.padEnd(10)} overall ${pct(s.overall)}`);
  console.log(`             flocks  ${Object.entries(s.flocks).map(([k, v]) => `${k} ${pct(v)}`).join(" | ")}`);
  console.log(`             subtot  ${Object.entries(s.subtotals).map(([k, v]) => `${k} ${pct(v)}`).join(" | ")}`);
  console.log(`             ledger  ${Object.entries(s.ledgers).map(([k, v]) => `${k.replace("_eggs", "")} ${pct(v)}`).join(" | ")} | deductions ${pct(s.deductions)}`);
  console.log(`             feed    ${Object.entries(s.feedBoxes).map(([k, v]) => `${k.replace("_bags", "")} ${pct(v)}`).join(" | ")}`);
  console.log(`             margin notes ${pct(s.marginNotes)}`);
}

async function main() {
  const [date, photo, out, ...flags] = process.argv.slice(2);
  const client = getAnthropicClient();
  const calls: { tool: string; in: number; out: number }[] = [];
  const orig = client.messages.create.bind(client.messages);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client.messages as any).create = async (...args: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await (orig as any)(...args);
    calls.push({ tool: args[0]?.tools?.[0]?.name ?? "?", in: r.usage?.input_tokens ?? 0, out: r.usage?.output_tokens ?? 0 });
    return r;
  };

  const cacheIdx = flags.indexOf("--cache");
  const cacheFile = cacheIdx >= 0 ? flags[cacheIdx + 1] : null;
  let pipelineDeps: PipelineDeps | undefined;
  if (cacheFile) {
    const cached = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : null;
    const recorded: { orientation: unknown; halves: unknown[] } = { orientation: null, halves: [] };
    let i = 0;
    pipelineDeps = {
      detectOrientation: async (b, m) => {
        if (cached) return cached.orientation;
        recorded.orientation = await detectPageOrientation(b, m);
        return recorded.orientation as never;
      },
      extractHalf: async (b, m, side) => {
        if (cached) return cached.halves[i++];
        const r = await extractPageHalf(b, m, side);
        recorded.halves.push(r);
        return r;
      },
    };
    process.on("exit", () => { if (!cached) fs.writeFileSync(cacheFile, JSON.stringify(recorded)); });
  }
  const correctionDeps: CorrectionDeps | undefined = flags.includes("--no-reread")
    ? { rereadSection: async () => { throw new Error("re-reads disabled"); }, rereadLedger: async () => { throw new Error("re-reads disabled"); }, rereadFeedBox: async () => { throw new Error("re-reads disabled"); } }
    : liveCorrectionDeps;

  const source = jsonSavedData(path.join(__dirname, "../benchmark-data/saved-2026-08-03_2026-08-08.json"));
  const result = await runBenchmarkForDate(date, "offline", undefined, {
    source,
    photoBuffer: fs.readFileSync(photo),
    skipOldReader: flags.includes("--skip-old"),
    pipelineDeps,
    correctionDeps,
  });

  const tin = calls.reduce((a, c) => a + c.in, 0);
  const tout = calls.reduce((a, c) => a + c.out, 0);
  const cost = (tin * PRICE_IN + tout * PRICE_OUT) / 1e6;
  const byTool: Record<string, number> = {};
  for (const c of calls) byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;

  console.log(`\n=== ${date} ===`);
  console.log(`Comparing against saved data of ${result.savedDataDate}`);
  console.log(`photo reads as ${result.v2DateRead} (dateMismatch=${result.dateMismatch}); rotation ${result.rotation.appliedRotationDegrees}°${result.rotation.retriedWith180 ? " (180° retry)" : ""}`);
  printScore("RAW", result.rawScores);
  printScore("CORRECTED", result.correctedScores);
  console.log(`  correction: ${result.correction.outcomes.length} cell outcomes, ${result.correction.rereadCalls} zoomed re-read call(s)`);
  for (const l of result.correction.log) console.log(`   - ${l}`);
  for (const w of result.correction.warnings) console.log(`   ! ${w}`);
  console.log(`  still wrong AND unflagged: ${result.unflaggedWrong.length}`);
  for (const u of result.unflaggedWrong) console.log(`   x ${u}`);
  console.log(`  vision calls: ${calls.length} ${JSON.stringify(byTool)}; tokens in ${tin} / out ${tout}; approx cost $${cost.toFixed(3)}`);

  const slim = { ...result, debugImages: { ...result.debugImages, fullPageWithSpine: null, halves: [] } };
  fs.writeFileSync(out, JSON.stringify({ result: slim, usage: { calls, tin, tout, cost } }, null, 1));
}
main().catch((e) => { console.error(String(e?.stack ?? e).slice(0, 1500)); process.exit(1); });
