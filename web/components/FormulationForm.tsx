"use client";

import { useActionState, useState } from "react";
import { saveFormulation } from "@/app/formulation/actions";

interface Line {
  material: string;
  qty: string;
}

export function FormulationForm({ materials }: { materials: string[] }) {
  const [state, formAction, pending] = useActionState(saveFormulation, null);
  const v = state?.values;

  const initialLines: Line[] = v
    ? Array.from({ length: Number(v.line_count ?? 0) }, (_, i) => ({
        material: v[`material_${i}`] ?? "",
        qty: v[`quantity_${i}`] ?? "",
      }))
    : [{ material: "", qty: "" }];
  const [lines, setLines] = useState<Line[]>(
    initialLines.length > 0 ? initialLines : [{ material: "", qty: "" }]
  );

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form action={formAction} className="stack card">
      <h2 style={{ margin: 0 }}>New formulation version</h2>
      {state && <div className="error-banner">{state.error}</div>}
      <div className="row2">
        <label className="field">
          <span>
            Group <span className="hint">(as used at the mill, e.g. a flock-group label)</span>
          </span>
          <input
            name="formulation_group"
            defaultValue={v?.formulation_group ?? ""}
            required
          />
        </label>
        <label className="field">
          <span>Effective date</span>
          <input
            type="date"
            name="effective_date"
            defaultValue={v?.effective_date ?? ""}
            required
          />
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>Batch total (kg)</span>
          <input
            type="number"
            step="0.001"
            min="0"
            name="batch_total_kg"
            defaultValue={v?.batch_total_kg ?? ""}
          />
        </label>
        <label className="field">
          <span>
            Reason for change <span className="hint">(optional)</span>
          </span>
          <input name="reason_for_change" defaultValue={v?.reason_for_change ?? ""} />
        </label>
      </div>

      <input type="hidden" name="line_count" value={lines.length} />
      {lines.map((line, i) => (
        <div key={i} className="row2" style={{ alignItems: "end" }}>
          <label className="field">
            <span>Material</span>
            <select
              name={`material_${i}`}
              value={line.material}
              onChange={(e) => setLine(i, { material: e.target.value })}
            >
              <option value="">—</option>
              {materials.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Quantity (kg, per batch)</span>
            <div className="actions-bar" style={{ marginBottom: 0, flexWrap: "nowrap" }}>
              <input
                type="number"
                step="0.001"
                min="0"
                name={`quantity_${i}`}
                value={line.qty}
                onChange={(e) => setLine(i, { qty: e.target.value })}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setLines((ls) => [...ls, { material: "", qty: "" }])}
      >
        + Add material
      </button>

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save formulation version"}
      </button>
    </form>
  );
}
