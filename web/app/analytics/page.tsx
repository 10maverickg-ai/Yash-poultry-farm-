import { after } from "next/server";
import { slipItems } from "@/lib/analytics/realistic";
import { forecastAlerts } from "@/lib/analytics/heat";
import { refreshWeatherQuietly } from "@/lib/weather/store";
import { todayIST } from "@/lib/weather/openMeteo";
import { TargetLines } from "@/components/TargetLines";
import { buildFarmCtx } from "@/lib/analytics/ctx";
import Link from "next/link";
import { loadEngineInput } from "@/lib/analytics/load";
import {
  addDays,
  alertsFor,
  breedName,
  SEGMENTS,
  SEGMENT_NAME,
  flockCards,
  lastDayOfData,
  monthView,
  watchList,
  type Alert,
  type AlertKind,
  type CardStatus,
  type FlockCard,
} from "@/lib/analytics/engine";
import { markAlertReviewed, saveAlertFeedback } from "./actions";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { loadCostInput } from "@/lib/costs/load";
import { loadPeriodExtras } from "@/lib/analytics/periodLoad";
import { PeriodView, RangeView, ViewSwitch } from "@/components/PeriodView";
import { DataStamp } from "@/components/DataStamp";
import { ShareMenu } from "@/components/ShareMenu";
import { shareQuery } from "@/lib/export/shareOptions";
import { chip } from "@/lib/analytics/chips";
import { dmy, n0, n1 } from "@/lib/format";
import { allSegmentPanels, farmCheck } from "@/lib/analytics/segments";
import { feedEfficiency, flockEff, effOn, type FeedEff } from "@/lib/analytics/feedEfficiency";
import { flockHenHoused } from "@/lib/analytics/henHoused";
import { fcrOf, fcrOn, flockFcr, type FcrResult } from "@/lib/analytics/fcr";
import { FarmLine, SegmentPanelView } from "@/components/SegmentPanels";
import { BAG_KG, dayEconomics, monthEconomics, rangeEconomics, flockMonthEconomics } from "@/lib/costs/engine";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<AlertKind, string> = {
  production_drop: "Production drop",
  high_mortality: "High mortality",
  low_feed_stock: "Low feed stock",
  egg_buildup: "Egg stock build-up",
  bird_count_anomaly: "Bird-count change",
  feed_anomaly: "Feed anomaly",
  missing_day: "Missing data",
  flock_health: "Flock may be sick",
  feed_efficiency: "Feed giving fewer eggs",
  fcr: "Feed giving fewer egg kilos (FCR)",
};


const iso = /^\d{4}-\d{2}-\d{2}$/;
const pretty = dmy;

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 28;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Eggs per 100 birds over the last 14 days">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const SPARK_COLOR: Record<CardStatus, string> = {
  ramping: "var(--an-blue)",
  green: "var(--an-green)",
  amber: "var(--an-amber)",
  red: "var(--an-red)",
  moult: "var(--an-blue)",
  no_reference: "var(--muted)",
  left: "var(--muted)",
};


