import Link from "next/link";
import { loadRepricePlan, datesNeedingReprice } from "@/lib/rates/repriceStore";
import { recipientLabel } from "@/lib/sales/recipients";
import { confirmReprice } from "./actions";
import { dmy, inr, n2 } from "@/lib/format";

export const metadata = { title: "Re-price a day" };
export const dynamic = "force-dynamic";

const iso = /^\d{4}-\d{2}-\d{2}$/;

export default async function RepricePage({ searchParams }: { searchParams: Promise<{ date?: string; error?: string; done?: string; before?: string; after?: string }> }) {
  const sp = await searchParams;
  const date = sp.date && iso.test(sp.date) ? sp.date : null;
  const [day, needing] = await Promise.all([date ? loadRepricePlan(date) : Promise.resolve(null), datesNeedingReprice()]);
  return (
    <>
      <h1>Re-price a day</h1>
      <p className="muted"><Link href="/sales">← Sales</Link> · <Link href="/sales/rates">Egg rates</Link></p>
      {sp.error && <div className="error-banner">{sp.error}</div>}
      {sp.done && <div className="saved-banner">Done: {sp.done} sale{sp.done === "1" ? "" : "s"} re-priced for {dmy(date)}. Total before {inr(Number(sp.before))}, after {inr(Number(sp.after))}.</div>}
      <section className="card">
        <p style={{ marginTop: 0 }}>When a day&apos;s rate is corrected (for example a subsidy arrives later), the sales already saved for that day keep their old price. Here you can recalculate them at the new rate: <b>Farmfresh = rate − 0.03</b>, <b>local = rate + 0.01</b>. You always see the before and after totals first, and nothing changes until you press the button.</p>
        <form method="get" className="actions-bar">
          <label className="field"><span>Day</span><input type="date" name="date" defaultValue={date ?? ""} required /></label>
          <button type="submit">Look at this day</button>
        </form>
      </section>

      {date && !day && <p className="card muted">{dmy(date)}: either no sales were saved that day, or there is no rate for that day (or the 3 days before), so there is nothing to re-price.</p>}
      {date && day && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>{dmy(date)} at the rate {n2(day.plan.rate)}{day.carried ? ` (carried from ${dmy(day.rateDate)}: "rate not updated")` : ""}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Who got the eggs</th><th>Kind</th><th>Eggs</th><th>Price now</th><th>Price after</th><th>Amount now</th><th>Amount after</th></tr></thead>
              <tbody>
                {day.plan.rows.map((r) => (
                  <tr key={r.id} className={r.changes ? "" : "muted"}>
                    <td>{recipientLabel(r.recipient)}</td>
                    <td>{r.kind === "farmfresh" ? "Farmfresh" : "Local"}</td>
                    <td>{r.eggs.toLocaleString("en-IN")}</td>
                    <td>{r.price != null ? n2(r.price) : "not priced"}</td>
                    <td>{n2(r.newPrice)}{r.changes ? "" : " (same)"}</td>
                    <td>{r.amount != null ? inr(r.amount) : "—"}</td>
                    <td>{inr(r.newAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th colSpan={5}>Day total</th><th>{inr(day.plan.totalBefore)}</th><th>{inr(day.plan.totalAfter)}</th></tr>
              </tfoot>
            </table>
          </div>
          <p><b>Before {inr(day.plan.totalBefore)} → after {inr(day.plan.totalAfter)}</b> ({day.plan.delta >= 0 ? "+" : "−"}{inr(Math.abs(day.plan.delta))}). {day.plan.changed} of {day.plan.rows.length} sale{day.plan.rows.length === 1 ? "" : "s"} would change.</p>
          {day.plan.changed > 0 ? (
            <form action={confirmReprice} className="actions-bar">
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="before" value={day.plan.totalBefore} />
              <input type="hidden" name="after" value={day.plan.totalAfter} />
              <button type="submit">Re-price these {day.plan.changed} sale{day.plan.changed === 1 ? "" : "s"}</button>
              <Link href="/sales" className="btn btn-secondary">Leave the prices as they are</Link>
            </form>
          ) : (
            <p className="muted">Every sale on this day is already at the day&apos;s rate. Nothing to do.</p>
          )}
        </section>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Days whose sales are not at the day&apos;s rate</h2>
        {needing.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>None: every priced sale is at its day&apos;s rate.</p>
        ) : (
          <ul className="an-list">
            {needing.map((d) => (
              <li key={d.date}>
                <Link href={`/sales/reprice?date=${d.date}`}>{dmy(d.date)}</Link>: {d.sales} sale{d.sales === 1 ? "" : "s"} differ; {inr(d.before)} now, {inr(d.after)} at the day&apos;s rate.
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
