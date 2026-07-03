"use client";

import { useActionState } from "react";
import { depleteFlock } from "@/app/flocks/actions";

export function DepleteFlockForm({ flockId }: { flockId: string }) {
  const [state, formAction, pending] = useActionState(
    depleteFlock.bind(null, flockId),
    null
  );

  return (
    <form action={formAction} className="stack card">
      <h2 style={{ margin: 0 }}>Mark depleted</h2>
      {state && <div className="error-banner">{state.error}</div>}
      <p className="muted" style={{ margin: 0 }}>
        When the flock is fully sold off. Frees its label for the next
        renumbering event; this cannot be undone from the app.
      </p>
      <label className="field">
        <span>Depletion date</span>
        <input
          type="date"
          name="depletion_date"
          defaultValue={state?.values.depletion_date ?? ""}
          required
        />
      </label>
      <button type="submit" className="btn-danger" disabled={pending}>
        {pending ? "Marking…" : "Mark depleted"}
      </button>
    </form>
  );
}