export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; month?: string; view?: string; p?: string; from?: string | string[]; to?: string | string[]; f?: string | string[] }>;
}) {
  const sp = await searchParams;
  // one wave of parallel reads (every extra round trip to the database costs a second on a slow connection)
  const [engineInput, costInput, extras, feedbackRows] = await Promise.all([
    loadEngineInput(),
    loadCostInput(),
    loadPeriodExtras(),
    pool.query(`SELECT alert_key, verdict FROM alert_feedback WHERE farm_code = $1`, [ACTIVE_FARM]),
  ]);
  const { ctx } = buildFarmCtx(engineInput);
  const slips = slipItems(ctx);
  const forecast = forecastAlerts(engineInput.weather ?? [], todayIST());
  after(() => refreshWeatherQuietly()); // after the page is sent: the page never waits for the weather service
  const view = sp.view === "week" || sp.view === "month" || sp.view === "year" ? sp.view : "day";

  if (sp.view === "custom" && ctx.dates.length > 0) {
    return (
      <>
        <h1>Analytics</h1>
        <DataStamp latest={lastDayOfData(ctx)} today={new Date().toISOString().slice(0, 10)} />
        <RangeView input={engineInput} cost={costInput} extras={extras} sp={sp} today={todayIST()} />
      </>
    );
  }

  if (view !== "day" && ctx.dates.length > 0) {
    return (
      <>
        <h1>Analytics</h1>
        <DataStamp latest={lastDayOfData(ctx)} today={new Date().toISOString().slice(0, 10)} />
        <PeriodView input={engineInput} cost={costInput} extras={extras} kind={view} p={sp.p} />
      </>
    );
  }

  if (ctx.dates.length === 0) {
    return (
      <>
        <h1>Analytics</h1>
        <p className="card muted">No Daily Production rows yet.</p>
      </>
    );
  }

  const latest = lastDayOfData(ctx);
  const asOf = iso.test(sp.date ?? "") && ctx.dates.includes(sp.date!) ? sp.date! : latest;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : asOf.slice(0, 7);
  const months = [...new Set(ctx.dates.map((d) => d.slice(0, 7)))];

  const panels = allSegmentPanels(ctx, extras, asOf);
  const chk = farmCheck(ctx, asOf);
  const alertsToday = alertsFor(ctx, asOf);
  const earlier: { date: string; alerts: Alert[] }[] = [];
  for (let i = 1; i <= 6; i++) {
    const d = addDays(asOf, -i);
    const a = alertsFor(ctx, d);
    if (a.length) earlier.push({ date: d, alerts: a });
  }
  const verdicts = new Map<string, string>(
    feedbackRows.rows.map((r) => [r.alert_key, r.verdict])
  );
  const cards = flockCards(ctx, asOf);
  const live = cards.filter((c) => c.status !== "left");
  const gone = cards.filter((c) => c.status === "left");
  const watchBySeg = { main: watchList(ctx, asOf, "main"), young: watchList(ctx, asOf, "young") };
  const watch: ReturnType<typeof watchList> = [];
  const watchFarm = watch;
  const money = dayEconomics(costInput, asOf);
  const week = rangeEconomics(costInput, addDays(asOf, -6), asOf);
  const monthMoney = monthEconomics(costInput, month);
  const flockMoney = new Map(flockMonthEconomics(costInput, month).map((f) => [f.flockId, f]));
  if (week.revenuePerEgg != null && week.costPerEgg != null && week.revenuePerEgg < week.costPerEgg) {
    watch.push({
      kind: "trending_below",
      flockId: null,
      label: null,
      text: `Revenue per egg ₹${week.revenuePerEgg.toFixed(2)} is below cost per egg ₹${week.costPerEgg.toFixed(2)} over the last ${week.days} days (estimate).`,
    });
  }
  const mv = monthView(ctx, month);
  const monthBySeg = { main: monthView(ctx, month, "main"), young: monthView(ctx, month, "young") };
  const returnTo = `/analytics?date=${asOf}&month=${month}`;
  // V17: eggs per kg of feed for each flock over the month (its own days with feed)
  const monthFcr = new Map([...ctx.byFlock].map(([id, rs]) => [id, fcrOf(ctx, rs.filter((r) => r.date.startsWith(month)))]));
  const monthEff = new Map([...ctx.byFlock].map(([id, rs]) => [id, feedEfficiency(rs.filter((r) => r.date.startsWith(month)).map((r) => ({ date: r.date, eggs: r.eggs, feed: r.feed })))]));

  return (
    <>
      <h1>Analytics</h1>
      <DataStamp latest={latest} today={new Date().toISOString().slice(0, 10)} />
      <p className="muted an-sub">
        HD % means <b>eggs per 100 birds</b>. The <b>breeder&apos;s target</b> is the book (perfect conditions). <b>Our realistic target</b> is learned from this farm&apos;s own good weeks. <Link href="/analytics/targets">How is this learned? →</Link> <Link href="/flagged">Review flags →</Link>
      </p>

      <ViewSwitch view="day" anchor={asOf} />
      <form method="get" className="card an-picker">
        <label className="field">
          <span>Show the board as of</span>
          <select name="date" defaultValue={asOf}>
            {[...ctx.dates].reverse().map((d) => (
              <option key={d} value={d}>
                {pretty(d)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-secondary">
          Go
        </button>
      </form>
      <ShareMenu query={shareQuery({ view: "board", from: addDays(asOf, -6), to: asOf })} what={`The board's 7 days, ${pretty(addDays(asOf, -6))} to ${pretty(asOf)}, all flocks. Other dates: "Choose what to share".`} />

      {/* ---- One panel per segment, whole farm last ---- */}
      {panels.map((p) => (
        <SegmentPanelView key={p.segment} p={p} detailHref={`/analytics?date=${asOf}#alerts`} />
      ))}
      <FarmLine panels={panels} eggs={chk.all?.eggs ?? 0} birds={chk.all?.birds ?? 0} hd={chk.all?.hd ?? null} unassigned={chk.unassigned} ok={chk.ok} />

      {/* ---- Money (estimate) ---- */}
      <section className="card" aria-labelledby="an-money-h">
        <h2 id="an-money-h" style={{ marginTop: 0 }}>Money — {pretty(asOf)} <span className="badge badge-flagged">estimate</span></h2>
        <div className="an-grid">
          <div className="an-metric"><div className="an-metric-title">Egg revenue</div><div className="an-metric-value">{money.revenue ? `₹${n0(money.revenue)}` : "—"}</div><div className="an-metric-cmp">{n0(money.eggsSold)} eggs sold</div></div>
          <div className="an-metric"><div className="an-metric-title">Cost</div><div className="an-metric-value">₹{n0(money.cost.total)}</div><div className="an-metric-cmp">feed ₹{n0(money.cost.feed)}</div></div>
          <div className="an-metric"><div className="an-metric-title">Profit</div><div className="an-metric-value">{money.revenue ? `₹${n0(money.profit)}` : "—"}</div></div>
          <div className="an-metric"><div className="an-metric-title">Revenue / egg</div><div className="an-metric-value">{money.revenuePerEgg != null ? `₹${money.revenuePerEgg.toFixed(2)}` : "—"}</div></div>
          <div className="an-metric"><div className="an-metric-title">Cost / egg</div><div className="an-metric-value">{money.costPerEgg != null ? `₹${money.costPerEgg.toFixed(2)}` : "—"}</div></div>
        </div>
        {money.unpricedEggsSold > 0 && <div className="flag-banner" style={{ marginTop: "0.6rem" }}>{n0(money.unpricedEggsSold)} eggs were sold this day with no BAFTA rate entered, so revenue and profit are left out rather than guessed. <Link href="/sales/rates">Enter the rates</Link></div>}
        {money.missing.length > 0 && <div className="flag-banner" style={{ marginTop: "0.6rem" }}>Cost is missing: {money.missing.join(", ")}.</div>}
        <p className="muted an-foot">Feed is exact: each shed&apos;s bags × {BAG_KG} kg × its own price that day ({money.feedBy.length ? money.feedBy.map((g) => `${g.label.startsWith("Formula: ") ? g.label.slice(9) : "farm default"} ₹${g.perKg.toFixed(2)}/kg on ${n0(g.bags)} bags`).join("; ") : "no feed that day"}{money.feedNotPriced.length ? `; ${money.feedNotPriced.join(", ")}: price not entered` : ""}). Electricity, labour and packing are spread/estimated; diesel and medicines count the day bought. Revenue is eggs <em>sold</em> that day, not laid.</p>
      </section>

      {/* ---- Alerts ---- */}
      <section aria-labelledby="an-alerts-h" id="alerts">
        <h2 id="an-alerts-h">
          Alerts <span className="badge badge-flagged">{alertsToday.length}</span>
        </h2>
        {alertsToday.length === 0 && <p className="card muted">Nothing to alert on for {pretty(asOf)}.</p>}
        {[...SEGMENTS, null].map((g) => {
          const list = alertsToday.filter((a) => a.segment === g);
          if (list.length === 0) return null;
          return (
            <div key={g ?? "none"}>
              <h3 className="an-daystamp">{g ? SEGMENT_NAME[g] : "Flocks with no segment set"} · {list.length}</h3>
              {list.map((a) => <AlertCard key={a.key} a={a} returnTo={returnTo} verdict={verdicts.get(a.key)} />)}
            </div>
          );
        })}
        {earlier.length > 0 && (
          <details className="card">
            <summary>
              Earlier this week ({earlier.reduce((s, e) => s + e.alerts.length, 0)})
            </summary>
            {earlier.map((e) => (
              <div key={e.date}>
                <h3 className="an-daystamp">{pretty(e.date)}</h3>
                {e.alerts.map((a, i) => (
                  <AlertCard key={i} a={a} returnTo={returnTo} compact verdict={verdicts.get(a.key)} />
                ))}
              </div>
            ))}
          </details>
        )}
        <p className="muted an-foot">
          Left out on purpose: anything marked reviewed, a production drop or zero-feed day while a flock is moulting (inferred from the data — nothing records moults yet), and a flock that left with a bird-movement record.
        </p>
      </section>

      {/* ---- What can go wrong next ---- */}
      <section aria-labelledby="an-next-h">
        <h2 id="an-next-h">What can go wrong next</h2>
        {SEGMENTS.map((g) => {
          const w = watchBySeg[g];
          return (
            <div className="card" key={g}>
              <h3 style={{ marginTop: 0 }}>{SEGMENT_NAME[g]}</h3>
              {slips.filter((x) => x.group === g).map((x) => (
                <p key={x.id} className="an-note" style={{ borderLeft: "4px solid #b7791f", paddingLeft: "0.5rem" }}>
                  <strong>⚠ {x.title}</strong> {x.detail} <Link href="/analytics/targets">See how it moved →</Link>
                </p>
              ))}
              {w.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>{g === "young" ? "Nothing to watch: no mortality creep. Young flocks are not judged against a target while they ramp up." : "No flock is slipping below its target and no flock has rising deaths."}</p>
              ) : (
                <ul className="an-list">
                  {w.map((x, i) => (
                    <li key={i}>
                      <strong>{x.kind === "trending_below" ? "Slipping below target" : x.kind === "mortality_creeping" ? "Mortality creeping" : "Feed days left"}.</strong>{" "}
                      {x.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {forecast.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Weather coming</h3>
            <ul className="an-list">
              {forecast.map((f) => (
                <li key={f.id}>
                  <strong>⚠ {f.title}</strong> {f.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
        {ctx.weatherByDate.size === 0 && <p className="muted an-tiny">Weather is not available yet, so there are no heat or cold warnings. It fills in by itself once the daily weather job has run.</p>}
        {watchFarm.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Whole farm</h3>
            <ul className="an-list">{watchFarm.map((x, i) => <li key={i}>{x.text}</li>)}</ul>
          </div>
        )}
      </section>

      {/* ---- Flock cards ---- */}
      <section aria-labelledby="an-flocks-h">
        <h2 id="an-flocks-h">Each flock against our realistic target</h2>
        <p className="muted an-sub">
          ✔ On our target: at least 90% of our realistic target for the flock&apos;s age. ⚠ Below: 80–90%. ✖ Well below: under 80%. The breeder&apos;s book is shown beside it, with the gap as a plain number and no colour. Where our realistic target is not learned yet for an age, or a flock has no placement date, the card says so in grey instead of a colour. Tap a flock for its page.
        </p>
        {[...SEGMENTS, null].map((g) => {
          const list = live.filter((c) => c.segment === g);
          if (list.length === 0) return null;
          return (
            <div key={g ?? "none"}>
              <h3 className="an-daystamp">{g ? SEGMENT_NAME[g] : "Segment not set"} · {list.length}</h3>
              <div className="an-cards">
                {list.map((c) => <FlockCardView key={c.flockId} c={c} eff={flockEff(ctx, c.flockId, asOf)} hh={flockHenHoused(ctx, c.flockId, asOf)} fcr={flockFcr(ctx, c.flockId, asOf)} />)}
              </div>
            </div>
          );
        })}
        {gone.length > 0 && (
          <details className="card">
            <summary>Flocks no longer on the register ({gone.length})</summary>
            <ul className="an-list">
              {gone.map((c) => (
                <li key={c.flockId}>
                  <strong>{c.label}</strong> {c.tag ? <span className="muted">({c.tag})</span> : null} — last reported {pretty(c.lastDate)}
                  {c.formerLabels.length ? `; earlier labels ${c.formerLabels.join(", ")}` : ""}.
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ---- Month ---- */}
      <section aria-labelledby="an-month-h">
        <h2 id="an-month-h">Month view</h2>
        <div className="actions-bar">
          {months.map((m) => (
            <Link key={m} href={`/analytics?date=${asOf}&month=${m}`} className={m === month ? "btn" : "btn-secondary btn"}>
              {new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}
            </Link>
          ))}
        </div>
        {SEGMENTS.map((g) => {
          const m = monthBySeg[g];
          if (m.rows.length === 0) return null;
          return (
            <div key={g}>
              <h3 className="an-daystamp">{SEGMENT_NAME[g]}</h3>
              <MonthTable mv={m} monthMoney={monthMoney} flockMoney={flockMoney} effByFlock={monthEff} effTotal={effOn(ctx, ctx.dates.filter((d) => d.startsWith(month)), g)} fcrByFlock={monthFcr} fcrTotal={fcrOn(ctx, ctx.dates.filter((d) => d.startsWith(month)), g)} />
            </div>
          );
        })}
        <h3 className="an-daystamp">Whole farm (sum of the groups; mixes mature and young birds)</h3>
        <MonthTable mv={mv} monthMoney={monthMoney} flockMoney={flockMoney} totalOnly effByFlock={monthEff} effTotal={effOn(ctx, ctx.dates.filter((d) => d.startsWith(month)), "all")} fcrByFlock={monthFcr} fcrTotal={fcrOn(ctx, ctx.dates.filter((d) => d.startsWith(month)), "all")} />
        <p className="muted an-foot">
          Deaths % = deaths ÷ birds at the start of the flock&apos;s first day in the month. Chick-shed deaths this month: {n0(mv.chickDeaths)} (not in the table).
          {monthMoney.revenue ? ` Farm: revenue ₹${n0(monthMoney.revenue)}, cost ₹${n0(monthMoney.cost.total)}, estimated profit ₹${n0(monthMoney.profit)}${monthMoney.revenuePerEgg != null && monthMoney.costPerEgg != null ? `; revenue per egg ₹${monthMoney.revenuePerEgg.toFixed(2)} vs cost per egg ₹${monthMoney.costPerEgg.toFixed(2)}` : ""}. Per-flock profit is an estimate (feed exact, other costs by bird count, revenue by eggs laid).` : " Revenue and profit are left out for this month: no BAFTA rates have been entered, so nothing is priced."}
          {monthMoney.birdSaleRevenue > 0 ? ` Bird sales this month ₹${n0(monthMoney.birdSaleRevenue)} (not in egg revenue).` : ""}
        </p>
      </section>
    </>
  );
}

function MonthEff({ e }: { e: FeedEff | undefined }) {
  if (!e) return <>–</>;
  if (e.eggsPerKg == null) return <span className="muted an-tiny">feed not recorded</span>;
  return <>{n2(e.eggsPerKg)}{e.daysWithFeed < e.days ? <span className="muted an-tiny"> ({e.daysWithFeed} of {e.days} days)</span> : null}</>;
}

function MonthFcr({ f }: { f: FcrResult | undefined }) {
  if (!f) return <>–</>;
  if (f.fcr == null) return <span className="muted an-tiny">{f.why?.startsWith("feed not recorded") ? "feed not recorded" : f.why?.startsWith("past the end") ? "beyond the book's egg weights" : "–"}</span>;
  return <>{n2(f.fcr)}{f.standardFcr != null ? <span className="muted an-tiny"> (book {n2(f.standardFcr)})</span> : null}</>;
}

function MonthTable({ mv, monthMoney, flockMoney, totalOnly, effByFlock, effTotal, fcrByFlock, fcrTotal }: { mv: ReturnType<typeof monthView>; monthMoney: ReturnType<typeof monthEconomics>; flockMoney: Map<string, { profit: number; feed: number; feedMissing: boolean }>; totalOnly?: boolean; effByFlock: Map<string, FeedEff>; effTotal: FeedEff; fcrByFlock: Map<string, FcrResult>; fcrTotal: FcrResult }) {
  return (
        <div className="card an-scroll">
          <table className="an-table">
            <thead>
              <tr>
                <th>Flock</th>
                <th className="num">Days</th>
                <th className="num">Eggs</th>
                <th className="num">Eggs per 100 birds</th>
                <th className="num">Feed bags (month total)</th>
                <th className="num">Feed cost ₹ (month, each shed&apos;s price)</th>
                <th className="num">Deaths</th>
                <th className="num">Deaths %</th>
                <th className="num">Est. profit ₹</th>
                <th className="num">Eggs per kg feed (month)</th>
                <th className="num">FCR, est. (month)</th>
              </tr>
            </thead>
            <tbody>
              {(totalOnly ? [] : mv.rows).map((r) => (
                <tr key={r.flockId}>
                  <td>
                    <strong>{r.label}</strong>
                    {r.labels.length > 1 && <div className="muted an-tiny">{r.labels.join(" → ")}</div>}
                    {r.note && <div className="muted an-tiny">{r.note}</div>}
                  </td>
                  <td className="num">{r.days}</td>
                  <td className="num">{n0(r.eggs)}</td>
                  <td className="num">{r.hd != null ? n1(r.hd) : "–"}</td>
                  <td className="num">{r.feedDays === 0 ? "not recorded" : `${n0(r.feed)}${r.feedDays < r.days ? ` (feed on ${r.feedDays} of ${r.days} days)` : ""}`}</td>
                  <td className="num">{(() => { const fm = r.flockId ? flockMoney.get(r.flockId) : undefined; return r.feedDays === 0 || !fm ? "–" : fm.feedMissing ? <span className="badge badge-flagged">not entered</span> : n0(fm.feed); })()}</td>
                  <td className="num">{n0(r.mort)}</td>
                  <td className="num">{r.mortPct != null ? r.mortPct.toFixed(2) : "–"}</td>
                  <td className="num">{r.flockId && monthMoney.revenue && flockMoney.get(r.flockId) ? n0(flockMoney.get(r.flockId)!.profit) : "–"}</td>
                  <td className="num"><MonthEff e={r.flockId ? effByFlock.get(r.flockId) : undefined} /></td>
                  <td className="num"><MonthFcr f={r.flockId ? fcrByFlock.get(r.flockId) : undefined} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{mv.total.label}</th>
                <th className="num">{mv.total.days}</th>
                <th className="num">{n0(mv.total.eggs)}</th>
                <th className="num">{mv.total.hd != null ? n1(mv.total.hd) : "–"}</th>
                <th className="num">{mv.total.feedDays === 0 ? "not recorded" : `${n0(mv.total.feed)}${mv.total.feedDays < mv.total.days ? ` (feed on ${mv.total.feedDays} of ${mv.total.days} days)` : ""}`}</th>
                <th className="num">{(() => {
                  // the feed cost of the rows above, added up shed by shed (feed is exact per shed; never all bags × one price)
                  if (mv.total.feedDays === 0) return "–";
                  if (mv.total.label === "Farm total") return monthMoney.missing.includes("feed price per kg") ? "not entered" : n0(monthMoney.cost.feed);
                  const fms = mv.rows.map((r) => (r.flockId ? flockMoney.get(r.flockId) : undefined)).filter((x): x is NonNullable<typeof x> => !!x);
                  return fms.some((x) => x.feedMissing) ? "not entered" : n0(fms.reduce((t, x) => t + x.feed, 0));
                })()}</th>
                <th className="num">{n0(mv.total.mort)}</th>
                <th className="num">–</th>
                <th className="num">{monthMoney.revenue && mv.total.label === "Farm total" ? n0(monthMoney.profit) : "–"}</th>
                <th className="num"><MonthEff e={effTotal} /></th>
                <th className="num"><MonthFcr f={fcrTotal} /></th>
              </tr>
            </tfoot>
          </table>
        </div>
  );
}

function AlertCard({ a, returnTo, compact, verdict }: { a: Alert; returnTo: string; compact?: boolean; verdict?: string }) {
  return (
    <div className={`card an-alert an-alert-${a.kind}`}>
      <div className="an-alert-head">
        <span className="badge badge-flagged">{KIND_LABEL[a.kind]}</span>
        {a.flockLabel && (
          <strong>
            {a.flockLabel}
            {a.registerLabel && a.registerLabel !== a.flockLabel ? <span className="muted an-tiny"> · register {a.registerLabel}</span> : null}
            {a.flockTag ? <span className="muted an-tiny"> · {a.flockTag}</span> : null}
          </strong>
        )}
        {!compact && <span className="muted an-tiny">{pretty(a.date)}</span>}
      </div>
      <p className="an-reason">{a.reason}</p>
      <div className="an-verdict">
        <span className="muted an-tiny">Was this alert useful?</span>
        <form action={saveAlertFeedback.bind(null, a.key, "real", returnTo)}>
          <button type="submit" className={verdict === "real" ? "an-small an-v-on" : "btn-secondary an-small"} aria-pressed={verdict === "real"}>This was real</button>
        </form>
        <form action={saveAlertFeedback.bind(null, a.key, "noise", returnTo)}>
          <button type="submit" className={verdict === "noise" ? "an-small an-v-on" : "btn-secondary an-small"} aria-pressed={verdict === "noise"}>This was noise</button>
        </form>
      </div>
      {a.source && (
        <form action={markAlertReviewed.bind(null, a.source.table, a.source.id, returnTo)}>
          <button type="submit" className="btn-secondary an-small">
            Reviewed — stop alerting on this record
          </button>
        </form>
      )}
    </div>
  );
}

/** V16: a flock's feed on the board day and over its last 7 rows, each with its period in the words. */
function FlockFeedLines({ f }: { f: FlockCard["feed"] }) {
  if (f.week.daysRecorded === 0) return <div className="muted an-tiny">Feed: not recorded for this flock (the register has no feed figure on these days).</div>;
  return (
    <div className="muted an-tiny an-feedlines">
      <div>Feed today: {f.day.recorded ? <><b>{n0(f.day.bags)}</b> bags{f.day.gPerBird != null ? ` · ${n0(f.day.gPerBird)} g/bird` : ""}</> : "feed not recorded"}</div>
      <div>Feed, last 7 days: {n1(f.week.bagsPerDay)} bags a day on average · {f.week.gPerBird != null ? `${n0(f.week.gPerBird)} g/bird a day` : "–"}{f.week.daysRecorded < f.week.days ? ` (feed on ${f.week.daysRecorded} of ${f.week.days} days)` : ""}</div>
    </div>
  );
}

const n2 = (x: number) => x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** V17: a flock's eggs per kg of feed on the board day and over its last 7 rows, each labelled. */
function FlockEffLine({ e }: { e: { day: FeedEff; week: FeedEff } }) {
  if (e.week.eggsPerKg == null) return <div className="muted an-tiny">Eggs per kg feed: feed not recorded for this flock on these days.</div>;
  return (
    <div className="muted an-tiny">
      Eggs per kg feed: today {e.day.eggsPerKg != null ? <b>{n2(e.day.eggsPerKg)}</b> : "feed not recorded"} · last 7 days {n2(e.week.eggsPerKg)}
      {e.week.daysWithFeed < e.week.days ? ` (${e.week.daysWithFeed} of ${e.week.days} days with feed)` : ""}
    </div>
  );
}

/** V17: a flock's hen-housed figures: since housing (eggs per hen housed, the book beside it when the number is real) and the last 7 days. */
function FlockHHLine({ h }: { h: ReturnType<typeof flockHenHoused> }) {
  if (!h) return null;
  const s = h.since;
  const real = s.housed.source !== "standin";
  return (
    <div className="muted an-tiny">
      Hen-housed: <b>{n1(s.perHen)}</b> eggs per hen housed since {s.from.slice(8, 10).replace(/^0/, "")} {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(s.from.slice(5, 7)) - 1]}
      {real && s.book.perHen != null ? ` (book ${n1(s.book.perHen)})` : ""}
      {h.last7?.hhPct != null ? ` · last 7 days ${n1(h.last7.hhPct)}% of hens housed${h.last7.book.hhPct != null ? ` (book ${n1(h.last7.book.hhPct)})` : ""}` : ""}
      {real ? ` · ${n0(s.housed.count)} housed` : " · stand-in: the 2 Jul count, the number housed is not known"}
    </div>
  );
}

/** V18: a flock's FCR (estimated from the standard egg weight unless weighed) on the board day and over its last 7 rows. */
function FlockFcrLine({ f }: { f: { day: FcrResult; week: FcrResult } }) {
  const w = f.week;
  if (w.fcr == null) return <div className="muted an-tiny">FCR: {w.why ?? "not available"}{w.feedPerEggG != null ? ` · feed ${n1(w.feedPerEggG)} g per egg (last 7 days)` : ""}</div>;
  return (
    <div className="muted an-tiny">
      FCR ({w.weight.actualRows ? "with weighed eggs" : "est. from standard egg weight"}): today {f.day.fcr != null ? <b>{n2(f.day.fcr)}</b> : (f.day.why?.startsWith("feed not recorded") ? "feed not recorded" : "–")} · last 7 days {n2(w.fcr)}
      {w.standardFcr != null ? ` (book ${n2(w.standardFcr)})` : ""} · feed {n1(w.feedPerEggG ?? 0)} g per egg
    </div>
  );
}

function FlockCardView({ c, eff, hh, fcr }: { c: FlockCard; eff: { day: FeedEff; week: FeedEff }; hh: ReturnType<typeof flockHenHoused>; fcr: { day: FcrResult; week: FcrResult } }) {
  return (
    <Link href={`/flocks/${c.flockId}`} className={`card an-flock an-${c.status} card-link`}>
      <div className="an-flock-head">
        <div>
          <strong className="an-flock-name">{c.label}</strong>
          <div className="muted an-tiny">
            {[
              c.registerLabel !== c.label && c.registerLabel ? `written in the register as ${c.registerLabel}` : "",
              c.placementDate ? (c.tag ?? "") : "placement date not set",
              c.ageWeeks != null ? `week ${c.ageWeeks}` : "",
              c.breed ? breedName(c.breed) : "",
            ].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className={`an-pill an-pill-${chip(c).css}`}><span aria-hidden="true">{chip(c).icon}</span> {chip(c).label}</span>
      </div>
      <div className="an-flock-body">
        <div>
          <div className="an-flock-nums">
            <span>
              <b>{c.hd7 != null ? n1(c.hd7) : "–"}</b> eggs per 100 birds (7 days)
            </span>
          </div>
          <TargetLines c={c} />
          <div className="muted an-tiny">
            {c.birds != null ? `${n0(c.birds)} birds today` : ""}
            {c.mort7 != null ? ` · last 7 days: ${n1(c.mort7)} deaths a day on average` : ""}
          </div>
          <FlockFeedLines f={c.feed} />
          <FlockEffLine e={eff} />
          <FlockHHLine h={hh} />
          <FlockFcrLine f={fcr} />
        </div>
        <Spark values={c.hdSeries} color={SPARK_COLOR[c.status]} />
      </div>
      <p className="an-note">{c.statusNote}</p>
      {c.formerLabels.length > 0 && <p className="muted an-tiny">Written in the register on earlier days as: {c.formerLabels.join(", ")} (the register renumbered when flocks left; this flock is always {c.label} now)</p>}
    </Link>
  );
}
