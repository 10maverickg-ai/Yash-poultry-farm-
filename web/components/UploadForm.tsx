"use client";

import { useActionState } from "react";
import Link from "next/link";
import { uploadAndExtractDailyProduction } from "@/app/upload/actions";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function UploadForm() {
  const [result, formAction, pending] = useActionState(
    uploadAndExtractDailyProduction,
    null
  );

  return (
    <>
      <form action={formAction} className="stack card">
        {result?.error && <div className="error-banner">{result.error}</div>}
        <label className="field">
          <span>
            Date on the page <span className="hint">(used if the photo&apos;s date isn&apos;t legible)</span>
          </span>
          <input type="date" name="date" defaultValue={todayISO()} required />
        </label>
        <label className="field">
          <span>Photo</span>
          <input type="file" name="photo" accept="image/*" capture="environment" required />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Reading register…" : "Upload & extract"}
        </button>
      </form>

      {result && !result.error && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>
            Extracted {result.written.length} flock
            {result.written.length === 1 ? "" : "s"} for {result.date}
          </h2>

          {result.photoUrl && (
            <a href={result.photoUrl} target="_blank" rel="noreferrer">
              View uploaded photo
            </a>
          )}

          {result.pageNotes && (
            <p className="muted" style={{ margin: 0 }}>
              Model notes: {result.pageNotes}
            </p>
          )}

          {result.written.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.written.map((w) => (
                    <tr key={w.label}>
                      <td>{w.label}</td>
                      <td>
                        {w.flagged ? (
                          <span className="badge badge-flagged" title={w.flagReason ?? ""}>
                            flagged
                          </span>
                        ) : (
                          "saved clean"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.unresolved.length > 0 && (
            <div className="error-banner">
              Could not match {result.unresolved.length === 1 ? "this label" : "these labels"} to
              any flock active on {result.date}: <strong>{result.unresolved.join(", ")}</strong>.
              These rows were NOT saved. Check the Flock Register — this usually means a
              renumbering event hasn&apos;t been logged yet, or the label was misread.
            </div>
          )}

          <div className="actions-bar" style={{ marginBottom: 0 }}>
            <Link href={`/production?date=${result.date}`} className="btn">
              Open Daily Production for {result.date}
            </Link>
            {result.written.some((w) => w.flagged) && (
              <Link href="/flagged" className="btn btn-secondary">
                Review flagged records
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
