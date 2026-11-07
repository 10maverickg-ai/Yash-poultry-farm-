import Link from "next/link";
import { chickBatchesForPlan, listPlanSteps, listTemplate } from "@/lib/medicines/chickStore";
import { buildPlan, dayOfAge, stepStatus } from "@/lib/medicines/chickPlan";
import { TO_CONFIRM_LINE } from "@/lib/medicines/catalogue";
import { ChickPlanView, type ViewStep } from "@/components/ChickPlanView";
import { ActionForm } from "@/components/ActionForm";
import { makeChickPlan } from "./actions";
import { todayIST } from "@/lib/weather/openMeteo";
import { dmy } from "@/lib/format";

export const metadata = { title: "Chick vaccination plan" };
export const dynamic = "force-dynamic";

const iso = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_WORD: Record<string, string> = { in_chick_shed: "in the chick shed", moved_to_layer: "moved to the layer cages", to_anil_farm: "went to Anil farm", mixed: "split between flocks" };

export default async function ChickPlanPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const sp = await searchParams;
  const today = todayIST();
  const [template, batches, steps] = await Promise.all([listTemplate(), chickBatchesForPlan(), listPlanSteps()]);
  const preview = sp.preview && iso.test(sp.preview) && !Number.isNaN(Date.parse(sp.preview)) ? sp.preview : null;
  return (
    <>
      <h1>Chick vaccination plan</h1>
      <p className="muted">
        The owner&apos;s day-by-day schedule for a new batch of chicks. <b>Day 1 is the day the chicks arrive.</b> The steps are linked to the <Link href="/medicines/list">Medicines list</Link>. <Link href="/medicines">← Medicines &amp; vaccines</Link>
      </p>
      <p className="card">{TO_CONFIRM_LINE}</p>

      <h2>Preview for a new batch</h2>
      <form method="get" className="day-pick" style={{ marginBottom: "0.5rem" }}>
        <label className="field" style={{ margin: 0, flex: 1 }}><span>The day the chicks arrive</span><input type="date" name="preview" defaultValue={preview ?? ""} required /></label>
        <button type="submit" className="btn-secondary">Show the plan</button>
      </form>
      {preview ? (
        <>
          <p className="muted an-tiny">This is only a preview: nothing is saved. When the batch is registered under <Link href="/flocks/batches">Chick batches</Link> its plan is made automatically.</p>
          <ChickPlanView steps={buildPlan(template, preview) as ViewStep[]} today={today} ticks={false} />
        </>
      ) : (
        <p className="muted an-tiny" style={{ margin: 0 }}>Choose a date to see every step with its date.</p>
      )}

      <h2>Your chick batches</h2>
      <p className="muted an-tiny">A plan is made automatically only for a batch registered from now on. For a batch that is already here, tap “Make the plan” and tick off what was really done; nothing is created for you.</p>
      {batches.length === 0 && <p className="card muted">No chick batch is registered yet. Add one under <Link href="/flocks/batches">Chick batches</Link>.</p>}
      {batches.map((b) => {
        const mine: ViewStep[] = steps.filter((s) => s.batchId === b.id).map((s) => ({ templateId: s.templateId, catalogueId: 0, name: s.name, kind: s.kind as ViewStep["kind"], purpose: s.purpose, dayFrom: s.dayFrom, dayTo: s.dayTo, due: s.due, windowEnd: s.windowEnd, note: s.note, needsConfirmation: s.needsConfirmation, isTask: s.kind === "management", id: s.id, givenDate: s.givenDate }));
        const counts = { done: 0, overdue: 0, open: 0 };
        for (const s of mine) {
          const st = stepStatus(s.due, s.windowEnd, s.givenDate ?? null, today);
          if (st === "done") counts.done++;
          else if (st === "overdue") counts.overdue++;
          else counts.open++;
        }
        const age = dayOfAge(b.arrival, today);
        return (
          <section key={b.id} aria-label={`Chick batch of ${dmy(b.arrival)}`}>
            <div className="card">
              <b>Batch of {dmy(b.arrival)}</b> <span className="muted an-tiny">· {b.count.toLocaleString("en-IN")} chicks · {STATUS_WORD[b.status] ?? b.status}{b.flockLabel ? ` (${b.flockLabel})` : ""} · {age >= 1 ? `day ${age} today` : `arrives in ${1 - age} day${1 - age === 1 ? "" : "s"}`}</span>
              {mine.length > 0 ? (
                <div className="muted an-tiny">{counts.done} done · {counts.overdue > 0 ? <b style={{ color: "#b91c1c" }}>{counts.overdue} overdue</b> : "0 overdue"} · {counts.open} still to come or due</div>
              ) : (
                <ActionForm action={makeChickPlan.bind(null, b.id)} className="actions-bar" style={{ marginTop: "0.4rem", marginBottom: 0 }}>
                  <button type="submit">Make the plan for this batch</button>
                </ActionForm>
              )}
            </div>
            {mine.length > 0 && <ChickPlanView steps={mine} today={today} ticks />}
          </section>
        );
      })}

      <h2>The schedule</h2>
      <details className="card">
        <summary><b>Show the schedule by day of age</b></summary>
        <div style={{ marginTop: "0.5rem" }}><ChickPlanView steps={buildPlan(template, "2000-01-01").map((s) => ({ ...s, due: "" })) as ViewStep[]} today={today} ticks={false} /></div>
      </details>
    </>
  );
}
