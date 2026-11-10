"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ItemState } from "@/app/medicines/list/actions";

// Removing a list item needs a tick, and only works for an item nothing uses; otherwise the answer says to take it out of the pick list.
export function CatalogueDelete({ action }: { action: (prev: ItemState | null, fd: FormData) => Promise<ItemState> }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ItemState | null, FormData>(action, null);
  useEffect(() => {
    if (state?.deleted) router.push("/medicines/list");
  }, [state, router]);
  return (
    <form action={formAction} className="card stack" style={{ borderLeft: "4px solid var(--danger)" }}>
      <h2 style={{ margin: 0 }}>Remove it from the list</h2>
      <p className="muted" style={{ margin: 0 }}>Only possible when nothing uses it. If it was ever used, take it out of the pick list instead (above): old lines keep their name.</p>
      {state && !state.ok && <div className="error-banner" role="status">{state.message}</div>}
      <label className="check-line"><input type="checkbox" name="confirm" value="yes" /> <span>Yes, remove it from the list</span></label>
      <button type="submit" className="btn-secondary" disabled={pending}>Remove</button>
    </form>
  );
}
