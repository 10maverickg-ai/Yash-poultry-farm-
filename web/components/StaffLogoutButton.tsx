"use client";

import { useActionState } from "react";
import type { WeatherState } from "@/app/settings/actions";

export function StaffLogoutButton({ action }: { action: () => Promise<WeatherState> }) {
  const [state, run, pending] = useActionState<WeatherState | null>(async () => action(), null);
  return (
    <form action={run} className="stack">
      <button type="submit" className="btn-secondary" disabled={pending}>{pending ? "Working…" : "Log out all staff phones"}</button>
      {state && (
        <div className={state.ok ? "saved-banner" : "error-banner"} role="status" aria-live="polite">{state.message}</div>
      )}
    </form>
  );
}
