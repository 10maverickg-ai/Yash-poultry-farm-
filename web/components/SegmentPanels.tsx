import Link from "next/link";
import type { BoardEff } from "@/lib/analytics/feedEfficiency";
import { EffTrendChart } from "@/components/PeriodCharts";
import { SEGMENT_NAME, RAMP_DAYS, type Segment } from "@/lib/analytics/engine";
import type { SegmentPanel } from "@/lib/analytics/segments";
import type { FeedPair } from "@/lib/analytics/feed";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const span = (from: string | null, to: string | null) => (from && to ? (from === to ? dm(to) : `${dm(from)} – ${dm(to)}`) : "");

const n0 = (x: number) => Math.round(x).toLocaleString("en-IN");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-IN");
const inr = (x: number) => `₹${n0(x)}`;

const WHAT: Record<Segment, string> = {
  main: "Right page of the register: mature flocks, big eggs. Feed is recorded for this group (the one feed box covers these flocks).",
  young: `Left page: young flocks still climbing to peak, small eggs. Feed is shown on the days the register records it for this group. Each flock is "ramping up" for its first ${RAMP_DAYS} days of lay.`,
};

function Cell({ title, value, sub, words }: { title: string; value: string; sub?: string; words?: boolean }) {
  return (
    <div className="an-metric">
      <div className="an-metric-title">{title}</div>
      <div className={`an-metric-value${words ? " an-metric-words" : ""}`}>{value}</div>
      {sub && <div className="an-metric-cmp">{sub}</div>}
    </div>
  );
}

function trend(now: number | null, prev: number | null): string | undefined {
  if (now == null || prev == null) return undefined;
  const d = now - prev;
  return `${d >= 0 ? "▲ up" : "▼ down"} ${n1(Math.abs(d))} from the 7 days before`;
}

/**
 * Feed as two labelled tiles (V16): the board day's own bags and g/bird first, then the last 7 days (total, average a day,
 * average g/bird a day). A number never appears without its period; a missing figure says why, never a bare "–".
 */
export function FeedCells({ f, daysLeft, onDay = false }: { f: FeedPair; daysLeft?: number | null; onDay?: boolean }) {
  const d = f.day;
  const w = f.week;
  // the board says "today" (the board day); the Day screen names the date
  const dayTitle = onDay ? `Feed on ${dm(d.date)}` : `Feed today (${dm(d.date)})`;
  const dayWord = onDay ? "that day" : "today";
  if (w.daysRecorded === 0) {
    return <Cell title={dayTitle} value="feed not recorded" words sub={`the register has no feed figure for this group on ${dm(d.date)} or in the ${w.days > 1 ? `${w.days - 1} days before` : "days before"}`} />;
  }
  const stock = daysLeft != null ? `feed stock left: ${n1(daysLeft)} days` : "";
  return (
    <>
      <Cell
        title={dayTitle}
        value={d.recorded ? `${n0(d.bags!)} bags` : "feed not recorded"}
        words={!d.recorded}
        sub={[d.recorded ? (d.gPerBird != null ? `${n0(d.gPerBird)} g/bird ${dayWord}` : "") : `the register has no feed figure for this group on ${dm(d.date)}`, stock].filter(Boolean).join(" · ")}
      />
      <Cell
        title={`Feed, last 7 days (${span(w.from, w.to)})`}
        value={`${n0(w.bags!)} bags`}
        sub={`average ${n0(w.bagsPerDay!)} bags a day · ${w.gPerBird != null ? n0(w.gPerBird) : "–"} g/bird a day${w.daysRecorded < w.days ? ` · feed recorded on ${w.daysRecorded} of these ${w.days} days, averages over those only` : ""}`}
      />
    </>
  );
}

