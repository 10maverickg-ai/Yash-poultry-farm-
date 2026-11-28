// V20: the phone bottom bar stays at the bottom of the screen on every page.   npx tsx scripts/layout-check.mts [base-url]
// Needs the app running (default http://localhost:3111; e.g. `npx next start -p 3111`) and Playwright's Chromium.
// ENGINE=webkit runs the same in WebKit (iPhone Safari's engine) when it is installed. TEXT=100,125 checks bigger text too.
//
// For every page at 360 and 390 px (iPhone sizes, iPhone user agent) it fails when:
//   - the page is wider than the screen (documentElement.scrollWidth > clientWidth), naming what sticks out — on iPhone
//     Safari that widens the layout viewport and drags the fixed bar into the middle of the screen;
//   - the bar's bottom edge is not the screen's bottom edge (at the top, after scrolling to the middle and to the end);
//   - the bar is wider than the screen, an item is narrower than 44 px, or a label is cut ("Analytics" at 360 px);
//   - the bar sits inside a parent with a transform / filter / contain / will-change / clipped overflow;
//   - the last thing on the page is hidden under the bar when scrolled to the end;
//   - a text field's font is under 16 px (iPhone Safari zooms in when it is tapped, and the bar is then off the bottom);
//   - the page errors.
// It also opens the Share / Download menu and a Feed formulas card (the ingredient table) and checks again.
/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is loaded at run time, untyped here */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BASE = process.argv[2] ?? process.env.BASE ?? "http://localhost:3111";
const ENGINE = process.env.ENGINE ?? "chromium";
const WIDTHS = (process.env.WIDTHS ?? "360,390").split(",").map(Number);
const TEXT = (process.env.TEXT ?? "100").split(",").map(Number);

let pw: any;
try { pw = require("playwright"); } catch { console.log("SKIP  Playwright is not installed here: the layout check did not run"); process.exit(0); }
try { const r = await fetch(BASE + "/today"); if (!r.ok) throw new Error(String(r.status)); } catch (e) { console.log(`SKIP  the app is not running at ${BASE} (${(e as Error).message}): start it, then run this check`); process.exit(0); }

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };

// every page of the app; pages that need an id take the first one linked from their list page
const STATIC = ["/", "/today", "/analytics", "/analytics?view=week", "/analytics?view=month", "/analytics?view=year", "/analytics?view=custom", "/analytics/compare", "/analytics/reference", "/analytics/targets",
  "/admin/reader-benchmark", "/changes", "/chick-batches", "/day", "/day/enter", "/egg-stock", "/export", "/export/backup", "/feed-bag-stock", "/feed-formulas", "/feed-stock", "/flagged", "/flocks", "/flocks/batches",
  "/flocks/moulting", "/flocks/new", "/flocks/renumber", "/formulation", "/import", "/knowledge", "/medicines", "/medicines/chicks", "/medicines/flocks", "/medicines/import", "/medicines/list", "/production",
  "/purchases", "/records", "/sales", "/sales/rates", "/sales/reprice", "/settings", "/sheds", "/upload", "/upload/single"];
const DYNAMIC: [string, RegExp][] = [["/flocks", /^\/flocks\/[0-9a-f-]{36}$/], ["/knowledge", /^\/knowledge\/\d+$/], ["/medicines", /^\/medicines\/line\/\d+$/], ["/medicines/list", /^\/medicines\/list\/\d+$/], ["/sales", /^\/sales\/\d+$/]];

// in-page code as plain JavaScript text (the TypeScript runner adds helpers that do not exist inside the page)
const MEASURE = `(() => {
  const W = document.documentElement.clientWidth;
  const closed = (e) => { const d = e.closest("details:not([open])"); return !!d && !e.closest("summary"); }; // inside a folded section: laid out, never shown
  const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0 && !closed(e); };
  const contained = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { if (getComputedStyle(a).overflowX !== "visible") { const r = a.getBoundingClientRect(); return r.right <= W + 0.5; } } return false; };
  const out = [];
  for (const e of document.querySelectorAll("body *")) {
    if (!vis(e) || getComputedStyle(e).position === "fixed") continue;
    const r = e.getBoundingClientRect();
    if (r.right > W + 0.5 && r.left < W && !contained(e) && !out.some((o) => o.el.contains(e))) out.push({ el: e, d: e.tagName.toLowerCase() + "." + String(e.className || "").slice(0, 30) + " right=" + Math.round(r.right) + ' "' + (e.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 50) + '"' });
  }
  const bar = document.querySelector(".bottom-nav");
  const shown = bar && getComputedStyle(bar).display !== "none";
  const br = bar ? bar.getBoundingClientRect() : null;
  const badParent = [];
  for (let a = bar ? bar.parentElement : null; a; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.transform !== "none" || s.filter !== "none" || (s.contain && s.contain !== "none") || (s.willChange && s.willChange !== "auto") || (a !== document.body && a !== document.documentElement && (s.overflowX !== "visible" || s.overflowY !== "visible"))) badParent.push(a.tagName.toLowerCase() + "." + a.className);
  }
  const items = bar ? [...bar.querySelectorAll("a")].map((a) => { const l = a.querySelector(".bn-label"); return { t: l.textContent || "", w: a.getBoundingClientRect().width, cut: l.scrollWidth > l.clientWidth + 0.5 }; }) : [];
  const kids = [...document.querySelectorAll("main *")].filter((e) => vis(e) && getComputedStyle(e).position !== "fixed");
  const lastBottom = kids.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
  const smallFields = [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea")].filter((e) => vis(e) && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.tagName.toLowerCase() + "[" + (e.name || e.type) + "] " + getComputedStyle(e).fontSize);
  return {
    W, innerW: innerWidth, innerH: innerHeight, overflow: document.documentElement.scrollWidth - W, offenders: out.map((o) => o.d).slice(0, 4),
    bar: shown && br ? { bottom: br.bottom, width: br.width, top: br.top, parentIsBody: bar.parentElement === document.body } : null,
    badParent, items, lastBottom, atEnd: Math.abs(scrollY + innerHeight - document.documentElement.scrollHeight) < 2, smallFields,
  };
})()`;
const SCROLL = (where: string) => `window.scrollTo(0, ${where === "top" ? "0" : where === "middle" ? "document.documentElement.scrollHeight / 2" : "document.documentElement.scrollHeight"})`;

