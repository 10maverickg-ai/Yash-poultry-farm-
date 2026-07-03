"use client";

import { useActionState } from "react";
import { createShed, updateShed } from "@/app/sheds/actions";

const SHED_TYPES = ["chick", "grower", "layer"] as const;

export function AddShedForm() {
  const [state, formAction, pending] = useActionState(createShed, null);
  const v = state?.values ?? {};

  return (
    <form action={formAction} className="stack card">
      <h2 style={{ margin: 0 }}>Add shed</h2>
      {state && <div className="error-banner">{state.error}</div>}
      <div className="row2">
        <label className="field">
          <span>
            Shed code * <span className="hint">(e.g. Shed 4)</span>
          </span>
          <input name="shed_code" defaultValue={v.shed_code ?? ""} required />
        </label>
        <label className="field">
          <span>Type</span>
          <select name="shed_type" defaultValue={v.shed_type ?? ""}>
            <option value="">—</option>
            {SHED_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>Max capacity</span>
          <input
            type="number"
            name="max_capacity"
            min="0"
            defaultValue={v.max_capacity ?? ""}
          />
        </label>
        <label className="field">
          <span>Notes</span>
          <input name="notes" defaultValue={v.notes ?? ""} />
        </label>
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add shed"}
      </button>
    </form>
  );
}

export interface ShedEditValues {
  shed_code: string;
  shed_type: string | null;
  max_capacity: number | null;
  notes: string | null;
}

export function EditShedForm({ shed }: { shed: ShedEditValues }) {
  const [state, formAction, pending] = useActionState(
    updateShed.bind(null, shed.shed_code),
    null
  );
  const v = state?.values;

  return (
    <form action={formAction} className="stack card">
      <h2 style={{ margin: 0 }}>Edit {shed.shed_code}</h2>
      {state && <div className="error-banner">{state.error}</div>}
      <div className="row2">
        <label className="field">
          <span>Type</span>
          <select
            name="shed_type"
            defaultValue={v ? v.shed_type : shed.shed_type ?? ""}
          >
            <option value="">—</option>
            {SHED_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Max capacity</span>
          <input
            type="number"
            name="max_capacity"
            min="0"
            defaultValue={v ? v.max_capacity : shed.max_capacity ?? ""}
          />
        </label>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea name="notes" rows={2} defaultValue={v ? v.notes : shed.notes ?? ""} />
      </label>
      <div className="actions-bar" style={{ marginBottom: 0 }}>
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <a href="/sheds" className="btn btn-secondary">
          Cancel
        </a>
      </div>
    </form>
  );
}
