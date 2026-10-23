import Link from "next/link";
import { loadEngineInput } from "@/lib/analytics/load";
import { addDays, alertsFor, buildCtx, eggStockDays, feedDaysLeft, flockCards, lastDayOfData, type CardStatus } from "@/lib/analytics/engine";
import { loadCostInput } from "@/lib/costs/load";
import { dayEconomics } from "@/lib/costs/engine";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

export const dynamic = "force-dynamic";

const n0 = (x: number) => Math.round(x).toLocaleString("en-IN");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-IN");
const pretty = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const DOT: Record<CardStatus, string> = {
  green: "var(--an-green)", amber: "var(--an-amber)", red: "var(--an-red)", moult: "var(--an-blue)", no_reference: "var(--muted)", left: "var(--muted)",
};
const WORD: Record<CardStatus, string> = {
  green: "On standard", amber: "Below standard", red: "Well below", moult: "Moulting", no_reference: "No reference", left: "Left",
};

export default async function TodayPage() {
  const [input, costInput] = await Promise.all([loadEngineInput(), loadCostInput()]);
  const ctx = buildCtx(input);
  if (ctx.dates.length === 0) return (<><h1>Today</h1><p className="card muted">No Daily Production rows yet. <Link href="/upload">Upload a photo</Link></p></>);

  const latest = lastDayOfData(ctx);
  const realToday = new Date().toISOString().slice(0, 10);
  const realYesterday = addDays(realToday, -1);
  const stale = Math.round((Date.parse(realYesterday) - Date.parse(latest)) / 86400000);

  const cards = flockCards(ctx, latest).filter((c) => c.status !== "left");
  const alerts = alertsFor(ctx, latest);
  const feed = feedDaysLeft(ctx, latest);
  const stock = eggStockDays(ctx, latest);
  const money = dayEconomics(costInput, latest);

  // What is missing: only facts that can be checked from the database.
  const [photoQ, queueQ, rateQ] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM daily_production WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`, [ACTIVE_FARM, realYesterday]),
    pool.query(`SELECT count(*)::int AS n FROM upload_queue WHERE farm_code = $1 AND entered_date = $2 AND status IN ('waiting','reading','saved','needs_review')`, [ACTIVE_FARM, realYesterday]),
    pool.query(`SELECT count(*)::int AS n FROM daily_egg_rates WHERE date = $1`, [realYesterday]),
  ]);
  const missing: { text: string; href: string; cta: string }[] = [];
  if (photoQ.rows[0].n === 0 && queueQ.rows[0].n === 0) missing.push({ text: `No register photo has been uploaded for ${pretty(realYesterday)}.`, href: "/upload", cta: "Upload photos" });
  else if (photoQ.rows[0].n === 0) missing.push({ text: `Photos for ${pretty(realYesterday)} are uploaded but not saved yet.`, href: "/upload", cta: "Open the queue" });
  if (rateQ.rows[0].n === 0) missing.push({ text: `No BAFTA rate entered for ${pretty(realYesterday)}.`, href: "/sales/rates", cta: "Enter the rate" });
  if (money.unpricedEggsSold > 0) missing.push({ text: `${n0(money.unpricedEggsSold)} eggs sold on ${pretty(latest)} have no rate, so revenue is left out.`, href: "/sales/rates", cta: "Enter the rate" });
  if (money.missing.length) missing.push({ text: `Cost is incomplete: ${money.missing.join(", ")}.`, href: "/purchases", cta: "Complete the month" });

  return (
    <>
      <h1>Today</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Latest day with data: <strong>{pretty(latest)}</strong>
        {stale > 0 ? ` — ${stale} day${stale === 1 ? "" : "s"} behind yesterday, nothing newer has been entered.` : "."}
      </p>

      <section className="card" aria-labelledby="td-flocks">
        <h2 id="td-flocks" style={{ marginTop: 0 }}>Eggs and hen-day % by flock</h2>
        {cards.map((c) => {
          const row = (ctx.byFlock.get(c.flockId) ?? []).find((r) => r.date === latest);
          return (
            <div key={c.flockId} className="td-flock">
              <span className="td-dot" style={{ background: DOT[c.status] }} aria-hidden="true" />
              <div>
                <b>{c.label}</b>{" "}
                <span className="muted">
                  {row ? `${n0(row.eggs ?? 0)} eggs · ${row.hd != null ? n1(row.hd) + "%" : "HD –"}` : "no row that day"}
                  {c.stdHd != null ? ` · standard ${n1(c.stdHd)}%` : ""}
                </span>
                <div className="muted an-tiny"><b>{WORD[c.status]}.</b> {c.statusNote}</div>
              </div>
            </div>
          );
        })}
        <p className="muted an-foot"><Link href="/analytics">Full board →</Link></p>
      </section>

      <section aria-labelledby="td-alerts">
        <h2 id="td-alerts">Open alerts <span className="badge badge-flagged">{alerts.length}</span></h2>
        {alerts.length === 0 && <p className="card muted">Nothing to alert on.</p>}
        {alerts.slice(0, 5).map((a) => (
          <details key={a.key} className="card td-alert">
            <summary><b>{a.flockLabel ?? "Farm"}</b> — {a.reason.length > 90 ? a.reason.slice(0, 87).trimEnd() + "…" : a.reason}</summary>
            <p style={{ margin: "0.4rem 0" }}>{a.reason}</p>
            <Link href={`/analytics?date=${a.date}`}>Open on the board →</Link>
          </details>
        ))}
        {alerts.length > 5 && <p className="muted"><Link href={`/analytics?date=${latest}`}>{alerts.length - 5} more on the board →</Link></p>}
      </section>

      <section className="card" aria-labelledby="td-stock">
        <h2 id="td-stock" style={{ marginTop: 0 }}>Stock</h2>
        <div className="an-grid">
          <div className="an-metric"><div className="an-metric-title">Feed left</div><div className="an-metric-value">{feed ? `${n1(feed.days)} days` : "–"}</div><div className="an-metric-cmp">{feed ? `${n0(feed.closing)} bags` : "no feed box row"}</div></div>
          <div className="an-metric"><div className="an-metric-title">Egg stock</div><div className="an-metric-value">{stock ? `${n1(stock.days)} days` : "–"}</div><div className="an-metric-cmp">{stock ? `${n0(stock.closing)} eggs` : "no ledger row"}</div></div>
        </div>
      </section>

      <section className="card" aria-labelledby="td-cash">
        <h2 id="td-cash" style={{ marginTop: 0 }}>Cash — {pretty(latest)} <span className="badge badge-flagged">estimate</span></h2>
        <div className="an-grid">
          <div className="an-metric"><div className="an-metric-title">Revenue</div><div className="an-metric-value">{money.revenue ? `₹${n0(money.revenue)}` : "—"}</div><div className="an-metric-cmp">{n0(money.eggsSold)} eggs sold</div></div>
          <div className="an-metric"><div className="an-metric-title">Cost{money.missing.length ? " (incomplete)" : ""}</div><div className="an-metric-value">₹{n0(money.cost.total)}</div></div>
        </div>
      </section>

      <section aria-labelledby="td-missing">
        <h2 id="td-missing">What is missing <span className="badge badge-flagged">{missing.length}</span></h2>
        {missing.length === 0 && <p className="card muted">Nothing is missing.</p>}
        {missing.map((m, i) => (
          <div key={i} className="card td-miss"><span>{m.text}</span><Link href={m.href} className="btn btn-secondary">{m.cta}</Link></div>
        ))}
      </section>
    </>
  );
}
