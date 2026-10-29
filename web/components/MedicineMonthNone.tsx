"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { LineState } from "@/app/medicines/actions";

// "None this month" for medicines and vaccines, and "Take it back". The answer shows on the same screen.
export function MedicineMonthNone({ action, none, empty, monthLabel, hasCost }: { action: (prev: LineState | null, fd: FormData) => Promise<LineState>; none: boolean; empty: boolean; monthLabel: string; hasCost: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LineState | null, FormData>(action, null);
  // the lists on this page are server-rendered: ask for them again after a save
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={formAction} className="actions-bar" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
      {state && <span className={state.ok ? "badge badge-active" : "error-banner"} role="status">{state.message}</span>}
      {none ? (
        <>
          <span className="badge badge-active">✓ None this month — saved</span>
          <input type="hidden" name="undo" value="1" />
          <button type="submit" className="btn-secondary" disabled={pending}>Take it back</button>
        </>
      ) : empty ? (
        <>
          <span className="muted">No medicines or vaccines entered for {monthLabel}: the Costs screen shows “not entered”.</span>
          <button type="submit" disabled={pending}>None this month</button>
        </>
      ) : !hasCost ? (
        <span className="muted">Lines are entered but none has a cost yet, so the Costs screen still says “medicine costs not entered”. Add the costs to the lines (open a line), or tap None if nothing was paid.</span>
      ) : (
        <span className="muted">These costs are counted on the Costs screen for {monthLabel}.</span>
      )}
    </form>
  );
}
