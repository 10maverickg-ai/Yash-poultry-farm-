// The signed session cookie. It carries who you are (owner or staff) and when it expires; nothing else. It is signed with
// HMAC-SHA256 using SESSION_SECRET, so it cannot be made up or changed on a phone, and changing SESSION_SECRET ends every session.
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseHash } from "./password";
import type { Env } from "./env";

export type Role = "owner" | "staff";
export interface Session {
  role: Role;
  iat: number; // issued (seconds)
  exp: number; // expires (seconds)
  keep: boolean; // "keep me logged in on this phone"
  sv?: number; // staff only: the session version at login ("Log out all staff phones" raises it)
  pf?: string; // staff only: fingerprint of the staff PIN hash at login (changing the PIN ends staff sessions)
}

export const SESSION_COOKIE = "ypf_session";
export const FID_COOKIE = "ypf_fid";
export const DAY = 86_400;
export const KEEP_TTL = 30 * DAY; // sliding: every day of use pushes it out again
export const SHORT_TTL = 12 * 3600; // when "keep me logged in" is off
export const REFRESH_AFTER = DAY;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest();

export function ttl(keep: boolean): number {
  return keep ? KEEP_TTL : SHORT_TTL;
}

export function signSession(s: Session, secret: string): string {
  const body = b64(JSON.stringify(s));
  return `v1.${body}.${b64(mac(secret, `v1.${body}`))}`;
}

/** The session in the cookie, or null when it is missing, altered, signed with another secret, or expired. */
export function verifySession(token: string | undefined | null, secret: string | null, now: number): Session | null {
  if (!token || !secret || token.length > 1200) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const want = mac(secret, `v1.${parts[1]}`);
  let got: Buffer;
  try {
    got = Buffer.from(parts[2], "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let s: Partial<Session>;
  try {
    s = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if ((s.role !== "owner" && s.role !== "staff") || typeof s.iat !== "number" || typeof s.exp !== "number") return null;
  if (s.exp <= now || s.iat > now + 300) return null;
  return { role: s.role, iat: s.iat, exp: s.exp, keep: s.keep === true, sv: typeof s.sv === "number" ? s.sv : undefined, pf: typeof s.pf === "string" ? s.pf : undefined };
}

/** Short fingerprint of the staff PIN hash: when the PIN is changed in Vercel every staff session stops working. */
export function pinFingerprint(secret: string, pinHash: string): string {
  return mac(secret, `pin:${pinHash}`).toString("hex").slice(0, 16);
}

export const staffEnabled = (e: Env): boolean => Boolean(parseHash(e.APP_STAFF_PIN_HASH));

export function newSession(role: Role, keep: boolean, now: number, extra: { sv?: number; pf?: string } = {}): Session {
  return { role, iat: now, exp: now + ttl(keep), keep, ...extra };
}

/** True when the cookie is older than a day: it is re-issued so a phone in daily use never logs out. */
export const needsRefresh = (s: Session, now: number): boolean => now - s.iat > REFRESH_AFTER;
export const refreshed = (s: Session, now: number): Session => ({ ...s, iat: now, exp: now + ttl(s.keep) });

/** Session for a request: signature and expiry, and for staff also the PIN fingerprint. (The staff "version" is checked in the server code, which can read the database.) */
export function sessionFromToken(token: string | undefined, e: Env, now: number, secret: string | null): Session | null {
  const s = verifySession(token, secret, now);
  if (!s) return null;
  if (s.role === "staff") {
    if (!secret || !e.APP_STAFF_PIN_HASH || !staffEnabled(e)) return null;
    if (s.pf !== pinFingerprint(secret, e.APP_STAFF_PIN_HASH)) return null;
    if (typeof s.sv !== "number") return null;
  }
  return s;
}
