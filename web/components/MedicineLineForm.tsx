"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { KINDS, UNITS } from "@/lib/medicines/lines";
import type { LineState } from "@/app/medicines/actions";

// Change ONE register line (V12 N3, V14: the name is picked from the Medicines list). A line typed by hand before the list existed can
// stay "not matched" (it keeps its typed name) or be matched to a list item here.
type Defaults = { date: string; kind: string; target: string; item?: string; catalogueId: number | null; quantity?: number | null; unit?: string | null; cost?: number | null; supplier?: string | null; note?: string | null };
export type ListOption = { id: number; name: string; kind: string };

export function MedicineLineForm({
  action,
  targets,
  suppliers,
  options,
  defaults,
  backHref,
}: {
  action: (prev: LineState | null, formData: FormData) => Promise<LineState>;
  targets: { flocks: { id: string; label: string; active: boolean }[]; sheds: string[] };
  suppliers: string[];
  options: ListOption[];
  defaults: Defaults;
  backHref?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LineState | null, FormData>(action, null);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  const d = defaults;
  return (
    <form action={formAction} className="card stack" id="entry">
      {state && <div className={state.ok ? "saved-banner" : "error-banner"} role="status" aria-live="polite">{state.message}</div>}
      {state?.ok && backHref && <p style={{ margin: 0 }}><a href={backHref}>← Back to the month</a></p>}
      <label className="field">
        <span>Medicine or vaccine <span className="hint">(from the Medicines list)</span></span>
        <select name="catalogue_id" defaultValue={d.catalogueId ?? ""}>
          {d.catalogueId == null && <option value="">Not matched: keep “{d.item}” as typed</option>}
          {["vaccine", "medicine"].map((k) => (
            <optgroup key={k} label={k === "vaccine" ? "Vaccines" : "Medicines"}>
              {options.filter((o) => o.kind === k).map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
            </optgroup>
          ))}
        </select>
      </label>
      {d.catalogueId == null && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">What is it? <span className="hint">(only while it is not matched to the list)</span></legend>
          <div className="row2">
            {KINDS.map((k) => (
              <label key={k.key} className="check-line" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "0 0.75rem" }}>
                <input type="radio" name="kind" value={k.key} defaultChecked={d.kind === k.key} /> <span><b>{k.label}</b></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
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
      <input type="hidden" name="item" value={d.item ?? ""} />
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
          <input type="text" name="supplier" list="med-suppliers" autoComplete="off" defaultValue={d.supplier ?? ""} maxLength={80} />
          <datalist id="med-suppliers">{suppliers.map((i) => (<option key={i} value={i} />))}</datalist>
        </label>
        <label className="field"><span>Note <span className="hint">(optional)</span></span><input type="text" name="note" defaultValue={d.note ?? ""} maxLength={200} /></label>
      </div>
      <label className="field">
        <span>Photo of the register page <span className="hint">(optional)</span></span>
        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" />
      </label>
      <div className="actions-bar" style={{ marginBottom: 0 }}>
        <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save the changes"}</button>
      </div>
    </form>
  );
}
