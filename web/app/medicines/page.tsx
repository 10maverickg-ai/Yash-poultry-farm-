import Link from "next/link";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { listFlocks } from "@/lib/flocks";
import { listBatches } from "@/lib/flocklife/load";
import { addMedicinePurchase, addVaccination, markVaccinationGiven, fillScheduleFromLibrary, changeVaccinationDue } from "./actions";

export const dynamic = "force-dynamic";

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");

export default async function MedicinesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const [flocks, batches, buys, vacc, lib] = await Promise.all([
    listFlocks(),
    listBatches(),
    pool.query(
      `SELECT date, category, item, quantity, unit, amount_inr, supplier FROM purchases
        WHERE farm_code = $1 AND category IN ('medicine','vaccine') ORDER BY date DESC, id DESC LIMIT 40`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT v.id, v.vaccine, v.due_date, v.given_date, v.route, v.note, f.display_label, b.arrival_date
         FROM vaccination_schedule v
         LEFT JOIN flocks f ON f.flock_internal_id = v.flock_internal_id
         LEFT JOIN chick_batches b ON b.id = v.chick_batch_id
        WHERE v.farm_code = $1 ORDER BY (v.given_date IS NOT NULL), v.due_date LIMIT 80`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT e.id, e.topic, e.breed, e.notes, d.company, d.title,
              (SELECT count(*)::int FROM knowledge_standards s WHERE s.entry_id = e.id AND s.metric LIKE 'vaccine:%') AS vaccines
         FROM knowledge_entries e JOIN knowledge_documents d ON d.id = e.document_id
        WHERE EXISTS (SELECT 1 FROM knowledge_standards s WHERE s.entry_id = e.id AND s.metric LIKE 'vaccine:%')
        ORDER BY d.company, e.topic`
    ),
  ]);
  const targets = [
    ...batches.map((b) => ({ v: `batch:${b.id}`, l: `Chick batch ${b.arrival}` })),
    ...flocks.filter((f) => f.status === "active").map((f) => ({ v: `flock:${f.flock_internal_id}`, l: `Flock ${f.display_label}` })),
  ];
  return (
    <>
      <h1>Medicines &amp; vaccines</h1>
      {sp.saved && <div className="saved-banner">{sp.saved}</div>}
      {sp.error && <div className="error-banner">{sp.error}</div>}

      <h2>Vaccination schedule</h2>
      {vacc.rows.length === 0 ? (
        <p className="card muted">Nothing scheduled yet. Add a vaccination below, or fill a batch from the <Link href="/knowledge">Knowledge library</Link>.</p>
      ) : (
        vacc.rows.map((v) => {
          const overdue = !v.given_date && String(v.due_date).slice(0, 10) < today;
          return (
            <div key={v.id} className={`card ${overdue ? "day-flagged" : ""}`}>
              <div><b>{v.vaccine}</b> — {v.display_label ? `flock ${v.display_label}` : `chick batch ${String(v.arrival_date).slice(0, 10)}`}</div>
              <div className="muted an-tiny">Due {String(v.due_date).slice(0, 10)}{v.route ? ` · ${v.route}` : ""}{v.note ? ` · ${v.note}` : ""}</div>
              {!v.given_date && (
                <form action={changeVaccinationDue.bind(null, Number(v.id))} className="actions-bar" style={{ marginTop: "0.4rem", marginBottom: 0 }}>
                  <input type="date" name="due_date" defaultValue={String(v.due_date).slice(0, 10)} aria-label="Due date" />
                  <button type="submit" className="btn-secondary">Change due date</button>
                </form>
              )}
              {v.given_date ? (
                <div className="badge badge-active" style={{ marginTop: "0.4rem" }}>Given {String(v.given_date).slice(0, 10)}</div>
              ) : (
                <form action={markVaccinationGiven.bind(null, Number(v.id))} className="actions-bar" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                  {overdue && <span className="badge badge-flagged">overdue</span>}
                  <input type="date" name="given_date" defaultValue={today} aria-label="Date given" />
                  <button type="submit">Mark given</button>
                </form>
              )}
            </div>
          );
        })
      )}

      <form action={addVaccination} className="card stack">
        <h3 style={{ margin: 0 }}>Add a vaccination</h3>
        <label className="field"><span>For</span>
          <select name="target" defaultValue=""><option value="" disabled>Choose…</option>{targets.map((t) => (<option key={t.v} value={t.v}>{t.l}</option>))}</select>
        </label>
        <label className="field"><span>Vaccine</span><input type="text" name="vaccine" /></label>
        <div className="row2">
          <label className="field"><span>Due</span><input type="date" name="due_date" defaultValue={today} /></label>
          <label className="field"><span>Route</span><input type="text" name="route" placeholder="eye drop, injection…" /></label>
        </div>
        <label className="field"><span>Note</span><input type="text" name="note" /></label>
        <button type="submit">Add</button>
      </form>

      <form action={fillScheduleFromLibrary} className="card stack">
        <h3 style={{ margin: 0 }}>Fill from the knowledge library</h3>
        {lib.rows.some((e) => /example/i.test(`${e.title} ${e.notes ?? ""}`)) && (
          <div className="flag-banner">Some library programmes are examples only (for instance the Merck Veterinary Manual table). They are a starting point: your vet decides the real dates, and you can change any date after it is created.</div>
        )}
        {lib.rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No vaccination schedule is loaded in the library yet (an entry needs standards named <code>vaccine:&lt;name&gt;</code> at an age in weeks — see knowledge/README.md). Nothing is filled in on its own.
          </p>
        ) : (
          <>
            <label className="field"><span>Library entry</span>
              <select name="entry" defaultValue=""><option value="" disabled>Choose…</option>{lib.rows.map((e) => (<option key={e.id} value={e.id}>{e.company} — {e.topic}{e.breed ? ` (${e.breed})` : ""} · {e.vaccines} vaccines{/example/i.test(`${e.title} ${e.notes ?? ""}`) ? " · EXAMPLE PROGRAMME" : ""}</option>))}</select>
            </label>
            <label className="field"><span>For</span>
              <select name="target" defaultValue=""><option value="" disabled>Choose…</option>{targets.map((t) => (<option key={t.v} value={t.v}>{t.l}</option>))}</select>
            </label>
            <button type="submit">Create the schedule</button>
          </>
        )}
      </form>

      <h2>Medicine &amp; vaccine purchases</h2>
      <form action={addMedicinePurchase} className="card stack">
        <label className="field"><span>Type</span>
          <select name="kind" defaultValue="medicine"><option value="medicine">Medicine</option><option value="vaccine">Vaccine</option></select>
        </label>
        <label className="field"><span>Date</span><input type="date" name="date" defaultValue={today} /></label>
        <label className="field"><span>What</span><input type="text" name="item" /></label>
        <div className="row2">
          <label className="field"><span>Quantity</span><input type="number" name="quantity" step="any" min="0" inputMode="decimal" /></label>
          <label className="field"><span>Unit</span><input type="text" name="unit" placeholder="vials, kg…" /></label>
        </div>
        <label className="field"><span>Price paid (₹)</span><input type="number" name="amount_inr" step="0.01" min="0" inputMode="decimal" /></label>
        <label className="field"><span>Supplier</span><input type="text" name="supplier" /></label>
        <label className="field"><span>Note</span><input type="text" name="note" /></label>
        <button type="submit">Save purchase</button>
        <p className="muted an-tiny" style={{ margin: 0 }}>The cost is counted on the day bought and shown in the monthly cost on the Buy page.</p>
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Type</th><th>What</th><th>Qty</th><th>₹</th></tr></thead>
        <tbody>
          {buys.rows.length === 0 ? (<tr><td colSpan={5} className="muted">No medicine or vaccine purchases entered yet.</td></tr>) : buys.rows.map((b, i) => (
            <tr key={i}><td>{b.date}</td><td>{b.category}</td><td>{b.item}{b.supplier ? <span className="muted"> · {b.supplier}</span> : null}</td><td>{b.quantity ?? ""} {b.unit ?? ""}</td><td>{inr(Number(b.amount_inr))}</td></tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
