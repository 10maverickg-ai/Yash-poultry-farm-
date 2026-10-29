import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { authConfig, onVercel, productionLike, sessionSecret } from "@/lib/auth/env";
import { attemptLogin } from "@/lib/auth/login";
import { getStore } from "@/lib/auth/attempts";
import { FID_COOKIE, newSession, pinFingerprint, SESSION_COOKIE, signSession, ttl } from "@/lib/auth/session";
import { OWNER_HOME, safeNext, STAFF_HOME } from "@/lib/auth/access";
import { getStaffVersion } from "@/lib/auth/staffVersion";

export const dynamic = "force-dynamic";

// POST /api/login  (a plain form post from /login; the password is never in an address). Answers with a redirect: onward on success,
// back to /login with a short code on failure. The code never says whether the entry was close.
function back(req: NextRequest, code: string, next: string | null) {
  const u = new URL("/login", req.url);
  u.searchParams.set("e", code);
  if (next) u.searchParams.set("next", next);
  const res = NextResponse.redirect(u, 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(String(form?.get("next") ?? ""));
  // a login form post from another site is refused
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.nextUrl.host) return back(req, "origin", next);
    } catch {
      return back(req, "origin", next);
    }
  }
  const env = process.env;
  const cfg = authConfig(env);
  if (cfg.mode === "dev_disabled") {
    const res = NextResponse.redirect(new URL(next ?? OWNER_HOME, req.url), 303);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
  const secret = sessionSecret(env);
  if (cfg.mode !== "ready" || !secret) return back(req, "setup", null);

  const entry = String(form?.get("password") ?? "");
  const keep = form?.get("keep") === "on";
  const fid = req.cookies.get(FID_COOKIE)?.value || randomBytes(16).toString("base64url");
  // Vercel sets x-forwarded-for itself (a caller cannot choose it there); anywhere else the first hop is used as given.
  const ip = (onVercel(env) ? req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-forwarded-for") : req.headers.get("x-forwarded-for"))?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";

  const out = await attemptLogin({ entry, ip, fid, now: Date.now(), env, store: getStore() });
  const secure = productionLike(env);
  const fidCookie = { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge: 400 * 24 * 3600 };

  if (out.kind !== "ok") {
    const res = back(req, out.kind === "bad" ? "bad" : out.kind === "locked" ? "locked" : out.kind === "paused" ? "paused" : "setup", next);
    res.cookies.set(FID_COOKIE, fid, fidCookie);
    return res;
  }

  const now = Math.floor(Date.now() / 1000);
  let session = newSession(out.role, keep, now);
  if (out.role === "staff") {
    const sv = await getStaffVersion();
    if (sv === null || !env.APP_STAFF_PIN_HASH) {
      const res = back(req, "staffdown", null);
      res.cookies.set(FID_COOKIE, fid, fidCookie);
      return res;
    }
    session = newSession("staff", keep, now, { sv, pf: pinFingerprint(secret, env.APP_STAFF_PIN_HASH) });
  }
  const res = NextResponse.redirect(new URL(out.role === "staff" ? STAFF_HOME : next ?? OWNER_HOME, req.url), 303);
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(SESSION_COOKIE, signSession(session, secret), { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: keep ? ttl(true) : undefined });
  res.cookies.set(FID_COOKIE, fid, fidCookie);
  return res;
}
