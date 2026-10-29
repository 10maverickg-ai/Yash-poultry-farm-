"use client";

import { useActionState } from "react";
import { updateSale } from "@/app/sales/actions";
import type { SaleRow } from "@/lib/eggstock-types";
import { RECIPIENTS } from "@/lib/sales/recipients";

const TRANSACTION_TYPES = [
  "sale_farmfresh",
  "sale_wholesaler",
  "local",
  "gift",
  "staff_allocation",
  "other",
] as const;

const TYPE_WORDS: Record<string, string> = {
  sale_farmfresh: "Farmfresh sale (rate − 0.03)",
  sale_wholesaler: "Wholesaler",
  local: "Local sale (rate + 0.01)",
  gift: "Gift",
  staff_allocation: "Given to staff",
  other: "Local sale (stored as other)",
};

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
      <label className="field">
        <span>Who got the eggs <span className="hint">(does not change the price)</span></span>
        <select name="recipient" defaultValue={v ? v.recipient : sale.recipient ?? ""}>
          <option value="" disabled>Choose…</option>
          {RECIPIENTS.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
      </label>
      <div className="row2">
        <label className="field">
          <span>Kind of sale</span>
          <select
            name="transaction_type"
            defaultValue={v ? v.transaction_type : sale.transaction_type ?? ""}
          >
            {TRANSACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_WORDS[t] ?? t.replaceAll("_", " ")}
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
