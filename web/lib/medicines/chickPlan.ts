// The chick vaccination and management plan (V14 Q6). Pure functions, no database. Day 1 = the day the chicks arrive (the placement date).
// Steps come from the owner's own day-by-day schedule (vaccination_schedule_template); the dates are worked out here from the arrival date.
import { daysBetween } from "./boosters";
import { dmy } from "@/lib/format";

export interface TemplateRow { id: number; dayFrom: number; dayTo: number | null; catalogueId: number; name: string; kind: "vaccine" | "medicine" | "management"; purpose: string | null; note: string | null; needsConfirmation: boolean; sort: number }
export interface PlanStep { templateId: number; catalogueId: number; name: string; kind: TemplateRow["kind"]; purpose: string | null; dayFrom: number; dayTo: number | null; due: string; windowEnd: string | null; note: string | null; needsConfirmation: boolean; isTask: boolean }

export const addDays = (d: string, n: number): string => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const dayOfAge = (arrival: string, today: string): number => daysBetween(arrival, today) + 1;

/** Every step with its date: due = arrival + (day - 1); a range such as day 18 to 20 is a window from its first to its last day. */
export function buildPlan(template: TemplateRow[], arrival: string): PlanStep[] {
  return [...template]
    .sort((a, b) => a.dayFrom - b.dayFrom || a.sort - b.sort || a.id - b.id)
    .map((t) => ({
      templateId: t.id,
      catalogueId: t.catalogueId,
      name: t.name,
      kind: t.kind,
      purpose: t.purpose,
      dayFrom: t.dayFrom,
      dayTo: t.dayTo,
      due: addDays(arrival, t.dayFrom - 1),
      windowEnd: t.dayTo != null ? addDays(arrival, t.dayTo - 1) : null,
      note: t.note,
      needsConfirmation: t.needsConfirmation,
      isTask: t.kind === "management",
    }));
}

export interface PlanDay<T> { dayFrom: number; dayTo: number | null; due: string; windowEnd: string | null; steps: T[] }
export function groupDays<T extends { dayFrom: number; dayTo: number | null; due: string; windowEnd: string | null }>(steps: T[]): PlanDay<T>[] {
  const out: PlanDay<T>[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (last && last.dayFrom === s.dayFrom && last.dayTo === s.dayTo) last.steps.push(s);
    else out.push({ dayFrom: s.dayFrom, dayTo: s.dayTo, due: s.due, windowEnd: s.windowEnd, steps: [s] });
  }
  return out;
}

export type StepStatus = "done" | "overdue" | "now" | "soon" | "later";
export const SOON_DAYS = 14;
/** done = given; overdue = the day (or the last day of the window) is past; now = today is the day or inside the window; soon = within 14 days. */
export function stepStatus(due: string, windowEnd: string | null, givenDate: string | null, today: string, soonDays = SOON_DAYS): StepStatus {
  if (givenDate) return "done";
  if (today > (windowEnd ?? due)) return "overdue";
  if (today >= due) return "now";
  return daysBetween(today, due) <= soonDays ? "soon" : "later";
}

export const dayLabel = (dayFrom: number, dayTo: number | null): string => (dayTo != null ? `Day ${dayFrom} to ${dayTo}` : `Day ${dayFrom}`);
export const weekday = (d: string): string => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
export const dateWords = (due: string, windowEnd: string | null): string => (windowEnd ? `${weekday(due)} ${dmy(due)} to ${weekday(windowEnd)} ${dmy(windowEnd)}` : `${weekday(due)} ${dmy(due)}`);

export interface BatchPlanSteps { id: number; arrival: string; steps: { name: string; due: string; windowEnd: string | null; givenDate: string | null }[] }
export interface ChickAlert { id: string; title: string; detail: string; href: string }

/** One line per batch that HAS a plan: how many steps are overdue and which are due in the next 14 days. A batch with no plan gives no alert. */
export function chickAlerts(batches: BatchPlanSteps[], today: string, href = "/medicines/chicks"): ChickAlert[] {
  const out: ChickAlert[] = [];
  for (const b of batches) {
    if (b.steps.length === 0) continue;
    const st = b.steps.map((s) => ({ ...s, status: stepStatus(s.due, s.windowEnd, s.givenDate, today) }));
    const over = st.filter((s) => s.status === "overdue");
    const soon = st.filter((s) => s.status === "now" || s.status === "soon");
    if (over.length === 0 && soon.length === 0) continue;
    const names = (xs: typeof st) => [...new Set(xs.map((x) => x.name))].join(", ");
    const parts: string[] = [];
    if (over.length) parts.push(`Not ticked and past their day: ${names(over)}.`);
    if (soon.length) parts.push(`Due now or within ${SOON_DAYS} days: ${names(soon)}.`);
    out.push({
      id: `chick-plan-${b.id}`,
      title: over.length
        ? `Chick batch of ${dmy(b.arrival)} (day ${dayOfAge(b.arrival, today)}): ${over.length} step${over.length === 1 ? "" : "s"} overdue${soon.length ? `, ${soon.length} due soon` : ""}.`
        : `Chick batch of ${dmy(b.arrival)} (day ${dayOfAge(b.arrival, today)}): ${soon.length} step${soon.length === 1 ? "" : "s"} due within ${SOON_DAYS} days.`,
      detail: parts.join(" "),
      href,
    });
  }
  return out;
}
