// Runs every check and regression script and prints one pass/fail table.   npx tsx scripts/run-all.mts [--fixtures <dir>] [--only <text>]
// Without --fixtures it dumps fresh fixtures from the database in DATABASE_URL (default: the local copy) into a temp folder,
// so the numbers the checks expect are always derived from the data as it is today.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const only = arg("--only");
let fx = arg("--fixtures");
const run = (cmd: string, a: string[]) => spawnSync(cmd, a, { encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });

if (!fx) {
  fx = mkdtempSync(join(tmpdir(), "farm-fixtures-"));
  const d = run("npx", ["tsx", "scripts/dump-fixtures.mts", fx]);
  if (d.status !== 0) {
    console.log(`Could not dump fixtures from the database (${(d.stderr || d.stdout).trim().split("\n").pop()}). Checks that need fixtures are SKIPPED.`);
    fx = undefined;
  }
}

const needsFixture = ["analytics-check", "costs-check", "period-check", "segment-check", "health-check"];
const checks = [
  "analytics-check", "costs-check", "period-check", "segment-check", "std-for-check", "rates-check", "friendly-check", "plain-check",
  "realistic-check", "import-check", "weather-check", "heat-check", "health-check", "medicines-check", "manualday-check", "reprice-check",
].filter((n) => readdirSync("scripts").includes(`${n}.mts`));
const regressions = readdirSync("scripts").filter((f) => /^regression-.*\.ts$/.test(f)).sort();

const rows: { name: string; status: string; detail: string }[] = [];
const go = (name: string, file: string, extra: string[] = []) => {
  if (only && !name.includes(only)) return;
  if (needsFixture.includes(name) && !fx) return void rows.push({ name, status: "SKIPPED", detail: "no fixtures" });
  const r = run("npx", ["tsx", `scripts/${file}`, ...extra]);
  const text = (r.stdout ?? "") + (r.stderr ?? "");
  const pass = (text.match(/^PASS/gm) ?? []).length;
  const fail = (text.match(/^FAIL/gm) ?? []).length;
  const first = (text.match(/^FAIL.*$/m) ?? [""])[0].slice(0, 110);
  rows.push({ name, status: r.status === 0 && fail === 0 ? "PASS" : "FAIL", detail: pass + fail > 0 ? `${pass} pass, ${fail} fail${first ? ` — ${first}` : ""}` : r.status === 0 ? "exit 0" : text.trim().split("\n").pop()!.slice(0, 120) });
};
for (const n of checks) go(n, `${n}.mts`, needsFixture.includes(n) && fx ? [fx] : []);
for (const f of regressions) go(f.replace(/\.ts$/, ""), f);

const w = Math.max(...rows.map((r) => r.name.length));
console.log("\nCheck".padEnd(w + 2) + "Result   Detail\n" + "-".repeat(w + 40));
for (const r of rows) console.log(`${r.name.padEnd(w + 1)} ${r.status.padEnd(8)} ${r.detail}`);
const bad = rows.filter((r) => r.status === "FAIL").length;
console.log(`\n${rows.length} scripts: ${rows.filter((r) => r.status === "PASS").length} pass, ${bad} fail, ${rows.filter((r) => r.status === "SKIPPED").length} skipped`);
process.exit(bad ? 1 : 0);
