"use client";

import { useActionState } from "react";
import { updateFlock } from "@/app/flocks/actions";

export interface FlockEditValues {
  display_label: string;
  breed: string | null;
  placement_date: string | null;
  source_hatchery: string | null;
  hatchery_bill_photo_url: string | null;
  initial_chick_count: number | null;
  current_bird_count: number | null;
  current_shed: string | null;
  notes: string | null;
}

export function FlockEditForm({
  flockId,
  flock,
  shedCodes,
}: {
  flockId: string;
  flock: FlockEditValues;
  shedCodes: string[];
}) {
  const [state, formAction, pending] = useActionState(
    updateFlock.bind(null, flockId),
    null
  );
  // On a failed submit, re-seed from what was typed; otherwise from the record.
  const v = state?.values;

  return (
    <form action={formAction} className="stack card">
      <h2 style={{ margin: 0 }}>Details</h2>
      {state && <div className="error-banner">{state.error}</div>}
      <label className="field">
        <span>
          Display label *{" "}
          <span className="hint">
            (edit here only to fix a typo — label shifts between flocks go
            through the renumbering form)
          </span>
        </span>
        <input
          name="display_label"
          defaultValue={v ? v.display_label : flock.display_label}
          required
        />
      </label>
      <div className="row2">
        <label className="field">
          <span>Breed</span>
          <input name="breed" defaultValue={v ? v.breed : flock.breed ?? ""} />
        </label>
        <label className="field">
          <span>Placement date</span>
          <input
            type="date"
            name="placement_date"
            defaultValue={v ? v.placement_date : flock.placement_date ?? ""}
          />
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>Source hatchery</span>
          <input
            name="source_hatchery"
            defaultValue={v ? v.source_hatchery : flock.source_hatchery ?? ""}
          />
        </label>
        <label className="field">
          <span>Initial chick count</span>
          <input
            type="number"
            name="initial_chick_count"
            min="0"
            defaultValue={v ? v.initial_chick_count : flock.initial_chick_count ?? ""}
          />
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>Current bird count</span>
          <input
            type="number"
            name="current_bird_count"
            min="0"
            defaultValue={v ? v.current_bird_count : flock.current_bird_count ?? ""}
          />
        </label>
        <label className="field">
          <span>Current shed</span>
          <select
            name="current_shed"
            defaultValue={v ? v.current_shed : flock.current_shed ?? ""}
          >
            <option value="">—</option>
            {shedCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Hatchery bill photo URL</span>
        <input
          name="hatchery_bill_photo_url"
          defaultValue={
            v ? v.hatchery_bill_photo_url : flock.hatchery_bill_photo_url ?? ""
          }
        />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea
          name="notes"
          rows={2}
          defaultValue={v ? v.notes : flock.notes ?? ""}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}