const b = await pw[ENGINE].launch();
const check = async (p: any, label: string, w: number) => {
  const pos: any[] = [];
  for (const where of ["top", "middle", "end"]) {
    await p.evaluate(SCROLL(where));
    await p.waitForTimeout(120);
    pos.push(await p.evaluate(MEASURE));
  }
  const [t, , e] = pos;
  const problems: string[] = [];
  const text = Number(/text (\d+)%/.exec(label)?.[1] ?? 100);
  if (t.overflow > 0 || t.offenders.length) problems.push(`page ${t.overflow}px wider than the screen: ${t.offenders.join(" ; ")}`);
  if (t.innerW !== w) problems.push(`layout viewport widened to ${t.innerW}px`);
  if (!t.bar) problems.push("no bottom bar shown");
  else {
    const off = pos.filter((m) => !m.bar || Math.abs(m.bar.bottom - m.innerH) > 1);
    if (off.length) problems.push(`bar bottom ${pos.map((m) => (m.bar ? Math.round(m.bar.bottom) : "-")).join("/")} vs screen ${t.innerH}`);
    if (t.bar.width > w + 0.5) problems.push(`bar ${Math.round(t.bar.width)}px wide`);
    if (!t.bar.parentIsBody || t.badParent.length) problems.push(`bar inside ${t.badParent.join(", ") || "something other than <body>"}`);
    const narrow = t.items.filter((i: any) => i.w < 44 - 0.5);
    if (narrow.length) problems.push(`bar items under 44px: ${narrow.map((i: any) => `${i.t} ${Math.round(i.w)}`).join(", ")}`);
    // at the phone's normal text size every label shows in full; with bigger text a label may end in "…" (it never widens the bar)
    const cut = t.items.filter((i: any) => i.cut);
    if (cut.length && text === 100) problems.push(`labels cut: ${cut.map((i: any) => i.t).join(", ")}`);
    if (e.atEnd && e.lastBottom > e.bar.top + 1) problems.push(`the end of the page (${Math.round(e.lastBottom)}) is under the bar (top ${Math.round(e.bar.top)})`);
  }
  if (t.smallFields.length) problems.push(`fields under 16px (iPhone zooms in when tapped): ${t.smallFields.slice(0, 3).join(", ")}`);
  ok(`${ENGINE} ${label}`, problems.length === 0, problems.join(" | "));
};

let pages = 0;
for (const w of WIDTHS) {
  for (const text of TEXT) {
    const dev = pw.devices["iPhone 13"];
    const ctx = await b.newContext({ ...dev, viewport: { width: w, height: dev.viewport.height } });
    const p = await ctx.newPage();
    const errs: string[] = [];
    p.on("pageerror", (e: Error) => errs.push(e.message.slice(0, 100)));
    const open = async (path: string) => {
      const r = await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
      if (text !== 100) { await p.addStyleTag({ content: `html { font-size: ${(16 * text) / 100}px !important }` }); await p.waitForTimeout(150); }
      return r?.status() ?? 0;
    };
    const list = [...STATIC];
    for (const [from, re] of DYNAMIC) {
      await open(from);
      const hrefs: string[] = await p.evaluate(`[...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "")`);
      const href = hrefs.find((h) => re.test(h.split("?")[0]));
      if (href) list.push(href);
    }
    for (const path of list) {
      errs.length = 0;
      const status = await open(path);
      pages++;
      if (status !== 200) { ok(`${ENGINE} ${w}px text ${text}% ${path}`, false, `status ${status}`); continue; }
      await check(p, `${w}px text ${text}% ${path}`, w);
      if (errs.length) ok(`${ENGINE} ${w}px text ${text}% ${path}: no page errors`, false, errs.join(" | "));
    }
    // the Share / Download menu open, on the Analytics board
    await open("/analytics");
    const sum = p.locator("details.sh-menu > summary").first();
    if (await sum.count()) { await sum.click(); await p.waitForTimeout(150); await check(p, `${w}px text ${text}% /analytics with Share / Download open`, w); }
    else ok(`${ENGINE} ${w}px /analytics has a Share / Download menu`, false);
    // Feed formulas: one card opened (ingredient table), then a second card tapped open too
    await open("/feed-formulas");
    const cards = p.locator("details.ff-card > summary");
    if ((await cards.count()) >= 2) { await cards.nth(0).click(); await cards.nth(1).click(); await p.waitForTimeout(150); await check(p, `${w}px text ${text}% /feed-formulas with two ingredient tables open`, w); }
    await ctx.close();
  }
}
await b.close();
console.log(`${pages} page loads`);
process.exit(bad ? 1 : 0);
