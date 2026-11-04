"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { compressImageForUpload, UnsupportedPhotoFormatError } from "@/lib/compressImage";

// The staff Upload screen: a date, a photo picker, a progress bar. It shows nothing from the farm and says nothing about what happens to
// the photo afterwards. One photo at a time; a failed photo does not stop the others.
const MAX_BYTES = 7 * 1024 * 1024;
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // India date

function send(file: File, date: string, onProgress: (pct: number) => void): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.set("photo", file);
    fd.set("date", date);
    const x = new XMLHttpRequest();
    x.open("POST", "/api/upload");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      try {
        const j = JSON.parse(x.responseText);
        resolve(x.status === 200 && j.ok ? { ok: true } : { ok: false, error: typeof j.error === "string" ? j.error : "That photo could not be uploaded. Try again." });
      } catch {
        resolve({ ok: false, error: x.status === 401 ? "You were logged out. Log in again and upload again." : "That photo could not be uploaded. Try again." });
      }
    };
    x.onerror = () => resolve({ ok: false, error: "No connection. Try again when you are online." });
    x.send(fd);
  });
}

export function StaffUpload() {
  const router = useRouter();
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = "";
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    let done = 0;
    for (const [i, original] of files.entries()) {
      setStatus(files.length > 1 ? `Uploading photo ${i + 1} of ${files.length}…` : "Uploading…");
      setPct(0);
      try {
        const f = await compressImageForUpload(original);
        if (f.size > MAX_BYTES) throw new Error("That photo is too big. Take it again.");
        const r = await send(f, date, setPct);
        if (!r.ok) throw new Error(r.error);
        done++;
      } catch (err) {
        setError(err instanceof UnsupportedPhotoFormatError ? "That photo format cannot be used. Take the photo again with the camera." : err instanceof Error ? err.message : "That photo could not be uploaded. Try again.");
      }
    }
    setBusy(false);
    setStatus(null);
    if (done > 0) router.push("/upload/thanks");
  }

  return (
    <div className="card stack">
      <label className="field">
        <span>Date written on the page</span>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} disabled={busy} />
      </label>
      <input ref={input} id="photo" type="file" accept="image/*" multiple onChange={onFiles} disabled={busy} hidden />
      <button type="button" className="login-go" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? "Uploading…" : "Take or choose photos"}
      </button>
      {busy && (
        <div aria-live="polite">
          <p style={{ margin: "0 0 0.3rem" }}>{status}</p>
          <progress max={100} value={pct} style={{ width: "100%" }} aria-label="Upload progress" />
        </div>
      )}
      {error && <p className="error-banner" role="alert">{error}</p>}
    </div>
  );
}
