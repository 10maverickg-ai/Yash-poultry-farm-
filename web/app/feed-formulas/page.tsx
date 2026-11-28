import Link from "next/link";
import { loadCostInput } from "@/lib/costs/load";
import { BAG_KG, flockFeedPrice } from "@/lib/costs/engine";
import { FeedCostByShed } from "@/components/FeedCostByShed";
import { costLines, defaultFeedPrice, nextFormulationFor, type Formulation } from "@/lib/costs/feedPrice";
import { todayIST } from "@/lib/weather/openMeteo";
import { dmy, n0 } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feed formulas" };

// V19 B1 / B3: the nutritionist's feed formulas, one card each, and what each shed's feed cost over the last 7 days.
// Every price here is read from feed_formulations as it is; a new row with a later date shows up with no code change.
const rs = (n: number, d = 2) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

function FormulaCard({ f, open, now }: { f: Formulation; open: boolean; now: string }) {
  const lines = costLines(f);
  const ingCost = f.ingredients.reduce((t, i) => t + (i.kgPerBatch * i.rupeesPerKg) / f.batchKg, 0);
  const pct = f.ingredients.reduce((t, i) => t + i.percent, 0);
  const kg = f.ingredients.reduce((t, i) => t + i.kgPerBatch, 0);
  const starts = f.effectiveFrom > now;
  return (
    <details className="card ff-card" id={`f-${f.code}`} open={open}>
      <summary className="ff-sum">
        <span className="ff-head">
          <strong className="ff-name">{f.name}</strong>
          <span className="ff-sheds">Sheds: <b>{f.sheds.length ? f.sheds.join(", ") : "none listed"}</b></span>
        </span>
        <span className="ff-price">
          <b>{rs(f.deliveredCostPerKg, 3)}</b> per kg delivered · <b>{rs(f.deliveredCostPerKg * BAG_KG)}</b> per {BAG_KG} kg bag
        </span>
        <span className="ff-facts muted an-tiny">
          Formula (ingredients) {rs(f.formulaCostPerKg, 3)}/kg{f.ameKcalPerKg != null ? ` · energy ${n0(f.ameKcalPerKg)} kcal/kg` : ""}{f.targetIntakeNote ? ` · ${f.targetIntakeNote}` : ""}
        </span>
        <span className="ff-facts muted an-tiny">{starts ? "Starts" : "Used from"} {dmy(f.effectiveFrom)}{f.source ? ` · ${f.source}` : ""}</span>
        {f.note && <span className="ff-note">Formulator&apos;s note: {f.note}</span>}
        <span className="ff-open">Ingredients and cost breakdown</span>
      </summary>
      <h3 className="ff-h">What a kg costs</h3>
      <table className="an-table ff-lines">
        <tbody>
          {lines.map((l) => (
            <tr key={l.label}><td>{l.label}</td><td className="num">{rs(l.perKg, 3)}</td></tr>
          ))}
          <tr className="ff-total"><td>Delivered cost per kg (what the app uses)</td><td className="num">{rs(f.deliveredCostPerKg, 3)}</td></tr>
          <tr><td>Per {BAG_KG} kg bag (the farm&apos;s bag)</td><td className="num">{rs(f.deliveredCostPerKg * BAG_KG)}</td></tr>
        </tbody>
      </table>
      <p className="muted an-tiny" style={{ margin: "0.3rem 0 0" }}>
        Delivered = formula cost ÷ (1 − {f.lossPct}% loss) + production + bagging. The {f.lossPct}% loss line is what that adds ({rs(f.formulaCostPerKg, 3)} ÷ {(1 - f.lossPct / 100).toFixed(2)} = {rs(f.formulaCostPerKg / (1 - f.lossPct / 100), 3)}).
      </p>
      <h3 className="ff-h">Ingredients ({f.ingredients.length}), largest first</h3>
      <div className="an-scroll">
        <table className="an-table ff-ing">
          <thead>
            <tr><th>Ingredient</th><th className="num">%</th><th className="num">kg per {n0(f.batchKg)} kg</th><th className="num">₹ per kg</th></tr>
          </thead>
          <tbody>
            {f.ingredients.map((i, k) => (
              <tr key={`${i.ingredient}-${k}`}><td>{i.ingredient}</td><td className="num">{i.percent.toFixed(3)}</td><td className="num">{i.kgPerBatch.toFixed(2)}</td><td className="num">{i.rupeesPerKg.toFixed(2)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th>Total</th><th className="num">{pct.toFixed(3)}</th><th className="num">{kg.toFixed(2)}</th><th className="num">{rs(ingCost, 3)}/kg</th></tr>
          </tfoot>
        </table>
      </div>
      <p className="muted an-tiny" style={{ margin: "0.3rem 0 0" }}>
        The ingredients add up to {rs(ingCost, 3)} per kg at the rates listed; the formulator&apos;s sheet says {rs(f.formulaCostPerKg, 3)} (the small difference is rounding of the rates). The app uses the sheet&apos;s delivered cost. The sheet also prints a 50 kg bag column; the farm&apos;s bag is {BAG_KG} kg, so the app uses {BAG_KG} kg.
      </p>
    </details>
  );
}

export default async function FeedFormulasPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams;
  const input = await loadCostInput();
  const formulations = input.formulations ?? [];
  const now = todayIST();
  const dates = [...new Set(input.prod.map((p) => p.date))].sort();
  const labels = input.flockLabels ?? {};
  const lastDay = dates[dates.length - 1];
  // the sheds on the register on the last entered day, in name order
  const live = [...new Set(input.prod.filter((p) => p.date === lastDay).map((p) => p.flockId))].sort((a, b) => (labels[a] ?? a).localeCompare(labels[b] ?? b, undefined, { numeric: true }));
  const rows = live.map((id) => ({ id, label: labels[id] ?? id, now: flockFeedPrice(input, id, now), next: nextFormulationFor(formulations, labels[id], now) }));
  const noFormula = rows.filter((r) => r.now.source !== "formula" && !r.next);
  // newest first; for the same date, in shed order (the formula of BAB-1 first, then BAB-2 …)
  const firstShed = (f: Formulation) => Math.min(...f.sheds.map((l) => Number(/(\d+)/.exec(l)?.[1] ?? 999)), 999);
  const byDate = [...formulations].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : firstShed(a) - firstShed(b)));
  const def = defaultFeedPrice(input.settings, now);

  return (
    <>
      <h1>Feed formulas</h1>
      <p className="muted an-sub" style={{ marginTop: 0 }}>
        The nutritionist&apos;s feed for each shed. From the date on its card, a shed&apos;s feed cost uses that formula&apos;s <b>delivered price per kg</b> (bags × {BAG_KG} kg × price). Days before that date, and sheds without a formula, use the farm default ({def ? `${rs(def.value)} per kg, own mill` : "not entered"}). Tap a card for its ingredients and how the price is made up.
      </p>
      {noFormula.length > 0 && (
        <p className="flag-banner">{noFormula.map((r) => r.label).join(", ")}: no formula yet, so {noFormula.length === 1 ? "its" : "their"} feed costs the farm default{noFormula[0].now.perKg != null ? ` ${rs(noFormula[0].now.perKg)} per kg` : " (not entered)"}.</p>
      )}
      {formulations.length === 0 ? (
        <p className="card muted">No feed formulas are stored yet. Every shed&apos;s feed costs the farm default.</p>
      ) : (
        byDate.map((f) => <FormulaCard key={f.id} f={f} open={open === f.code} now={now} />)
      )}

      <FeedCostByShed input={input} now={now} />
      <p className="muted an-foot"><Link href="/purchases">Farm default feed price (Purchases &amp; costs) →</Link> · <Link href="/analytics">Analytics →</Link></p>
    </>
  );
}
