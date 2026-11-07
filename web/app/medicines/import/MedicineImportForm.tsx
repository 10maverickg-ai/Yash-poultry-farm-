"use client";

import { useActionState, useRef, useState } from "react";
import { importMedicines, type MedImportState } from "../actions";
import { inr } from "@/lib/format";

export function MedicineImportForm() {
  const [state, action, pending] = useActionState<MedImportState | null, FormData>(importMedicines, null);
  // React clears the form after each action; keep the chosen file and the answers for unknown names so "check" then "import" works.
  const fileRef = useRef<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const submit = (fd: FormData) => {
    const f = fd.get("file");
    if (f instanceof File && f.size > 0) fileRef.current = f;
    else if (fileRef.current) fd.set("file", fileRef.current);
    for (const [k, v] of Object.entries(mapping)) if (v) fd.set(`map|${k}`, v);
    return action(fd);
  };
  const rep = state?.report;
  const bad = rep?.rows.filter((r) => r.state === "error" || r.state === "exists") ?? [];
  const good = rep?.rows.filter((r) => r.state === "ok") ?? [];
  const choices = state?.catalogue ?? [];
  return (
    <form action={submit} className="card">
      <label>
        File (CSV or Excel .xlsx)
        <input type="file" name="file" accept=".csv,.xlsx,text/csv" onChange={(e) => { fileRef.current = e.target.files?.[0] ?? null; }} />
      </label>
      <label className="an-tiny" style={{ display: "block", marginTop: "0.5rem" }}>
        <input type="checkbox" name="skip_errors" /> import the good lines and skip the lines with errors
      </label>
      <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="submit" name="intent" value="preview" disabled={pending}>Check only (dry run)</button>
        <button type="submit" name="intent" value="import" disabled={pending}>Import now</button>
      </p>
      {pending && <p className="muted">Reading the file…</p>}
      {state && <div className={state.mode === "error" ? "error-banner" : state.mode === "imported" ? "saved-banner" : "flag-banner"}>{state.message}</div>}
      {rep && rep.rows.length > 0 && (
        <>
          <p>
            <b>{rep.counts.total}</b> rows: <b>{rep.counts.ok}</b> ready · <b>{rep.counts.exists}</b> already in the register · <b>{rep.counts.error}</b> with errors
            {rep.counts.unknown > 0 && <> · <b>{rep.counts.unknown}</b> with a name not in the list</>}
            {rep.counts.skipped > 0 && <> · <b>{rep.counts.skipped}</b> left out</>}
          </p>

          {rep.unknown.length > 0 && (
            <div className="stack">
              <h3 style={{ margin: 0 }}>Names the Medicines list does not know</h3>
              <p className="muted an-tiny" style={{ margin: 0 }}>Nothing is added to the list by itself. For each name choose the list item it means, add it as a new item (it is marked “to confirm”), or leave those rows out. Then press Check again or Import.</p>
              {rep.unknown.map((u) => (
                <div key={u.key} className="card" style={{ margin: 0 }}>
                  <div><b>{u.name}</b> <span className="muted an-tiny">rows {u.rows.slice(0, 8).join(", ")}{u.rows.length > 8 ? "…" : ""}</span></div>
                  <label className="field" style={{ margin: "0.3rem 0 0" }}>
                    <span>What should it be?</span>
                    <select value={mapping[u.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [u.key]: e.target.value }))} aria-label={`What ${u.name} means`}>
                      <option value="">Choose…</option>
                      <optgroup label="Match to an item in the list">
                        {choices.map((c) => (<option key={c.id} value={`item:${c.id}`}>{c.name}</option>))}
                      </optgroup>
                      <optgroup label="Add as a new item (to confirm)">
                        <option value="new:vaccine">New vaccine “{u.name}”</option>
                        <option value="new:medicine">New medicine “{u.name}”</option>
                      </optgroup>
                      <option value="skip">Leave these rows out</option>
                    </select>
                  </label>
                </div>
              ))}
            </div>
          )}

          {good.length > 0 && (
            <>
              <h3>What will be saved</h3>
              <ul className="an-list">
                {good.slice(0, 12).map((r) => (
                  <li key={r.line}>
                    <b>{r.item!.name}</b>{r.item!.create ? " (new, to confirm)" : ""} · {r.date} · {r.plan!.parts.map((p) => p.label).join(", ")}
                    {r.plan!.basis && r.plan!.costTotal != null ? ` · ${inr(r.plan!.costTotal)} split ${r.plan!.basis === "birds" ? "by birds" : "equally"}` : r.plan!.parts[0]?.cost != null ? ` · ${inr(r.plan!.parts[0].cost)}` : ""}
                  </li>
                ))}
              </ul>
              {good.length > 12 && <p className="muted an-tiny">…and {good.length - 12} more rows.</p>}
            </>
          )}

          {bad.length > 0 && (
            <div className="tl-scroll">
              <table className="tl-table">
                <thead><tr><th>Line</th><th>Date</th><th>Name</th><th>What is wrong</th></tr></thead>
                <tbody>
                  {bad.slice(0, 200).map((r) => (
                    <tr key={r.line}><td>{r.line}</td><td>{r.raw.date}</td><td>{r.raw.name}</td><td>{r.state === "exists" ? "Already in the register: left as it is" : r.errors.join("; ")}</td></tr>
                  ))}
                </tbody>
              </table>
              {bad.length > 200 && <p className="muted an-tiny">…and {bad.length - 200} more.</p>}
            </div>
          )}
          {good.some((r) => r.warnings.some((w) => /no cost/.test(w))) && <p className="muted an-tiny">Some good rows have no cost: they are imported as “cost not entered”, not as ₹0.</p>}
        </>
      )}
    </form>
  );
}
