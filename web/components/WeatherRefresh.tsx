"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { WeatherState } from "@/app/settings/actions";

export function WeatherRefresh({ action }: { action: () => Promise<WeatherState> }) {
  const router = useRouter();
  const [state, run, pending] = useActionState<WeatherState | null>(async () => action(), null);
  useEffect(() => {
    if (state) router.refresh(); // the "last attempt" line is read from the log, so it changes after a failure too
  }, [state, router]);
  return (
    <form action={run} className="stack">
      <button type="submit" disabled={pending}>{pending ? "Asking the weather service… (can take up to 20 seconds)" : "Refresh weather now"}</button>
      {state && (
        <div className={state.ok ? "saved-banner" : "error-banner"} role="status" aria-live="polite">
          {state.message}
        </div>
      )}
    </form>
  );
}
