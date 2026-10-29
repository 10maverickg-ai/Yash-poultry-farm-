import Link from "next/link";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { loadCostInput } from "@/lib/costs/load";
import { dmy } from "@/lib/format";
import { monthEconomics } from "@/lib/costs/engine";
import { ExportLinks } from "@/components/ExportLinks";
import { addCostSetting, addPurchase, addDiesel, completeMonthInput } from "./actions";
import { monthChecklist, type ChecklistItem } from "@/lib/costs/inputs";

export const dynamic = "force-dynamic";

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
const monthName = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const TYPE_LABEL: Record<string, string> = {
  feed_per_kg: "Feed price per kg (own mill)",
  labour_month: "Labour per month",
  electricity_month: "Electricity for a month",
  packing_per_tray: "Packing per tray sold",
  chick_cost_per_chick: "Chick price (average per chick)",
  diesel_month: "Diesel for a month",
  medicines_month: "Medicines for a month",
};

function Checklist({ month, items }: { month: string; items: ChecklistItem[] }) {
  const missing = items.filter((i) => !i.done);
  return (
    <details className="card checklist" open={missing.length > 0}>
      <summary>
        {missing.length === 0 ? "All monthly inputs dealt with ✓" : `${missing.length} input${missing.length === 1 ? "" : "s"} still missing — tap to complete (about 2 minutes)`}
      </summary>
      {items.map((i) => (
        <div key={i.key} className={`check-item ${i.done ? "check-done" : ""}`}>
          <div><b>{i.done ? "✓" : "○"} {i.label}</b> <span className="muted an-tiny">— {i.how}</span></div>
          {!i.done && (
            <form action={completeMonthInput.bind(null, month, i.key)} className="check-form">
              {i.key === "electricity" && (<><input type="number" name="value" step="0.01" min="0" inputMode="decimal" placeholder="Bill ₹" aria-label="Electricity bill in rupees" /><button type="submit">Save</button></>)}
              {i.key === "diesel" && (<><input type="number" name="litres" step="0.1" min="0" inputMode="decimal" placeholder="Litres" aria-label="Litres" /><input type="number" name="amount_inr" step="0.01" min="0" inputMode="decimal" placeholder="₹" aria-label="Amount in rupees" /><input type="date" name="date" defaultValue={`${month}-01`} min={`${month}-01`} aria-label="Date" /><button type="submit">Save</button><button type="submit" name="none" value="1" className="btn-secondary">None this month</button></>)}
              {i.key === "medicines" && (<><input type="text" name="item" placeholder="What" aria-label="What was bought" /><input type="number" name="amount_inr" step="0.01" min="0" inputMode="decimal" placeholder="₹" aria-label="Amount in rupees" /><input type="date" name="date" defaultValue={`${month}-01`} min={`${month}-01`} aria-label="Date" /><button type="submit">Save</button><button type="submit" name="none" value="1" className="btn-secondary">None this month</button></>)}
              {i.key === "other" && (<><input type="text" name="item" placeholder="What" aria-label="What it was" /><input type="number" name="amount_inr" step="0.01" min="0" inputMode="decimal" placeholder="₹" aria-label="Amount in rupees" /><input type="date" name="date" defaultValue={`${month}-01`} min={`${month}-01`} aria-label="Date" /><button type="submit">Save</button><button type="submit" name="none" value="1" className="btn-secondary">None this month</button></>)}
              {i.key === "labour" && (<><input type="number" name="value" step="0.01" min="0" inputMode="decimal" defaultValue={i.standing} aria-label="Labour total for the month in rupees" /><button type="submit">Confirm this month</button></>)}
              {i.key === "packing" && (<><input type="number" name="value" step="0.01" min="0" inputMode="decimal" defaultValue={i.standing} aria-label="Packing cost per tray in rupees" /><button type="submit">Confirm</button></>)}
            </form>
          )}
        </div>
      ))}
    </details>
  );
}

const daysIn = (ym: string) => { const [y, mo] = ym.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };

const latestSetting = (settings: { type: string; value: number; effectiveFrom: string; month: string | null }[], type: string) => settings.filter((x) => x.type === type && !x.month).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0]?.value ?? null;

