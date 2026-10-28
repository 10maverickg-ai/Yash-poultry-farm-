"use client";

import { useActionState } from "react";
import { paperHistoryAction, type ImportState } from "./actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState | null, FormData>(paperHistoryAction, null);
  const rep = state?.report;
  const bad = rep?.results.filter((r) => r.state !== "ok") ?? [];
  return (
    <form action={action} className="card">
      <label>
        File (CSV or Excel .xlsx)
        <input type="file" name="file" accept=".csv,.xlsx,text/csv" required />
      </label>
      <label className="an-tiny" style={{ display: "block", marginTop: "0.5rem" }}>
        <input type="checkbox" name="replace" /> also replace days that already exist (otherwise they are left untouched)
      </label>
      <label className="an-tiny" style={{ display: "block" }}>
        <input type="checkbox" name="skip_errors" /> import the good rows and skip the rows with errors
      </label>
      <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="submit" name="intent" value="preview" disabled={pending}>Check only (dry run)</button>
        <button type="submit" name="intent" value="import" disabled={pending}>Import now</button>
      </p>
      {pending && <p className="muted">Reading the file…</p>}
      {state && <div className={state.mode === "error" ? "error-banner" : state.mode === "imported" ? "saved-banner" : "flag-banner"}>{state.message}</div>}
      {rep && (
        <>
          <p>
            <b>{rep.counts.total}</b> rows: <b>{rep.counts.ok}</b> ready · <b>{rep.counts.exists}</b> already in the register · <b>{rep.counts.error}</b> with errors
          </p>
          {bad.length > 0 && (
            <div className="tl-scroll">
              <table className="tl-table">
                <thead><tr><th>Line</th><th>Date</th><th>Flock</th><th>What is wrong</th></tr></thead>
                <tbody>
                  {bad.slice(0, 200).map((r) => (
                    <tr key={r.row.line}>
                      <td>{r.row.line}</td><td>{r.row.date ?? "?"}</td><td>{r.row.flockLabel}</td>
                      <td>{r.state === "exists" ? "Day already exists — left untouched unless “replace” is ticked" : r.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {bad.length > 200 && <p className="muted an-tiny">…and {bad.length - 200} more.</p>}
            </div>
          )}
          {rep.results.some((r) => r.state === "ok" && r.warnings.length > 0) && <p className="muted an-tiny">Some good rows have a note (for example no feed bags): they are imported, but those days teach nothing about feed.</p>}
        </>
      )}
    </form>
  );
}
