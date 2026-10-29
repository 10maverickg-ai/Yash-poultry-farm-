// Tests of the login, the staff PIN and the doors of the app.   npx tsx scripts/auth-check.mts
//
// Part 1 (no server): the rules as plain functions: settings that fail closed, cookies (tampered, expired, other secret), the allow-lists,
//   the lock-out timeline (5 in 15 minutes, release after the window, 20 PINs an hour farm-wide, owner counted separately).
// Part 2 (code scan): every server action starts with requireOwner() and every route handler checks its caller.
// Part 3 (real server): starts the PRODUCTION build (builds it first if there is none) with a throw-away password, PIN and secrets made
//   inside this script (nothing real, nothing written to disk) and asks every route of the app, from the build's own route list:
//   (a) with no cookie, (b) as staff, (c) as owner, (d) the weather job with and without its secret, (e) logout, (f) lock-outs over HTTP,
//   (g) a second server with NO login settings, which must stay closed. Also checks that no protected answer carries farm data.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword, parseHash, verifyPassword } from "../lib/auth/password.ts";
import { isPinShape, ownerPasswordProblem, pinProblem } from "../lib/auth/pin.ts";
import { authConfig, onVercel, productionLike } from "../lib/auth/env.ts";
import { FID_COOKIE, newSession, needsRefresh, pinFingerprint, refreshed, SESSION_COOKIE, sessionFromToken, signSession, verifySession } from "../lib/auth/session.ts";
import { isApiLike, isPublic, safeNext, STAFF_ALLOWED, staffMay } from "../lib/auth/access.ts";
import { cronAllowed, gate } from "../lib/auth/gate.ts";
import { attemptLogin } from "../lib/auth/login.ts";
import { lockEnd, lockState, MemoryStore, newRef, PIN_FARM_LIMIT, TRY_LIMIT, TRY_WINDOW_MS } from "../lib/auth/attempts.ts";

let failed = 0;
const ok = (n: string, c: boolean, x = "") => {
  if (!c) failed++;
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- throw-away credentials, made here, never real ---------------------------------------------------------------------------------
const rnd = () => randomBytes(9).toString("base64url").replace(/[^a-z0-9]/gi, "x");
const OWNER_PW = `test-${rnd()}-${rnd()}`;
let STAFF_PIN = "";
do STAFF_PIN = String(1000 + Math.floor(Math.random() * 9000)); while (pinProblem(STAFF_PIN));
const wrongPin = (i: number): string => { const w = String(4000 + ((i * 37 + 11) % 5000)); return w === STAFF_PIN ? "9040" : w; };
const SECRET = randomBytes(32).toString("base64url");
const CRON = randomBytes(32).toString("base64url");
const OWNER_HASH = await hashPassword(OWNER_PW, 12);
const PIN_HASH = await hashPassword(STAFF_PIN, 12);
const BASE_ENV: Record<string, string> = { NODE_ENV: "production", APP_PASSWORD_HASH: OWNER_HASH, APP_STAFF_PIN_HASH: PIN_HASH, SESSION_SECRET: SECRET, CRON_SECRET: CRON };

// ============================== PART 1: the rules as functions ===========================================================================
ok("hash: scrypt format parses; the right password matches; a wrong one, an empty one and a broken hash do not", parseHash(OWNER_HASH) !== null && (await verifyPassword(OWNER_PW, OWNER_HASH)) && !(await verifyPassword(OWNER_PW + "x", OWNER_HASH)) && !(await verifyPassword("", OWNER_HASH)) && !(await verifyPassword(OWNER_PW, "scrypt:1:1:1:aa:bb")) && !(await verifyPassword(OWNER_PW, undefined)));
ok("hash: the same password gives a different hash each time (salted) and the hash has no dollar sign or the password in it", (await hashPassword(OWNER_PW, 12)) !== OWNER_HASH && !OWNER_HASH.includes("$") && !OWNER_HASH.includes(OWNER_PW));
ok("PIN rules: 4 to 6 digits only; easy ones refused (0000, 1234, 1111, 4321, 1212, 123456); a good one accepted", isPinShape("4821") && isPinShape("482193") && !isPinShape("123") && !isPinShape("1234567") && !isPinShape("48a1") && ["0000", "1234", "1111", "4321", "1212", "123456", "9999"].every((p) => pinProblem(p) !== null) && pinProblem("7392") === null && pinProblem("48") !== null);
ok("owner password rules: at least 10 characters and not only digits (it would be sent to the PIN check)", ownerPasswordProblem("short") !== null && ownerPasswordProblem("1234567890") !== null && ownerPasswordProblem("123456") !== null && ownerPasswordProblem("three plain words") === null);

const NOW = 1_800_000_000_000;
const sec = Math.floor(NOW / 1000);
ok("settings: complete settings are 'ready'", authConfig(BASE_ENV).mode === "ready");
ok("settings: no hash, no secret, a short secret or a broken hash each fail closed in production", ["APP_PASSWORD_HASH", "SESSION_SECRET"].every((k) => authConfig({ ...BASE_ENV, [k]: undefined }).mode === "not_set_up") && authConfig({ ...BASE_ENV, SESSION_SECRET: "tooshort" }).mode === "not_set_up" && authConfig({ ...BASE_ENV, APP_PASSWORD_HASH: "plain-text-password" }).mode === "not_set_up" && authConfig({ NODE_ENV: "production" }).mode === "not_set_up");
ok("settings: LOGIN_DISABLED_FOR_DEV=1 works on a developer machine only", authConfig({ NODE_ENV: "development", LOGIN_DISABLED_FOR_DEV: "1" }).mode === "dev_disabled" && authConfig({ NODE_ENV: "development" }).mode === "not_set_up");
ok("settings: LOGIN_DISABLED_FOR_DEV=1 is ignored in production and on Vercel", authConfig({ NODE_ENV: "production", LOGIN_DISABLED_FOR_DEV: "1" }).mode === "not_set_up" && authConfig({ NODE_ENV: "development", VERCEL: "1", LOGIN_DISABLED_FOR_DEV: "1" }).mode === "not_set_up" && authConfig({ VERCEL_ENV: "preview", LOGIN_DISABLED_FOR_DEV: "1" }).mode === "not_set_up" && onVercel({ VERCEL_URL: "x" }) && productionLike({ NODE_ENV: "production" }));
ok("settings: the switch does not override a complete setup (the real login still applies)", authConfig({ ...BASE_ENV, NODE_ENV: "development", LOGIN_DISABLED_FOR_DEV: "1" }).mode === "ready");

const owner = newSession("owner", true, sec);
const tok = signSession(owner, SECRET);
ok("cookie: a valid owner cookie is accepted; the same cookie with another secret, tampered, truncated, empty or junk is not", verifySession(tok, SECRET, sec)?.role === "owner" && verifySession(tok, "another-secret-another-secret-12345", sec) === null && verifySession(tok.slice(0, -2) + "xx", SECRET, sec) === null && verifySession(tok.slice(0, -5), SECRET, sec) === null && verifySession("", SECRET, sec) === null && verifySession("junk", SECRET, sec) === null && verifySession(tok, null, sec) === null);
const [v, body, mac] = tok.split(".");
const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), role: "owner", exp: sec + 99999999 })).toString("base64url");
ok("cookie: changing what is inside (a longer expiry, a staff cookie turned into owner) breaks the signature", verifySession(`${v}.${forged}.${mac}`, SECRET, sec) === null && verifySession(signSession(newSession("staff", true, sec, { sv: 0, pf: "x" }), SECRET).replace(/^(v1\.)([^.]+)/, (_m, a, b) => a + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, "base64url").toString()), role: "owner" })).toString("base64url")), SECRET, sec) === null);
ok("cookie: expired is refused; a cookie from the future is refused; one second before expiry is still fine", verifySession(signSession({ ...owner, exp: sec - 1 }, SECRET), SECRET, sec) === null && verifySession(signSession({ ...owner, iat: sec + 3600, exp: sec + 7200 }, SECRET), SECRET, sec) === null && verifySession(signSession({ ...owner, exp: sec + 1 }, SECRET), SECRET, sec) !== null);
ok("cookie: 30 days when kept, 12 hours when not; re-issued after a day of use (sliding), not before", owner.exp - owner.iat === 30 * 86400 && newSession("owner", false, sec).exp - sec === 12 * 3600 && !needsRefresh(owner, sec + 3600) && needsRefresh(owner, sec + 86400 + 1) && refreshed(owner, sec + 90000).exp === sec + 90000 + 30 * 86400);
const staffTok = signSession(newSession("staff", true, sec, { sv: 3, pf: pinFingerprint(SECRET, PIN_HASH) }), SECRET);
ok("cookie: a staff cookie works only while the staff PIN hash is unchanged and set", sessionFromToken(staffTok, BASE_ENV, sec, SECRET)?.role === "staff" && sessionFromToken(staffTok, { ...BASE_ENV, APP_STAFF_PIN_HASH: PIN_HASH.replace(/.$/, "A") }, sec, SECRET) === null && sessionFromToken(staffTok, { ...BASE_ENV, APP_STAFF_PIN_HASH: undefined }, sec, SECRET) === null);
ok("cookie: changing SESSION_SECRET logs everybody out (owner and staff)", sessionFromToken(tok, BASE_ENV, sec, "a-brand-new-secret-a-brand-new-secret") === null && sessionFromToken(staffTok, BASE_ENV, sec, "a-brand-new-secret-a-brand-new-secret") === null);

