import { listMoulting } from "@/lib/flocklife/load";
import { listFlocks } from "@/lib/flocks";
import { dayOfMoult, expectedBags, moultFeedForDay } from "@/lib/flocklife/moulting";
import { addMoultPeriod, confirmMoult } from "../life-actions";

export const dynamic = "force-dynamic";

const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-IN");

export const metadata = { title: "Moulting" };

export default async function MoultingPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const [periods, flocks] = await Promise.all([listMoulting(), listFlocks()]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <h1>Moulting</h1>
      {sp.saved && <div className="saved-banner">{sp.saved}</div>}
      {sp.error && <div className="error-banner">{sp.error}</div>}
      <p className="muted">
        Enter the day the moult started. While a flock is moulting there are no zero-feed or production-drop alerts for it. Expected feed per bird per day:
        days 1–5 none · 6–8 30 g · 9–11 40 g · 12–14 50 g · 15–17 60 g · 18–19 70 g · 20–21 80 g · 22–23 90 g · then 100 g for 3–4 days until body weight is corrected · then normal.
      </p>

      {periods.length === 0 && <p className="card muted">No moulting recorded.</p>}
      {periods.map((p) => {
        const endOrToday = p.end ?? today;
        const day = dayOfMoult(p.start, endOrToday);
        const sched = moultFeedForDay(day);
        return (
          <div key={p.id} className="card stack">
            <h3 style={{ margin: 0 }}>
              {p.flockName} <span className="muted">· from {p.start}{p.end ? ` to ${p.end}` : ""}</span>{" "}
              {!p.confirmed && <span className="badge badge-flagged">inferred — owner to confirm</span>}
            </h3>
            {p.note && <p className="muted" style={{ margin: 0 }}>{p.note}</p>}
            {!p.end && (
              <p style={{ margin: 0 }}>
                {sched.grams == null
                  ? <>Day {day} since the start: the feed schedule is finished. Set the end date below once the flock is laying normally.</>
                  : <>Moulting day <b>{day}</b> today: {sched.label}{p.birds ? ` — about ${n1(expectedBags(day, p.birds)!)} bags for ${p.birds.toLocaleString("en-IN")} birds` : ""}.</>}
              </p>
            )}
            {p.feedByDay.length > 0 && (
              <div className="an-scroll">
                <table className="an-table" style={{ minWidth: 0 }}>
                  <thead><tr><th>Day</th><th>Date</th><th className="num">Expected g/bird</th><th className="num">Expected bags</th><th className="num">Register bags</th></tr></thead>
                  <tbody>
                    {p.feedByDay.slice(0, 35).map((f) => {
                      const d = dayOfMoult(p.start, f.date);
                      const s = moultFeedForDay(d);
                      const eb = p.birds && s.grams != null ? expectedBags(d, p.birds) : null;
                      return (
                        <tr key={f.date}>
                          <td>{d}</td><td>{f.date.slice(5)}</td>
                          <td className="num">{s.grams == null ? "normal" : s.grams}</td>
                          <td className="num">{eb != null ? n1(eb) : "–"}</td>
                          <td className="num">{f.bags ?? "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <form action={confirmMoult.bind(null, p.id)} className="stack">
              <div className="row2">
                <label className="field"><span>Start date</span><input type="date" name="start_date" defaultValue={p.start} /></label>
                <label className="field"><span>End date <span className="hint">(optional)</span></span><input type="date" name="end_date" defaultValue={p.end ?? ""} /></label>
              </div>
              <button type="submit" className={p.confirmed ? "btn-secondary" : ""}>{p.confirmed ? "Save dates" : "Confirm these dates"}</button>
            </form>
          </div>
        );
      })}

      <form action={addMoultPeriod} className="card stack">
        <h3 style={{ margin: 0 }}>Add a moult</h3>
        <label className="field"><span>Flock</span>
          <select name="flock" defaultValue="">
            <option value="" disabled>Choose…</option>
            {flocks.filter((f) => f.status === "active").map((f) => (<option key={f.flock_internal_id} value={f.flock_internal_id}>{f.display_label}</option>))}
          </select>
        </label>
        <div className="row2">
          <label className="field"><span>Start date</span><input type="date" name="start_date" /></label>
          <label className="field"><span>End date <span className="hint">(optional)</span></span><input type="date" name="end_date" /></label>
        </div>
        <label className="field"><span>Note</span><input type="text" name="note" /></label>
        <button type="submit">Save moult</button>
      </form>
    </>
  );
}
