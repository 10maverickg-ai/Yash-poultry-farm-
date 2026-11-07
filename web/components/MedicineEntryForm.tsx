"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UNITS } from "@/lib/medicines/lines";
import { describeSplit, planEntry } from "@/lib/medicines/entry";
import type { EntryState } from "@/app/medicines/actions";

// The entry form (V14 Q3): pick the medicine or vaccine from the master list (never typed), tick the flocks, then date, quantity and cost.
// One register line is saved per ticked flock; a total quantity or cost is split by the birds in each flock (the line under the boxes
// shows how, before saving). The answer appears on this same screen and the next entry keeps the date, flocks, shop and photo.
export interface PickItem { id: number; name: string; kind: "vaccine" | "medicine"; summary: string; needsConfirmation: boolean; search: string }
export interface PickFlock { id: string; label: string; birds: number | null; segment: "main" | "young" | null }

const fmt = (n: number | null) => (n == null ? "bird count not known" : `${n.toLocaleString("en-IN")} birds`);

export function MedicineEntryForm({
  action,
  items,
  flocks,
  defaults,
  suppliers,
}: {
  action: (prev: EntryState | null, formData: FormData) => Promise<EntryState>;
  items: PickItem[];
  flocks: PickFlock[];
  defaults: { date: string; flockIds: string[]; supplier: string };
  suppliers: string[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<EntryState | null, FormData>(action, null);
  useEffect(() => {
    if (state?.ok) router.refresh(); // the month list on this page is server-rendered
  }, [state, router]);
  const keep = state?.ok && state.keep ? state.keep : null;
  // a saved entry starts the form fresh (a new key remounts it) but keeps what the next entry on the same page shares
  return (
    <Inner
      key={state?.ok ? `s${state.savedId}` : "f"}
      formAction={formAction}
      pending={pending}
      state={state}
      items={items}
      flocks={flocks}
      suppliers={suppliers}
      date={keep?.date ?? defaults.date}
      flockIds={keep?.flockIds ?? defaults.flockIds}
      supplier={keep ? keep.supplier : defaults.supplier}
    />
  );
}

function Inner({ formAction, pending, state, items, flocks, suppliers, date, flockIds, supplier }: { formAction: (fd: FormData) => void; pending: boolean; state: EntryState | null; items: PickItem[]; flocks: PickFlock[]; suppliers: string[]; date: string; flockIds: string[]; supplier: string }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [ticked, setTicked] = useState<string[]>(flockIds);
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [cost, setCost] = useState("");
  const shown = useMemo(() => {
    const k = q.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
    return k ? items.filter((i) => i.search.includes(k)) : items;
  }, [q, items]);
  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const plan = useMemo(() => planEntry({ flockIds: ticked, quantity: qty.trim() === "" || !Number.isFinite(Number(qty)) ? null : Number(qty), cost: cost.trim() === "" || !Number.isFinite(Number(cost)) ? null : Number(cost) }, flocks.map((f) => ({ id: f.id, label: f.label, birds: f.birds }))), [ticked, qty, cost, flocks]);
  const splitText = describeSplit(plan, unit.trim() || null);
  const pickedItem = items.find((i) => i.id === picked);
  return (
    <form action={formAction} className="card stack" id="entry">
      {state && <div className={state.ok ? "saved-banner" : "error-banner"} role="status" aria-live="polite">{state.message}</div>}

      <fieldset className="md-fieldset">
        <legend className="field-label">1. What was given?</legend>
        <label className="field">
          <span>Search the list</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, other spelling or disease" autoComplete="off" />
        </label>
        <div className="md-picklist" role="radiogroup" aria-label="Medicines and vaccines in the list">
          {shown.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing in the list matches. Add it below.</p>}
          {shown.map((i) => (
            <label key={i.id} className={`md-pick${picked === i.id ? " md-pick-on" : ""}`}>
              <input type="radio" name="catalogue_id" value={i.id} checked={picked === i.id} onChange={() => setPicked(i.id)} />
              <span>
                <b>{i.name}</b> <span className="muted an-tiny">{i.kind === "vaccine" ? "vaccine" : "medicine"}</span>
                {i.needsConfirmation && <span className="badge badge-confirm" style={{ marginLeft: "0.4rem" }}>to confirm</span>}
                {i.summary && <span className="muted an-tiny" style={{ display: "block" }}>{i.summary}</span>}
              </span>
            </label>
          ))}
        </div>
        <p className="muted an-tiny" style={{ margin: 0 }} aria-live="polite">{pickedItem ? <>Picked: <b>{pickedItem.name}</b></> : "Tap one to pick it."}</p>
        <details>
          <summary>It is not in the list: add a new one</summary>
          <div className="stack" style={{ marginTop: "0.5rem" }}>
            <label className="field"><span>Name <span className="hint">(as written on the packet or in the register)</span></span><input type="text" name="new_name" maxLength={80} autoComplete="off" /></label>
            <div className="row2">
              <label className="check-line" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "0 0.75rem" }}><input type="radio" name="new_kind" value="vaccine" /> <span>Vaccine</span></label>
              <label className="check-line" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "0 0.75rem" }}><input type="radio" name="new_kind" value="medicine" /> <span>Medicine</span></label>
            </div>
            <label className="field"><span>What it is for <span className="hint">(optional)</span></span><input type="text" name="new_purpose" maxLength={200} /></label>
            <p className="muted an-tiny" style={{ margin: 0 }}>If you fill this in, it is used instead of the pick above. It is added to the list and marked “to confirm” until you check it on the Medicines list.</p>
          </div>
        </details>
      </fieldset>

      <fieldset className="md-fieldset">
        <legend className="field-label">2. Which flocks?</legend>
        <div className="actions-bar" style={{ marginBottom: "0.4rem" }}>
          <button type="button" className="btn-secondary" onClick={() => setTicked(flocks.map((f) => f.id))}>Whole farm</button>
          <button type="button" className="btn-secondary" onClick={() => setTicked(flocks.filter((f) => f.segment === "main").map((f) => f.id))}>Main group</button>
          <button type="button" className="btn-secondary" onClick={() => setTicked(flocks.filter((f) => f.segment === "young").map((f) => f.id))}>Young group</button>
          <button type="button" className="btn-secondary" onClick={() => setTicked([])}>Clear</button>
        </div>
        <div className="md-flocks">
          {flocks.map((f) => (
            <label key={f.id} className={`md-flock-tick${ticked.includes(f.id) ? " md-pick-on" : ""}`}>
              <input type="checkbox" name="flock_id" value={f.id} checked={ticked.includes(f.id)} onChange={() => toggle(f.id)} />
              <span><b>{f.label}</b> <span className="muted an-tiny">{fmt(f.birds)}</span></span>
            </label>
          ))}
        </div>
        <p className="muted an-tiny" style={{ margin: 0 }} aria-live="polite">{ticked.length === 0 ? "Tick at least one flock." : `${ticked.length} flock${ticked.length === 1 ? "" : "s"} ticked. One line is saved for each.`}</p>
      </fieldset>

      <fieldset className="md-fieldset">
        <legend className="field-label">3. When and how much?</legend>
        <div className="row2">
          <label className="field"><span>Date in the register</span><input type="date" name="date" defaultValue={date} required /></label>
          <label className="field"><span>Bought from <span className="hint">(optional)</span></span><input type="text" name="supplier" list="med-suppliers" autoComplete="off" defaultValue={supplier} maxLength={80} /><datalist id="med-suppliers">{suppliers.map((s) => (<option key={s} value={s} />))}</datalist></label>
        </div>
        <div className="row2">
          <label className="field"><span>Quantity <span className="hint">(optional, the total)</span></span><input type="number" name="quantity" step="any" min="0" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          <label className="field"><span>Unit <span className="hint">(bottles, vials, kg…)</span></span><input type="text" name="unit" list="med-units" autoComplete="off" maxLength={20} value={unit} onChange={(e) => setUnit(e.target.value)} /><datalist id="med-units">{UNITS.map((u) => (<option key={u} value={u} />))}</datalist></label>
        </div>
        <label className="field"><span>Cost in rupees <span className="hint">(optional, the total; leave empty if the register has no price: it then shows as “cost not entered”, not ₹0)</span></span><input type="number" name="cost" step="0.01" min="0" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
        {splitText && <p className="flag-banner" style={{ margin: 0 }} aria-live="polite">{splitText.replace(" was ", " will be ")} <span className="muted an-tiny">(Worked out on the latest bird counts here; the exact split uses the counts on the date and is shown after saving.)</span></p>}
        <label className="field"><span>Note <span className="hint">(optional)</span></span><input type="text" name="note" maxLength={200} /></label>
        <label className="field"><span>Photo of the register page <span className="hint">(optional)</span></span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" /></label>
        {state?.ok && state.photoUrl && (
          <>
            <input type="hidden" name="keep_photo" value={state.photoUrl} />
            <p className="muted an-tiny" style={{ margin: 0 }}>This entry will use the same register-page photo as the last one (<a href={state.photoUrl} target="_blank" rel="noreferrer">see it</a>). Choose a file above only if it is on a different page.</p>
          </>
        )}
      </fieldset>

      <div className="actions-bar" style={{ marginBottom: 0 }}>
        <button type="submit" name="intent" value="next" disabled={pending}>{pending ? "Saving…" : "Save and add the next"}</button>
        <button type="submit" name="intent" value="done" className="btn-secondary" disabled={pending}>Save and finish</button>
      </div>
    </form>
  );
}