ok("allow-list: staff may open exactly the Upload page, the upload route, the thanks page and the install help (GET/POST as listed), nothing else", STAFF_ALLOWED.length === 4 && staffMay("/upload", "GET") && staffMay("/upload/thanks", "GET") && staffMay("/install", "GET") && staffMay("/api/upload", "POST") && !staffMay("/api/upload", "GET") && !staffMay("/upload", "POST") && ["/", "/today", "/analytics", "/day", "/day/enter", "/sales", "/purchases", "/medicines", "/settings", "/export", "/export/download", "/import", "/flocks", "/egg-stock", "/upload/single", "/flagged", "/changes", "/api/weather", "/upload/anything", "/uploads", "/Upload"].every((p) => !staffMay(p, "GET") && !staffMay(p, "POST")));
ok("allow-list: public files are exactly the login, its two routes, the install files and built assets", ["/login", "/api/login", "/api/logout", "/manifest.webmanifest", "/sw.js", "/offline.html", "/_next/static/chunks/a.js", "/icons/icon-192.png"].every(isPublic) && ["/", "/today", "/api/upload", "/api/weather", "/settings", "/login/x", "/icons", "/_next/image", "/_next/static"].every((p) => !isPublic(p)));
ok("allow-list: 'after login go here' only accepts a path inside the site, never the login screen, an API route or another site", safeNext("/today?x=1") === "/today?x=1" && safeNext("//evil.example") === null && safeNext("https://evil.example") === null && safeNext("/\\evil") === null && safeNext("/login") === null && safeNext("/api/logout") === null && safeNext("") === null && safeNext(null) === null && safeNext("/a\nb") === null);
ok("allow-list: data and file answers are refused with 401/403, pages are redirected", isApiLike("/api/x", "GET", null) && isApiLike("/today", "POST", null) && isApiLike("/today", "GET", "abc") && isApiLike("/export/download", "GET", null) && isApiLike("/x.csv", "GET", null) && !isApiLike("/today", "GET", null) && !isApiLike("/", "HEAD", null));

