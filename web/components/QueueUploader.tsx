"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { enqueuePhoto, processNext } from "@/app/upload/queue-actions";
import { compressImageForUpload, UnsupportedPhotoFormatError } from "@/lib/compressImage";

interface Pick {
  key: string;
  file: File;
  date: string;
  state: "ready" | "sending" | "queued" | "error";
  note: string | null;
}

const MAX_BYTES = 7 * 1024 * 1024;
const today = () => new Date().toISOString().slice(0, 10);

// Many photos at once. Each one is compressed in the browser, sent on its own
// and stored in the server-side queue; then the queue is read one photo at a
// time, in date order. One photo failing never stops the rest.
export function QueueUploader({ waiting, reading }: { waiting: number; reading: number }) {
  const router = useRouter();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [allDate, setAllDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const stopRef = useRef(false);

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = "";
    const next: Pick[] = [];
    for (const original of files) {
      const key = `${original.name}-${original.size}-${original.lastModified}`;
      try {
        const f = await compressImageForUpload(original);
        if (f.size > MAX_BYTES) next.push({ key, file: original, date: allDate, state: "error", note: "Too large even after compression — take it again at a lower resolution." });
        else next.push({ key, file: f, date: allDate, state: "ready", note: null });
      } catch (err) {
        next.push({ key, file: original, date: allDate, state: "error", note: err instanceof UnsupportedPhotoFormatError ? err.message : "Could not read this photo." });
      }
    }
    setPicks((p) => [...p, ...next].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
  }

  function setDate(key: string, date: string) {
    setPicks((p) => p.map((x) => (x.key === key ? { ...x, date } : x)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
  }

  async function runQueue() {
    stopRef.current = false;
    setRunning(true);
    try {
      for (let guard = 0; guard < 500 && !stopRef.current; guard++) {
        setProgress("Reading the next photo…");
        const r = await processNext();
        router.refresh();
        if (r.done) break;
      }
    } finally {
      setRunning(false);
      setProgress(null);
      router.refresh();
    }
  }

  async function sendAll() {
    setBusy(true);
    const ready = picks.filter((p) => p.state === "ready" || p.state === "error");
    for (const [i, p] of ready.entries()) {
      if (p.state === "error" && p.note) continue;
      setProgress(`Storing photo ${i + 1} of ${ready.length}…`);
      setPicks((all) => all.map((x) => (x.key === p.key ? { ...x, state: "sending" } : x)));
      const fd = new FormData();
      fd.set("photo", p.file);
      fd.set("date", p.date);
      const r = await enqueuePhoto(fd).catch(() => ({ ok: false, error: "The connection dropped. Try this photo again.", status: null }));
      setPicks((all) => all.map((x) => (x.key === p.key ? { ...x, state: r.ok ? "queued" : "error", note: r.ok ? (r.status === "duplicate" ? "That date already has a saved day — see below." : null) : r.error } : x)));
    }
    setBusy(false);
    setProgress(null);
    router.refresh();
    if (!stopRef.current) await runQueue();
  }

  const unsent = picks.filter((p) => p.state === "ready").length;

  return (
    <div className="card stack">
      <label className="field">
        <span>Date shown on the pages <span className="hint">(applies to photos you add next; change any photo below)</span></span>
        <input type="date" value={allDate} onChange={(e) => setAllDate(e.target.value)} />
      </label>
      <label className="field">
        <span>Photos</span>
        <input type="file" multiple accept="image/*,.heic,.heif" onChange={onFiles} disabled={busy} />
      </label>

      {picks.length > 0 && (
        <ul className="queue-picks">
          {picks.map((p) => (
            <li key={p.key} className={`queue-pick queue-${p.state}`}>
              <span className="queue-name">{p.file.name}</span>
              <input type="date" value={p.date} onChange={(e) => setDate(p.key, e.target.value)} disabled={p.state === "sending" || p.state === "queued"} aria-label={`Date for ${p.file.name}`} />
              <span className="muted an-tiny">{p.state === "queued" ? "in the queue" : p.state === "sending" ? "storing…" : p.state === "error" ? "" : "ready"}</span>
              {p.note && <span className="an-tiny queue-note">{p.note}</span>}
              {p.state !== "sending" && p.state !== "queued" && (
                <button type="button" className="btn-secondary an-small" onClick={() => setPicks((all) => all.filter((x) => x.key !== p.key))}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="actions-bar" style={{ marginBottom: 0 }}>
        <button type="button" onClick={sendAll} disabled={busy || running || unsent === 0}>
          {busy ? "Storing…" : unsent > 0 ? `Add ${unsent} photo${unsent === 1 ? "" : "s"} and start reading` : "Add photos and start reading"}
        </button>
        {(waiting > 0 || reading > 0) && !running && !busy && (
          <button type="button" className="btn-secondary" onClick={runQueue}>
            Read the {waiting + reading} photo{waiting + reading === 1 ? "" : "s"} still waiting
          </button>
        )}
        {running && (
          <button type="button" className="btn-secondary" onClick={() => { stopRef.current = true; }}>
            Pause after this photo
          </button>
        )}
      </div>
      {progress && <p className="muted" style={{ margin: 0 }} aria-live="polite">{progress}</p>}
      <p className="muted an-tiny" style={{ margin: 0 }}>
        The queue is kept on the server: closing this page does not lose photos that are already in it. Reading goes on while this page is open; come back and tap “Read the photos still waiting” to carry on.
      </p>
    </div>
  );
}
