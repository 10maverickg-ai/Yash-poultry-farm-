// Which login mode this server is in, decided from the environment ON EVERY REQUEST (never at import time: `next build` has no
// runtime environment). The rule is fail CLOSED: if the login is not fully set up, nobody gets in.
import { parseHash } from "./password";

export type Env = Record<string, string | undefined>;

export const MIN_SECRET_LENGTH = 32;

export const onVercel = (e: Env = process.env): boolean => Boolean(e.VERCEL || e.VERCEL_ENV || e.VERCEL_URL);
/** A production build, or anything on Vercel. The developer switch below is ignored in both. */
export const productionLike = (e: Env = process.env): boolean => e.NODE_ENV === "production" || onVercel(e);

export type AuthMode = "ready" | "not_set_up" | "dev_disabled";
export interface AuthConfig {
  mode: AuthMode;
  /** names of the settings that are missing or unusable (never their values) */
  missing: string[];
}

export function authConfig(e: Env = process.env): AuthConfig {
  const missing: string[] = [];
  if (!e.APP_PASSWORD_HASH || !parseHash(e.APP_PASSWORD_HASH)) missing.push("APP_PASSWORD_HASH");
  if (!e.SESSION_SECRET || e.SESSION_SECRET.length < MIN_SECRET_LENGTH) missing.push("SESSION_SECRET");
  if (missing.length === 0) return { mode: "ready", missing };
  // Only a developer's own machine, only with the explicit switch, never a production build and never Vercel.
  if (!productionLike(e) && e.LOGIN_DISABLED_FOR_DEV === "1") {
    warnDevDisabled();
    return { mode: "dev_disabled", missing };
  }
  return { mode: "not_set_up", missing };
}

let warned = false;
function warnDevDisabled() {
  if (warned) return;
  warned = true;
  const line = "!".repeat(78);
  console.warn(`\n${line}\n!! LOGIN IS SWITCHED OFF (LOGIN_DISABLED_FOR_DEV=1). Anybody who can reach this server can see and change all data.\n!! This only works on a developer machine. A production build or Vercel ignores it and stays locked.\n${line}\n`);
}

/** The secret that signs sessions, or null when the login is not ready. */
export const sessionSecret = (e: Env = process.env): string | null => (e.SESSION_SECRET && e.SESSION_SECRET.length >= MIN_SECRET_LENGTH ? e.SESSION_SECRET : null);
export const cronSecret = (e: Env = process.env): string | null => (e.CRON_SECRET && e.CRON_SECRET.length >= 16 ? e.CRON_SECRET : null);
