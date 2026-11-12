import { buildFarmCtx } from "@/lib/analytics/ctx";
import Link from "next/link";
import { watchList, lastDayOfData, SEGMENTS, SEGMENT_NAME, type AlertKind, type Ctx, type Segment } from "@/lib/analytics/engine";
import {
  compare,
  lastYearRange,
  monthsWithin,
  partsWithin,
  precedingRange,
  quickRanges,
  rangeCoverage,
  rangeOf,
  runRate,
  shiftRange,
  summarizePeriod,
  summarizeRange,
  weeksWithin,
  type Change,
  type PeriodExtras,
  type PeriodKind,
  type PeriodRange,
  type PeriodSummary,
  type RangeKind,
} from "@/lib/analytics/period";
import { flockOptions, rangeHref, readRange, type Param } from "@/lib/analytics/rangeParams";
import type { CostInput } from "@/lib/costs/engine";
import type { EngineInput } from "@/lib/analytics/engine";
import { SeriesChart } from "@/components/PeriodCharts";
import { chip } from "@/lib/analytics/chips";
import { dmy, n0, n1, n2, inr } from "@/lib/format";

const pretty = (d: string) => dmy(d);
const KIND_LABEL: Record<AlertKind, string> = {
  production_drop: "Production drop",
  high_mortality: "High mortality",
  low_feed_stock: "Low feed stock",
  egg_buildup: "Egg stock build-up",
  bird_count_anomaly: "Bird-count change",
  feed_anomaly: "Feed anomaly",
  missing_day: "Missing data",
  flock_health: "Flock may be sick",
};

const VIEWS: { key: "day" | RangeKind; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "custom", label: "Custom" },
];

export function ViewSwitch({ view, anchor, compareHref = "/analytics/compare" }: { view: string; anchor: string; compareHref?: string }) {
  return (
    <>
    <nav className="pv-switch" aria-label="Analytics view">
      {VIEWS.map((v) => (
        <a key={v.key} href={v.key === "day" ? `/analytics?date=${anchor}` : v.key === "custom" ? "/analytics?view=custom" : `/analytics?view=${v.key}&p=${anchor}`} className={view === v.key ? "on" : ""} aria-current={view === v.key ? "page" : undefined}>
          {v.label}
        </a>
      ))}
    </nav>
    <p className="pv-compare"><a className="btn btn-secondary" href={compareHref}>Compare flocks</a> <span className="muted an-tiny">two flocks or two periods side by side</span></p>
    </>
  );
}

function Delta({ c, digits = 0, money = false }: { c: Change | undefined; digits?: number; money?: boolean }) {
  if (!c || c.abs == null) return <span className="muted pv-chg">no earlier period to compare</span>;
  if (c.good == null) return <span className="muted pv-chg">no change</span>;
  const f = money ? (x: number) => inr(Math.abs(x)) : digits ? (x: number) => n1(Math.abs(x)) : (x: number) => n0(Math.abs(x));
  return (
    <span className={`pv-chg ${c.good ? "pv-good" : "pv-bad"}`}>
      {c.abs > 0 ? "▲" : "▼"} {f(c.abs)}
      {c.pct != null ? ` (${c.abs > 0 ? "+" : "−"}${Math.abs(c.pct).toFixed(1)}%)` : ""} — {c.good ? "better" : "worse"}
    </span>
  );
}

function Card({ title, value, sub, c, digits, money }: { title: string; value: string; sub?: string; c?: Change; digits?: number; money?: boolean }) {
  return (
    <div className="an-metric">
      <div className="an-metric-title">{title}</div>
      <div className="an-metric-value">{value}</div>
      {sub && <div className="an-metric-cmp">{sub}</div>}
      {c !== undefined && <div><Delta c={c} digits={digits} money={money} /></div>}
    </div>
  );
}

function Picker({ range, kind, options, latest, first }: { range: PeriodRange; kind: PeriodKind; options: { value: string; label: string }[]; latest: PeriodRange; first: PeriodRange }) {
  const prev = shiftRange(range, -1);
  const next = shiftRange(range, 1);
  const hasPrev = range.from > first.from;
  const hasNext = range.from < latest.from;
  return (
    <div className="pv-nav">
      <a className={`btn btn-secondary ${hasPrev ? "" : "pv-off"}`} href={`/analytics?view=${kind}&p=${prev.from}`} aria-label={`Previous ${kind}`} aria-disabled={!hasPrev}>◀</a>
      <form method="get" action="/analytics">
        <input type="hidden" name="view" value={kind} />
        <select name="p" defaultValue={range.from} aria-label={`Choose a ${kind}`}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="submit" className="btn-secondary">Go</button>
      </form>
      <a className={`btn btn-secondary ${hasNext ? "" : "pv-off"}`} href={`/analytics?view=${kind}&p=${next.from}`} aria-label={`Next ${kind}`} aria-disabled={!hasNext}>▶</a>
    </div>
  );
}

