"use client";

// V18 A1: the "Share" action. It asks the server for the same file as the Excel link, then hands it to the phone's
// share sheet (WhatsApp, Mail, Files …) with navigator.share. A browser that cannot share files gets the download.
// Read-only. iPhone Safari only allows the share sheet straight after a tap, so when the file took too long to make,
// the button says "File ready — tap to share" and the next tap shares the file already made.
import { useRef, useState } from "react";

type State = { s: "idle" } | { s: "busy" } | { s: "again" } | { s: "done"; text: string } | { s: "error"; text: string };

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ShareAction({ href, label = "Share" }: { href: string; label?: string }) {
  const [st, setSt] = useState<State>({ s: "idle" });
  const file = useRef<File | null>(null);

  async function share(f: File) {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof nav.share === "function" && nav.canShare?.({ files: [f] })) {
      try {
        await nav.share({ files: [f], title: f.name });
        setSt({ s: "done", text: "Shared." });
      } catch (e) {
        const name = (e as Error).name;
        if (name === "AbortError") setSt({ s: "idle" });
        else if (name === "NotAllowedError") setSt({ s: "again" });
        else setSt({ s: "error", text: `Could not share: ${(e as Error).message}` });
      }
      return;
    }
    download(f);
    setSt({ s: "done", text: "This browser cannot share a file, so it was downloaded instead." });
  }

  async function go() {
    if (file.current) return share(file.current);
    setSt({ s: "busy" });
    try {
      const r = await fetch(href, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.text()) || `the server said ${r.status}`);
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "yash-poultry.xlsx";
      file.current = new File([blob], name, { type: blob.type });
      await share(file.current);
    } catch (e) {
      setSt({ s: "error", text: `Could not make the file: ${(e as Error).message}` });
    }
  }

  return (
    <span className="sh-action">
      <button type="button" className="btn btn-secondary" onClick={go} disabled={st.s === "busy"} aria-live="polite">
        {st.s === "busy" ? "Making the file…" : st.s === "again" ? "File ready — tap to share" : label}
      </button>
      {(st.s === "done" || st.s === "error") && <span className={`an-tiny ${st.s === "error" ? "sh-err" : "muted"}`} role="status">{st.text}</span>}
    </span>
  );
}
