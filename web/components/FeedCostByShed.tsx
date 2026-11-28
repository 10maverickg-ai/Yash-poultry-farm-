// V19 B3: "Feed cost by shed" over the last 7 days with data: shed, formula, ₹/kg, bags, kg, cost, cost per egg.
// Each day's bags × BAG_KG × that day's price for the shed (flockFeedCosts, the same rule as every cost on the app).
import Link from "next/link";
import { BAG_KG, flockFeedCosts, flockFeedPrice, type CostInput } from "@/lib/costs/engine";
import { nextFormulationFor } from "@/lib/costs/feedPrice";
import { dmy, n0, n1 } from "@/lib/format";

const rs = (n: number, d = 2) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const rs0 = (n: number) => `₹${n0(n)}`;

export function FeedCostByShed({ input, now }: { input: CostInput; now: string }) {
  const formulations = input.formulations ?? [];
  const dates = [...new Set(input.prod.map((p) => p.date))].sort();
  const last7 = dates.slice(-7);
  const labels = input.flockLabels ?? {};
  const lastDay = dates[dates.length - 1];
  // the sheds on the register on the last entered day, in name order
  const live = [...new Set(input.prod.filter((p) => p.date === lastDay).map((p) => p.flockId))].sort((a, b) => (labels[a] ?? a).localeCompare(labels[b] ?? b, undefined, { numeric: true }));
  const costs = new Map(flockFeedCosts(input, last7).map((c) => [c.flockId, c]));
  const rows = live.map((id) => ({ id, label: labels[id] ?? id, now: flockFeedPrice(input, id, now), next: nextFormulationFor(formulations, labels[id], now), c: costs.get(id) ?? null }));
  const tot = rows.reduce((t, r) => ({ bags: t.bags + (r.c?.bags ?? 0), kg: t.kg + (r.c?.kg ?? 0), cost: r.c?.cost == null || t.cost == null ? null : t.cost + r.c.cost, eggs: t.eggs + (r.c?.eggs ?? 0) }), { bags: 0, kg: 0, cost: 0 as number | null, eggs: 0 });
  const pastUsed = rows.some((r) => r.c && r.c.prices.some((p) => p.label !== r.now.label || p.perKg !== r.now.perKg));
  return (
    <section className="card" id="by-shed" aria-labelledby="by-shed-h">
        <h2 id="by-shed-h" style={{ marginTop: 0 }}>Feed cost by shed — last 7 days with data ({last7.length ? `${dmy(last7[0])} to ${dmy(last7[last7.length - 1])}` : "none"})</h2>
        <p className="muted an-tiny" style={{ marginTop: 0 }}>
          Cost = each day&apos;s bags × {BAG_KG} kg × that day&apos;s price for the shed. &quot;₹/kg now&quot; is the price from today ({dmy(now)}).{pastUsed ? " Some of these 7 days are before a shed's formula started, so they cost the price of their own day (shown under the shed)." : ""} Cost per egg = the shed&apos;s feed cost ÷ its eggs in those days.
        </p>
        <div className="an-scroll">
          <table className="an-table ff-shed">
            <thead>
              <tr><th>Shed</th><th>Formula (now)</th><th className="num">₹/kg now</th><th className="num">Bags</th><th className="num">kg</th><th className="num">Feed cost</th><th className="num">Feed ₹ per egg</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/flocks/${r.id}`}>{r.label}</Link></td>
                  <td className="ff-wrap">
                    <span className="ff-cell">
                      {r.now.formulation ? <Link href={`/feed-formulas?open=${encodeURIComponent(r.now.formulation.code)}#f-${r.now.formulation.code}`}>{r.now.formulation.name}</Link> : r.now.source === "default" ? "farm default (no formula yet)" : "not entered"}
                      {r.next && <span className="muted an-tiny ff-sub">from {dmy(r.next.effectiveFrom)}: {r.next.name} ({rs(r.next.deliveredCostPerKg)}/kg)</span>}
                      {r.c && r.c.prices.some((p) => p.label !== r.now.label || p.perKg !== r.now.perKg) && <span className="muted an-tiny ff-sub">these 7 days: {r.c.prices.map((p) => (p.perKg != null ? `${rs(p.perKg)}/kg (${p.source === "formula" ? "formula" : "farm default"})` : "not entered")).join(", ")}</span>}
                    </span>
                  </td>
                  <td className="num">{r.now.perKg != null ? rs(r.now.perKg) : <span className="badge badge-flagged">not entered</span>}</td>
                  <td className="num">{r.c && r.c.daysWithFeed ? n0(r.c.bags) : <span className="muted">feed not recorded</span>}</td>
                  <td className="num">{r.c && r.c.daysWithFeed ? n0(r.c.kg) : ""}</td>
                  <td className="num">{!r.c || !r.c.daysWithFeed ? "" : r.c.cost != null ? rs0(r.c.cost) : <span className="badge badge-flagged">not entered</span>}</td>
                  <td className="num">{r.c?.costPerEgg != null ? rs(r.c.costPerEgg) : ""}</td>
                </tr>
              ))}
              <tr className="ff-allrow"><td>All sheds</td><td className="ff-wrap"><span className="ff-cell">each shed at its own price</span></td><td className="num">–</td><td className="num">{n0(tot.bags)}</td><td className="num">{n0(tot.kg)}</td><td className="num">{tot.cost != null ? rs0(tot.cost) : "not entered"}</td><td className="num">{tot.cost != null && tot.eggs > 0 ? rs(tot.cost / tot.eggs) : ""}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted an-tiny" style={{ marginBottom: 0 }}>
          {tot.eggs > 0 && tot.cost != null ? `${n0(tot.eggs)} eggs in these days; feed ${rs(tot.cost / tot.eggs)} per egg = ${rs((tot.cost / tot.eggs) * 30)} per tray of 30 · ${n1(tot.kg / Math.max(1, last7.length))} kg a day on average.` : ""} The farm total is the sum of the sheds, never all bags × one price.
        </p>
      </section>
  );
}
