import Link from "next/link";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { loadCostInput } from "@/lib/costs/load";
import { monthEconomics } from "@/lib/costs/engine";
import { ExportLinks } from "@/components/ExportLinks";
import { addCostSetting, addPurchase, addDiesel } from "./actions";

export const dynamic = "force-dynamic";

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
const monthName = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const TYPE_LABEL: Record<string, string> = {
  feed_per_kg: "Feed price per kg (own mill)",
  labour_month: "Labour per month",
  electricity_month: "Electricity for a month",
  packing_per_tray: "Packing per tray sold",
};

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const [input, settings, purchases, diesel] = await Promise.all([
    loadCostInput(),
    pool.query(`SELECT cost_type, value, unit, effective_from, month, note FROM cost_settings WHERE farm_code = $1 ORDER BY cost_type, effective_from DESC`, [ACTIVE_FARM]),
    pool.query(`SELECT date, category, item, quantity, unit, amount_inr, supplier FROM purchases WHERE farm_code = $1 ORDER BY date DESC, id DESC LIMIT 30`, [ACTIVE_FARM]),
    pool.query(`SELECT date, litres, amount_inr FROM diesel_purchases WHERE farm_code = $1 ORDER BY date DESC, id DESC LIMIT 15`, [ACTIVE_FARM]),
  ]);
  const months = [...new Set(input.prod.map((p) => p.date.slice(0, 7)))].sort().reverse();

  return (
    <>
      <h1>Purchases &amp; costs</h1>
      {sp.saved && <div className="saved-banner">{sp.saved}</div>}
      {sp.error && <div className="error-banner">{sp.error}</div>}

      {months.length > 0 && (
        <div className="card">
          <ExportLinks kind="costs" month={months[0]} label="Costs and profit" />
        </div>
      )}
      <h2>Monthly cost (estimate)</h2>
      <p className="muted an-sub">
        Feed is exact (bags × 45 kg × price). Electricity and labour are the month&apos;s amount spread evenly over its days; packing is per tray sold; diesel and medicines count on the day bought. A month with no electricity entered shows as missing, not as zero.
      </p>
      {months.map((m) => {
        const e = monthEconomics(input, m);
        return (
          <div key={m} className="card">
            <h3 style={{ marginTop: 0 }}>{monthName(m)}</h3>
            <table className="an-table" style={{ minWidth: 0 }}>
              <tbody>
                <tr><td>Feed</td><td className="num">₹{inr(e.cost.feed)}</td></tr>
                <tr><td>Electricity</td><td className="num">₹{inr(e.cost.electricity)}</td></tr>
                <tr><td>Labour</td><td className="num">₹{inr(e.cost.labour)}</td></tr>
                <tr><td>Packing</td><td className="num">₹{inr(e.cost.packing)}</td></tr>
                <tr><td>Diesel</td><td className="num">₹{inr(e.cost.diesel)}</td></tr>
                <tr><td>Medicines &amp; vaccines</td><td className="num">₹{inr(e.cost.medicine)}</td></tr>
                <tr><td>Other purchases</td><td className="num">₹{inr(e.cost.other)}</td></tr>
              </tbody>
              <tfoot>
                <tr><th>Total cost</th><th className="num">₹{inr(e.cost.total)}</th></tr>
                <tr><td>Egg revenue (priced sales)</td><td className="num">{e.revenue ? `₹${inr(e.revenue)}` : "—"}</td></tr>
                <tr><th>Estimated profit</th><th className="num">{e.revenue ? `₹${inr(e.profit)}` : "—"}</th></tr>
              </tfoot>
            </table>
            {e.chickPurchases > 0 && <p className="muted an-tiny">Chick purchases this month (not in the total): ₹{inr(e.chickPurchases)}</p>}
            {e.birdSaleRevenue > 0 && <p className="muted an-tiny">Bird sales this month (not in egg revenue): ₹{inr(e.birdSaleRevenue)}</p>}
            {e.unpricedEggsSold > 0 && <div className="flag-banner">{e.unpricedEggsSold.toLocaleString("en-IN")} eggs were sold without a BAFTA rate, so revenue and profit here are incomplete. <Link href="/sales/rates">Enter the rates</Link>.</div>}
            {e.missing.length > 0 && <div className="flag-banner">Not entered: {e.missing.join(", ")}.</div>}
          </div>
        );
      })}

      <h2>Cost settings</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>What</th><th>Value</th><th>From</th><th>Note</th></tr></thead>
          <tbody>
            {settings.rows.map((s, i) => (
              <tr key={i}>
                <td>{TYPE_LABEL[s.cost_type] ?? s.cost_type}{s.month ? ` (${s.month})` : ""}</td>
                <td>₹{Number(s.value).toLocaleString("en-IN")} {s.unit}</td>
                <td>{String(s.effective_from).slice(0, 10)}</td>
                <td className="muted">{s.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={addCostSetting} className="card stack">
        <h3 style={{ margin: 0 }}>Add or change a cost</h3>
        <label className="field"><span>What</span>
          <select name="type" defaultValue="">
            <option value="" disabled>Choose…</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
        </label>
        <label className="field"><span>Amount (₹)</span><input type="number" name="value" step="0.01" min="0" inputMode="decimal" /></label>
        <label className="field"><span>Applies from</span><input type="date" name="effective_from" defaultValue={today} /></label>
        <label className="field"><span>Month <span className="hint">(electricity only)</span></span><input type="month" name="month" /></label>
        <label className="field"><span>Note</span><input type="text" name="note" /></label>
        <button type="submit">Save cost</button>
      </form>

      <h2>Purchases</h2>
      <form action={addPurchase} className="card stack">
        <h3 style={{ margin: 0 }}>Add a purchase</h3>
        <label className="field"><span>Category</span>
          <select name="category" defaultValue="">
            <option value="" disabled>Choose…</option>
            <option value="feed_ingredient">Feed ingredient</option>
            <option value="chicks">Chicks</option>
            <option value="packing">Packing</option>
            <option value="electricity">Electricity</option>
            <option value="labour">Labour</option>
            <option value="medicine">Medicine</option>
            <option value="vaccine">Vaccine</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field"><span>Date</span><input type="date" name="date" defaultValue={today} /></label>
        <label className="field"><span>What</span><input type="text" name="item" /></label>
        <div className="row2">
          <label className="field"><span>Quantity</span><input type="number" name="quantity" step="any" min="0" inputMode="decimal" /></label>
          <label className="field"><span>Unit</span><input type="text" name="unit" placeholder="bags, doses…" /></label>
        </div>
        <label className="field"><span>Amount (₹)</span><input type="number" name="amount_inr" step="0.01" min="0" inputMode="decimal" /></label>
        <label className="field"><span>Supplier</span><input type="text" name="supplier" /></label>
        <label className="field"><span>Note</span><input type="text" name="note" /></label>
        <button type="submit">Save purchase</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Category</th><th>What</th><th>Qty</th><th>₹</th></tr></thead>
          <tbody>
            {purchases.rows.length === 0 ? (<tr><td colSpan={5} className="muted">No purchases entered yet.</td></tr>) : purchases.rows.map((p, i) => (
              <tr key={i}><td>{p.date}</td><td>{p.category.replace("_", " ")}</td><td>{p.item}{p.supplier ? <span className="muted"> · {p.supplier}</span> : null}</td><td>{p.quantity ?? ""} {p.unit ?? ""}</td><td>{inr(Number(p.amount_inr))}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Diesel</h2>
      <form action={addDiesel} className="card stack">
        <h3 style={{ margin: 0 }}>Drum filled</h3>
        <label className="field"><span>Date</span><input type="date" name="date" defaultValue={today} /></label>
        <label className="field"><span>Litres</span><input type="number" name="litres" step="0.1" min="0" inputMode="decimal" /></label>
        <label className="field"><span>Amount (₹)</span><input type="number" name="amount_inr" step="0.01" min="0" inputMode="decimal" /></label>
        <label className="field"><span>Note</span><input type="text" name="note" /></label>
        <button type="submit">Save diesel</button>
      </form>
      {diesel.rows.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Litres</th><th>₹</th></tr></thead>
          <tbody>{diesel.rows.map((d, i) => (<tr key={i}><td>{d.date}</td><td>{Number(d.litres)}</td><td>{inr(Number(d.amount_inr))}</td></tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