export const metadata = { title: "Purchases and costs" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const [input, settings, purchases, diesel] = await Promise.all([
    loadCostInput(),
    pool.query(`SELECT cost_type, value, unit, effective_from, month, note FROM cost_settings WHERE farm_code = $1 ORDER BY cost_type, effective_from DESC`, [ACTIVE_FARM]),
    pool.query(`SELECT date, category, item, quantity, unit, amount_inr, supplier FROM purchases WHERE farm_code = $1 ORDER BY date DESC, id DESC LIMIT 30`, [ACTIVE_FARM]),
    pool.query(`SELECT date, litres, amount_inr FROM diesel_purchases WHERE farm_code = $1 ORDER BY date DESC, id DESC LIMIT 15`, [ACTIVE_FARM]),
  ]);
  const chickPrice = latestSetting(input.settings, "chick_cost_per_chick");
  const months = [...new Set(input.prod.map((p) => p.date.slice(0, 7)))].sort().reverse();
  const checklists = new Map<string, ChecklistItem[]>();
  for (const m of months) checklists.set(m, await monthChecklist(m));

  return (
    <>
      <h1>Purchases &amp; costs</h1>
      {sp.saved && <div className="saved-banner">{sp.saved}</div>}
      {sp.error && <div className="error-banner">{sp.error}</div>}

      {months.length === 0 && <p className="card muted">No days have been entered yet, so there are no monthly costs to show. <Link href="/upload">Upload the first register photo</Link>.</p>}
      {months.length > 0 && (
        <div className="card">
          <ExportLinks kind="costs" month={months[0]} label="Costs and profit" />
        </div>
      )}
      <h2>Monthly cost (estimate)</h2>
      <p className="muted an-sub">
        Feed is exact (bags × 45 kg × price). Electricity and labour are the month&apos;s amount spread evenly over its days; packing is per tray sold; diesel and medicines count on the day bought; chicks count in the month they arrive. Anything not entered shows “not entered” (never ₹0) and the profit says it is incomplete.
      </p>
      {months.map((m) => {
        const e = monthEconomics(input, m);
        return (
          <div key={m} className="card">
            <h3 style={{ marginTop: 0 }}>{monthName(m)}</h3>
            {e.days < daysIn(m) && <p className="muted an-tiny" style={{ marginTop: 0 }}><b>To date, not the full month:</b> {e.days} of {daysIn(m)} days have data, so the monthly bills (electricity, labour) are counted for those {e.days} days only.</p>}
            <div style={{ overflowX: "auto" }}><table className="an-table" style={{ minWidth: 0 }}>
              <tbody>
                <tr><td>Feed</td><td className="num">{e.missing.some((x) => x.startsWith("feed price")) ? <span className="badge badge-flagged">not entered (price starts 1 Aug)</span> : `₹${inr(e.cost.feed)}`}</td></tr>
                <tr><td>Electricity</td><td className="num">{e.missing.some((x) => x.startsWith("electricity")) ? <span className="badge badge-flagged">missing: not entered</span> : `₹${inr(e.cost.electricity)}`}</td></tr>
                <tr><td>Labour</td><td className="num">{e.missing.some((x) => x.startsWith("labour")) ? <span className="badge badge-flagged">not entered</span> : `₹${inr(e.cost.labour)}`}</td></tr>
                <tr><td>Packing</td><td className="num">{e.missing.some((x) => x.startsWith("packing price")) ? <span className="badge badge-flagged">not entered (price starts 1 Aug)</span> : `₹${inr(e.cost.packing)}`}</td></tr>
                <tr><td>Diesel</td><td className="num">{e.missing.some((x) => x.startsWith("diesel")) ? <span className="badge badge-flagged">not entered</span> : `₹${inr(e.cost.diesel)}`}</td></tr>
                <tr><td>Medicines &amp; vaccines</td><td className="num">{e.missing.some((x) => x.startsWith("medicines")) ? <span className="badge badge-flagged">not entered</span> : `₹${inr(e.cost.medicine)}`}</td></tr>
                <tr><td>Other costs</td><td className="num">{e.missing.some((x) => x.startsWith("other costs")) ? <span className="badge badge-flagged">not entered</span> : `₹${inr(e.cost.other)}`}</td></tr>
                <tr><td>Chick purchase <span className="muted an-tiny">(average {chickPrice != null ? `₹${chickPrice}` : "price"} per chick × chicks that arrived; counted in the month they arrived, not spread over laying months)</span></td><td className="num">{`₹${inr(e.cost.chicks)}`}</td></tr>
              </tbody>
              <tfoot>
                <tr><th>Total cost so far{e.missing.length ? " (incomplete)" : ""} <span className="muted an-tiny">estimate</span></th><th className="num">₹{inr(e.cost.total)}</th></tr>
                <tr><td>Egg revenue (priced sales)</td><td className="num">{e.revenue ? `₹${inr(e.revenue)}` : "—"}</td></tr>
                <tr><th>Estimated profit{e.missing.length ? " — INCOMPLETE" : ""} <span className="muted an-tiny">estimate</span></th><th className="num">{e.revenue ? `₹${inr(e.profit)}` : "—"}</th></tr>
              </tfoot>
            </table></div>
            {e.birdSaleRevenue > 0 && <p className="muted an-tiny">Bird sales this month (not in egg revenue): ₹{inr(e.birdSaleRevenue)}</p>}
            <Checklist month={m} items={checklists.get(m) ?? []} />
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
                <td>{TYPE_LABEL[s.cost_type] ?? String(s.cost_type).replaceAll("_", " ")}{s.month ? ` (${s.month})` : ""}</td>
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
              <tr key={i}><td>{dmy(p.date)}</td><td>{p.category.replace("_", " ")}</td><td>{p.item}{p.supplier ? <span className="muted"> · {p.supplier}</span> : null}</td><td>{p.quantity ?? ""} {p.unit ?? ""}</td><td>{inr(Number(p.amount_inr))}</td></tr>
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
          <tbody>{diesel.rows.map((d, i) => (<tr key={i}><td>{dmy(d.date)}</td><td>{Number(d.litres)}</td><td>{inr(Number(d.amount_inr))}</td></tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
