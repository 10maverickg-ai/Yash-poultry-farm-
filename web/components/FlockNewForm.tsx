"use client";

import { useActionState } from "react";
import { createFlock } from "@/app/flocks/actions";

export function FlockNewForm({ shedCodes }: { shedCodes: string[] }) {
  const [state, formAction, pending] = useActionState(createFlock, null);
  const v = state?.values ?? {};

  return (
    <form action={formAction} className="stack card">
      {state && <div className="error-banner">{state.error}</div>}
      <label className="field">
        <span>
          Display label * <span className="hint">(as on paper, e.g. BAB-I)</span>
        </span>
        <input name="display_label" defaultValue={v.display_label ?? ""} required />
      </label>
      <div className="row2">
        <label className="field">
          <span>Breed</span>
          <input name="breed" defaultValue={v.breed ?? "BV300"} />
        </label>
        <label className="field">
          <span>
            Placement date <span className="hint">(chick arrival)</span>
          </span>
          <input type="date" name="placement_date" defaultValue={v.placement_date ?? ""} />
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>Source hatchery</span>
          <input name="source_hatchery" defaultValue={v.source_hatchery ?? ""} />
        </label>
        <label className="field">
          <span>Initial chick count</span>
          <input
            type="number"
            name="initial_chick_count"
            min="0"
            defaultValue={v.initial_chick_count ?? ""}
          />
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>
            Current bird count{" "}
            <span className="hint">(defaults to initial count)</span>
          </span>
          <input
            type="number"
            name="current_bird_count"
            min="0"
            defaultValue={v.current_bird_count ?? ""}
          />
        </label>
        <label className="field">
          <span>Current shed</span>
          <select name="current_shed" defaultValue={v.current_shed ?? ""}>
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
        <span>Current stage</span>
        <select name="current_stage" defaultValue={v.current_stage ?? "chick"}>
          <option value="chick">chick</option>
          <option value="grower">grower</option>
          <option value="layer">layer</option>
        </select>
      </label>
      <label className="field">
        <span>
          Hatchery bill photo URL{" "}
          <span className="hint">(optional; photo upload comes with Phase 3)</span>
        </span>
        <input
          name="hatchery_bill_photo_url"
          defaultValue={v.hatchery_bill_photo_url ?? ""}
        />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea name="notes" rows={2} defaultValue={v.notes ?? ""} />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create flock"}
      </button>
    </form>
  );
}
