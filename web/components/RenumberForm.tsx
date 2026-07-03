"use client";

import { useActionState } from "react";
import { renumberFlocks } from "@/app/flocks/actions";

export interface RenumberRow {
  flockId: string;
  label: string;
  placed: string | null;
}

export function RenumberForm({ rows }: { rows: RenumberRow[] }) {
  const [state, formAction, pending] = useActionState(renumberFlocks, null);
  const v = state?.values ?? {};

  return (
    <form action={formAction} className="stack card">
      {state && <div className="error-banner">{state.error}</div>}
      <label className="field">
        <span>
          Effective from *{" "}
          <span className="hint">(first day the new labels are used on paper)</span>
        </span>
        <input
          type="date"
          name="effective_from"
          defaultValue={v.effective_from ?? ""}
          required
        />
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Current label</th>
              <th>Placed</th>
              <th>New label</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.flockId}>
                <td>{r.label}</td>
                <td>{r.placed ?? "—"}</td>
                <td>
                  <input
                    name={`label_${r.flockId}`}
                    defaultValue={v[`label_${r.flockId}`] ?? r.label}
                    required
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Flocks whose label is unchanged are left untouched.
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Applying…" : "Apply renumbering"}
      </button>
    </form>
  );
}
