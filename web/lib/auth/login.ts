// One login box for everybody. What was typed decides which check it goes to: 4 to 6 digits is the staff PIN (when a staff PIN
// is set up), anything else is the owner password. There is no username. Wrong tries are slowed down, counted and locked out;
// the answer never says whether the entry was close.
import { createHmac } from "node:crypto";
import { authConfig, onVercel, sessionSecret, type Env } from "./env";
import { verifyPassword } from "./password";
import { isPinShape } from "./pin";
import { staffEnabled, type Role } from "./session";
import { lockState, newRef, type AttemptStore } from "./attempts";

export type LoginOutcome =
  | { kind: "ok"; role: Role }
  | { kind: "bad"; role: Role }
  | { kind: "locked" } // "Too many tries, wait 15 minutes."
  | { kind: "paused" } // "Too many tries. Ask the owner."  (staff PIN only)
  | { kind: "not_set_up" };

export const MESSAGE: Record<string, string> = {
  bad: "That is not right. Try again.",
  locked: "Too many tries, wait 15 minutes.",
  paused: "Too many tries. Ask the owner.",
  setup: "Login is not set up yet.",
  origin: "That did not come from this page. Open the login page and try again.",
};

export const hashed = (secret: string, kind: string, value: string): string => createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex").slice(0, 24);

export const failDelayMs = (e: Env): number => {
  if (onVercel(e)) return 800;
  const n = Number(e.LOGIN_FAIL_DELAY_MS);
  return Number.isFinite(n) && n >= 0 && n <= 5000 ? n : 800;
};

export interface LoginArgs {
  entry: string;
  ip: string;
  fid: string;
  now: number; // ms
  env: Env;
  store: AttemptStore;
  sleep?: (ms: number) => Promise<void>;
}

export async function attemptLogin(a: LoginArgs): Promise<LoginOutcome> {
  const cfg = authConfig(a.env);
  const secret = sessionSecret(a.env);
  if (cfg.mode !== "ready" || !secret) return { kind: "not_set_up" };
  const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const staff = staffEnabled(a.env) && isPinShape(a.entry);
  const role: Role = staff ? "staff" : "owner";
  const ip = hashed(secret, "ip", a.ip);
  const fid = hashed(secret, "fid", a.fid);
  const base = { ref: "", at: a.now, role, ip, fid };

  const lock = await lockState(a.store, role, ip, fid, a.now);
  if (lock.state !== "ok") {
    await a.store.record({ ...base, ref: newRef(), ok: false, blocked: true });
    await sleep(failDelayMs(a.env));
    return { kind: lock.state === "paused" ? "paused" : "locked" };
  }

  const okPw = a.entry.length > 0 && a.entry.length <= 200 && (await verifyPassword(a.entry, staff ? a.env.APP_STAFF_PIN_HASH : a.env.APP_PASSWORD_HASH));
  await a.store.record({ ...base, ref: newRef(), ok: okPw, blocked: false });
  if (okPw) return { kind: "ok", role };
  await sleep(failDelayMs(a.env));
  return { kind: "bad", role };
}
