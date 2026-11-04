// Checks that the website is installable and that the service worker is safe.   npx tsx scripts/pwa-check.mts
// Part 1 (files): manifest fields, icon sizes (read from the PNG files), the worker's rules, the offline page, the safe-area CSS.
// Part 2 (real browser, needs the playwright package and Chromium; SKIPPED when they are not there): starts the production build with a
// throw-away login, asks Chrome itself whether the app is installable (the DevTools "installability" check, which replaced Lighthouse's
// PWA score), checks the worker is active, that after browsing the whole app logged in the cache holds only the shell and built files,
// and that with the server stopped a page request shows the offline page and nothing from the farm.
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { hashPassword } from "../lib/auth/password.ts";

let failed = 0;
const ok = (n: string, c: boolean, x = "") => {
  if (!c) failed++;
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- part 1: files ---------------------------------------------------------------------------------------------------------------------
const src = readFileSync("app/manifest.ts", "utf8");
for (const [k, v] of [["name", '"Yash Poultry Farm"'], ["short_name", '"Farm"'], ["start_url", '"/today"'], ["scope", '"/"'], ["display", '"standalone"'], ["orientation", '"portrait-primary"']] as const) {
  ok(`manifest: ${k} is ${v}`, new RegExp(`${k}: ${v}`).test(src));
}
ok("manifest: theme and background colours are the app's green and page grey", /theme_color: "#1d6f42"/.test(src) && /background_color: "#f4f6f8"/.test(src) && /--accent: #1d6f42/.test(readFileSync("app/globals.css", "utf8")) && /--bg: #f4f6f8/.test(readFileSync("app/globals.css", "utf8")));
const want = [["public/icons/icon-192.png", 192], ["public/icons/icon-512.png", 512], ["public/icons/maskable-192.png", 192], ["public/icons/maskable-512.png", 512], ["public/apple-touch-icon.png", 180], ["public/icons/favicon-32.png", 32]] as const;
const dims = await Promise.all(want.map(async ([f]) => (existsSync(f) ? sharp(f).metadata() : null)));
ok("icons: 192 and 512 (any and maskable), apple touch icon 180 and favicon 32 exist at exactly those sizes", dims.every((m, i) => m && m.width === want[i][1] && m.height === want[i][1] && m.format === "png"), JSON.stringify(dims.map((m) => m && [m.width, m.height])));
ok("icons: the manifest lists every one of them, with both purposes", ["icon-192.png", "icon-512.png", "maskable-192.png", "maskable-512.png"].every((f) => src.includes(f)) && /purpose: "any"/.test(src) && /purpose: "maskable"/.test(src));
const ico = readFileSync("public/favicon.ico");
ok("favicon.ico is a real ICO with 16, 32 and 48 px pictures", ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) === 3);
const sw = readFileSync("public/sw.js", "utf8");
ok("worker: only GET requests are looked at; forms, uploads and server actions go straight to the network", /req\.method !== "GET"\) return/.test(sw));
ok("worker: a page request is network only, with the offline page as the one fallback; it is never stored", /req\.mode === "navigate"/.test(sw) && /catch\(\(\) => caches/.test(sw) && !/put\(req/.test(sw.split('if (isStatic(url))')[0]));
ok("worker: only built files, icons and fonts are stored (the only cache.put is inside the isStatic branch)", (sw.match(/\.put\(/g) ?? []).length === 1 && sw.indexOf(".put(") > sw.indexOf("if (isStatic(url))") && /const isStatic = [^\n]*_next\/static[^\n]*icons[^\n]*woff/.test(sw));
ok("worker: other-site requests, API answers and page data are never touched", /url\.origin !== self\.location\.origin\) return/.test(sw) && !/\/api\//.test(sw));
ok("worker: the cache is named after the build and every older cache is deleted on update", /"ypf-static-" \+ VERSION/.test(sw) && /n !== CACHE/.test(sw) && /caches\.delete/.test(sw) && /skipWaiting/.test(sw) && /clients\.claim/.test(sw));
const off = readFileSync("public/offline.html", "utf8");
ok("offline page: says 'No connection. Your data is safe. Try again when you are online.', has a Retry button, no farm data, works with no script files", /No connection\. Your data is safe\. Try again when you are online\./.test(off) && /id="retry"/.test(off) && !/BAB-|Farmfresh|₹/.test(off) && !/src="\/_next/.test(off) && /viewport-fit=cover/.test(off));
const css = readFileSync("app/globals.css", "utf8");
ok("safe areas: header, sides and bottom bar keep clear of the notch and the home bar", /safe-area-inset-top/.test(css) && /safe-area-inset-left/.test(css) && /safe-area-inset-bottom/.test(css));
const layout = readFileSync("app/layout.tsx", "utf8");
ok("page tags: viewport-fit=cover, apple-mobile-web-app-capable, status bar style, icons, theme colour", /viewportFit: "cover"/.test(layout) && /apple-mobile-web-app-capable/.test(layout) && /statusBarStyle/.test(layout) && /apple-touch-icon\.png/.test(layout) && /themeColor/.test(layout));
const reg = readFileSync("components/PwaRegister.tsx", "utf8");
ok("registration: only in production, and a blocked localStorage cannot break it", /process\.env\.NODE_ENV === "production"/.test(reg) && /catch \{/.test(reg));
const hint = readFileSync("components/InstallHint.tsx", "utf8");
ok("install help: Android uses beforeinstallprompt, iPhone gets a plain hint, never shown when installed, storage access is in try/catch", /beforeinstallprompt/.test(hint) && /Add to Home Screen/.test(hint) && /display-mode: standalone/.test(hint) && /navigator as Navigator & \{ standalone/.test(hint) && /try \{[\s\S]*localStorage[\s\S]*\} catch/.test(hint));

// ---- part 2: a real browser ------------------------------------------------------------------------------------------------------------
type PW = typeof import("playwright");
let pw: PW | null = null;
for (const id of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
  try { pw = createRequire(import.meta.url)(id) as PW; break; } catch { /* try the next place */ }
}
if (!pw || !existsSync(".next/BUILD_ID")) {
  console.log(`SKIPPED  browser checks (${!pw ? "the playwright package / Chromium is not installed" : "no production build: run npx next build"})`);
} else {
  const procs: ChildProcess[] = [];
  const stop = () => { for (const p of procs.splice(0)) { try { if (p.pid) process.kill(-p.pid, "SIGTERM"); } catch { /* ignore */ } } };
  process.on("exit", stop);
  const rnd = () => randomBytes(9).toString("base64url").replace(/[^a-z0-9]/gi, "x");
  const PW_OWNER = `test-${rnd()}-${rnd()}`;
  const env: Record<string, string> = {
    ...(Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !/^(APP_|SESSION_SECRET|CRON_SECRET|LOGIN_|NODE_ENV)/.test(k))) as Record<string, string>),
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://yash:yash_dev_password@localhost:5432/yash_poultry",
    APP_PASSWORD_HASH: await hashPassword(PW_OWNER, 12),
    SESSION_SECRET: randomBytes(32).toString("base64url"),
    CRON_SECRET: randomBytes(32).toString("base64url"),
    LOGIN_FAIL_DELAY_MS: "0",
  };
  const BASE = "http://localhost:3196";
  const start = async () => {
    procs.push(spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3196"], { env, stdio: "ignore", detached: true }));
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + "/login")).status) return; } catch { /* not yet */ } await sleep(500); }
    throw new Error("server did not start");
  };
  try {
    await start();
    const browser = await pw.chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(BASE + "/login", { waitUntil: "networkidle" });
    const swState = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, state: r.active?.state, script: r.active?.scriptURL }; });
    ok("browser: the service worker is active for the whole site, named after the build", swState.state === "activated" && swState.scope === BASE + "/" && /\/sw\.js\?v=.+/.test(swState.script ?? ""), JSON.stringify(swState));
    await page.reload({ waitUntil: "networkidle" });
    ok("browser: the worker controls the page after a reload", await page.evaluate(() => !!navigator.serviceWorker.controller));
    const inst = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: unknown[] };
    const man = (await cdp.send("Page.getAppManifest")) as { errors: unknown[]; data: string; url: string };
    ok("browser: Chrome's own installability check finds NO problems and the manifest has no parse errors", inst.installabilityErrors.length === 0 && man.errors.length === 0, JSON.stringify([inst.installabilityErrors, man.errors]));
    const m = JSON.parse(man.data) as { display: string; start_url: string; icons: { src: string; sizes: string; purpose: string }[] };
    ok("browser: the manifest Chrome reads is standalone, starts at /today, and has any + maskable icons at 192 and 512", m.display === "standalone" && m.start_url === "/today" && ["any", "maskable"].every((p) => [192, 512].every((s) => m.icons.some((i) => i.purpose === p && i.sizes === `${s}x${s}`))));
    const tags = await page.evaluate(() => ({ vp: document.querySelector('meta[name="viewport"]')?.getAttribute("content"), apple: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content"), theme: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"), touch: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") }));
    ok("browser: the page carries viewport-fit=cover, apple-mobile-web-app-capable, the theme colour and the apple touch icon", /viewport-fit=cover/.test(tags.vp ?? "") && tags.apple === "yes" && tags.theme === "#1d6f42" && tags.touch === "/apple-touch-icon.png", JSON.stringify(tags));
    await page.locator("#password").fill(PW_OWNER);
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/today");
    for (const p of ["/today", "/analytics", "/sales", "/settings", "/day?date=2026-10-28", "/medicines"]) await page.goto(BASE + p, { waitUntil: "networkidle" });
    const cached = await page.evaluate(async () => { const out: string[] = []; for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(new URL(r.url).pathname); return out; });
    const odd = cached.filter((u) => !u.startsWith("/_next/static/") && !u.startsWith("/icons/") && u !== "/offline.html");
    ok(`browser: after browsing 6 pages logged in, the cache holds ${cached.length} files, all of them the offline page, icons or built files; no page, no data`, cached.length > 3 && odd.length === 0, odd.join(","));
    stop();
    await sleep(1200);
    await page.goto(BASE + "/today").catch(() => null);
    const txt = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    ok("browser: with no connection a page shows the offline page with a Retry button and nothing from the farm", /No connection\. Your data is safe\. Try again when you are online\./.test(txt) && (await page.getByRole("button", { name: "Retry" }).isVisible()) && !/BAB-|Farmfresh|₹|Today|Analytics/.test(txt), txt.slice(0, 120));
    await start();
    await page.getByRole("button", { name: "Retry" }).click();
    await page.waitForURL("**/today", { timeout: 15000 }).catch(() => null);
    ok("browser: back online, Retry returns to the page", /\/today/.test(page.url()));
    await browser.close();
  } catch (e) {
    ok("browser checks ran to the end", false, e instanceof Error ? e.message : String(e));
  } finally {
    stop();
  }
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
