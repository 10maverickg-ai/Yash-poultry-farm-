// The decision made before any page code runs (proxy.ts calls this). It is a plain function of the request, so it can be tested
// without a server. Order: public files, the weather job, "is login set up", "is there a valid session", "may this role open this".
import { timingSafeEqual } from "node:crypto";
import { authConfig, cronSecret, sessionSecret, type Env } from "./env";
import { isApiLike, isPublic, LOGIN_PATH, OWNER_HOME, STAFF_HOME, staffMay } from "./access";
import { needsRefresh, refreshed, SESSION_COOKIE, sessionFromToken, signSession, ttl, type Session } from "./session";

export interface GateInput {
  pathname: string;
  search: string;
  method: string;
  authorization: string | null;
  nextAction: string | null;
  cookie: string | undefined; // the session cookie's value
}

export type GateResult =
  | { kind: "next"; noStore: boolean; setCookie?: { name: string; value: string; maxAge: number | undefined }; session?: Session }
  | { kind: "redirect"; to: string }
  | { kind: "json"; status: number; error: string }
  | { kind: "setup" }; // login is not set up: pages show "Login is not set up yet", everything else 503

const safeEq = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The weather job: "Authorization: Bearer <CRON_SECRET>" and nothing else (a login cookie does not open it). */
export function cronAllowed(authorization: string | null, e: Env): "ok" | "denied" | "not_set_up" {
  const secret = cronSecret(e);
  if (!secret) return "not_set_up";
  return authorization && safeEq(authorization, `Bearer ${secret}`) ? "ok" : "denied";
}

export function gate(i: GateInput, e: Env, now: number): GateResult {
  const { pathname } = i;
  const nowSec = Math.floor(now / 1000);

  if (pathname === "/api/weather") {
    const c = cronAllowed(i.authorization, e);
    if (c === "ok") return { kind: "next", noStore: true };
    return { kind: "json", status: c === "not_set_up" ? 503 : 401, error: c === "not_set_up" ? "cron_not_set_up" : "bearer_required" };
  }

  const api = isApiLike(pathname, i.method, i.nextAction);
  const cfg = authConfig(e);
  if (isPublic(pathname)) {
    // a logged-in browser that opens the login screen goes straight on (not when it was sent here with a message, or a staff phone whose
    // session the server has ended would bounce between /upload and /login)
    if (pathname === LOGIN_PATH && cfg.mode === "ready" && !/[?&]e=/.test(i.search)) {
      const s = sessionFromToken(i.cookie, e, nowSec, sessionSecret(e));
      if (s) return { kind: "redirect", to: s.role === "staff" ? STAFF_HOME : OWNER_HOME };
    }
    return { kind: "next", noStore: pathname === LOGIN_PATH || pathname.startsWith("/api/") };
  }

  if (cfg.mode === "dev_disabled") return { kind: "next", noStore: true };
  if (cfg.mode === "not_set_up") return api ? { kind: "json", status: 503, error: "login_not_set_up" } : { kind: "setup" };

  const secret = sessionSecret(e);
  const s = sessionFromToken(i.cookie, e, nowSec, secret);
  if (!s) {
    if (api) return { kind: "json", status: 401, error: "login_required" };
    const back = `${pathname}${i.search}`;
    return { kind: "redirect", to: back.length < 300 && back !== "/" ? `${LOGIN_PATH}?next=${encodeURIComponent(back)}` : LOGIN_PATH };
  }

  if (s.role === "staff" && !staffMay(pathname, i.method)) {
    return api ? { kind: "json", status: 403, error: "not_allowed" } : { kind: "redirect", to: STAFF_HOME };
  }

  if (secret && needsRefresh(s, nowSec)) {
    const r = refreshed(s, nowSec);
    return { kind: "next", noStore: true, session: s, setCookie: { name: SESSION_COOKIE, value: signSession(r, secret), maxAge: r.keep ? ttl(true) : undefined } };
  }
  return { kind: "next", noStore: true, session: s };
}
