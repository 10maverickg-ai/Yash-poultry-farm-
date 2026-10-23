"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { uploadBenchmarkPhotoAction } from "./actions";
import { compressImageForUpload, UnsupportedPhotoFormatError } from "@/lib/compressImage";

const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Lets the owner attach a photo to a date that already has saved, verified
// daily_production rows but no photo (most of August) — the only reason
// this exists is so the benchmark page has something to run the new
// reader against for those dates. It never touches daily_production or any
// other production table; see actions.ts.
export function BenchmarkPhotoUploadForm({ benchmarkKey }: { benchmarkKey: string }) {
  const [result, formAction, pending] = useActionState(uploadBenchmarkPhotoAction, null);
  const [compressing, setCompressing] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setClientError(null);
    const input = e.currentTarget;
    const original = input.files?.[0];
    if (!original) return;

    setCompressing(true);
    try {
      const compressed = await compressImageForUpload(original);
      if (compressed.size > MAX_UPLOAD_BYTES) {
        setClientError("That photo is too large — please try a lower camera resolution.");
        input.value = "";
        return;
      }
      if (compressed !== original) {
        const dt = new DataTransfer();
        dt.items.add(compressed);
        input.files = dt.files;
      }
    } catch (err) {
      setClientError(
        err instanceof UnsupportedPhotoFormatError
          ? err.message
          : "Couldn't read that photo — please try a different one."
      );
      input.value = "";
    } finally {
      setCompressing(false);
    }
  }

  const isBusy = compressing || pending;
  const shownError = clientError ?? result?.error;

  return (
    <form action={formAction} className="stack card">
      <h3>Add a photo for the benchmark</h3>
      <p className="muted">
        For a date that already has saved numbers but no stored photo (most
        of August). This never changes any saved production data — it only
        gives the benchmark page something to run the new reader against.
      </p>
      {shownError && <div className="error-banner">{shownError}</div>}
      {result?.success && <div className="success-banner">Photo saved for the benchmark.</div>}
      <input type="hidden" name="key" value={benchmarkKey} />
      <label>
        Date
        <input type="date" name="date" defaultValue={todayISO()} required />
      </label>
      <label>
        Photo
        <input
          type="file"
          name="photo"
          accept="image/*,.heic,.heif"
          onChange={handleFileChange}
          required
        />
      </label>
      <button type="submit" className="btn" disabled={isBusy}>
        {compressing ? "Preparing photo…" : pending ? "Uploading…" : "Save photo for benchmark"}
      </button>
    </form>
  );
}
