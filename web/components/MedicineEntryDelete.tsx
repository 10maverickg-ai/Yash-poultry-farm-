"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { LineState } from "@/app/medicines/actions";

export function MedicineEntryDelete({ action, month, count }: { action: (prev: LineState | null, fd: FormData) => Promise<LineState>; month: string; count: number }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LineState | null, FormData>(action, null);
  // the lists on this page are server-rendered: ask for them again after a save
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  if (state?.deleted) return <div className="saved-banner">{state.message} <a href={`/medicines?month=${month}#month`}>Back to the month →</a></div>;
  return (
    <form action={formAction} className="card stack" style={{ borderLeft: "4px solid var(--danger)" }}>
      <h2 style={{ margin: 0 }}>Delete the whole entry ({count} lines)</h2>
      <p className="muted" style={{ margin: 0 }}>This removes all lines saved together and their costs from the month. It cannot be undone.</p>
      {state && !state.ok && <div className="error-banner" role="status">{state.message}</div>}
      <label className="check-line"><input type="checkbox" name="confirm" value="yes" /> <span>Yes, delete the whole entry</span></label>
      <button type="submit" className="btn-secondary" disabled={pending}>Delete</button>
    </form>
  );
}
