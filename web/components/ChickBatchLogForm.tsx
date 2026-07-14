"use client";

import { useActionState } from "react";
import { createChickBatch } from "@/app/chick-batches/actions";

export function ChickBatchLogForm({ shedCodes }: { shedCodes: string[] }) {
  const [state, formAction, pending] = useActionState(createChickBatch, null);
  const v = state?.values ?? {};

  return (
    <form action={formAction} className="stack card">
      <h2 style={{ margin: 0 }}>Log a batch</h2>
      {state && <div className="error-banner">{state.error}</div>}
      <div className="row2">
        <label className="field">
          <span>Date</span>
          <input type="date" name="date" defaultValue={v.date ?? ""} required />
        </label>
        <label className="field">
          <span>Shed</span>
          <select name="shed_code" defaultValue={v.shed_code ?? ""} required>
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
        <span>Total birds</span>
        <input
          type="number"
          min="0"
          name="total_birds"
          defaultValue={v.total_birds ?? ""}
        />
      </label>
      <label className="field">
        <span>
          Source hatchery <span className="hint">(optional)</span>
        </span>
        <input name="source_hatchery" defaultValue={v.source_hatchery ?? ""} />
      </label>
      <label className="field">
        <span>
          Notes <span className="hint">(optional)</span>
        </span>
        <textarea name="notes" rows={2} defaultValue={v.notes ?? ""} />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Log batch"}
      </button>
    </form>
  );
}
