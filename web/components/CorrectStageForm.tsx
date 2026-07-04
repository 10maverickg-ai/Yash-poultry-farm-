"use client";

import { useActionState } from "react";
import { correctStage } from "@/app/flocks/actions";

const STAGES = ["chick", "grower", "layer"] as const;

// Data-entry fix, NOT a lifecycle event: no transition date, no forward-only
// rule, stage_transition_dates untouched. Visually distinct from the
// transition card and gated behind an explicit confirmation tick.
export function CorrectStageForm({
  flockId,
  currentStage,
}: {
  flockId: string;
  currentStage: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    correctStage.bind(null, flockId),
    null
  );

  return (
    <form action={formAction} className="stack card card-correction">
      <h2 style={{ margin: 0 }}>Correct stage (data-entry fix)</h2>
      {state && <div className="error-banner">{state.error}</div>}
      <p className="muted" style={{ margin: 0 }}>
        Only for fixing a wrongly entered stage. A real move between stages is
        a <strong>stage transition</strong> above — it records the date; this
        does not.
      </p>
      <label className="field">
        <span>Correct stage</span>
        <select
          name="corrected_stage"
          defaultValue={state?.values.corrected_stage ?? currentStage ?? ""}
          required
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
              {s === currentStage ? " (currently set)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label
        className="field"
        style={{ gridTemplateColumns: "auto 1fr", alignItems: "center", gap: "0.5rem" }}
      >
        <input
          type="checkbox"
          name="confirm_correction"
          value="yes"
          required
          style={{ width: "auto" }}
        />
        <span style={{ fontWeight: 400 }}>
          I&apos;m fixing a data-entry mistake, not recording a real transition
        </span>
      </label>
      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? "Applying…" : "Apply correction"}
      </button>
    </form>
  );
}
