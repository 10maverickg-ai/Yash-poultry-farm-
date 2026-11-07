"use server";

import { withTransaction } from "@/lib/db";
import { createPlanForBatch, setStepGiven } from "@/lib/medicines/chickStore";

export interface PlanState { ok: boolean; message: string }
const iso = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const FAILED = "That could not be saved just now. Try again in a moment.";

// "Make the plan": only when the owner taps it (existing batches get nothing automatically). Steps already made are kept.
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export async function makeChickPlan(batchId: number, _prev: PlanState | null, _formData: FormData): Promise<PlanState> {
  try {
    const n = await withTransaction((c) => createPlanForBatch(c, batchId));
    return n > 0 ? { ok: true, message: `The plan was made: ${n} step${n === 1 ? "" : "s"}.` } : { ok: false, message: "Nothing was added: the plan for this batch is already made." };
  } catch {
    return { ok: false, message: FAILED };
  }
}

// Tick a step off with the date it was really done (never assumed). A date in the future is refused.
export async function tickStep(id: number, _prev: PlanState | null, formData: FormData): Promise<PlanState> {
  const d = String(formData.get("given_date") ?? "");
  if (!iso.test(d)) return { ok: false, message: "Choose the date it was done." };
  if (d > today()) return { ok: false, message: "That date is in the future. Choose the date it was done." };
  try {
    return (await setStepGiven(id, d)) ? { ok: true, message: "Ticked off." } : { ok: false, message: "That step is no longer in the plan." };
  } catch {
    return { ok: false, message: FAILED };
  }
}

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export async function untickStep(id: number, _prev: PlanState | null, _formData: FormData): Promise<PlanState> {
  try {
    return (await setStepGiven(id, null)) ? { ok: true, message: "Taken back: the step is open again." } : { ok: false, message: "That step is no longer in the plan." };
  } catch {
    return { ok: false, message: FAILED };
  }
}
