"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { LineState } from "@/app/medicines/actions";

export function MedicineDelete({ action, month }: { action: (prev: LineState | null, fd: FormData) => Promise<LineState>; month: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LineState | null, FormData>(action, null);
  // the lists on this page are server-rendered: ask for them again after a save
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  if (state?.deleted) return <div className="saved-banner">{state.message} <a href={`/medicines?month=${month}#month`}>Back to the month →</a></div>;
  return (
    <form action={formAction} className="card stack" style={{ borderLeft: "4px solid var(--danger)" }}>
      <h2 style={{ margin: 0 }}>Delete this line</h2>
      <p className="muted" style={{ margin: 0 }}>This removes the line and its cost from the month. It cannot be undone.</p>
      {state && !state.ok && <div className="error-banner" role="status">{state.message}</div>}
      <label className="check-line"><input type="checkbox" name="confirm" value="yes" /> <span>Yes, delete this line</span></label>
      <button type="submit" className="btn-secondary" disabled={pending}>Delete</button>
    </form>
  );
}
