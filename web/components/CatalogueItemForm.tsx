"use client";

import { ActionForm, type FormAnswer } from "@/components/ActionForm";
import { ITEM_KINDS, ROUTES, type CatalogueItem } from "@/lib/medicines/catalogue";

// The add form and the edit form of a list item. Plain labels; the "to confirm" tick is explained in one line.
export function CatalogueItemForm({ action, item, usedLock }: { action: (prev: FormAnswer | null, fd: FormData) => Promise<FormAnswer>; item?: CatalogueItem; usedLock?: boolean }) {
  return (
    <ActionForm action={action} className="stack">
      <label className="field">
        <span>Name <span className="hint">(as the owner writes it, for example Nuvaimmune)</span></span>
        <input type="text" name="name" required maxLength={80} defaultValue={item?.name ?? ""} autoComplete="off" />
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label">What is it?</legend>
        <div className="row2">
          {ITEM_KINDS.map((k) => (
            <label key={k.key} className="check-line" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "0 0.75rem" }}>
              <input type="radio" name="kind" value={k.key} defaultChecked={(item?.kind ?? "vaccine") === k.key} disabled={usedLock && item?.kind !== k.key} required /> <span>{k.label}</span>
            </label>
          ))}
        </div>
        {usedLock && <p className="muted an-tiny" style={{ margin: "0.3rem 0 0" }}>The type cannot change because register lines already use this item.</p>}
      </fieldset>
      <label className="field"><span>What it is for <span className="hint">(the disease or the reason, optional)</span></span><input type="text" name="purpose" maxLength={200} defaultValue={item?.purpose ?? ""} /></label>
      <div className="row2">
        <label className="field">
          <span>How it is given <span className="hint">(optional)</span></span>
          <select name="route" defaultValue={item?.route ?? ""}>
            <option value="">Not said</option>
            {ROUTES.map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
          </select>
        </label>
        <label className="field"><span>Brand <span className="hint">(optional)</span></span><input type="text" name="brand" maxLength={80} defaultValue={item?.brand ?? ""} /></label>
      </div>
      <div className="row2">
        <label className="field"><span>Usual dose <span className="hint">(in words, optional)</span></span><input type="text" name="dose" maxLength={120} defaultValue={item?.dose ?? ""} /></label>
        <label className="field"><span>Usual unit <span className="hint">(bottles, vials, kg…, optional)</span></span><input type="text" name="unit" maxLength={20} defaultValue={item?.unit ?? ""} /></label>
      </div>
      <label className="field"><span>Note <span className="hint">(optional)</span></span><input type="text" name="note" maxLength={300} defaultValue={item?.note ?? ""} /></label>
      {item ? (
        <label className="check-line">
          <input type="checkbox" name="still_to_confirm" value="yes" defaultChecked={item.needsConfirmation} />
          <span>Still “to confirm” <span className="hint">(untick when the name and details are checked)</span></span>
        </label>
      ) : (
        <label className="check-line"><input type="checkbox" name="checked" value="yes" /> <span>I have checked this name. <span className="hint">(Leave it unticked and the item is marked “to confirm”.)</span></span></label>
      )}
      <button type="submit">{item ? "Save the changes" : "Add to the list"}</button>
    </ActionForm>
  );
}
