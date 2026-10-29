// The second lock, inside the code that actually does something (the first is proxy.ts). Every server action calls requireOwner()
// (or, for the few things staff may do, requireUser()) as its first line; every route handler calls guardRoute().
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfig, sessionSecret } from "./env";
import { SESSION_COOKIE, sessionFromToken, type Session } from "./session";
import { getStaffVersion } from "./staffVersion";
import { LOGIN_PATH, STAFF_HOME } from "./access";

const devOwner = (): Session => ({ role: "owner", iat: 0, exp: Number.MAX_SAFE_INTEGER, keep: true });

/** Who is asking, from the cookie alone (no database): enough to decide what the menu shows. */
export async function peekSession(): Promise<Session | null> {
  const cfg = authConfig();
  if (cfg.mode === "dev_disabled") return devOwner();
  if (cfg.mode !== "ready") return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionFromToken(token, process.env, Math.floor(Date.now() / 1000), sessionSecret());
}

/** Who is asking, fully checked: a staff session must also match the current "staff session version" in the database. */
export async function currentSession(): Promise<Session | null> {
  const s = await peekSession();
  if (!s) return null;
  if (s.role === "staff") {
    const v = await getStaffVersion();
    if (v === null || s.sv !== v) return null;
  }
  return s;
}

export async function requireUser(): Promise<Session> {
  const s = await currentSession();
  if (!s) redirect(LOGIN_PATH);
  return s;
}

/** The first line of every server action and owner page that changes or shows farm data. A staff phone is sent to /upload. */
export async function requireOwner(): Promise<Session> {
  const s = await requireUser();
  if (s.role !== "owner") redirect(STAFF_HOME);
  return s;
}

/** For route handlers: null when allowed, otherwise the response to return (401 not logged in, 403 not allowed). */
export async function guardRoute(level: "owner" | "user" = "owner"): Promise<Response | null> {
  const s = await currentSession();
  const body = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (!s) return body("login_required", 401);
  if (level === "owner" && s.role !== "owner") return body("not_allowed", 403);
  return null;
}