const g = (path: string, over: Partial<Parameters<typeof gate>[0]> = {}, env = BASE_ENV) => gate({ pathname: path, search: "", method: "GET", authorization: null, nextAction: null, cookie: undefined, ...over }, env, NOW);
ok("gate: no cookie: pages redirect to /login (with the page to come back to), data answers are 401, nothing passes", (() => { const a = g("/today"); const b = g("/api/anything"); const c = g("/export/download"); const d = g("/today", { method: "POST", nextAction: "x" }); return a.kind === "redirect" && a.to === "/login?next=%2Ftoday" && b.kind === "json" && b.status === 401 && c.kind === "json" && c.status === 401 && d.kind === "json" && d.status === 401; })());
ok("gate: public files pass without a cookie; a logged-in browser opening /login goes on, unless it was sent there with a message", g("/login").kind === "next" && g("/manifest.webmanifest").kind === "next" && g("/icons/icon-512.png").kind === "next" && (() => { const r = g("/login", { cookie: tok }); return r.kind === "redirect" && r.to === "/today"; })() && g("/login", { cookie: tok, search: "?e=expired" }).kind === "next" && (() => { const r = g("/login", { cookie: staffTok }); return r.kind === "redirect" && r.to === "/upload"; })());
ok("gate: owner cookie opens everything (with no-store); an expired or tampered cookie opens nothing", g("/settings", { cookie: tok }).kind === "next" && (g("/settings", { cookie: tok }) as { noStore: boolean }).noStore === true && g("/settings", { cookie: signSession({ ...owner, exp: sec - 5 }, SECRET) }).kind === "redirect" && g("/settings", { cookie: tok.slice(0, -3) + "abc" }).kind === "redirect");
ok("gate: staff cookie: allowed things pass; other pages redirect to /upload; other methods and data answers are 403", g("/upload", { cookie: staffTok }).kind === "next" && g("/api/upload", { cookie: staffTok, method: "POST" }).kind === "next" && (() => { const r = g("/today", { cookie: staffTok }); return r.kind === "redirect" && r.to === "/upload"; })() && (() => { const r = g("/export/download", { cookie: staffTok }); return r.kind === "json" && r.status === 403; })() && (() => { const r = g("/upload", { cookie: staffTok, method: "POST", nextAction: "abc" }); return r.kind === "json" && r.status === 403; })());
ok("gate: login not set up: pages show the not-set-up screen, everything else is 503, public files still load; the dev switch does not open it", (() => { const e = { NODE_ENV: "production" }; const p = g("/today", {}, e); const a = g("/api/x", {}, e); return p.kind === "setup" && a.kind === "json" && a.status === 503 && g("/manifest.webmanifest", {}, e).kind === "next" && g("/today", {}, { ...e, LOGIN_DISABLED_FOR_DEV: "1" }).kind === "setup"; })());
ok("gate: the weather job needs 'Authorization: Bearer <CRON_SECRET>' and nothing else: not a login cookie, not a wrong secret; with no CRON_SECRET set it is closed", g("/api/weather", { authorization: `Bearer ${CRON}` }).kind === "next" && g("/api/weather").kind === "json" && g("/api/weather", { cookie: tok }).kind === "json" && g("/api/weather", { authorization: "Bearer wrong" }).kind === "json" && g("/api/weather", { authorization: CRON }).kind === "json" && cronAllowed(`Bearer ${CRON}`, { ...BASE_ENV, CRON_SECRET: undefined }) === "not_set_up" && cronAllowed(`Bearer ${CRON}`, BASE_ENV) === "ok" && cronAllowed(null, BASE_ENV) === "denied");

