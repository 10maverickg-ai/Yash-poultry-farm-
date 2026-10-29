import Link from "next/link";
import { listFlocks } from "@/lib/flocks";
import { listBatches } from "@/lib/flocklife/load";
import { pool } from "@/lib/db";
import { listLines, listSchedule, listSuggestions, listTargets, monthStatus } from "@/lib/medicines/store";
import { groupSchedule, monthSummary, monthsOf, type ScheduleItem } from "@/lib/medicines/lines";
import { MedicineLineForm } from "@/components/MedicineLineForm";
import { MedicineMonthNone } from "@/components/MedicineMonthNone";
import { ActionForm } from "@/components/ActionForm";
import { saveLine, markMonthNone, addVaccination, markVaccinationGiven, fillScheduleFromLibrary, changeVaccinationDue } from "./actions";
import { dmy, inr } from "@/lib/format";

export const metadata = { title: "Medicines and vaccines" };
export const dynamic = "force-dynamic";

const monthName = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const todayISO = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
type SP = { saved?: string; error?: string; month?: string; add?: string; date?: string; kind?: string; target?: string; photo?: string };

function ScheduleList({ title, items, tone, today, kids }: { title: string; items: ScheduleItem[]; tone: "red" | "amber" | "plain" | "done"; today: string; kids: boolean }) {
  if (items.length === 0 && tone !== "plain") return null;
  return (
    <section className="card" aria-label={title}>
      <h3 style={{ marginTop: 0 }}>{title} <span className="badge">{items.length}</span></h3>
      {items.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing here.</p>}
      {items.map((v) => (
        <div key={v.id} className={tone === "red" ? "day-flagged" : ""} style={{ padding: "0.5rem 0", borderTop: "1px solid var(--line)" }}>
          <div><b>{v.vaccine}</b> — {v.target}</div>
          <div className="muted an-tiny">
            {v.givenDate ? `Given ${dmy(v.givenDate)} (was due ${dmy(v.dueDate)})` : `Due ${dmy(v.dueDate)}`}{v.route ? ` · ${v.route}` : ""}{v.note ? ` · ${v.note}` : ""}
            {tone === "red" && <> · <b>{Math.round((Date.parse(today) - Date.parse(v.dueDate)) / 86400000)} days overdue</b></>}
          </div>
          {!v.givenDate && kids && (
            <>
              <ActionForm action={markVaccinationGiven.bind(null, v.id)} className="actions-bar" style={{ marginTop: "0.4rem", marginBottom: 0 }}>
                <input type="date" name="given_date" defaultValue={today} aria-label={`Date ${v.vaccine} was given`} />
                <button type="submit">Mark given</button>
              </ActionForm>
              <ActionForm action={changeVaccinationDue.bind(null, v.id)} className="actions-bar" style={{ marginTop: "0.3rem", marginBottom: 0 }}>
                <input type="date" name="due_date" defaultValue={v.dueDate} aria-label={`New due date for ${v.vaccine}`} />
                <button type="submit" className="btn-secondary">Change due date</button>
              </ActionForm>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

export default async function MedicinesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const today = todayISO();
  const [lines, targets, suggestions, schedule, flocks, batches, lib] = await Promise.all([
    listLines(),
    listTargets(),
    listSuggestions(),
    listSchedule(),
    listFlocks(),
    listBatches(),
    pool.query(
      `SELECT e.id, e.topic, e.breed, e.notes, d.company, d.title,
              (SELECT count(*)::int FROM knowledge_standards s WHERE s.entry_id = e.id AND s.metric LIKE 'vaccine:%') AS vaccines
         FROM knowledge_entries e JOIN knowledge_documents d ON d.id = e.document_id
        WHERE EXISTS (SELECT 1 FROM knowledge_standards s WHERE s.entry_id = e.id AND s.metric LIKE 'vaccine:%') ORDER BY d.company, e.topic`
    ),
  ]);
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : (lines[0]?.date.slice(0, 7) ?? today.slice(0, 7));
  const months = monthsOf(lines, month);
  const idx = months.indexOf(month);
  const status = await monthStatus(month);
  const sum = monthSummary(lines, month);
  const inMonth = lines.filter((l) => l.date.startsWith(month));
  const groups = groupSchedule(schedule, today);
  const scheduleTargets = [
    ...batches.map((b) => ({ v: `batch:${b.id}`, l: `Chick batch ${b.arrival}` })),
    ...flocks.filter((f) => f.status === "active").map((f) => ({ v: `flock:${f.flock_internal_id}`, l: `Flock ${f.display_label}` })),
  ];
  const defaults = { date: sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : (lines[0]?.date ?? today), kind: sp.kind ?? "medicine", target: sp.target ?? "farm" };
  return (
    <>
      <h1>Medicines &amp; vaccines</h1>
      {sp.saved && <div className="saved-banner">{sp.saved}</div>}
      {sp.error && <div className="error-banner">{sp.error}</div>}
      <p className="muted">
        One line for each medicine or vaccine written in the register. The cost is optional; a line with a cost counts in the monthly cost on the <Link href="/purchases">Costs screen</Link>.
        {" "}<Link href="/medicines/import">Import many lines from Excel →</Link>
      </p>

      <h2 id="enter">1. Enter a line</h2>
      <MedicineLineForm action={saveLine} targets={targets} suggestions={suggestions} defaults={defaults} mode="add" />

      <h2 id="month">2. The month</h2>
      <div className="card">
        <div className="actions-bar" style={{ marginBottom: "0.4rem" }}>
          {idx < months.length - 1 && <Link href={`/medicines?month=${months[idx + 1]}#month`} className="btn btn-secondary">← {monthName(months[idx + 1])}</Link>}
          <b style={{ alignSelf: "center" }}>{monthName(month)}</b>
          {idx > 0 && <Link href={`/medicines?month=${months[idx - 1]}#month`} className="btn btn-secondary">{monthName(months[idx - 1])} →</Link>}
        </div>
        <div className="an-grid">
          <div className="an-card"><div className="muted an-tiny">Lines</div><b>{sum.lines}</b></div>
          <div className="an-card"><div className="muted an-tiny">Cost entered</div><b>{sum.lines ? inr(sum.cost) : "—"}</b>{sum.withoutCost > 0 && <div className="muted an-tiny">{sum.withoutCost} line{sum.withoutCost === 1 ? "" : "s"} with no cost entered</div>}</div>
          {sum.byKind.map((k) => (<div key={k.kind} className="an-card"><div className="muted an-tiny">{k.kind === "vaccine" ? "Vaccines" : "Medicines"}</div><b>{k.lines}</b><div className="muted an-tiny">{k.lines === 0 ? "" : k.lines === k.withoutCost ? "cost not entered" : inr(k.cost)}</div></div>))}
        </div>
        <MedicineMonthNone action={markMonthNone.bind(null, month)} none={status === "none"} empty={sum.lines === 0} hasCost={sum.cost > 0} monthLabel={monthName(month)} />
      </div>

      {sum.lines > 0 && (
        <>
          <h3>Totals per flock, shed and the whole farm</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>For</th><th>Lines</th><th>Cost entered</th><th>Lines with no cost</th></tr></thead>
              <tbody>{sum.byTarget.map((t) => (<tr key={t.label}><td>{t.label}</td><td>{t.lines}</td><td>{t.lines === t.withoutCost ? "—" : inr(t.cost)}</td><td>{t.withoutCost || "—"}</td></tr>))}</tbody>
            </table>
          </div>
          <h3>Every line of the month</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Name</th><th>For</th><th>Quantity</th><th>Cost</th><th>Register photo</th><th>Edit</th></tr></thead>
              <tbody>
                {inMonth.map((l) => (
                  <tr key={l.id}>
                    <td>{dmy(l.date)}</td>
                    <td>{l.kind === "vaccine" ? "Vaccine" : "Medicine"}</td>
                    <td>{l.item}{l.supplier ? <span className="muted"> · {l.supplier}</span> : null}{l.sourceTag !== "hand entry" ? <span className="muted"> · {l.sourceTag}</span> : null}</td>
                    <td>{l.targetLabel}</td>
                    <td>{l.quantity != null ? `${l.quantity} ${l.unit ?? ""}` : "—"}</td>
                    <td>{l.cost == null ? <span className="muted">not entered</span> : inr(l.cost)}</td>
                    <td>{l.photoUrl ? <a href={l.photoUrl} target="_blank" rel="noreferrer">photo</a> : "—"}</td>
                    <td><Link href={`/medicines/line/${l.id}`}>Edit</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 id="schedule">3. Vaccination schedule</h2>
      {schedule.length === 0 && <p className="card muted">Nothing scheduled yet. Add a vaccination below, or fill a schedule from the <Link href="/knowledge">Knowledge library</Link>.</p>}
      <ScheduleList title="Overdue" items={groups.overdue} tone="red" today={today} kids />
      <ScheduleList title="Due in the next 14 days" items={groups.soon} tone="amber" today={today} kids />
      <ScheduleList title="Later" items={groups.later} tone="plain" today={today} kids />
      <ScheduleList title="Done" items={groups.done} tone="done" today={today} kids={false} />

      <details className="card">
        <summary><b>Add a vaccination to the schedule</b></summary>
        <ActionForm action={addVaccination} className="stack" style={{ marginTop: "0.6rem" }}>
          <label className="field"><span>For</span>
            <select name="target" defaultValue=""><option value="" disabled>Choose…</option>{scheduleTargets.map((t) => (<option key={t.v} value={t.v}>{t.l}</option>))}</select>
          </label>
          <label className="field"><span>Vaccine</span><input type="text" name="vaccine" required /></label>
          <div className="row2">
            <label className="field"><span>Due</span><input type="date" name="due_date" defaultValue={today} /></label>
            <label className="field"><span>How it is given <span className="hint">(eye drop, injection…)</span></span><input type="text" name="route" /></label>
          </div>
          <label className="field"><span>Note</span><input type="text" name="note" /></label>
          <button type="submit">Add to the schedule</button>
        </ActionForm>
      </details>
      <details className="card">
        <summary><b>Fill a schedule from the knowledge library</b></summary>
        <ActionForm action={fillScheduleFromLibrary} className="stack" style={{ marginTop: "0.6rem" }}>
          {lib.rows.some((e) => /example/i.test(`${e.title} ${e.notes ?? ""}`)) && <div className="flag-banner">Some library programmes are examples only (for instance the Merck Veterinary Manual table). They are a starting point: your vet decides the real dates, and you can change any date afterwards.</div>}
          {lib.rows.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No vaccination schedule is loaded in the library yet, so nothing can be filled in.</p>
          ) : (
            <>
              <label className="field"><span>Library entry</span>
                <select name="entry" defaultValue=""><option value="" disabled>Choose…</option>{lib.rows.map((e) => (<option key={e.id} value={e.id}>{e.company} — {e.topic}{e.breed ? ` (${e.breed})` : ""} · {e.vaccines} vaccines{/example/i.test(`${e.title} ${e.notes ?? ""}`) ? " · EXAMPLE PROGRAMME" : ""}</option>))}</select>
              </label>
              <label className="field"><span>For</span>
                <select name="target" defaultValue=""><option value="" disabled>Choose…</option>{scheduleTargets.map((t) => (<option key={t.v} value={t.v}>{t.l}</option>))}</select>
              </label>
              <button type="submit">Create the schedule</button>
            </>
          )}
        </ActionForm>
      </details>
    </>
  );
}
