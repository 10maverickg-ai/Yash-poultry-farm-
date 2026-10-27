import { getEggStockDay } from "@/lib/eggstock";
import { EggStockForm } from "@/components/EggStockForm";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

export const dynamic = "force-dynamic";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function EggStockPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayISO();
  const day = await getEggStockDay(date);
  // The two ledgers belong to the two groups: big = main flocks, small = young flocks (docs/DECISIONS.md).
  const seg = await pool.query(
    `SELECT coalesce(f.segment, 'none') AS segment, coalesce(sum(d.eggs_total), 0)::int AS eggs
       FROM daily_production d JOIN flocks f USING (flock_internal_id)
      WHERE d.farm_code = $1 AND d.date = $2 AND d.deleted_at IS NULL GROUP BY 1`,
    [ACTIVE_FARM, date]
  );
  const eggsOf = (k: string) => Number(seg.rows.find((r) => r.segment === k)?.eggs ?? 0);
  const groups = [
    { name: "Main flocks (big ledger)", sec: day.sections.find((s) => s.section === "big")?.summary ?? null, flocks: eggsOf("main") },
    { name: "Young flocks (small ledger)", sec: day.sections.find((s) => s.section === "small")?.summary ?? null, flocks: eggsOf("young") },
  ];
  const n0 = (x: number | null | undefined) => (x == null ? "–" : x.toLocaleString("en-IN"));
  const sumOf = (f: (g: (typeof groups)[number]) => number | null | undefined) => groups.reduce((t, g) => t + (f(g) ?? 0), 0);
  const allFlocks = seg.rows.reduce((t, r) => t + Number(r.eggs), 0);

  return (
    <>
      <h1>Egg Stock Ledger</h1>

      <form method="get" className="card actions-bar" style={{ alignItems: "end" }}>
        <label className="field" style={{ flex: 1 }}>
          <span>Date</span>
          <input type="date" name="date" defaultValue={date} />
        </label>
        <button type="submit" className="btn-secondary">
          Load
        </button>
      </form>

      {sp.saved && (
        <div className="saved-banner">
          Saved. Sale lines have matching rows on the Sales page; any balance
          mismatch shows as a flag above the form.
        </div>
      )}

      <section className="card" aria-label="Ledger by group">
        <h2 style={{ marginTop: 0 }}>The two ledgers, by group</h2>
        <div className="an-scroll" style={{ padding: 0 }}>
          <table className="an-table" style={{ minWidth: 0 }}>
            <thead><tr><th>Group</th><th className="num">Opening</th><th className="num">Laid (ledger)</th><th className="num">Laid (flock rows)</th><th className="num">Closing</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name}>
                  <td>{g.name}</td>
                  <td className="num">{n0(g.sec?.opening_balance_eggs)}</td>
                  <td className="num">{n0(g.sec?.total_eggs_produced)}</td>
                  <td className="num">{n0(g.flocks)}</td>
                  <td className="num">{n0(g.sec?.closing_balance_eggs)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th>Whole farm</th><th className="num">{n0(sumOf((g) => g.sec?.opening_balance_eggs))}</th><th className="num">{n0(sumOf((g) => g.sec?.total_eggs_produced))}</th><th className="num">{n0(allFlocks)}</th><th className="num">{n0(sumOf((g) => g.sec?.closing_balance_eggs))}</th></tr>
            </tfoot>
          </table>
        </div>
        <p className="muted an-foot" style={{ marginBottom: 0 }}>
          Check: {groups.every((g) => g.sec) ? (
            groups.every((g) => g.sec!.total_eggs_produced == null || g.sec!.total_eggs_produced === g.flocks)
              ? "each ledger's laid figure equals its own flocks' rows, and the whole farm is the sum of the two ✓."
              : "a ledger's laid figure differs from its own flocks' rows (before 4 Oct the small ledger held graded small eggs of the main flocks, so it will not match its rows then)."
          ) : "one of the two ledgers is not saved for this day."}
        </p>
      </section>

      <EggStockForm key={date} date={date} day={day} />
    </>
  );
}