// ---- lock-outs, with a fake clock -------------------------------------------------------------------------------------------------
const MIN = 60_000;
const mkArgs = (store: MemoryStore, entry: string, ip: string, fid: string, now: number) => ({ entry, ip, fid, now, env: BASE_ENV, store, sleep: async () => {} });
{
  const s = new MemoryStore();
  let t = NOW;
  const outs: string[] = [];
  for (let i = 0; i < 5; i++) outs.push((await attemptLogin(mkArgs(s, "wrong" + i, "10.0.0.1", "browser-a", (t += 1000)))).kind);
  const sixth = await attemptLogin(mkArgs(s, "wrong-again", "10.0.0.1", "browser-a", (t += 1000)));
  const rightWhileLocked = await attemptLogin(mkArgs(s, OWNER_PW, "10.0.0.1", "browser-a", (t += 1000)));
  ok("lock-out: five wrong owner tries are 'bad', the sixth is 'locked', and even the right password is refused while locked", outs.every((k) => k === "bad") && sixth.kind === "locked" && rightWhileLocked.kind === "locked", JSON.stringify({ outs, sixth, rightWhileLocked }));
  const otherAddress = await attemptLogin(mkArgs(s, OWNER_PW, "10.0.0.2", "browser-b", (t += 1000)));
  const sameBrowserNewAddress = await attemptLogin(mkArgs(s, OWNER_PW, "10.0.0.3", "browser-a", (t += 1000)));
  ok("lock-out: it is per address AND per browser: another address and browser gets in; the same browser from a new address is still locked", otherAddress.kind === "ok" && sameBrowserNewAddress.kind === "locked");
  const fifth = NOW + 5000; // the fifth wrong try completes the lock; the lock lasts one full 15 minutes from then
  const justBefore = await attemptLogin(mkArgs(s, OWNER_PW, "10.0.0.1", "browser-c", fifth + TRY_WINDOW_MS - 1));
  const released = await attemptLogin(mkArgs(s, OWNER_PW, "10.0.0.1", "browser-c", fifth + TRY_WINDOW_MS + 1));
  ok("lock-out: locked for a full 15 minutes after the fifth wrong try (not one millisecond sooner), then free again", justBefore.kind === "locked" && released.kind === "ok", JSON.stringify({ justBefore, released }));
  ok("lock-out: tries spread over 14 minutes still lock at the fifth and still wait a full 15 minutes; four tries never lock", lockEnd([0, 3, 6, 9, 14].map((m) => m * MIN), 5, 15 * MIN) === 29 * MIN && lockEnd([0, 3, 6, 9].map((m) => m * MIN), 5, 15 * MIN) === null && lockEnd([0, 4, 8, 12, 16].map((m) => m * MIN), 5, 15 * MIN) === null);
  ok("lock-out: the locked tries are written down as 'blocked' and are not counted as new wrong tries", (await s.recent(50)).filter((r) => r.blocked).length >= 3 && (await s.failures("owner", 0)).length === 5);
}
{
  const s = new MemoryStore();
  let t = NOW;
  // 20 wrong PINs from 20 different addresses and browsers
  const kinds: string[] = [];
  for (let i = 0; i < PIN_FARM_LIMIT; i++) kinds.push((await attemptLogin(mkArgs(s, wrongPin(i), `192.0.2.${i}`, `f${i}`, (t += 2000)))).kind);
  const pinNow = await attemptLogin(mkArgs(s, STAFF_PIN, "198.51.100.77", "fresh", (t += 2000)));
  const ownerNow = await attemptLogin(mkArgs(s, OWNER_PW, "198.51.100.77", "fresh", (t += 2000)));
  ok("PIN farm-wide limit: 20 wrong PINs from 20 places pause PIN login ('paused'); the right PIN is refused too; the owner password still works", kinds.every((k) => k === "bad") && pinNow.kind === "paused" && ownerNow.kind === "ok", JSON.stringify({ pinNow, ownerNow }));
  const lastFail = (await s.failures("staff", 0)).sort((a, b) => b.at - a.at)[0].at; // the 20th wrong PIN starts the pause
  const still = await attemptLogin(mkArgs(s, STAFF_PIN, "198.51.100.78", "fresh2", lastFail + 60 * MIN - 1));
  const back = await attemptLogin(mkArgs(s, STAFF_PIN, "198.51.100.78", "fresh2", lastFail + 60 * MIN + 1));
  ok("PIN farm-wide limit: paused for a full hour after the 20th wrong PIN (not a second sooner), then PIN login works again", still.kind === "paused" && back.kind === "ok", JSON.stringify({ still, back }));
  const t2 = new MemoryStore();
  for (let i = 0; i < 25; i++) await attemptLogin(mkArgs(t2, wrongPin(i), `192.0.2.${i}`, `f${i}`, NOW + i * 1000));
  const ownerFine = await attemptLogin(mkArgs(t2, OWNER_PW, "203.0.113.200", "own", NOW + 60_000));
  const ownerWrong = await attemptLogin(mkArgs(t2, "not-the-password", "203.0.113.201", "own2", NOW + 61_000));
  ok("owner is never locked out by PIN guessing: owner tries have their own counter (right password ok, a wrong one is just 'bad')", ownerFine.kind === "ok" && ownerWrong.kind === "bad");
  const t3 = new MemoryStore();
  const tries = [];
  for (let i = 0; i < 6; i++) tries.push((await attemptLogin(mkArgs(t3, wrongPin(i + 100), "10.9.9.9", "same", NOW + i * 1000))).kind);
  ok("PIN lock-out per address and browser: the same 5-in-15-minutes rule applies to PIN tries", tries.slice(0, 5).every((k) => k === "bad") && tries[5] === "locked", JSON.stringify(tries));
}
{
  const s = new MemoryStore();
  const noPin = { ...BASE_ENV, APP_STAFF_PIN_HASH: undefined };
  const a = await attemptLogin({ entry: STAFF_PIN, ip: "1.1.1.1", fid: "x", now: NOW, env: noPin, store: s, sleep: async () => {} });
  ok("with no staff PIN set up, digits are just a wrong owner password (staff cannot log in)", a.kind === "bad" && (a as { role: string }).role === "owner");
  const r = await attemptLogin({ entry: STAFF_PIN, ip: "1.1.1.1", fid: "x2", now: NOW, env: BASE_ENV, store: s, sleep: async () => {} });
  const r2 = await attemptLogin({ entry: OWNER_PW, ip: "1.1.1.1", fid: "x3", now: NOW, env: BASE_ENV, store: s, sleep: async () => {} });
  const r3 = await attemptLogin({ entry: OWNER_PW, ip: "1.1.1.1", fid: "x4", now: NOW, env: { ...BASE_ENV, APP_PASSWORD_HASH: undefined }, store: s, sleep: async () => {} });
  ok("one box: digits 4 to 6 long go to the staff PIN (role staff), anything else to the owner password (role owner); no setup means no login", r.kind === "ok" && r.role === "staff" && r2.kind === "ok" && r2.role === "owner" && r3.kind === "not_set_up");
  const rows = await s.recent(10);
  const dump = JSON.stringify(rows);
  ok("the record never holds a password, a PIN or an address: only hashed codes", !dump.includes(OWNER_PW) && !dump.includes(STAFF_PIN) && !dump.includes("1.1.1.1") && rows.every((x) => /^[0-9a-f]{24}$/.test(x.ip) && /^[0-9a-f]{24}$/.test(x.fid)));
  const wrongSlow: number[] = [];
  await attemptLogin({ entry: "wrong", ip: "2.2.2.2", fid: "d", now: NOW, env: BASE_ENV, store: new MemoryStore(), sleep: async (ms) => void wrongSlow.push(ms) });
  ok("every wrong try is slowed down (about 0.8 s on Vercel and by default)", wrongSlow.length === 1 && wrongSlow[0] === 800);
  ok("lockState handles an empty record, and refs are unique", (await lockState(new MemoryStore(), "owner", "a", "b", NOW)).state === "ok" && newRef() !== newRef() && TRY_LIMIT === 5);
}

