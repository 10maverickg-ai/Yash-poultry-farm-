"use client";

import { useSyncExternalStore } from "react";

// Help to put the website on the home screen. Android Chrome: a small Install button (the browser's own prompt). iPhone / iPad: a plain
// hint, dismissible, shown until it is dismissed once. Never shown inside the installed app. Dismissal is remembered in localStorage
// (inside try/catch: a private window just shows it again).
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type Mode = "none" | "ios" | "android";
const KEY_IOS = "ypf_ios_hint_dismissed";
const KEY_ANDROID = "ypf_install_dismissed";

const read = (k: string): boolean => {
  try {
    return localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
};
const write = (k: string) => {
  try {
    localStorage.setItem(k, "1");
  } catch {
    /* ignore */
  }
};

let deferred: InstallPrompt | null = null; // the browser's install prompt, kept until the button is tapped
let gone = false; // installed or dismissed during this visit
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onPrompt = (e: Event) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    notify();
  };
  const onInstalled = () => {
    deferred = null;
    gone = true;
    notify();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

function snapshot(): Mode {
  if (gone) return "none";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "none"; // already installed: never show anything
  if (deferred && !read(KEY_ANDROID)) return "android";
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (ios && !read(KEY_IOS)) return "ios";
  return "none";
}

export function InstallHint() {
  const mode = useSyncExternalStore(subscribe, snapshot, () => "none" as Mode);
  if (mode === "none") return null;
  const close = () => {
    write(mode === "ios" ? KEY_IOS : KEY_ANDROID);
    gone = true;
    notify();
  };
  return (
    <div className="install-hint" role="note">
      {mode === "ios" ? (
        <span>To keep this app on your phone: tap <b>Share</b>, then <b>Add to Home Screen</b>.</span>
      ) : (
        <>
          <span>Put this app on your phone.</span>
          <button
            type="button"
            className="install-go"
            onClick={async () => {
              const p = deferred;
              if (!p) return;
              await p.prompt();
              await p.userChoice.catch(() => null);
              deferred = null;
              gone = true;
              notify();
            }}
          >
            Install
          </button>
        </>
      )}
      <button type="button" className="pwa-x" onClick={close} aria-label="Close this hint">✕</button>
    </div>
  );
}