export function SegmentPanelView({ p, detailHref }: { p: SegmentPanel; detailHref?: string }) {
  const t = p.today;
  return (
    <section className={`card seg-panel seg-${p.segment}`} aria-label={SEGMENT_NAME[p.segment]}>
      <h2 style={{ marginTop: 0 }}>
        {detailHref ? <Link href={detailHref.split("#")[0]} className="plain-link">{SEGMENT_NAME[p.segment]} ›</Link> : SEGMENT_NAME[p.segment]}
        {p.ramping > 0 && <span className="an-pill an-pill-ramping" style={{ marginLeft: "0.5rem" }}>↗ {p.ramping} ramping up</span>}
      </h2>
      <p className="muted an-sub" style={{ marginTop: 0 }}>{WHAT[p.segment]}</p>
      {!t ? (
        <p className="muted">No rows for this group on this day.</p>
      ) : (
        <div className="an-grid seg-grid">
          <Cell title="Eggs per 100 birds (HD %), last 7 days" value={p.hd7 != null ? n1(p.hd7) : "–"} sub={trend(p.hd7, p.hdPrev7) ?? (t.hd != null ? `today ${n1(t.hd)}` : undefined)} />
          <Cell title="Eggs laid today" value={n0(t.eggs)} sub={p.eggsAvg7 != null ? `usual: ${n0(p.eggsAvg7)} a day` : undefined} />
          <Cell title="Birds" value={n0(t.birds)} sub={`${t.flocks} flock${t.flocks === 1 ? "" : "s"}`} />
          <Cell title="Deaths today" value={n0(t.mort)} sub={p.deathsPerDay7 != null ? `last 7 days: ${n1(p.deathsPerDay7)} a day on average · ${p.mortPct7 != null ? p.mortPct7.toFixed(2) : "–"}% of birds` : undefined} />
          <FeedCells f={p.feed.pair} daysLeft={p.feed.daysLeft} />
          <Cell title={p.segment === "main" ? "Big eggs in stock" : "Small eggs in stock"} value={p.stock ? `${n1(p.stock.days)} days` : "–"} sub={p.stock ? `${n0(p.stock.closing)} eggs` : "no ledger row"} />
          <EggsPerKgCell e={p.eff} />
          <HenHousedCell p={p} />
        </div>
      )}
      {t && p.effTrend.length > 0 && (
        <div className="eff-trend">
          <EffTrendChart points={p.effTrend} title={`Eggs per kg feed, last 30 days (${dayMon(p.effTrend[0].date)} – ${dayMon(p.effTrend[p.effTrend.length - 1].date)})`} />
          <p className="muted an-tiny" style={{ margin: 0 }}>A gap means the register has no feed figure that day. Higher is better: more eggs from each kg of feed.</p>
        </div>
      )}
      <p className="an-foot" style={{ marginBottom: 0 }}>
        <b>Eggs sold, last 7 days:</b> big eggs {inr(p.revenue.weekBig)} · small eggs {inr(p.revenue.weekSmall)}{p.revenue.day ? ` (${inr(p.revenue.day)} today)` : ""}.
        {p.revenue.unpricedEggsWeek > 0 ? ` ${n0(p.revenue.unpricedEggsWeek)} eggs unpriced.` : ""}
      </p>
      <div style={{ marginTop: "0.5rem" }}>
        <b>Alerts: {p.alerts.length}</b>
        {p.alerts.length > 0 && (
          <ul className="an-list">
            {p.alerts.slice(0, 3).map((a) => <li key={a.key}>{a.flockLabel ? <b>{a.flockLabel}: </b> : null}{a.reason}</li>)}
          </ul>
        )}
        {p.alerts.length > 3 && detailHref && <p className="muted an-tiny"><Link href={detailHref}>{p.alerts.length - 3} more →</Link></p>}
      </div>
    </section>
  );
}

export function FarmLine({ panels, eggs, birds, hd, unassigned, ok }: { panels: SegmentPanel[]; eggs: number; birds: number; hd: number | null; unassigned: number; ok: boolean }) {
  return (
    <p className="card muted an-sub" aria-label="Whole farm">
      <b>Whole farm</b> (sum of the groups above; it mixes mature and young birds, so its HD % is not a measure of either): {n0(eggs)} eggs · {n0(birds)} birds{hd != null ? ` · HD ${n1(hd)}%` : ""}.{" "}
      {ok ? "Check: groups add up to the farm total ✓." : unassigned > 0 ? `${unassigned} flock row${unassigned === 1 ? " has" : "s have"} no segment set, so the groups do not add up to the total — set it on the Flocks screen.` : "Check: groups do not add up to the farm total."}
      {panels.length === 0 ? "" : ""}
    </p>
  );
}