// ============================== PART 2: the code itself =====================================================================================
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.name === "node_modules" || d.name.startsWith(".") ? [] : d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
const sources = ["app", "lib", "components"].flatMap(walk).filter((f) => /\.(ts|tsx)$/.test(f));
const actionFiles = sources.filter((f) => /^\s*["']use server["']/m.test(readFileSync(f, "utf8").slice(0, 400)));
const unguarded: string[] = [];
let actionCount = 0;
for (const f of actionFiles) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/export async function (\w+)\(/g)) {
    actionCount++;
    let j = m.index! + m[0].length;
    let depth = 1;
    while (depth > 0) { const c = s[j++]; if (c === "(") depth++; else if (c === ")") depth--; }
    let ang = 0;
    let k = j;
    for (;; k++) { const c = s[k]; if (c === "<") ang++; else if (c === ">" && s[k - 1] !== "=") ang--; else if (c === "{" && ang === 0) break; }
    if (!/^\s*await (requireOwner|requireUser)\(\);/.test(s.slice(k + 1, k + 80))) unguarded.push(`${f}:${m[1]}`);
  }
}
ok(`code: every one of the ${actionCount} server actions in ${actionFiles.length} files starts with requireOwner() / requireUser()`, actionCount > 60 && unguarded.length === 0, unguarded.join(", "));
const exportsNotAsync = actionFiles.filter((f) => /^export (const|function) /m.test(readFileSync(f, "utf8")));
ok("code: no server-action file exports anything that is not an async function (so nothing slips past the scan above)", exportsNotAsync.length === 0, exportsNotAsync.join(", "));
const routeFiles = sources.filter((f) => /(^|\/)route\.ts$/.test(f));
const selfGuarded = new Set(["app/api/login/route.ts", "app/api/logout/route.ts", "app/api/weather/route.ts"]);
const badRoutes = routeFiles.filter((f) => !selfGuarded.has(f) && !/guardRoute\(/.test(readFileSync(f, "utf8")));
ok(`code: every route handler (${routeFiles.length}) checks its caller itself (guardRoute), except login/logout and the weather job which have their own checks`, badRoutes.length === 0 && /cronAllowed\(/.test(readFileSync("app/api/weather/route.ts", "utf8")), badRoutes.join(", "));
const staffRoutes = readFileSync("lib/auth/access.ts", "utf8");
ok("code: the staff allow-list lives in one file and the proxy uses it (nothing else decides who may open what)", /export const STAFF_ALLOWED/.test(staffRoutes) && !sources.some((f) => f !== "lib/auth/access.ts" && /STAFF_ALLOWED\s*=/.test(readFileSync(f, "utf8"))) && /staffMay\(/.test(readFileSync("lib/auth/gate.ts", "utf8")) && /from "@\/lib\/auth\/gate"/.test(readFileSync("proxy.ts", "utf8")));
ok("code: no real password or hash is written in the repo's auth code or scripts (the only secrets here are made at run time)", !sources.concat(["scripts/make-password-hash.mts", "scripts/make-secret.mts", "scripts/auth-check.mts"]).some((f) => /scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{16,}/.test(readFileSync(f, "utf8"))));

// ============================== PART 3: a real server =======================================================================================
const procs: ChildProcess[] = [];
const dbUrl = process.env.DATABASE_URL ?? "postgres://yash:yash_dev_password@localhost:5432/yash_poultry";
const startedAt = new Date();

if (!existsSync(".next/BUILD_ID")) {
  console.log("(no production build yet: building it first, this takes a minute)");
  const b = spawnSync("npx", ["next", "build"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (b.status !== 0) {
    ok("the production build succeeded", false, (b.stdout + b.stderr).slice(-300));
    process.exit(1);
  }
}

async function start(port: number, env: Record<string, string>): Promise<void> {
  const clean: Record<string, string> = {};
  for (const [k, val] of Object.entries(process.env)) if (val !== undefined && !/^(APP_|SESSION_SECRET|CRON_SECRET|LOGIN_)/.test(k) && k !== "NODE_ENV") clean[k] = val;
  const p = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...clean, DATABASE_URL: dbUrl, ...env }, stdio: "ignore", detached: true });
  procs.push(p);
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/login`, { redirect: "manual" });
      if (r.status > 0) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`server on ${port} did not start`);
}
const stopAll = () => { for (const p of procs) { try { if (p.pid) process.kill(-p.pid, "SIGTERM"); } catch { /* ignore */ } } };
process.on("exit", stopAll);

const PORT = 3197;
const URL = `http://localhost:${PORT}`;
type Res = { status: number; location: string | null; body: string; headers: Headers; setCookie: string[] };
async function call(base: string, path: string, o: { method?: string; cookie?: string; headers?: Record<string, string>; body?: BodyInit } = {}): Promise<Res> {
  const h: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) h.cookie = o.cookie;
  const r = await fetch(base + path, { method: o.method ?? "GET", headers: h, body: o.body, redirect: "manual" });
  const body = await r.text();
  return { status: r.status, location: r.headers.get("location"), body, headers: r.headers, setCookie: r.headers.getSetCookie?.() ?? [] };
}
const cookieOf = (r: Res, name: string) => (r.setCookie.find((c) => c.startsWith(name + "=")) ?? "").split(";")[0];
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const FORM = { "content-type": "application/x-www-form-urlencoded" };
let ipn = 0;
const freshIp = () => `198.18.${Math.floor(++ipn / 250)}.${(ipn % 250) + 1}`;
async function login(base: string, entry: string, ip = freshIp(), fid?: string, extra: Record<string, string> = {}): Promise<Res> {
  return call(base, "/api/login", { method: "POST", headers: { ...FORM, "x-forwarded-for": ip, ...(fid ? { cookie: `${FID_COOKIE}=${fid}` } : {}) }, body: form({ password: entry, keep: "on", ...extra }) });
}

const PROBES = ["BAB-", "Farmfresh", "₹", "mortality", "Anil", "Yash P.F."];
const leaks = (body: string) => PROBES.filter((p) => body.includes(p));

// the route list, straight from the build, so a new page or route is covered without touching this file
const manifest = JSON.parse(readFileSync(".next/app-path-routes-manifest.json", "utf8")) as Record<string, string>;
const sample = (p: string) => p.replace(/\[date\]/g, "2026-10-28").replace(/\[[^\]]+\]/g, "1");
const routes = [...new Set(Object.values(manifest).filter((p) => !p.startsWith("/_")))].map((p) => ({ path: sample(p), isRoute: Object.keys(manifest).some((k) => manifest[k] === p && k.endsWith("/route")) })).sort((a, b) => a.path.localeCompare(b.path));
ok(`route list: read ${routes.length} routes from the production build (pages and route handlers)`, routes.length > 40 && routes.some((r) => r.path === "/today") && routes.some((r) => r.path === "/api/upload") && routes.some((r) => r.path === "/settings"));

try {
  await start(PORT, { ...BASE_ENV, LOGIN_FAIL_DELAY_MS: "0" });

  // ---- (a) no cookie: nothing is open --------------------------------------------------------------------------------------------
  const open = new Set(["/login", "/api/login", "/api/logout", "/manifest.webmanifest"]);
  const bad: string[] = [];
  const leaked: string[] = [];
  let asked = 0;
  for (const r of routes) {
    for (const m of ["GET", "POST"]) {
      const res = await call(URL, r.path, { method: m, headers: m === "POST" ? { "next-action": "0000000000000000000000000000000000000000" } : {} });
      asked++;
      if (leaks(res.body).length) leaked.push(`${m} ${r.path}: ${leaks(res.body)}`);
      if (open.has(r.path)) continue;
      const toLogin = res.status >= 300 && res.status < 400 && /\/login(\?|$)/.test(res.location ?? "");
      const refused = res.status === 401 || res.status === 403;
      if (!(m === "GET" ? toLogin || refused : refused)) bad.push(`${m} ${r.path} -> ${res.status} ${res.location ?? ""}`);
    }
  }
  ok(`(a) no cookie: every page and route (${routes.length}, GET and as a server-action POST = ${asked} requests) is a redirect to /login or 401; none answers with data`, bad.length === 0, bad.slice(0, 6).join(" | "));
  ok("(e) no answer to a request without a cookie contains farm data (flock names, money, sales words)", leaked.length === 0, leaked.slice(0, 4).join(" | "));
  const login0 = await call(URL, "/login");
  const pub = await Promise.all(["/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-192.png", "/favicon.ico"].map((p) => call(URL, p)));
  ok("public: the login screen loads; the PWA files are not behind the login (404 here only if the file does not exist yet), none is a redirect to /login", login0.status === 200 && /Log in/.test(login0.body) && pub.every((r) => !(r.status >= 300 && r.status < 400)));
  const tampered = signSession(owner, "an-attacker-secret-an-attacker-secret-0123");
  const exp = signSession({ ...owner, iat: 1, exp: 2 }, SECRET);
  const t1 = await call(URL, "/today", { cookie: `${SESSION_COOKIE}=${tampered}` });
  const t2 = await call(URL, "/today", { cookie: `${SESSION_COOKIE}=${exp}` });
  const t3 = await call(URL, "/today", { cookie: `${SESSION_COOKIE}=${signSession(owner, SECRET).slice(0, -4)}AAAA` });
  ok("(b) tampered cookie (wrong secret, altered signature) and expired cookie: redirected to /login, no data", [t1, t2, t3].every((r) => r.status === 307 && /\/login/.test(r.location ?? "") && leaks(r.body).length === 0));

  // ---- login: wrong, right ---------------------------------------------------------------------------------------------------------
  const wrong = await login(URL, "definitely-wrong");
  ok("(b) wrong password: back to /login with a short code, no session cookie, no hint, password not in the address", wrong.status === 303 && /\/login\?e=bad$/.test(wrong.location ?? "") && !cookieOf(wrong, SESSION_COOKIE) && !(wrong.location ?? "").includes("definitely"));
  const crossSite = await call(URL, "/api/login", { method: "POST", headers: { ...FORM, origin: "https://evil.example", "x-forwarded-for": freshIp() }, body: form({ password: OWNER_PW }) });
  ok("(b) a login form posted from another website is refused, even with the right password", crossSite.status === 303 && /e=origin/.test(crossSite.location ?? "") && !cookieOf(crossSite, SESSION_COOKIE));
  const good = await login(URL, OWNER_PW, freshIp(), undefined, { next: "/sales" });
  const ownerCookie = cookieOf(good, SESSION_COOKIE);
  const setCookie = good.setCookie.find((c) => c.startsWith(SESSION_COOKIE + "=")) ?? "";
  ok("(b) right password: redirected on to the page asked for; the cookie is HttpOnly, Secure, SameSite=Lax, 30 days; the answer is no-store", good.status === 303 && /\/sales$/.test(good.location ?? "") && !!ownerCookie && /httponly/i.test(setCookie) && /secure/i.test(setCookie) && /samesite=lax/i.test(setCookie) && /max-age=2592000/i.test(setCookie) && /no-store/.test(good.headers.get("cache-control") ?? ""), setCookie.replace(/=[^;]+/, "=<token>"));
  const evilNext = await login(URL, OWNER_PW, freshIp(), undefined, { next: "https://evil.example/x" });
  ok("(b) the 'go here after login' address cannot send you to another website", /\/today$/.test(evilNext.location ?? ""));
  const noKeep = await call(URL, "/api/login", { method: "POST", headers: { ...FORM, "x-forwarded-for": freshIp() }, body: form({ password: OWNER_PW }) });
  ok("(b) 'keep me logged in' off: the cookie is a session cookie (no Max-Age)", !/max-age/i.test(noKeep.setCookie.find((c) => c.startsWith(SESSION_COOKIE + "=")) ?? "x max-age"));

  // ---- (c) owner: sees everything ---------------------------------------------------------------------------------------------------
  const ownerBad: string[] = [];
  let ownerOk = 0;
  for (const r of routes) {
    if (r.path === "/api/weather" || r.path === "/api/login" || r.path === "/api/logout" || r.path === "/login") continue;
    const res = await call(URL, r.path, { cookie: ownerCookie, headers: r.path === "/api/upload" ? {} : {} });
    if (res.status === 401 || res.status === 403 || /\/login|\/upload$/.test(res.location ?? "")) ownerBad.push(`${r.path} -> ${res.status} ${res.location ?? ""}`);
    else ownerOk++;
    if (res.status < 400 && !/no-store/.test(res.headers.get("cache-control") ?? "") && !r.isRoute) ownerBad.push(`${r.path}: not no-store (${res.headers.get("cache-control")})`);
  }
  ok(`(c) owner cookie: ${ownerOk} routes open (nothing is refused or sent to the login), every authenticated answer is Cache-Control: no-store`, ownerBad.length === 0 && ownerOk > 40, ownerBad.slice(0, 5).join(" | "));
  const sec = await call(URL, "/upload/single", { cookie: ownerCookie });
  ok("V12 security headers are still there on authenticated pages", sec.headers.get("x-content-type-options") === "nosniff" && sec.headers.get("x-frame-options") === "SAMEORIGIN" && !!sec.headers.get("referrer-policy"));

  // ---- (b) staff -----------------------------------------------------------------------------------------------------------------------
  const sl = await login(URL, STAFF_PIN);
  const staffCookie = cookieOf(sl, SESSION_COOKIE);
  ok("(b) staff PIN: logs in and is sent to /upload (not /today), even if another page was asked for", sl.status === 303 && /\/upload$/.test(sl.location ?? "") && !!staffCookie);
  const sl2 = await login(URL, STAFF_PIN, freshIp(), undefined, { next: "/settings" });
  ok("(b) staff cannot be sent to an owner page through the 'next' address", /\/upload$/.test(sl2.location ?? ""));
  const allowedGet = new Set(STAFF_ALLOWED.filter((a) => a.methods.includes("GET")).map((a) => a.path));
  const staffBad: string[] = [];
  const staffLeaks: string[] = [];
  let staffRefused = 0;
  for (const r of routes) {
    if (["/api/login", "/api/logout", "/login", "/api/weather"].includes(r.path)) continue;
    for (const m of ["GET", "POST"]) {
      const res = await call(URL, r.path, { method: m, cookie: staffCookie, headers: m === "POST" ? { "next-action": "0000000000000000000000000000000000000000" } : {} });
      const mayGet = m === "GET" && allowedGet.has(r.path);
      const mayPost = m === "POST" && r.path === "/api/upload" ;
      if (mayGet) {
        if (res.status !== 200) staffBad.push(`${m} ${r.path} should open but -> ${res.status}`);
        if (leaks(res.body).length) staffLeaks.push(`${m} ${r.path}: ${leaks(res.body)}`);
        continue;
      }
      if (mayPost) continue; // checked below with a real upload
      staffRefused++;
      const api = r.isRoute || m === "POST";
      const goodAnswer = api ? res.status === 403 : res.status === 307 && /\/upload$/.test(res.location ?? "");
      if (!goodAnswer) staffBad.push(`${m} ${r.path} -> ${res.status} ${res.location ?? ""}`);
      if (leaks(res.body).length) staffLeaks.push(`${m} ${r.path}: ${leaks(res.body)}`);
    }
  }
  ok(`(b) staff: the 3 allowed pages open; every other route and server action (${staffRefused} requests) is a redirect to /upload (pages) or 403 (routes and actions)`, staffBad.length === 0 && staffRefused > 80, staffBad.slice(0, 6).join(" | "));
  ok("(b) staff: no answer, allowed or refused, contains farm data (no flock names, money or sales words)", staffLeaks.length === 0, staffLeaks.slice(0, 4).join(" | "));
  const up = await call(URL, "/upload", { cookie: staffCookie });
  ok("(b) staff Upload page: a date and a photo picker; no menu, no queue, no flock list", up.status === 200 && /Upload register photos/.test(up.body) && !/Analytics|Flocks|Sales|queue|waiting|saved/i.test(up.body.replace(/<script[\s\S]*?<\/script>/g, "")));
  const noFile = await call(URL, "/api/upload", { method: "POST", cookie: staffCookie, body: (() => { const f = new FormData(); f.set("date", "2026-10-28"); return f; })() });
  const notPic = await call(URL, "/api/upload", { method: "POST", cookie: staffCookie, body: (() => { const f = new FormData(); f.set("date", "2026-10-28"); f.set("photo", new File(["not a picture"], "x.pdf", { type: "application/pdf" })); return f; })() });
  const future = await call(URL, "/api/upload", { method: "POST", cookie: staffCookie, body: (() => { const f = new FormData(); f.set("date", "2099-01-01"); f.set("photo", new File([new Uint8Array([255, 216, 255])], "x.jpg", { type: "image/jpeg" })); return f; })() });
  ok("(b) staff upload route: no photo, a PDF and a future date are refused with a short plain message and no farm data", [noFile, notPic, future].every((r) => r.status === 400 && /"ok":false/.test(r.body) && r.body.length < 200 && leaks(r.body).length === 0), [noFile.body, notPic.body, future.body].join(" "));
  const noCookieUpload = await call(URL, "/api/upload", { method: "POST", body: new FormData() });
  ok("(a) the upload route without a login is 401", noCookieUpload.status === 401);
  // staff session ended by the owner ("Log out all staff phones") or by a changed PIN hash is covered in part 1 (cookie fingerprint) and below
  const pool = new pg.Pool({ connectionString: dbUrl, max: 1 });
  try {
    await pool.query(`UPDATE auth_state SET int_value = int_value + 1 WHERE key = 'staff_session_version'`);
    const afterBump = await call(URL, "/upload", { cookie: staffCookie });
    const sentToLogin = (afterBump.status === 307 && /\/login/.test(afterBump.location ?? "")) || (afterBump.status === 200 && /\/login\?e=expired/.test(afterBump.body));
    ok("(b) 'Log out all staff phones': the staff cookie stops working at once (sent back to the login, no upload page shown), the owner cookie still works", sentToLogin && !/Take or choose photos/.test(afterBump.body) && (await call(URL, "/settings", { cookie: ownerCookie })).status === 200, `${afterBump.status} ${afterBump.location}`);
    await pool.query(`UPDATE auth_state SET int_value = int_value - 1 WHERE key = 'staff_session_version'`);
  } catch (e) {
    ok("(b) 'Log out all staff phones' test could run (migration 0048 applied to the database)", false, String(e));
  }

  // ---- (d) the weather job -------------------------------------------------------------------------------------------------------------
  const c0 = await call(URL, "/api/weather");
  const c1 = await call(URL, "/api/weather", { headers: { authorization: "Bearer wrong" } });
  const c2 = await call(URL, "/api/weather", { cookie: ownerCookie });
  const c3 = await call(URL, "/api/weather", { headers: { authorization: `Bearer ${CRON}` } });
  ok("(d) weather job: no header, a wrong secret, and an owner login cookie are all 401; the right 'Bearer <CRON_SECRET>' is accepted", c0.status === 401 && c1.status === 401 && c2.status === 401 && c3.status === 200, `${c0.status} ${c1.status} ${c2.status} ${c3.status}`);

  // ---- (e) logout --------------------------------------------------------------------------------------------------------------------------
  const lo = await call(URL, "/api/logout", { method: "POST", cookie: ownerCookie });
  const cleared = lo.setCookie.find((c) => c.startsWith(SESSION_COOKIE + "="));
  const afterLogout = await call(URL, "/today", { cookie: cleared ? cleared.split(";")[0] : undefined });
  ok("(d) logout: the answer clears the cookie (empty, Max-Age 0) and goes to /login; with that cookie state /today is closed again", lo.status === 303 && /\/login/.test(lo.location ?? "") && !!cleared && /max-age=0/i.test(cleared) && afterLogout.status === 307, `${lo.status} ${cleared}`);
  const getLogout = await call(URL, "/api/logout");
  ok("logout is a POST: a plain link to it does nothing", getLogout.status === 405);

  // ---- (f) lock-outs over HTTP ---------------------------------------------------------------------------------------------------------------
  const ipL = freshIp();
  const tries: string[] = [];
  for (let i = 0; i < 5; i++) tries.push((await login(URL, "bad-guess-" + i, ipL)).location ?? "");
  const sixth = await login(URL, OWNER_PW, ipL);
  const other = await login(URL, OWNER_PW, freshIp());
  ok("(b) lock-out over HTTP: 5 wrong tries, then even the right password from that address says 'wait 15 minutes'; another address still gets in", tries.every((l) => /e=bad/.test(l)) && /e=locked/.test(sixth.location ?? "") && !cookieOf(sixth, SESSION_COOKIE) && other.status === 303 && !!cookieOf(other, SESSION_COOKIE), `${tries.join(",")} | ${sixth.location}`);
  const fid = "browser-" + rnd();
  for (let i = 0; i < 5; i++) await login(URL, "bad-guess-" + i, freshIp(), fid);
  const sameBrowser = await login(URL, OWNER_PW, freshIp(), fid);
  ok("(b) lock-out is also per browser: the same cookie from a brand-new address is locked", /e=locked/.test(sameBrowser.location ?? ""));
  const locked = await call(URL, "/login?e=locked");
  const banner = (locked.body.match(/class="error-banner"[^>]*>([^<]*)</) ?? [])[1] ?? "";
  ok("(b) the locked message is plain and says nothing about how close a guess was", banner === "Too many tries, wait 15 minutes." && !/close|almost|nearly|correct/i.test(banner), banner);
  for (let i = 0; i < PIN_FARM_LIMIT; i++) await login(URL, wrongPin(i), freshIp(), "pf" + i);
  const pinPaused = await login(URL, STAFF_PIN, freshIp());
  const ownerStill = await login(URL, OWNER_PW, freshIp());
  const pausedPage = await call(URL, "/login?e=paused");
  ok("(b) PIN farm-wide limit over HTTP: after 20 wrong PINs from 20 places the right PIN is paused ('Too many tries. Ask the owner.'); the owner password still works", /e=paused/.test(pinPaused.location ?? "") && ownerStill.status === 303 && !!cookieOf(ownerStill, SESSION_COOKIE) && /Too many tries\. Ask the owner\./.test(pausedPage.body), `${pinPaused.location} | ${ownerStill.status}`);
  const log = await pool.query(`SELECT role_tried, ok, blocked, ip_hash FROM login_attempts WHERE attempted_at >= $1`, [startedAt]).catch(() => null);
  ok("every login try was written to login_attempts (successes, wrong tries, blocked tries) with hashed addresses and no secrets", !!log && log.rows.length > 40 && log.rows.some((r) => r.ok) && log.rows.some((r) => r.blocked) && log.rows.some((r) => r.role_tried === "staff") && log.rows.every((r) => /^[0-9a-f]{24}$/.test(r.ip_hash)), String(log?.rows.length));
  await pool.query(`DELETE FROM login_attempts WHERE attempted_at >= $1`, [startedAt]).catch(() => null);
  await pool.end();

  // ---- (g) a server with NO login settings stays closed ---------------------------------------------------------------------------------------
  const PORT2 = 3198;
  const URL2 = `http://localhost:${PORT2}`;
  await start(PORT2, { LOGIN_DISABLED_FOR_DEV: "1" }); // the developer switch must be ignored by a production build
  const closed: string[] = [];
  const closedLeaks: string[] = [];
  for (const r of routes) {
    if (["/login", "/api/login", "/api/logout", "/manifest.webmanifest"].includes(r.path)) continue;
    for (const m of ["GET", "POST"]) {
      const res = await call(URL2, r.path, { method: m, headers: m === "POST" ? { "next-action": "0000000000000000000000000000000000000000" } : {} });
      const page = m === "GET" && !r.isRoute && !isApiLike(r.path, m, null);
      if (!(page ? res.status === 503 && /Login is not set up yet/.test(res.body) : res.status === 503 || res.status === 401)) closed.push(`${m} ${r.path} -> ${res.status}`);
      if (leaks(res.body).length) closedLeaks.push(`${m} ${r.path}`);
    }
  }
  ok("(b) missing login settings fail CLOSED: every page says 'Login is not set up yet' (503), every other route is 503/401, even with LOGIN_DISABLED_FOR_DEV=1 set on a production build", closed.length === 0 && closedLeaks.length === 0, closed.slice(0, 5).join(" | ") + closedLeaks.slice(0, 3).join(" | "));
  const noLogin = await login(URL2, OWNER_PW);
  ok("(b) with no settings, the login itself refuses everything ('not set up'), no cookie is given", noLogin.status === 303 && /e=setup/.test(noLogin.location ?? "") && !cookieOf(noLogin, SESSION_COOKIE));
  const cronClosed = await call(URL2, "/api/weather", { headers: { authorization: `Bearer ${CRON}` } });
  ok("(d) with no CRON_SECRET set the weather job is closed (503), not open", cronClosed.status === 503);
} catch (e) {
  ok("the real-server tests ran to the end", false, e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" ") : String(e));
} finally {
  stopAll();
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