function FlockTable({ s }: { s: PeriodSummary }) {
  return (
    <div className="card an-scroll">
      <table className="an-table">
        <thead>
          <tr><th>Flock</th><th className="num">Days</th><th className="num">Eggs</th><th className="num">Share of eggs</th><th className="num">Eggs per 100 birds</th><th className="num">Breeder&apos;s target (book)</th><th className="num">Our realistic target</th><th className="num">Gap to book</th><th className="num">Deaths</th><th className="num">Deaths %</th><th className="num">Feed g/bird</th></tr>
        </thead>
        <tbody>
          {s.flocks.map((f) => (
            <tr key={f.flockId}>
              <td>
                <strong>{f.label}</strong> <span className={`an-pill an-pill-${chip(f).css}`}><span aria-hidden="true">{chip(f).icon}</span> {chip(f).label}</span>
                <div className="muted an-tiny">{f.breed}{f.registerLabel !== f.label ? ` · register ${f.registerLabel}` : ""}</div>
                <div className="muted an-tiny">{f.statusNote}</div>
              </td>
              <td className="num">{f.days}</td>
              <td className="num">{n0(f.eggs)}</td>
              <td className="num">{f.shareOfEggs != null ? `${n1(f.shareOfEggs)}%` : "–"}</td>
              <td className="num">{f.hd != null ? n1(f.hd) : "–"}</td>
              <td className="num">{f.stdHd != null ? n1(f.stdHd) : "–"}</td>
              <td className="num">{f.realisticHd != null ? n1(f.realisticHd) : f.stdHd != null ? "not learned yet" : "–"}</td>
              <td className="num">{f.gap != null ? `${f.gap > 0 ? "−" : "+"}${n1(Math.abs(f.gap))}` : "–"}</td>
              <td className="num">{n0(f.deaths)}</td>
              <td className="num">{f.deathsPct != null ? f.deathsPct.toFixed(2) : "–"}</td>
              <td className="num">{f.feedGPerBird != null ? n0(f.feedGPerBird) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareTable({ changes, vsLabel, lastYear }: { changes: Change[]; vsLabel: string; lastYear: Change[] | null }) {
  const fmt = (c: Change, v: number | null) => (v == null ? "–" : c.key === "hd" || c.key === "deathsPct" ? `${v.toFixed(c.key === "deathsPct" ? 2 : 1)}%` : c.key.endsWith("Day") && c.key !== "eggsPerDay" ? inr(v) : c.key === "feedG" ? `${n0(v)} g` : n0(v));
  return (
    <div className="card an-scroll">
      <table className="an-table" style={{ minWidth: 0 }}>
        <thead><tr><th>Measure</th><th className="num">Now</th><th className="num">{vsLabel}</th><th>Change</th></tr></thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.key}>
              <td>{c.label}</td>
              <td className="num">{fmt(c, c.now)}</td>
              <td className="num">{fmt(c, c.before)}</td>
              <td><Delta c={c} digits={c.key === "hd" || c.key === "deathsPct" || c.key === "feedG" ? 1 : 0} money={c.key.endsWith("Day") && c.key !== "eggsPerDay"} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted an-foot">
        Rates per day with data, so a short period is never compared as a total with a full one. {lastYear ? "" : "Same period last year: no earlier data."}
      </p>
    </div>
  );
}

function Money({ s, month }: { s: PeriodSummary; month?: string }) {
  const m = s.money;
  const profitLabel = m.costComplete ? "Estimated profit" : "Estimated profit — INCOMPLETE";
  const miss = (what: string) => m.missing.some((x) => x.startsWith(what));
  return (
    <section className="card" aria-label="Money">
      <h2 style={{ marginTop: 0 }}>Money <span className="badge badge-flagged">estimate</span></h2>
      <p className="an-sub" style={{ marginTop: 0 }}><b>{s.partial ? `To date, not the full period: ${s.daysWithData} of ${s.range.days} days have data` : `Full period: all ${s.range.days} days have data`}.</b> {s.partial ? "Monthly bills (electricity, labour) are counted for those days only." : ""}</p>
      <div className="an-grid">
        <Card title="Egg revenue" value={m.revenue ? inr(m.revenue) : "—"} sub={`${n0(m.eggsSold)} eggs sold${m.avgPricePerEgg != null ? ` · avg ₹${n2(m.avgPricePerEgg)}/egg` : ""}`} />
        <Card title={m.costComplete ? "Cost" : "Cost so far"} value={inr(m.cost.total)} sub={m.costComplete ? "all inputs entered" : "some inputs missing"} />
        <Card title={profitLabel} value={m.profit != null ? inr(m.profit) : "—"} sub={m.profitPerTray != null ? `${inr(m.profitPerTray)} per tray sold` : undefined} />
        <Card title="Revenue / egg" value={m.revenuePerEgg != null ? `₹${n2(m.revenuePerEgg)}` : "—"} />
        <Card title="Cost / egg" value={m.costPerEgg != null ? `₹${n2(m.costPerEgg)}` : "—"} sub={m.costComplete ? undefined : "so far"} />
        {m.birdSaleRevenue > 0 && <Card title="Bird sales" value={inr(m.birdSaleRevenue)} sub="not in egg revenue" />}
      </div>
      {m.unpricedEggs > 0 && <div className="flag-banner" style={{ marginTop: "0.6rem" }}>{n0(m.unpricedEggs)} eggs sold have no rate, so they are left out of revenue. <Link href="/sales/rates">Enter the rates</Link></div>}
      {m.missing.length > 0 && (
        <div className="flag-banner" style={{ marginTop: "0.6rem" }}>
          Cost is missing: {m.missing.join(", ")}. These are <b>missing, not zero</b>, so cost is understated and profit is overstated. <Link href="/purchases">Enter them</Link>
        </div>
      )}
      <div style={{ overflowX: "auto" }}><table className="an-table" style={{ minWidth: 0, marginTop: "0.6rem" }}>
        <tbody>
          <tr><td>Feed <span className="muted an-tiny">{m.feedPerKg != null ? `(₹${m.feedPerKg.toFixed(2)} per kg = ₹${n0(m.feedPerKg * 45)} per 45 kg bag, own mill)` : ""}</span></td><td className="num">{miss("feed price") ? <span className="badge badge-flagged">not entered</span> : inr(m.cost.feed)}</td></tr>
          <tr><td>Electricity</td><td className="num">{m.missing.some((x) => x.startsWith("electricity")) ? <span className="badge badge-flagged">missing: not entered</span> : inr(m.cost.electricity)}</td></tr>
          <tr><td>Labour</td><td className="num">{m.missing.includes("labour") ? <span className="badge badge-flagged">missing: not entered</span> : inr(m.cost.labour)}</td></tr>
          <tr><td>Packing</td><td className="num">{miss("packing price") ? <span className="badge badge-flagged">not entered</span> : inr(m.cost.packing)}</td></tr>
          <tr><td>Diesel</td><td className="num">{miss("diesel") ? <span className="badge badge-flagged">not entered</span> : inr(m.cost.diesel)}</td></tr>
          <tr><td>Medicines and vaccines</td><td className="num">{miss("medicines") ? <span className="badge badge-flagged">not entered</span> : inr(m.cost.medicine)}</td></tr>
          <tr><td>Other costs</td><td className="num">{miss("other costs") ? <span className="badge badge-flagged">not entered</span> : inr(m.cost.other)}</td></tr>
          <tr><td>Chick purchase <span className="muted an-tiny">{`(average ${m.chickPrice != null ? `₹${m.chickPrice}` : "price"} per chick × chicks that arrived; counted in the month they arrived)`}</span></td><td className="num">{inr(m.cost.chicks)}</td></tr>
        </tbody>
      </table></div>
      {month && <p className="muted an-foot"><Link href="/purchases">Complete this month&apos;s inputs →</Link></p>}
    </section>
  );
}

function SalesSplit({ s }: { s: PeriodSummary }) {
  const m = s.money;
  const rows = Object.keys(m.eggsByChannel);
  return (
    <section className="card" aria-label="Sales split">
      <h2 style={{ marginTop: 0 }}>Egg sales by buyer and grade</h2>
      {m.byBuyer.length === 0 ? <p className="muted">No egg sales in this period.</p> : (
        <div className="an-scroll" style={{ padding: 0 }}>
          <table className="an-table" style={{ minWidth: 0 }}>
            <thead><tr><th>Buyer</th><th className="num">Eggs</th><th className="num">Revenue</th></tr></thead>
            <tbody>{m.byBuyer.map((b) => <tr key={b.buyer}><td>{b.buyer}</td><td className="num">{n0(b.eggs)}</td><td className="num">{inr(b.revenue)}</td></tr>)}</tbody>
          </table>
          <table className="an-table" style={{ minWidth: 0, marginTop: "0.6rem" }}>
            <thead><tr><th>Channel / grade</th><th className="num">Eggs</th><th className="num">Revenue</th></tr></thead>
            <tbody>
              {rows.map((k) => <tr key={k}><td>{k === "farmfresh" ? "Farmfresh" : "Local"}</td><td className="num">{n0(m.eggsByChannel[k])}</td><td className="num">{inr(m.revenueByChannel[k] ?? 0)}</td></tr>)}
              {Object.keys(m.eggsByGrade).map((k) => <tr key={k}><td>{k === "big" ? "Big" : k === "small" ? "Small" : k} eggs</td><td className="num">{n0(m.eggsByGrade[k])}</td><td className="num">{inr(m.revenueByGrade[k] ?? 0)}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Alerts({ s }: { s: PeriodSummary }) {
  const kinds = Object.entries(s.alerts.byKind) as [AlertKind, number][];
  return (
    <section className="card" aria-label="Alerts">
      <h2 style={{ marginTop: 0 }}>Alerts in this period <span className="badge badge-flagged">{s.alerts.total}</span></h2>
      {kinds.length === 0 ? <p className="muted" style={{ margin: 0 }}>None. (Owner-reviewed records, the never-flag list and the cleared August register are left out.)</p> : (
        <ul className="an-list">{kinds.sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k}><b>{KIND_LABEL[k]}</b>: {n}</li>)}</ul>
      )}
      <p className="muted an-foot"><Link href={`/analytics?date=${s.lastDate ?? ""}`}>Open the Day view for the details →</Link></p>
    </section>
  );
}

function Next({ ctx, s }: { ctx: Ctx; s: PeriodSummary }) {
  const items: string[] = [];
  const only = s.flockFilter ? new Set(s.flockFilter) : null;
  if (s.lastDate) {
    // chosen flocks: only what is about those flocks (farm-wide items belong to "All flocks")
    for (const w of watchList(ctx, s.lastDate, s.segment)) if (!only || (w.flockId && only.has(w.flockId))) items.push(w.text);
  }
  if (s.feed.daysLeftAtEnd != null && s.feed.daysLeftAtEnd < 1.5) items.push(`Feed stock at the end of the period was only ${n1(s.feed.daysLeftAtEnd)} days.`);
  if (s.feed.eggStockDaysAtEnd != null && s.feed.eggStockDaysAtEnd > 4) items.push(`Egg stock at the end of the period was ${n1(s.feed.eggStockDaysAtEnd)} days of production.`);
  if (s.money.revenuePerEgg != null && s.money.costPerEgg != null && s.money.revenuePerEgg < s.money.costPerEgg) items.push(`Revenue per egg ₹${n2(s.money.revenuePerEgg)} is below cost per egg ₹${n2(s.money.costPerEgg)}${s.money.costComplete ? "" : " (cost so far — it can only be higher)"}.`);
  for (const f of s.flocks) if (f.status === "red") items.push(`${f.label} is well below its ${f.breed} standard: ${f.statusNote}`);
  const uniq = [...new Set(items)];
  return (
    <section className="card" aria-label="What can go wrong next">
      <h2 style={{ marginTop: 0 }}>What can go wrong next</h2>
      {uniq.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing is trending badly, and no stock is running short.</p> : <ul className="an-list">{uniq.map((t, i) => <li key={i}>{t}</li>)}</ul>}
    </section>
  );
}

function Headline({ s, c }: { s: PeriodSummary; c: Change[] }) {
  const g = (k: string) => c.find((x) => x.key === k);
  return (
    <section className="card" aria-label="Headline numbers">
      <p className="muted an-sub" style={{ marginTop: 0 }}>{s.dataNote}{s.partial ? " — averages use only days with data" : ""}.</p>
      <div className="an-grid">
        <Card title="Eggs per day" value={s.eggs.perDay != null ? n0(s.eggs.perDay) : "–"} sub={`${n0(s.eggs.total)} eggs · ${n0(s.eggs.trays)} trays`} c={g("eggsPerDay")} />
        <Card title="Eggs per 100 birds (HD %)" value={s.eggs.hdPooled != null ? `${n1(s.eggs.hdPooled)}%` : "–"} sub="all eggs ÷ all bird-days × 100" c={g("hd")} digits={1} />
        <Card title="Deaths" value={n0(s.birds.deaths)} sub={s.birds.deathsPct != null ? `${s.birds.deathsPct.toFixed(2)}% of opening birds · ${s.birds.deathsPer1000!.toFixed(1)} per 1,000` : undefined} c={g("deathsPct")} digits={1} />
        {s.feed.recorded ? (
          <Card title="Feed g / bird / day" value={s.feed.gPerBirdDay != null ? n0(s.feed.gPerBirdDay) : "–"} sub={`${n0(s.feed.bags)} bags · ${s.feed.kgPer100Eggs != null ? n1(s.feed.kgPer100Eggs) : "–"} kg per 100 eggs`} c={g("feedG")} digits={1} />
        ) : (
          <Card title="Feed g / bird / day" value="not recorded" sub="feed is not recorded for this group" />
        )}
        {!s.farmLevel ? (
          <Card title="Sales, cost and profit" value="farm-level" sub="not split by flock: choose All flocks to see them" />
        ) : (
          <Card title="Revenue" value={s.money.revenue ? inr(s.money.revenue) : "—"} sub={s.money.costSplit ? "priced egg sales" : "priced egg sales of this group"} c={g("revenueDay")} money />
        )}
        {!s.farmLevel ? null : s.money.costSplit ? (
          <Card title={s.money.costComplete ? "Profit (estimate)" : "Profit (incomplete)"} value={s.money.profit != null ? inr(s.money.profit) : "—"} sub={s.money.costComplete ? undefined : "cost inputs missing"} c={g("profitDay")} money />
        ) : (
          <Card title="Cost and profit" value="whole farm" sub="shared costs are not split between groups" />
        )}
      </div>
      <details style={{ marginTop: "0.6rem" }}>
        <summary>More numbers</summary>
        <ul className="an-list">
          <li>Birds: opening {s.birds.opening != null ? n0(s.birds.opening) : "–"}, closing {s.birds.closing != null ? n0(s.birds.closing) : "–"}. Moved out: {n0(s.birds.soldOut)} sold, {n0(s.birds.anilOut)} to Anil farm; in: {n0(s.birds.anilIn)} from Anil farm. These are movements, not deaths.</li>
          {s.farmLevel ? (
            <li>Breakage {n0(s.eggs.breakage)} eggs{s.eggs.breakagePct != null ? ` (${s.eggs.breakagePct.toFixed(2)}% of eggs laid)` : ""}; labour take, gifts and other {n0(s.eggs.otherOut)} eggs{s.eggs.otherOutPct != null ? ` (${s.eggs.otherOutPct.toFixed(2)}%)` : ""}.</li>
          ) : (
            <li>Breakage and labour take: written in the egg ledger for the whole page, not split by flock.</li>
          )}
          {s.eggs.best && s.eggs.worst && <li>Best day {pretty(s.eggs.best.date)} ({n1(s.eggs.best.hd)}%), worst day {pretty(s.eggs.worst.date)} ({n1(s.eggs.worst.hd)}%).</li>}
          <li>{s.feed.recorded ? `Feed ${n0(s.feed.kg)} kg.` : "Feed is not recorded for these flocks."} {s.farmLevel ? <>Feed left at period end: {s.feed.daysLeftAtEnd != null ? `${n1(s.feed.daysLeftAtEnd)} days` : "–"}. Egg stock: {s.feed.eggStockDaysAtEnd != null ? `${n1(s.feed.eggStockDaysAtEnd)} days` : "–"}.</> : "Feed stock and egg stock are kept for the whole farm, not per flock."}</li>
          {s.eggs.hdMeanOfDaily != null && s.eggs.hdPooled != null && <li>Mean of the daily percentages would be {n1(s.eggs.hdMeanOfDaily)}%; the pooled figure above is the correct one.</li>}
        </ul>
      </details>
    </section>
  );
}

const shortDay = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const nextDay = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

function SeriesBlock({ s, every }: { s: PeriodSummary; every?: number }) {
  const custom = s.range.kind === "custom";
  // a custom range longer than about two months is drawn one point per Monday-Sunday week, so it stays readable on a phone
  const weekly = custom && s.range.days > 62;
  const lab = (d: string) => (s.range.kind === "week" ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }) : custom ? shortDay(d) : String(Number(d.slice(8, 10))));
  type P = { label: string; eggs: number | null; hd: number | null; deaths: number | null; feed: number | null; temp: number | null };
  let pts: P[];
  if (weekly) {
    pts = weeksWithin(s.range).map((w) => {
      const rs = s.series.filter((p) => p.date >= w.from && p.date <= w.to);
      const n = rs.length;
      const eggs = rs.reduce((t, p) => t + p.eggs, 0);
      const birds = rs.reduce((t, p) => t + p.birds, 0);
      return { label: shortDay(w.from), eggs: n ? eggs / n : null, hd: birds > 0 ? (eggs / birds) * 100 : null, deaths: n ? rs.reduce((t, p) => t + p.deaths, 0) / n : null, feed: n ? rs.reduce((t, p) => t + p.feedBags, 0) / n : null, temp: null };
    });
  } else {
    // every day of the period on the axis, with a gap where there is no data
    const days: string[] = [];
    for (let d = s.range.from; d <= s.range.to && days.length < 63; d = nextDay(d)) days.push(d);
    const by = new Map(s.series.map((p) => [p.date, p]));
    pts = days.map((d) => {
      const p = by.get(d);
      return { label: lab(d), eggs: p ? p.eggs : null, hd: p ? p.hd : null, deaths: p ? p.deaths : null, feed: p ? p.feedBags : null, temp: s.maxTemps[d] ?? null };
    });
  }
  const pick = (f: (p: P) => number | null) => pts.map((p) => ({ label: p.label, value: f(p) }));
  // "15 Oct" labels are wide: at most about six on a phone-width chart
  const ev = custom && every == null ? (pts.length <= 7 ? 1 : Math.ceil(pts.length / 6)) : every;
  // max temperature as a thin line on the HD and deaths charts (V11); nothing is drawn when the weather is not available
  const temp = !weekly && Object.keys(s.maxTemps).length ? { name: "max temperature", unit: "°C", values: pts.map((p) => p.temp) } : undefined;
  const per = weekly ? " (average per day, one point per week)" : "";
  const long = s.range.kind === "month" || custom;
  return (
    <section className="card" aria-label="Daily charts">
      <SeriesChart title={`Eggs per day${per}`} unit="eggs" kind="bar" points={pick((p) => p.eggs)} labelEvery={ev} />
      <SeriesChart title={`Hen-day %${weekly ? " (pooled per week)" : ""}`} unit="% of birds" kind="line" points={pick((p) => p.hd)} labelEvery={ev} overlay={temp} />
      {long && (
        <>
          <SeriesChart title={`Deaths per day${per}`} unit="birds" kind="bar" points={pick((p) => p.deaths)} labelEvery={ev} overlay={temp} />
          {s.feed.recorded ? <SeriesChart title={`Feed per day${per}`} unit="bags" kind="bar" points={pick((p) => p.feed)} labelEvery={ev} /> : <p className="muted an-tiny">Feed per day: feed is not recorded for these flocks (left page of the register).</p>}
        </>
      )}
      <p className="muted an-foot">{weekly ? "The range is longer than two months, so each point is one Monday–Sunday week; the day table below has every day." : "A blank day means no data was entered for it."}{temp || weekly ? "" : " Weather is not available yet, so no temperature line is drawn."}</p>
    </section>
  );
}

function DayTable({ s }: { s: PeriodSummary }) {
  const table = (
    <table className="an-table" style={{ minWidth: 0 }}>
      <thead><tr><th>Day</th><th className="num">Eggs</th><th className="num">Eggs per 100 birds</th><th className="num">Deaths</th><th className="num">Feed (bags)</th></tr></thead>
      <tbody>
        {s.series.map((p) => (
          <tr key={p.date}>
            <td><Link href={`/day?date=${p.date}`}>{pretty(p.date)}</Link></td>
            <td className="num">{n0(p.eggs)}</td><td className="num">{p.hd != null ? n1(p.hd) : "–"}</td><td className="num">{n0(p.deaths)}</td><td className="num">{s.feed.recorded ? n0(p.feedBags) : "not recorded"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="card an-scroll">
      {s.series.length > 7 ? (
        <details>
          <summary>Day by day ({s.series.length} days with data)</summary>
          {table}
        </details>
      ) : table}
      <p className="muted an-foot">Tap a day to open it.{s.range.kind === "custom" && s.series.length < s.range.days ? ` Days with no data are not listed (${s.range.days - s.series.length} of ${s.range.days}).` : ""}</p>
    </div>
  );
}

function WeekTable({ weeks, unit = "week" }: { weeks: PeriodSummary[]; unit?: "week" | "month" }) {
  return (
    <div className="card an-scroll">
      <table className="an-table">
        <thead><tr><th>{unit === "week" ? "Week" : "Month"}</th><th className="num">Days</th><th className="num">Eggs/day</th><th className="num">Eggs per 100 birds</th><th className="num">Deaths</th><th className="num">Feed g/bird</th><th className="num">Revenue</th></tr></thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.range.from}>
              <td><Link href={unit === "week" ? `/analytics?view=week&p=${w.range.from}` : `/analytics?view=month&p=${w.range.from.slice(0, 7)}`}>{w.range.label}</Link></td>
              <td className="num">{w.daysWithData}/{w.range.days}</td>
              <td className="num">{w.eggs.perDay != null ? n0(w.eggs.perDay) : "–"}</td>
              <td className="num">{w.eggs.hdPooled != null ? n1(w.eggs.hdPooled) : "–"}</td>
              <td className="num">{n0(w.birds.deaths)}</td>
              <td className="num">{w.feed.gPerBirdDay != null ? n0(w.feed.gPerBirdDay) : "–"}</td>
              <td className="num">{w.money.revenue ? inr(w.money.revenue) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted an-foot">{unit === "week" ? "Weeks run Monday to Sunday; the first and last week are clipped to the dates shown." : "Calendar months; the first and last month are clipped to the dates shown."} Compare them by the per-day columns, not by totals.</p>
    </div>
  );
}

function YearView({ ctx, s, months, input, yearsLabel }: { ctx: Ctx; s: PeriodSummary; months: PeriodSummary[]; input: EngineInput; yearsLabel: string }) {
  const withData = months.filter((m) => m.daysWithData > 0);
  const rr = runRate(withData);
  const bestM = withData.length ? withData.reduce((a, b) => ((b.eggs.hdPooled ?? 0) > (a.eggs.hdPooled ?? 0) ? b : a)) : null;
  const worstM = withData.length ? withData.reduce((a, b) => ((b.eggs.hdPooled ?? 1e9) < (a.eggs.hdPooled ?? 1e9) ? b : a)) : null;
  const mlabel = (m: PeriodSummary) => m.range.label.slice(0, 3);
  const pts = (f: (m: PeriodSummary) => number | null) => months.map((m) => ({ label: mlabel(m), value: m.daysWithData ? f(m) : null }));
  const sold = (flockId: string) => -input.movements.filter((m) => m.flockId === flockId && m.type === "sale" && m.date >= s.range.from && m.date <= s.range.to).reduce((t, m) => t + m.change, 0);
  const monthsOf = (flockId: string) => withData.filter((m) => m.flocks.some((f) => f.flockId === flockId)).length;
  return (
    <>
      <p className="card muted">Data starts {pretty(ctx.dates[0])} {ctx.dates[0].slice(0, 4)}; nothing earlier was entered. {yearsLabel}{withData.some((m) => m.partial) ? ` Partial months — ${withData.filter((m) => m.partial).map((m) => `${m.range.label} (${m.daysWithData} of ${m.range.days} days)`).join(", ")}: their totals cover only the days with data, so compare months by the per-day columns (eggs/day, HD %, g/bird), not by totals.` : ""}</p>
      <section className="card an-scroll" aria-label="Month by month">
        <h2 style={{ marginTop: 0 }}>Month by month</h2>
        <table className="an-table">
          <thead><tr><th>Month</th><th className="num">Days</th><th className="num">Eggs/day</th><th className="num">Eggs per 100 birds</th><th className="num">Deaths %</th><th className="num">Feed g/bird</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Profit</th></tr></thead>
          <tbody>
            {withData.map((m) => (
              <tr key={m.range.from}>
                <td><Link href={`/analytics?view=month&p=${m.range.from}`}>{m.range.label}</Link></td>
                <td className="num">{m.daysWithData}/{m.range.days}</td>
                <td className="num">{m.eggs.perDay != null ? n0(m.eggs.perDay) : "–"}</td>
                <td className="num">{m.eggs.hdPooled != null ? n1(m.eggs.hdPooled) : "–"}</td>
                <td className="num">{m.birds.deathsPct != null ? m.birds.deathsPct.toFixed(2) : "–"}</td>
                <td className="num">{m.feed.gPerBirdDay != null ? n0(m.feed.gPerBirdDay) : "–"}</td>
                <td className="num">{m.money.revenue ? inr(m.money.revenue) : "–"}</td>
                <td className="num">{inr(m.money.cost.total)}{m.money.costComplete ? "" : "*"}</td>
                <td className="num">{m.money.profit != null ? inr(m.money.profit) + (m.money.costComplete ? "" : "*") : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted an-foot">* cost inputs missing for that month (counted as missing, not zero) — profit is an incomplete estimate. A month with fewer days than the calendar shows how many days have data. Same month last year: {withData.some((m) => lastYearHas(ctx, m.range)) ? "see the Month view" : "no earlier data"}.</p>
      </section>
      <section className="card" aria-label="Monthly charts">
        <SeriesChart title="Eggs per day, by month" unit="eggs" kind="bar" points={pts((m) => m.eggs.perDay)} labelEvery={1} />
        <SeriesChart title="Hen-day %, by month" unit="% of birds" kind="line" points={pts((m) => m.eggs.hdPooled)} labelEvery={1} />
        <SeriesChart title="Deaths, % of opening birds" unit="%" kind="bar" points={pts((m) => m.birds.deathsPct)} labelEvery={1} />
        <SeriesChart title="Feed per bird per day" unit="g" kind="bar" points={pts((m) => m.feed.gPerBirdDay)} labelEvery={1} />
        <SeriesChart title="Revenue by month" unit="₹" kind="bar" points={pts((m) => m.money.revenue || null)} labelEvery={1} />
        <SeriesChart title="Cost so far, by month" unit="₹" kind="bar" points={pts((m) => m.money.cost.total)} labelEvery={1} />
        <SeriesChart title="Estimated profit, by month" unit="₹" kind="bar" points={pts((m) => (m.money.profit != null && m.money.profit > 0 ? m.money.profit : null))} labelEvery={1} />
        <p className="muted an-foot">Profit bars show only months with a positive estimate; read the table for the rest. Months with missing cost inputs are incomplete.</p>
      </section>
      {bestM && worstM && withData.length > 1 && (
        <p className="card">Best month by hen-day %: <b>{bestM.range.label}</b> ({n1(bestM.eggs.hdPooled ?? 0)}%). Worst: <b>{worstM.range.label}</b> ({n1(worstM.eggs.hdPooled ?? 0)}%).</p>
      )}
      <section className="card an-scroll" aria-label="Flocks this year">
        <h2 style={{ marginTop: 0 }}>Flocks this year</h2>
        <table className="an-table">
          <thead><tr><th>Flock</th><th className="num">Months</th><th className="num">Eggs per 100 birds</th><th className="num">Deaths %</th><th className="num">Birds sold</th></tr></thead>
          <tbody>
            {s.flocks.map((f) => (
              <tr key={f.flockId}>
                <td><b>{f.label}</b> <span className={`an-pill an-pill-${chip(f).css}`}><span aria-hidden="true">{chip(f).icon}</span> {chip(f).label}</span></td>
                <td className="num">{monthsOf(f.flockId)}</td>
                <td className="num">{f.hd != null ? n1(f.hd) : "–"}</td>
                <td className="num">{f.deathsPct != null ? f.deathsPct.toFixed(2) : "–"}</td>
                <td className="num">{n0(sold(f.flockId))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card" aria-label="Run rate">
        <h2 style={{ marginTop: 0 }}>Run rate</h2>
        {rr ? (
          <p style={{ margin: 0 }}>
            At the pace of the last full month ({rr.month}) the farm lays about <b>{n0(rr.eggsYear)}</b> eggs a year{rr.revenueYear ? <> and sells about <b>{inr(rr.revenueYear)}</b></> : ""}. This is simple arithmetic (last full month × 12), <b>not a forecast</b>.
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>A run rate needs at least two full months of data. Not shown.</p>
        )}
      </section>
    </>
  );
}

function lastYearHas(ctx: Ctx, r: PeriodRange): boolean {
  const ly = lastYearRange(r);
  return ctx.dates.some((d) => d >= ly.from && d <= ly.to);
}

function SegmentBlock({ ctx, input, kind, range, prevR, seg, title, sum, prev, Sg, months }: { ctx: Ctx; input: EngineInput; kind: RangeKind; range: PeriodRange; prevR: PeriodRange; seg: Segment | null; title?: string; sum: PeriodSummary; prev: PeriodSummary; Sg: (r: PeriodRange, seg: Segment | null) => PeriodSummary; months: PeriodSummary[] }) {
  const ch = compare(sum, prev);
  const custom = kind === "custom";
  const parts = custom ? partsWithin(range) : null;
  const what = custom ? "range" : kind;
  const prevLabel = custom ? `the ${prevR.days} day${prevR.days === 1 ? "" : "s"} before (${prevR.label})` : prev.daysWithData > 0 ? prevR.label : `the previous ${kind}`;
  return (
    <section aria-label={title ?? (seg ? SEGMENT_NAME[seg] : "Chosen flocks")} className={`seg-block seg-block-${seg ?? "chosen"}`}>
      <h2 className="seg-h">{title ?? (seg ? SEGMENT_NAME[seg] : "Chosen flocks")}</h2>
      {sum.daysWithData === 0 ? (
        <p className="card muted">No rows for {seg ? "this group" : "these flocks"} in this {what}.</p>
      ) : (
        <>
          <Headline s={sum} c={ch} />
          {kind !== "year" && <SeriesBlock s={sum} every={kind === "month" ? 5 : kind === "week" ? 1 : undefined} />}
          {(kind === "week" || custom) && <DayTable s={sum} />}
          {kind === "month" && <WeekTable weeks={weeksWithin(range).map((w) => Sg(w, seg))} />}
          {parts && parts.parts.length > 1 && (
            <>
              <h3>{parts.unit === "week" ? "Week by week" : "Month by month"}</h3>
              <WeekTable unit={parts.unit} weeks={parts.parts.map((w) => Sg(w, seg))} />
            </>
          )}
          {kind === "year" && <YearView ctx={ctx} s={sum} months={months} input={input} yearsLabel={sum.partial ? `This group has ${sum.daysWithData} days of data out of ${range.days}.` : ""} />}
          {kind !== "year" && (
            <>
              <h3>Per flock</h3>
              <FlockTable s={sum} />
            </>
          )}
          <h3>Compared with {prevLabel}</h3>
          <PartialNote now={sum} prev={prev} prevR={prevR} />
          <CompareTable changes={ch} vsLabel={custom ? "Before" : prev.daysWithData > 0 ? prevR.label : `Previous ${kind}`} lastYear={null} />
          <Alerts s={sum} />
          <Next ctx={ctx} s={sum} />
        </>
      )}
    </section>
  );
}

/** Never compare a partial period with a full one without saying so. */
function PartialNote({ now, prev, prevR }: { now: PeriodSummary; prev: PeriodSummary; prevR: PeriodRange }) {
  if (now.range.kind !== "custom") return null;
  const a = now.partial ? `this range has data on ${now.daysWithData} of ${now.range.days} days` : "";
  const b = prev.daysWithData === 0 ? `the ${prevR.days} days before have no data, so there is nothing to compare with` : prev.partial ? `the range before has data on ${prev.daysWithData} of ${prevR.days} days` : "";
  if (!a && !b) return <p className="muted an-sub">Both ranges have data on every day.</p>;
  return <p className="an-sub"><b>Not like for like:</b> {[a, b].filter(Boolean).join("; ")}. The table compares rates per day with data, never totals.</p>;
}
export function PeriodView({
  input,
  cost,
  extras,
  kind,
  p,
}: {
  input: EngineInput;
  cost: CostInput;
  extras: PeriodExtras;
  kind: PeriodKind;
  p: string | undefined;
}) {
  const { ctx } = buildFarmCtx(input);
  const latestDay = lastDayOfData(ctx);
  const firstDay = ctx.dates[0];
  const latest = rangeOf(kind, latestDay);
  const first = rangeOf(kind, firstDay);
  const anchor = /^\d{4}(-\d{2}(-\d{2})?)?$/.test(p ?? "") ? (p!.length === 4 ? `${p}-01-01` : p!.length === 7 ? `${p}-01` : p!) : latestDay;
  let range = rangeOf(kind, anchor);
  if (range.from > latest.from) range = latest;
  if (range.to < first.from) range = first;

  const S = (r: PeriodRange) => summarizePeriod(ctx, cost, extras, r);
  const Sg = (r: PeriodRange, g: Segment | null) => summarizePeriod(ctx, cost, extras, r, g ?? "all");
  const s = S(range);
  const prevR = shiftRange(range, -1);
  const prev = S(prevR);
  const ly = lastYearRange(range);
  const lySum = S(ly);
  const changes = compare(s, prev);
  const lyChanges = lySum.daysWithData > 0 ? compare(s, lySum) : null;
  const vsLabel = `Previous ${kind}`;

  // picker options: every period of this kind that has data
  const opts: { value: string; label: string }[] = [];
  for (let r = first; r.from <= latest.from; r = shiftRange(r, 1)) opts.push({ value: r.from, label: r.label });
  opts.reverse();

  const today = new Date().toISOString().slice(0, 10);
  const current = range.from <= today && range.to >= today;
  const heading = `${kind === "week" ? "Week" : kind === "month" ? "Month" : "Year"}: ${range.label}${current && s.daysWithData > 0 ? ` — so far, ${s.daysWithData} day${s.daysWithData === 1 ? "" : "s"}` : ""}`;
  const segSums = { main: summarizePeriod(ctx, cost, extras, range, "main"), young: summarizePeriod(ctx, cost, extras, range, "young") };
  const segPrev = { main: summarizePeriod(ctx, cost, extras, prevR, "main"), young: summarizePeriod(ctx, cost, extras, prevR, "young") };
  const segMonths = {
    main: kind === "year" ? monthsWithin(range).map((m) => summarizePeriod(ctx, cost, extras, m, "main")) : [],
    young: kind === "year" ? monthsWithin(range).map((m) => summarizePeriod(ctx, cost, extras, m, "young")) : [],
  };

  return (
    <>
      <ViewSwitch view={kind} anchor={s.lastDate ?? range.from} />
      <Picker range={range} kind={kind} options={opts} latest={latest} first={first} />
      <h2 style={{ margin: "0 0 0.4rem" }}>{heading}</h2>
      {s.daysWithData === 0 ? (
        <p className="card muted">No data in this {kind}. Pick another from the list.</p>
      ) : (
        <>
          {SEGMENTS.map((g) => (
            <SegmentBlock key={g} ctx={ctx} input={input} kind={kind} range={range} prevR={prevR} seg={g} sum={segSums[g]} prev={segPrev[g]} Sg={Sg} months={segMonths[g]} />
          ))}
          <section aria-label="Whole farm">
            <h2 className="seg-h">Whole farm</h2>
            <p className="muted an-sub" style={{ marginTop: 0 }}>The sum of the groups above — it mixes mature and young birds, so its HD % is not a measure of either. {s.dataNote}.</p>
            <Headline s={s} c={changes} />
            <h3>Compared with {prev.daysWithData > 0 ? prevR.label : `the previous ${kind}`}</h3>
            <CompareTable changes={changes} vsLabel={prev.daysWithData > 0 ? prevR.label : vsLabel} lastYear={lyChanges} />
            {lyChanges && (<><h3>Same {kind} last year ({ly.label})</h3><CompareTable changes={lyChanges} vsLabel={ly.label} lastYear={lyChanges} /></>)}
            {kind !== "year" && <SalesSplit s={s} />}
            <Money s={s} month={kind === "month" ? range.from.slice(0, 7) : undefined} />
            <Alerts s={s} />
            <Next ctx={ctx} s={s} />
          </section>
          <p className="muted an-foot">
            Download this {kind} to Excel:{" "}
            {(["main", "young", "all"] as const).map((g, i) => (
              <span key={g}>{i > 0 ? " · " : ""}<a href={`/export/download?kind=${kind}&p=${kind === "year" ? range.from.slice(0, 4) : kind === "month" ? range.from.slice(0, 7) : range.from}&segment=${g}&format=xlsx`} download>{g === "all" ? "Whole farm" : g === "main" ? "Main" : "Young"}</a></span>
            ))}
          </p>
        </>
      )}
    </>
  );
}


// ---- Custom range (V15): the same blocks as the Month view, for any from..to and optionally chosen flocks ----
function RangePicker({ ctx, range, flockIds, today }: { ctx: Ctx; range: PeriodRange; flockIds: string[]; today: string }) {
  const opts = flockOptions(ctx);
  const chosen = new Set(flockIds);
  const labels = opts.filter((o) => chosen.has(o.id)).map((o) => o.label);
  const chips = quickRanges(ctx, today);
  return (
    <section className="card pv-range" aria-label="Choose the dates and flocks">
      <form method="get" action="/analytics">
        <input type="hidden" name="view" value="custom" />
        <div className="pv-dates">
          <label className="field"><span>From</span><input type="date" name="from" defaultValue={range.from} max={today} required /></label>
          <label className="field"><span>To</span><input type="date" name="to" defaultValue={range.to} max={today} required /></label>
        </div>
        <details className="pv-flocks">
          <summary>Flocks: <b>{labels.length ? labels.join(", ") : "All flocks"}</b></summary>
          <p className="muted an-tiny" style={{ margin: "0.3rem 0" }}>Tick one or more flocks, then press Show. Tick none for all flocks.</p>
          <div className="pv-flock-grid">
            {opts.map((o) => (
              <label key={o.id} className="pv-check">
                <input type="checkbox" name="f" value={o.label} defaultChecked={chosen.has(o.id)} />
                <span>
                  <b>{o.label}</b>
                  <span className="muted an-tiny">{[o.registerLabel !== o.label ? `register ${o.registerLabel}` : "", o.gone ? `left after ${dmy(o.lastDate)}` : o.segment === "young" ? "young" : "main"].filter(Boolean).join(" · ")}</span>
                </span>
              </label>
            ))}
          </div>
          {labels.length > 0 && <p style={{ margin: "0.4rem 0 0" }}><a className="btn btn-secondary" href={rangeHref(range.from, range.to)}>All flocks</a></p>}
        </details>
        <button type="submit" className="pv-show">Show</button>
      </form>
      <div className="pv-chips" role="group" aria-label="Quick ranges">
        {chips.map((c) => {
          const on = c.range.from === range.from && c.range.to === range.to;
          return (
            <a key={c.key} href={rangeHref(c.range.from, c.range.to, labels)} className={`pv-chip${on ? " on" : ""}`} aria-current={on ? "true" : undefined}>{c.label}</a>
          );
        })}
      </div>
      <p className="muted an-tiny" style={{ margin: "0.4rem 0 0" }}>&quot;Last 7 / 14 / 30&quot; are the last days that have data. Dates are farm days (IST); both ends are included.</p>
    </section>
  );
}

export function RangeView({ input, cost, extras, sp, today }: { input: EngineInput; cost: CostInput; extras: PeriodExtras; sp: { from?: Param; to?: Param; f?: Param }; today: string }) {
  const { ctx } = buildFarmCtx(input);
  const choice = readRange(ctx, sp, today);
  const { range, flockIds, flockLabels } = choice;
  const chosen = flockIds.length > 0;
  const prevR = precedingRange(range);
  const cov = rangeCoverage(ctx, range);
  const S = (r: PeriodRange, g: Segment | null) => (g ? summarizeRange(ctx, cost, extras, r, { segment: g }) : summarizeRange(ctx, cost, extras, r, { flocks: chosen ? flockIds : null }));
  const s = S(range, null);
  const prev = S(prevR, null);
  const changes = compare(s, prev);
  const segs = chosen ? [...new Set(s.flocks.map((f) => ctx.flockById.get(f.flockId)?.segment ?? null))] : [];
  return (
    <>
      <ViewSwitch view="custom" anchor={s.lastDate ?? range.to} compareHref={`/analytics/compare?${new URLSearchParams({ ...(flockLabels[0] ? { a: flockLabels[0] } : {}), af: range.from, at: range.to, bf: range.from, bt: range.to }).toString()}`} />
      <RangePicker ctx={ctx} range={range} flockIds={flockIds} today={today} />
      {choice.notes.length > 0 && <div className="flag-banner" role="status">{choice.notes.map((n, i) => <p key={i} style={{ margin: 0 }}>{n}</p>)}</div>}
      <h2 style={{ margin: "0.6rem 0 0.2rem" }}>{range.label} <span className="muted" style={{ fontWeight: 400 }}>· {range.days} day{range.days === 1 ? "" : "s"}{chosen ? ` · ${flockLabels.join(", ")}` : " · all flocks"}</span></h2>
      <p className="an-sub" style={{ marginTop: 0 }}><b>{s.dataNote}</b>{s.partial && s.daysWithData > 0 ? " — averages use only the days with data" : ""}.{cov.note ? ` ${cov.note}` : ""}{choice.isDefault ? " Showing the last 14 days with data; pick other dates above." : ""}</p>
      {s.daysWithData === 0 ? (
        <p className="card muted">No data for {chosen ? "these flocks" : "the farm"} in this range. Pick other dates or one of the quick ranges.</p>
      ) : chosen ? (
        <>
          <p className="card an-sub" style={{ marginTop: 0 }}>
            Numbers below use <b>only the chosen flocks&apos; own rows</b> (their birds, eggs, deaths and feed). Egg sales, revenue, costs, profit and the egg-ledger breakage are kept for the whole farm, so they are <b>farm-level, not split by flock</b> and are not shown here. <a href={rangeHref(range.from, range.to)}>Show all flocks</a>
            {segs.length > 1 ? " These flocks are in both groups (main and young), so their HD % mixes mature and young birds." : ""}
          </p>
          <SegmentBlock ctx={ctx} input={input} kind="custom" range={range} prevR={prevR} seg={null} title={`Chosen flocks: ${flockLabels.join(", ")}`} sum={s} prev={prev} Sg={S} months={[]} />
        </>
      ) : (
        <>
          {SEGMENTS.map((g) => (
            <SegmentBlock key={g} ctx={ctx} input={input} kind="custom" range={range} prevR={prevR} seg={g} sum={S(range, g)} prev={S(prevR, g)} Sg={S} months={[]} />
          ))}
          <section aria-label="Whole farm">
            <h2 className="seg-h">Whole farm</h2>
            <p className="muted an-sub" style={{ marginTop: 0 }}>The sum of the groups above — it mixes mature and young birds, so its HD % is not a measure of either. {s.dataNote}.</p>
            <Headline s={s} c={changes} />
            <h3>Compared with the {prevR.days} day{prevR.days === 1 ? "" : "s"} before ({prevR.label})</h3>
            <PartialNote now={s} prev={prev} prevR={prevR} />
            <CompareTable changes={changes} vsLabel="Before" lastYear={null} />
            <SalesSplit s={s} />
            <Money s={s} />
            <Alerts s={s} />
            <Next ctx={ctx} s={s} />
          </section>
        </>
      )}
      {s.daysWithData > 0 && <RangeDownloads from={range.from} to={range.to} flockLabels={flockLabels} />}
    </>
  );
}

/** "Download this view": the same address as the screen, so the file has the same numbers. */
function RangeDownloads({ from, to, flockLabels }: { from: string; to: string; flockLabels: string[] }) {
  const href = (format: string, segment?: string) => {
    const q = new URLSearchParams({ kind: "range", from, to, format });
    for (const l of flockLabels) q.append("f", l);
    if (segment) q.set("segment", segment);
    return `/export/download?${q.toString()}`;
  };
  return (
    <section className="card" aria-label="Download this view">
      <h2 style={{ marginTop: 0 }}>Download this view</h2>
      {flockLabels.length > 0 ? (
        <p className="pv-dl"><a className="btn btn-secondary" href={href("xlsx")} download>Excel (.xlsx)</a> <a className="btn btn-secondary" href={href("csv")} download>CSV</a></p>
      ) : (
        <ul className="pv-dl-list">
          {([["all", "Whole farm"], ["main", "Main flocks"], ["young", "Young flocks"]] as const).map(([g, l]) => (
            <li key={g}><span>{l}</span> <a className="btn btn-secondary" href={href("xlsx", g)} download>Excel</a> <a className="btn btn-secondary" href={href("csv", g)} download>CSV</a></li>
          ))}
        </ul>
      )}
      <p className="muted an-foot">One row per day with data; real dates and numbers; HD % as a formula, pooled in the totals row. Read-only.</p>
    </section>
  );
}
