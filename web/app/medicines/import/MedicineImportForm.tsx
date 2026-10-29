"use client";

import { useActionState, useRef } from "react";
import { importMedicines, type MedImportState } from "../actions";

export function MedicineImportForm() {
  const [state, action, pending] = useActionState<MedImportState | null, FormData>(importMedicines, null);
  // React clears the form after each action; keep the chosen file so "check" then "import" works without choosing it again.
  const fileRef = useRef<File | null>(null);
  const submit = (fd: FormData) => {
    const f = fd.get("file");
    if (f instanceof File && f.size > 0) fileRef.current = f;
    else if (fileRef.current) fd.set("file", fileRef.current);
    return action(fd);
  };
  const rep = state?.report;
  const bad = rep?.rows.filter((r) => r.state !== "ok") ?? [];
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
          <p><b>{rep.counts.total}</b> lines: <b>{rep.counts.ok}</b> ready · <b>{rep.counts.exists}</b> already in the register · <b>{rep.counts.error}</b> with errors</p>
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
          {rep.rows.some((r) => r.state === "ok" && r.warnings.length > 0) && <p className="muted an-tiny">Some good lines have no cost: they are imported as “cost not entered”, not as ₹0.</p>}
        </>
      )}
    </form>
  );
}
