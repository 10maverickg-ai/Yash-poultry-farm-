import Link from "next/link";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

export const dynamic = "force-dynamic";

const SHEETS = [
  { kind: "production", title: "Daily production", text: "Per flock per day: birds, deaths, feed bags, eggs, HD%." },
  { kind: "ledger", title: "Egg ledger", text: "Big and small: opening, produced, sales, breakage, other, closing." },
  { kind: "sales", title: "Egg sales", text: "Date, buyer, grade, eggs, price per egg, amount." },
  { kind: "costs", title: "Costs and profit", text: "Per day: revenue, each cost, total, estimated profit (estimate — labelled)." },
] as const;

export const metadata = { title: "Download to Excel" };

export default async function ExportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const { rows } = await pool.query(
    `SELECT DISTINCT to_char(date, 'YYYY-MM') AS m FROM daily_production WHERE farm_code = $1 AND deleted_at IS NULL ORDER BY m DESC`,
    [ACTIVE_FARM]
  );
  const months: string[] = rows.map((r) => r.m);
  const month = months.includes(sp.month ?? "") ? sp.month! : months[0] ?? new Date().toISOString().slice(0, 7);
  const weeks: string[] = [];
  const { weekStart } = await import("@/lib/analytics/period");
  const dateRows = await pool.query(`SELECT DISTINCT date FROM daily_production WHERE farm_code = $1 AND deleted_at IS NULL ORDER BY date DESC`, [ACTIVE_FARM]);
  for (const r of dateRows.rows) {
    const w = weekStart(String(r.date).slice(0, 10));
    if (!weeks.includes(w)) weeks.push(w);
  }
  return (
    <>
      <h1>Download to Excel</h1>
      <p className="muted">Real Excel files (numbers are numbers, dates are dates, totals row with formulas) and plain CSV. Nothing here changes any data.</p>
      <div className="actions-bar">
        {months.map((m) => (
          <Link key={m} href={`/export?month=${m}`} className={m === month ? "btn" : "btn btn-secondary"}>
            {new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}
          </Link>
        ))}
      </div>
      {SHEETS.map((s) => (
        <div key={s.kind} className="card stack">
          <h3 style={{ margin: 0 }}>{s.title} — {month}</h3>
          <p className="muted" style={{ margin: 0 }}>{s.text}</p>
          <div className="actions-bar" style={{ marginBottom: 0 }}>
            <a className="btn" href={`/export/download?kind=${s.kind}&month=${month}&format=xlsx`} download>Excel (.xlsx)</a>
            <a className="btn btn-secondary" href={`/export/download?kind=${s.kind}&month=${month}&format=csv`} download>CSV</a>
          </div>
        </div>
      ))}
      <section className="card stack" aria-label="Period summaries">
        <h3 style={{ margin: 0 }}>Week, month and year summaries</h3>
        <p className="muted" style={{ margin: 0 }}>One row per day (week, month) or per month (year), with HD% as a formula, a pooled HD% in the totals row, and the missing-input notes. Estimates are labelled.</p>
        <form method="get" action="/export/download" className="stack">
          <label className="field"><span>Week (Monday to Sunday)</span>
            <select name="p" defaultValue={weeks[0]}>{weeks.map((w) => <option key={w} value={w}>{w}</option>)}</select>
          </label>
          <label className="field"><span>Group</span>
            <select name="segment" defaultValue="main">
              <option value="main">Main flocks (big eggs)</option>
              <option value="young">Young flocks (small eggs)</option>
              <option value="all">Whole farm (sum of the groups)</option>
            </select>
          </label>
          <input type="hidden" name="kind" value="week" />
          <div className="actions-bar" style={{ marginBottom: 0 }}>
            <button type="submit" name="format" value="xlsx">Week — Excel</button>
            <button type="submit" name="format" value="csv" className="btn-secondary">CSV</button>
          </div>
        </form>
        {[["month", month], ["year", month.slice(0, 4)]].map(([k, p]) => (
          <div key={k} className="stack">
            <b>{k === "month" ? `Month ${p}` : `Year ${p}`}</b>
            <div className="actions-bar" style={{ marginBottom: 0 }}>
              {[["main", "Main"], ["young", "Young"], ["all", "Whole farm"]].map(([sg, label]) => (
                <a key={sg} className={sg === "all" ? "btn btn-secondary" : "btn"} href={`/export/download?kind=${k}&p=${p}&segment=${sg}&format=xlsx`} download>{label} — Excel</a>
              ))}
            </div>
            <div className="actions-bar" style={{ marginBottom: 0 }}>
              {[["main", "Main"], ["young", "Young"], ["all", "Whole farm"]].map(([sg, label]) => (
                <a key={sg} className="btn btn-secondary" href={`/export/download?kind=${k}&p=${p}&segment=${sg}&format=csv`} download>{label} — CSV</a>
              ))}
            </div>
          </div>
        ))}
      </section>
      <p className="card muted">
        Want everything, for safekeeping? <Link href="/export/backup">Download the full backup (one zip)</Link>.
      </p>
    </>
  );
}
