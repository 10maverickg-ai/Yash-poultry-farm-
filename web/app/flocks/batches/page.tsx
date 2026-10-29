import Link from "next/link";
import { listBatches, chickDeathsByRow } from "@/lib/flocklife/load";
import { listFlocks } from "@/lib/flocks";
import { PHASES, phaseForAge, changeover, CHANGEOVER_STEPS } from "@/lib/flocklife/phases";
import { addBatch, updateBatch } from "../life-actions";

export const dynamic = "force-dynamic";

const n0 = (x: number) => x.toLocaleString("en-IN");
const STATUS: Record<string, string> = { in_chick_shed: "In the chick shed", moved_to_layer: "Moved to layer cages", to_anil_farm: "Went to Anil farm", mixed: "Split (Anil farm + top-up)" };

export const metadata = { title: "Chick batches" };

export default async function BatchesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const [batches, deaths, flocks] = await Promise.all([listBatches(), chickDeathsByRow(), listFlocks()]);
  const today = new Date().toISOString().slice(0, 10);
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const lastReg = deaths.byDay.length ? deaths.byDay[deaths.byDay.length - 1].date : null;

  // Row 4 "Chicks" from 19 Sept is the chick-shed batch that arrived 18 Sept; rows 1-3 are the older batch (left/right/third) and "Grower" from 19 Sept.
  const olderDeaths = deaths.rows.filter((r) => r.position <= 3 && r.label !== "Anil chicks").reduce((s, r) => s + r.deaths, 0);
  const row4 = deaths.rows.filter((r) => r.position === 4).reduce((s, r) => s + r.deaths, 0);

  return (
    <>
      <h1>Chick batches</h1>
      {sp.saved && <div className="saved-banner">{sp.saved}</div>}
      {sp.error && <div className="error-banner">{sp.error}</div>}

      {batches.map((b) => {
        const ageDays = days(b.arrival, b.status === "moved_to_layer" && b.movedToLayer ? b.movedToLayer : today);
        const ageWeeks = Math.floor(ageDays / 7);
        const phase = phaseForAge(ageWeeks);
        const co = b.status === "in_chick_shed" || b.status === "moved_to_layer" ? changeover(ageDays) : null;
        const isOlder = b.arrival === "2026-05-23";
        const isNewer = b.arrival === "2026-09-18";
        const dead = isOlder ? olderDeaths : isNewer ? row4 : null;
        const base = isOlder ? b.start + 737 : b.start - b.anil;
        return (
          <div key={b.id} className="card stack">
            <h3 style={{ margin: 0 }}>
              Arrived {b.arrival} · {n0(b.start)} chicks <span className="badge badge-active">{STATUS[b.status] ?? b.status}</span>
            </h3>
            {b.note && <p style={{ margin: 0 }}>{b.note}</p>}
            <p className="muted" style={{ margin: 0 }}>
              {b.status === "mixed"
                ? `${n0(b.anil)} to Anil farm · ${n0(b.start - b.anil)} filled a shortfall at Yash farm.`
                : `Age ${ageWeeks} weeks${b.status === "moved_to_layer" ? " when moved" : ""} · BV300 feed phase: ${phase.label} (${phase.note}).`}
            </p>
            {co && (
              <div className="flag-banner">
                Next feed ({co.to.label}) starts in {co.startsInDays} day{co.startsInDays === 1 ? "" : "s"}. Change over 10 days:{" "}
                {CHANGEOVER_STEPS.map((s) => `${s.days} ${s.mix}`).join(" · ")} <span className="muted">(day split assumed)</span>
              </div>
            )}
            {dead != null && (
              <p style={{ margin: 0 }}>
                Deaths recorded {isOlder ? "(rows 1–3 as written, since 12 Aug; the “Anil chicks” row is left out)" : "(row 4 “Chicks”, since 19 Sep)"}: <b>{n0(dead)}</b>
                {base > 0 ? ` = ${((dead / base) * 100).toFixed(2)}% of ${n0(base)}` : ""}.
                {isOlder ? " Deaths before 12 Aug are not in the database." : ""}
              </p>
            )}
            <form action={updateBatch.bind(null, b.id)} className="stack">
              <div className="row2">
                <label className="field"><span>Status</span>
                  <select name="status" defaultValue={b.status}>
                    {Object.entries(STATUS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                  </select>
                </label>
                <label className="field"><span>Moved to layer</span><input type="date" name="moved_to_layer_date" defaultValue={b.movedToLayer ?? ""} /></label>
              </div>
              <label className="field"><span>Became flock</span>
                <select name="resulting_flock_id" defaultValue={b.flockId ?? ""}>
                  <option value="">— not linked —</option>
                  {flocks.map((f) => (<option key={f.flock_internal_id} value={f.flock_internal_id}>{f.display_label}</option>))}
                </select>
              </label>
              <button type="submit" className="btn-secondary">Save</button>
            </form>
          </div>
        );
      })}

      <h2>Chick shed deaths by row</h2>
      <p className="muted an-sub">
        Row 1 = left side, row 2 = right side (so a rise can be traced to one side). From 19 Sept the first three rows are written “Grower” and row 4 is “Chicks”. The third row before 27 Aug is “meaning not confirmed”.
      </p>
      <div className="card an-scroll">
        <table className="an-table" style={{ minWidth: 0 }}>
          <thead><tr><th>Row</th><th>Written as</th><th>From</th><th>To</th><th className="num">Deaths</th></tr></thead>
          <tbody>
            {deaths.rows.map((r, i) => (<tr key={i}><td>{r.position}{r.position === 1 ? " (left)" : r.position === 2 ? " (right)" : ""}</td><td>{r.label}</td><td>{r.from.slice(5)}</td><td>{r.to.slice(5)}</td><td className="num">{n0(r.deaths)}</td></tr>))}
          </tbody>
        </table>
      </div>
      {lastReg && <p className="muted an-tiny">Latest chick-shed row: {lastReg}.</p>}

      <h2>BV300 feed phases</h2>
      <div className="card">
        <ul className="an-list">{PHASES.map((p) => (<li key={p.key}><b>{p.label}</b> from week {p.fromWeek} — {p.note}</li>))}</ul>
      </div>

      <form action={addBatch} className="card stack">
        <h3 style={{ margin: 0 }}>New batch</h3>
        <label className="field"><span>Arrival date</span><input type="date" name="arrival_date" defaultValue={today} /></label>
        <label className="field"><span>Chicks</span><input type="number" name="starting_count" min="1" inputMode="numeric" /></label>
        <div className="row2">
          <label className="field"><span>Source</span><input type="text" name="source" /></label>
          <label className="field"><span>Shed side</span><select name="shed_side" defaultValue=""><option value="">—</option><option value="left">Left</option><option value="right">Right</option><option value="both">Both</option></select></label>
        </div>
        <label className="field"><span>Note</span><input type="text" name="note" /></label>
        <button type="submit">Save batch</button>
      </form>
      <p><Link href="/flocks">← Flocks</Link></p>
    </>
  );
}
