"use client";

import { useActionState, useState } from "react";
import { saveFeedStock } from "@/app/feed-stock/actions";
import type { FeedStockSlot } from "@/lib/feed";

// Paper units, exactly as the register page: Opening / Purchase / Closing in
// quintals, Consumed in kg. The balance line under each touched row previews
// the kg arithmetic the server's flag rule will run (blank Purchase = 0).
export function FeedStockForm({
  date,
  slots,
}: {
  date: string;
  slots: FeedStockSlot[];
}) {
  const [state, formAction, pending] = useActionState(
    saveFeedStock.bind(null, date),
    null
  );

  return (
    <form action={formAction} className="stack">
      {state && <div className="error-banner">{state.error}</div>}
      <input type="hidden" name="material_count" value={slots.length} />
      {slots.map((slot, i) => (
        <MaterialRow key={slot.material_name} slot={slot} index={i} typed={state?.values} />
      ))}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save day's feed stock"}
      </button>
    </form>
  );
}

const kgToQtl = (kg: string | null) => (kg === null ? "" : String(Number(kg) / 100));

function MaterialRow({
  slot,
  index,
  typed,
}: {
  slot: FeedStockSlot;
  index: number;
  typed: Record<string, string> | undefined;
}) {
  const seed = (field: string, savedQtl: string) =>
    typed ? typed[`${field}_${index}`] ?? "" : savedQtl;

  const [opening, setOpening] = useState(
    seed("opening_q", kgToQtl(slot.saved?.opening_balance_kg ?? null))
  );
  const [purchase, setPurchase] = useState(
    seed("purchase_q", kgToQtl(slot.saved?.purchase_kg ?? null))
  );
  const [consumed, setConsumed] = useState(
    seed("consumed_kg", slot.saved?.consumed_kg === null || slot.saved === null ? "" : String(Number(slot.saved.consumed_kg)))
  );
  const [closing, setClosing] = useState(
    seed("closing_q", kgToQtl(slot.saved?.closing_balance_kg ?? null))
  );

  const touched = [opening, purchase, consumed, closing].some((v) => v !== "");
  let balanceNote: { ok: boolean; text: string } | null = null;
  if (touched && opening !== "" && consumed !== "" && closing !== "") {
    const o = Number(opening) * 100;
    const p = purchase === "" ? 0 : Number(purchase) * 100;
    const c = Number(consumed);
    const cl = Number(closing) * 100;
    if ([o, p, c, cl].every(Number.isFinite)) {
      const expected = o + p - c;
      balanceNote = {
        ok: Math.abs(expected - cl) <= 0.001,
        text: `${o} + ${p} − ${c} = ${expected} kg vs closing ${cl} kg`,
      };
    }
  }

  return (
    <div className="card stack feed-row" style={{ marginBottom: 0 }}>
      <h2 style={{ margin: 0 }}>
        {slot.material_name}
        {slot.saved?.flagged && <span className="badge badge-flagged"> flagged</span>}
        {slot.previous_closing_kg !== null && (
          <span className="hint">
            {" "}
            prev closing: {Number(slot.previous_closing_kg) / 100} qtl
          </span>
        )}
      </h2>
      {slot.saved?.flagged && slot.saved.flag_reason && (
        <div className="flag-banner">{slot.saved.flag_reason}</div>
      )}
      <input type="hidden" name={`material_${index}`} value={slot.material_name} />
      <div className="grid4">
        <label className="field">
          <span>Opening (qtl)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            name={`opening_q_${index}`}
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Purchase (qtl)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            name={`purchase_q_${index}`}
            value={purchase}
            onChange={(e) => setPurchase(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Consumed (kg)</span>
          <input
            type="number"
            step="0.001"
            min="0"
            name={`consumed_kg_${index}`}
            value={consumed}
            onChange={(e) => setConsumed(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Closing (qtl)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            name={`closing_q_${index}`}
            value={closing}
            onChange={(e) => setClosing(e.target.value)}
          />
        </label>
      </div>
      {balanceNote && (
        <p className={balanceNote.ok ? "muted" : "balance-warn"} style={{ margin: 0 }}>
          {balanceNote.ok ? "✓ " : "✗ "}
          {balanceNote.text}
        </p>
      )}
    </div>
  );
}
