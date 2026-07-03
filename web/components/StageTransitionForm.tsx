"use client";

import { useActionState } from "react";
import { transitionStage } from "@/app/flocks/actions";

const STAGE_ORDER = ["chick", "grower", "layer"] as const;

export function StageTransitionForm({
  flockId,
  currentStage,
  transitions,
}: {
  flockId: string;
  currentStage: string | null;
  transitions: [string, string][]; // [["chick_to_grower", "2026-01-10"], …]
}) {
  const [state, formAction, pending] = useActionState(
    transitionStage.bind(null, flockId),
    null
  );

  // Forward-only: offer only stages after the current one.
  const currentIdx = currentStage
    ? STAGE_ORDER.indexOf(currentStage as (typeof STAGE_ORDER)[number])
    : -1;
  const forwardStages = STAGE_ORDER.slice(currentIdx + 1);

  const summary = (
    <p className="muted" style={{ margin: 0 }}>
      Current stage: <strong>{currentStage ?? "not set"}</strong>
      {transitions.map(([k, v]) => (
        <span key={k}>
          {" "}
          · {k.replaceAll("_", " ")}: {v}
        </span>
      ))}
    </p>
  );

  if (forwardStages.length === 0) {
    return (
      <div className="stack card">
        <h2 style={{ margin: 0 }}>Stage transition</h2>
        {summary}
        <p className="muted" style={{ margin: 0 }}>
          Layer is the final stage — no further transitions.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="stack card">
      <h2 style={{ margin: 0 }}>Stage transition</h2>
      {state && <div className="error-banner">{state.error}</div>}
      {summary}
      <div className="row2">
        <label className="field">
          <span>
            New stage <span className="hint">(forward only)</span>
          </span>
          <select name="new_stage" defaultValue={state?.values.new_stage} required>
            {forwardStages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Transition date</span>
          <input
            type="date"
            name="transition_date"
            defaultValue={state?.values.transition_date ?? ""}
            required
          />
        </label>
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Recording…" : "Record transition"}
      </button>
    </form>
  );
}
