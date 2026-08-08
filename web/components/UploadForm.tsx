"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { uploadAndExtractDailyProduction } from "@/app/upload/actions";
import { compressImageForUpload } from "@/lib/compressImage";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Matches next.config.ts's serverActions.bodySizeLimit, with headroom for
// the rest of the form fields and multipart overhead — if a photo is still
// this large after compression (a very unusual original, or a format
// compression couldn't touch), the selection is rejected before it can ever
// be submitted, rather than letting the platform reject the request with a
// raw "Body exceeded"-style error.
const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

export function UploadForm() {
  const [result, formAction, pending] = useActionState(
    uploadAndExtractDailyProduction,
    null
  );
  const [compressing, setCompressing] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  // Compresses the photo the moment it's picked, then replaces the file
  // input's own file with the compressed one via the standard DataTransfer
  // technique — the form itself still submits normally via
  // action={formAction}, exactly like every other form in this app; nothing
  // about the submit path changes, only what file is sitting in the input
  // by the time the user taps the button.
  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setClientError(null);
    const input = e.currentTarget;
    const original = input.files?.[0];
    if (!original) return;

    setCompressing(true);
    try {
      const compressed = await compressImageForUpload(original);
      if (compressed.size > MAX_UPLOAD_BYTES) {
        setClientError(
          "That photo is too large to upload — please try taking it again, or use a lower camera resolution."
        );
        input.value = "";
        return;
      }
      if (compressed !== original) {
        const dt = new DataTransfer();
        dt.items.add(compressed);
        input.files = dt.files;
      }
    } finally {
      setCompressing(false);
    }
  }

  const isBusy = compressing || pending;
  const shownError = clientError ?? result?.error;

  return (
    <>
      <form action={formAction} className="stack card">
        {shownError && <div className="error-banner">{shownError}</div>}
        <label className="field">
          <span>
            Date on the page <span className="hint">(used if the photo&apos;s date isn&apos;t legible)</span>
          </span>
          <input type="date" name="date" defaultValue={todayISO()} required />
        </label>
        <label className="field">
          <span>Photo</span>
          <input
            type="file"
            name="photo"
            accept="image/*"
            capture="environment"
            required
            onChange={handleFileChange}
          />
        </label>
        <button type="submit" disabled={isBusy}>
          {compressing ? "Preparing photo…" : pending ? "Reading register…" : "Upload & extract"}
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
                            flagged{w.autoRechecked ? " (auto-rechecked)" : ""}
                          </span>
                        ) : w.autoRechecked ? (
                          "saved clean (auto-rechecked)"
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
