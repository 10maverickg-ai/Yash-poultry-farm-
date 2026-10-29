"use client";

import { useEffect, useSyncExternalStore } from "react";

// Registers the service worker (production only) and tells the owner, once, when the app was updated since the last visit.
// The version is the build id; the page itself always comes fresh from the server, so a new deployment is picked up on the next open.
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const KEY = "ypf_build_seen";

let showNote = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const hide = () => {
  showNote = false;
  notify();
};

export function PwaRegister() {
  const visible = useSyncExternalStore(subscribe, () => showNote, () => false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(BUILD)}`, { scope: "/" }).catch(() => {
        /* the app works the same without it */
      });
    }
    try {
      const seen = localStorage.getItem(KEY);
      if (seen && seen !== BUILD) {
        showNote = true;
        notify();
        window.setTimeout(hide, 8000);
      }
      localStorage.setItem(KEY, BUILD);
    } catch {
      /* private window or storage blocked: no note, nothing breaks */
    }
  }, []);

  if (!visible) return null;
  return (
    <div className="pwa-note" role="status" aria-live="polite">
      <span>Updated to the latest version.</span>
      <button type="button" className="pwa-x" onClick={hide} aria-label="Close this note">✕</button>
    </div>
  );
}
