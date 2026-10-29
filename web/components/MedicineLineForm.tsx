"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { KINDS, UNITS } from "@/lib/medicines/lines";
import type { LineState } from "@/app/medicines/actions";

// The medicine / vaccine line form (V12 N3). The answer ("Saved: … Add the next line") appears on this same screen, and the next line
// keeps the date, type, target, supplier and the register-page photo. Works with the photo chosen by the camera or from the gallery.
type Defaults = { date: string; kind: string; target: string; item?: string; quantity?: number | null; unit?: string | null; cost?: number | null; supplier?: string | null; note?: string | null };

export function MedicineLineForm({
  action,
  targets,
  suggestions,
  defaults,
  mode,
  backHref,
}: {
  action: (prev: LineState | null, formData: FormData) => Promise<LineState>;
  targets: { flocks: { id: string; label: string; active: boolean }[]; sheds: string[] };
  suggestions: { items: string[]; suppliers: string[] };
  defaults: Defaults;
  mode: "add" | "edit";
  backHref?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LineState | null, FormData>(action, null);
  // the lists on this page are server-rendered: ask for them again after a save
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  // after a successful add the form starts fresh with what the next line of the same page shares
  const d: Defaults = mode === "add" && state?.ok && state.keep ? { ...defaults, ...state.keep } : defaults;
  const supplierDefault = mode === "add" && state?.ok && state.keep ? state.keep.supplier : d.supplier ?? "";
  return (
    <form key={state?.ok ? `s${state.savedId}` : "f"} action={formAction} className="card stack" id="entry">
      {state && <div className={state.ok ? "saved-banner" : "error-banner"} role="status" aria-live="polite">{state.message}</div>}
      {mode === "edit" && state?.ok && backHref && <p style={{ margin: 0 }}><a href={backHref}>← Back to the month</a></p>}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">What is it?</legend>
        <div className="row2">
          {KINDS.map((k) => (
            <label key={k.key} className="check-line" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "0 0.75rem" }}>
              <input type="radio" name="kind" value={k.key} defaultChecked={d.kind ? d.kind === k.key : k.key === "medicine"} required /> <span><b>{k.label}</b></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row2">
        <label className="field"><span>Date in the register</span><input type="date" name="date" defaultValue={d.date} required /></label>
        <label className="field">
          <span>Given to / for</span>
          <select name="target" defaultValue={d.target || "farm"}>
            <option value="farm">Whole farm</option>
            <optgroup label="Flock">
              {targets.flocks.map((f) => (<option key={f.id} value={`flock:${f.id}`}>{f.label}{f.active ? "" : " (left the farm)"}</option>))}
            </optgroup>
            {targets.sheds.length > 0 && (
              <optgroup label="Shed">
                {targets.sheds.map((s) => (<option key={s} value={`shed:${s}`}>{s}</option>))}
              </optgroup>
            )}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Name of the medicine or vaccine <span className="hint">(for example Enrofloxacin, Ranikhet Lasota)</span></span>
        <input type="text" name="item" list="med-items" autoComplete="off" defaultValue={d.item ?? ""} required maxLength={120} />
        <datalist id="med-items">{suggestions.items.map((i) => (<option key={i} value={i} />))}</datalist>
      </label>
      <div className="row2">
        <label className="field"><span>Quantity <span className="hint">(optional)</span></span><input type="number" name="quantity" step="any" min="0" inputMode="decimal" defaultValue={d.quantity ?? ""} /></label>
        <label className="field">
          <span>Unit <span className="hint">(bottles, vials, kg…)</span></span>
          <input type="text" name="unit" list="med-units" autoComplete="off" defaultValue={d.unit ?? ""} maxLength={20} />
          <datalist id="med-units">{UNITS.map((u) => (<option key={u} value={u} />))}</datalist>
        </label>
      </div>
      <label className="field">
        <span>Cost in rupees <span className="hint">(optional: leave empty if the register has no price; it then shows as “cost not entered”, not ₹0)</span></span>
        <input type="number" name="cost" step="0.01" min="0" inputMode="decimal" defaultValue={d.cost ?? ""} />
      </label>
      <div className="row2">
        <label className="field">
          <span>Bought from <span className="hint">(optional)</span></span>
          <input type="text" name="supplier" list="med-suppliers" autoComplete="off" defaultValue={supplierDefault} maxLength={80} />
          <datalist id="med-suppliers">{suggestions.suppliers.map((i) => (<option key={i} value={i} />))}</datalist>
        </label>
        <label className="field"><span>Note <span className="hint">(optional)</span></span><input type="text" name="note" defaultValue={d.note ?? ""} maxLength={200} /></label>
      </div>
      <label className="field">
        <span>Photo of the register page <span className="hint">(optional)</span></span>
        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" />
      </label>
      {mode === "add" && state?.ok && state.photoUrl && (
        <>
          <input type="hidden" name="keep_photo" value={state.photoUrl} />
          <p className="muted an-tiny" style={{ margin: 0 }}>This line will use the same register-page photo as the last one (<a href={state.photoUrl} target="_blank" rel="noreferrer">see it</a>). Choose a file above only if this line is on a different page.</p>
        </>
      )}
      <div className="actions-bar" style={{ marginBottom: 0 }}>
        {mode === "add" ? (
          <>
            <button type="submit" name="intent" value="next" disabled={pending}>{pending ? "Saving…" : "Save and add the next line"}</button>
            <button type="submit" name="intent" value="done" className="btn-secondary" disabled={pending}>Save and finish</button>
          </>
        ) : (
          <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save the changes"}</button>
        )}
      </div>
    </form>
  );
}