// ---- V17: eggs per kg of feed ------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMon = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const fromTo = (a: string | null, b: string | null) => (a && b ? (a === b ? dayMon(a) : `${dayMon(a)} – ${dayMon(b)}`) : "");
const n2 = (x: number) => x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Eggs per kg feed": the board day as the big number, then the last 7 days, each with its period in the words,
 * and an arrow + "better" / "worse" against the 7 days before (more eggs per kg = better); colour is never the only signal.
 */
export function EggsPerKgCell({ e }: { e: BoardEff }) {
  const d = e.day;
  const w = e.week;
  const c = e.change;
  if (w.eggsPerKg == null && d.eggsPerKg == null) {
    return (
      <div className="an-metric an-metric-wide">
        <div className="an-metric-title">Eggs per kg feed today ({dayMon(e.date)})</div>
        <div className="an-metric-value an-metric-words">feed not recorded</div>
        <div className="an-metric-cmp">the register has no feed figure for this group on {dayMon(e.date)} or in the days before, so eggs per kg cannot be worked out</div>
      </div>
    );
  }
  return (
    <div className="an-metric an-metric-wide">
      <div className="an-metric-title">Eggs per kg feed today ({dayMon(e.date)})</div>
      <div className={`an-metric-value${d.eggsPerKg == null ? " an-metric-words" : ""}`}>{d.eggsPerKg != null ? n2(d.eggsPerKg) : "feed not recorded"}</div>
      <div className="an-metric-cmp eff-lines">
        <span>{d.eggsPerKg != null ? `today: ${n1(d.kgPer100Eggs ?? 0)} kg feed per 100 eggs` : `no feed figure on ${dayMon(e.date)}`}</span>
        <span>
          7-day ({fromTo(w.from, w.to)}): <b>{w.eggsPerKg != null ? n2(w.eggsPerKg) : "–"}</b> eggs per kg{w.kgPer100Eggs != null ? ` · ${n1(w.kgPer100Eggs)} kg per 100 eggs` : ""}
          {w.daysWithFeed < w.days ? ` · ${w.daysWithFeed} of ${w.days} days with feed` : ""}
        </span>
        {c ? (
          <span className={c.good == null ? "" : c.good ? "pv-good" : "pv-bad"}>
            {c.abs > 0 ? "▲" : c.abs < 0 ? "▼" : "="} {c.abs >= 0 ? "+" : "−"}{n2(Math.abs(c.abs))} ({c.pct >= 0 ? "+" : "−"}{Math.abs(c.pct).toFixed(1)}%) vs the 7 days before ({fromTo(e.prevWeek.from, e.prevWeek.to)}){c.good == null ? " — no change" : c.good ? " — better" : " — worse"}
          </span>
        ) : (
          <span>no earlier 7 days with feed to compare</span>
        )}
      </div>
    </div>
  );
}

/**
 * V17 hen-housed % over the last 7 days next to the hen-day %: eggs ÷ hens housed (birds moved in or out counted,
 * deaths, culls and sales not), so the gap between the two is what deaths and sales cost. Stand-ins are named.
 */
export function HenHousedCell({ p }: { p: SegmentPanel }) {
  const h = p.hh;
  if (h.hhPct == null) return null;
  return (
    <div className="an-metric an-metric-wide">
      <div className="an-metric-title">Hen-housed %, last 7 days ({fromTo(h.from, h.to)})</div>
      <div className="an-metric-value">{n1(h.hhPct)}%</div>
      <div className="an-metric-cmp eff-lines">
        <span>eggs ÷ hens housed{p.hd7 != null ? ` · hen-day % for the same days: ${n1(p.hd7)} (eggs ÷ birds alive)` : ""}</span>
        <span>{h.standins.length === 0 ? "hens housed counted on the flocks' first day in the register" : h.standins.length === h.flocks ? "stand-in: the number housed is not known for these flocks, so the birds on 2 Jul 2026 are used" : `stand-in (birds on 2 Jul 2026) for ${h.standins.join(", ")}`}</span>
      </div>
    </div>
  );
}
