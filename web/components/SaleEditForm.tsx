"use client";

import { useActionState } from "react";
import { updateSale } from "@/app/sales/actions";
import type { SaleRow } from "@/lib/eggstock-types";

const TRANSACTION_TYPES = [
  "sale_farmfresh",
  "sale_wholesaler",
  "gift",
  "staff_allocation",
  "other",
] as const;

export function SaleEditForm({ sale }: { sale: SaleRow }) {
  const [state, formAction, pending] = useActionState(
    updateSale.bind(null, sale.id),
    null
  );
  const v = state?.values;

  return (
    <form action={formAction} className="stack card">
      {state && <div className="error-banner">{state.error}</div>}
      <p className="muted" style={{ margin: 0 }}>
        {sale.date} · {sale.buyer_or_recipient ?? "—"} ·{" "}
        {sale.eggs_quantity?.toLocaleString("en-IN")} eggs
        {sale.trays_quantity && ` (${sale.trays_quantity} trays)`} — derived
        from the ledger line; edit those figures on the Egg Stock page.
      </p>
      <div className="row2">
        <label className="field">
          <span>Transaction type</span>
          <select
            name="transaction_type"
            defaultValue={v ? v.transaction_type : sale.transaction_type ?? ""}
          >
            {TRANSACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            Grade <span className="hint">(if applicable)</span>
          </span>
          <input name="grade" defaultValue={v ? v.grade : sale.grade ?? ""} />
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>
            Price per unit <span className="hint">(manual only — no paper source)</span>
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            name="price_per_unit"
            defaultValue={v ? v.price_per_unit : sale.price_per_unit ?? ""}
          />
        </label>
        <label className="field">
          <span>
            Amount <span className="hint">(manual only)</span>
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            name="amount"
            defaultValue={v ? v.amount : sale.amount ?? ""}
          />
        </label>
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save sale details"}
      </button>
    </form>
  );
}
