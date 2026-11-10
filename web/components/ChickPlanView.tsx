import { ActionForm } from "@/components/ActionForm";
import { tickStep, untickStep } from "@/app/medicines/chicks/actions";
import { dayLabel, dateWords, groupDays, stepStatus, type PlanStep } from "@/lib/medicines/chickPlan";
import { dmy } from "@/lib/format";

// One plan, day by day. With `ticks` (a real batch) each step shows its status in words and can be ticked off with the date it was done;
// without (a schedule or a preview) it is a read-only list. Names the owner has not confirmed carry the "to confirm" badge.
export interface ViewStep extends PlanStep { id?: number; givenDate?: string | null }

export function ChickPlanView({ steps, today, ticks }: { steps: ViewStep[]; today: string; ticks: boolean }) {
  return (
    <div className="cp-days">
      {groupDays(steps).map((d) => (
        <section key={`${d.dayFrom}-${d.dayTo}`} className="card cp-day" aria-label={dayLabel(d.dayFrom, d.dayTo)}>
          <h3 style={{ margin: 0 }}>{dayLabel(d.dayFrom, d.dayTo)}{ticks || d.due ? <span className="muted an-tiny"> · {dateWords(d.due, d.windowEnd)}</span> : null}</h3>
          {d.steps.map((s) => {
            const st = ticks ? stepStatus(s.due, s.windowEnd, s.givenDate ?? null, today) : null;
            return (
              <div key={`${s.templateId}-${s.id ?? ""}`} className={`cp-step${st === "overdue" ? " day-flagged" : ""}`}>
                <div>
                  <b>{s.name}</b>{" "}
                  <span className="muted an-tiny">{s.isTask ? "task" : s.kind === "vaccine" ? "vaccine" : "medicine"}</span>
                  {s.needsConfirmation && <span className="badge badge-confirm" style={{ marginLeft: "0.4rem" }}>to confirm</span>}
                  {st && <span className={`md-status ${st === "done" ? "md-tl-green-text" : st === "overdue" ? "md-tl-red-text" : st === "later" ? "" : "md-tl-amber-text"}`} style={{ marginLeft: "0.5rem" }}>{st === "done" ? `✓ ${s.isTask ? "Done" : "Given"} ${dmy(s.givenDate!)}` : st === "overdue" ? "Overdue" : st === "now" ? (s.isTask ? "To do now" : "Due now") : st === "soon" ? "Due soon" : "Later"}</span>}
                </div>
                {s.purpose && <div className="muted an-tiny">{s.purpose}</div>}
                {s.note && <div className="muted an-tiny">{s.note}</div>}
                {ticks && s.id != null && (
                  s.givenDate ? (
                    <ActionForm action={untickStep.bind(null, s.id)} className="actions-bar" style={{ margin: "0.2rem 0 0" }}><button type="submit" className="btn-secondary btn-small">Take back</button></ActionForm>
                  ) : (
                    <ActionForm action={tickStep.bind(null, s.id)} className="actions-bar" style={{ margin: "0.3rem 0 0" }}>
                      <input type="date" name="given_date" defaultValue={today} max={today} aria-label={`Date ${s.name} was ${s.isTask ? "done" : "given"}`} required />
                      <button type="submit">{s.isTask ? "Tick: done" : "Tick: given"}</button>
                    </ActionForm>
                  )
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
