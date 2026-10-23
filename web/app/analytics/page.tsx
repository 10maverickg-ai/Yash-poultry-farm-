import Link from "next/link";
import { loadEngineInput } from "@/lib/analytics/load";
import {
  addDays,
  alertsFor,
  buildCtx,
  farmToday,
  flockCards,
  lastDayOfData,
  monthView,
  watchList,
  type Alert,
  type AlertKind,
  type CardStatus,
  type FlockCard,
} from "@/lib/analytics/engine";
import { markAlertReviewed } from "./actions";
import { loadCostInput } from "@/lib/costs/load";
import { dayEconomics, monthEconomics, rangeEconomics, flockMonthEconomics } from "@/lib/costs/engine";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<AlertKind, string> = {
  production_drop: "Production drop",
  high_mortality: "High mortality",
  low_feed_stock: "Low feed stock",
  egg_buildup: "Egg stock build-up",
  bird_count_anomaly: "Bird-count change",
  feed_anomaly: "Feed anomaly",
  missing_day: "Missing data",
};

const STATUS_LABEL: Record<CardStatus, string> = {
  green: "On standard",
  amber: "Below standard",
  red: "Well below",
  moult: "Moulting",
  no_reference: "No reference loaded",
  left: "Left the register",
};

const iso = /^\d{4}-\d{2}-\d{2}$/;
const n0 = (x: number) => Math.round(x).toLocaleString("en-IN");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-IN");
const pretty = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Delta({ now, vs, unit = "", invert = false, neutral = false, digits = 0 }: { now: number | null; vs: number | null | undefined; unit?: string; invert?: boolean; neutral?: boolean; digits?: number }) {
  if (now == null || vs == null) return <span className="an-delta">–</span>;
  const d = now - vs;
  const f = (x: number) => (digits === 0 ? n0(Math.abs(x)) : n1(Math.abs(x)));
  if (Math.abs(d) < 0.5 * 10 ** -digits) return <span className="an-delta">same</span>;
  const good = invert ? d < 0 : d > 0;
  return (
    <span className={`an-delta ${neutral ? "" : good ? "an-up" : "an-down"}`}>
      {d > 0 ? "▲" : "▼"} {f(d)}
      {unit}
    </span>
  );
}

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
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="HD% over the last 14 days">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const SPARK_COLOR: Record<CardStatus, string> = {
  green: "var(--an-green)",
  amber: "var(--an-amber)",
  red: "var(--an-red)",
  moult: "var(--an-blue)",
  no_reference: "var(--muted)",
  left: "var(--muted)",
};


export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const [engineInput, costInput] = await Promise.all([loadEngineInput(), loadCostInput()]);
  const ctx = buildCtx(engineInput);

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

  const ft = farmToday(ctx, asOf);
  const t = ft.today;
  const alertsToday = alertsFor(ctx, asOf);
  const earlier: { date: string; alerts: Alert[] }[] = [];
  for (let i = 1; i <= 6; i++) {
    const d = addDays(asOf, -i);
    const a = alertsFor(ctx, d);
    if (a.length) earlier.push({ date: d, alerts: a });
  }
  const cards = flockCards(ctx, asOf);
  const live = cards.filter((c) => c.status !== "left");
  const gone = cards.filter((c) => c.status === "left");
  const watch = watchList(ctx, asOf);
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
  const returnTo = `/analytics?date=${asOf}&month=${month}`;
  const staleDays = Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(latest)) / 86400000);

  return (
    <>
      <h1>Analytics</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Data through <strong>{pretty(latest)}</strong>
        {staleDays > 1 ? ` (${staleDays} days ago — nothing newer has been entered)` : ""}.{" "}
        <Link href="/flagged">{"Review flags →"}</Link>
      </p>

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

      {/* ---- Farm today ---- */}
      <section className="card an-today" aria-labelledby="an-today-h">
        <h2 id="an-today-h">Farm — {pretty(asOf)}</h2>
        {t ? (
          <>
            <p className="muted an-sub">
              {t.flocks} flock{t.flocks === 1 ? "" : "s"} reporting
              {ft.yesterday && ft.yesterday.flocks !== t.flocks ? ` (${ft.yesterday.flocks} yesterday)` : ""} · {n0(t.birds)} birds
            </p>
            <div className="an-grid">
              <Metric title="Eggs" value={n0(t.eggs)} t={t.eggs} y={ft.yesterday?.eggs} a={ft.avg7?.eggs} />
              <Metric title="Trays" value={n0(t.trays)} t={t.trays} y={ft.yesterday?.trays} a={ft.avg7?.trays} />
              <Metric title="HD %" value={t.hd != null ? `${n1(t.hd)}%` : "–"} t={t.hd} y={ft.yesterday?.hd} a={ft.avg7?.hd} digits={1} unit=" pts" />
              <Metric title="Deaths" value={n0(t.mort)} t={t.mort} y={ft.yesterday?.mort} a={ft.avg7?.mort} invert />
              <Metric title="Feed (bags)" value={n0(t.feed)} t={t.feed} y={ft.yesterday?.feed} a={ft.avg7?.feed} neutral />
            </div>
            <p className="muted an-foot">
              Each line: change vs yesterday · vs the 7-day average{ft.avg7 ? ` (${ft.avg7.days} days)` : ""}. Totals fall when a flock leaves the register — that is not a production drop.
            </p>
          </>
        ) : (
          <p className="muted">No production rows for this date.</p>
        )}
      </section>

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
        <p className="muted an-foot">Feed is exact; electricity, labour and packing are spread/estimated; diesel and medicines count the day bought. Revenue is eggs <em>sold</em> that day, not laid.</p>
      </section>

      {/* ---- Alerts ---- */}
      <section aria-labelledby="an-alerts-h">
        <h2 id="an-alerts-h">
          Alerts <span className="badge badge-flagged">{alertsToday.length}</span>
        </h2>
        {alertsToday.length === 0 && <p className="card muted">Nothing to alert on for {pretty(asOf)}.</p>}
        {alertsToday.map((a, i) => (
          <AlertCard key={i} a={a} returnTo={returnTo} />
        ))}
        {earlier.length > 0 && (
          <details className="card">
            <summary>
              Earlier this week ({earlier.reduce((s, e) => s + e.alerts.length, 0)})
            </summary>
            {earlier.map((e) => (
              <div key={e.date}>
                <h3 className="an-daystamp">{pretty(e.date)}</h3>
                {e.alerts.map((a, i) => (
                  <AlertCard key={i} a={a} returnTo={returnTo} compact />
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
        <div className="card">
          {watch.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No flock is trending below standard, no mortality creep, and feed days left could not be worked out.</p>
          ) : (
            <ul className="an-list">
              {watch.map((w, i) => (
                <li key={i}>
                  <strong>{w.kind === "trending_below" ? "Trending below standard" : w.kind === "mortality_creeping" ? "Mortality creeping" : "Feed days left"}.</strong>{" "}
                  {w.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---- Flock cards ---- */}
      <section aria-labelledby="an-flocks-h">
        <h2 id="an-flocks-h">Flocks vs BV300 standard</h2>
        <p className="muted an-sub">
          Green: 7-day HD at least 90% of the standard for the flock&apos;s age; amber 80–90%; red under 80%. A flock is identified by the database, not the register label — labels shift when a flock leaves.
        </p>
        <div className="an-cards">
          {live.map((c) => (
            <FlockCardView key={c.flockId} c={c} />
          ))}
        </div>
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
        <div className="card an-scroll">
          <table className="an-table">
            <thead>
              <tr>
                <th>Flock</th>
                <th className="num">Days</th>
                <th className="num">Eggs</th>
                <th className="num">HD %</th>
                <th className="num">Feed bags</th>
                <th className="num">Deaths</th>
                <th className="num">Deaths %</th>
                <th className="num">Est. profit ₹</th>
              </tr>
            </thead>
            <tbody>
              {mv.rows.map((r) => (
                <tr key={r.flockId}>
                  <td>
                    <strong>{r.label}</strong>
                    {r.labels.length > 1 && <div className="muted an-tiny">{r.labels.join(" → ")}</div>}
                    {r.note && <div className="muted an-tiny">{r.note}</div>}
                  </td>
                  <td className="num">{r.days}</td>
                  <td className="num">{n0(r.eggs)}</td>
                  <td className="num">{r.hd != null ? n1(r.hd) : "–"}</td>
                  <td className="num">{n0(r.feed)}</td>
                  <td className="num">{n0(r.mort)}</td>
                  <td className="num">{r.mortPct != null ? r.mortPct.toFixed(2) : "–"}</td>
                  <td className="num">{r.flockId && monthMoney.revenue && flockMoney.get(r.flockId) ? n0(flockMoney.get(r.flockId)!.profit) : "–"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Farm total</th>
                <th className="num">{mv.total.days}</th>
                <th className="num">{n0(mv.total.eggs)}</th>
                <th className="num">{mv.total.hd != null ? n1(mv.total.hd) : "–"}</th>
                <th className="num">{n0(mv.total.feed)}</th>
                <th className="num">{n0(mv.total.mort)}</th>
                <th className="num">–</th>
                <th className="num">{monthMoney.revenue ? n0(monthMoney.profit) : "–"}</th>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted an-foot">
          Deaths % = deaths ÷ birds at the start of the flock&apos;s first day in the month. Chick-shed deaths this month: {n0(mv.chickDeaths)} (not in the table).
          {monthMoney.revenue ? ` Farm: revenue ₹${n0(monthMoney.revenue)}, cost ₹${n0(monthMoney.cost.total)}, estimated profit ₹${n0(monthMoney.profit)}${monthMoney.revenuePerEgg != null && monthMoney.costPerEgg != null ? `; revenue per egg ₹${monthMoney.revenuePerEgg.toFixed(2)} vs cost per egg ₹${monthMoney.costPerEgg.toFixed(2)}` : ""}. Per-flock profit is an estimate (feed exact, other costs by bird count, revenue by eggs laid).` : " Revenue and profit are left out for this month: no BAFTA rates have been entered, so nothing is priced."}
          {monthMoney.birdSaleRevenue > 0 ? ` Bird sales this month ₹${n0(monthMoney.birdSaleRevenue)} (not in egg revenue).` : ""}
        </p>
      </section>
    </>
  );
}

function Metric({
  title,
  value,
  t,
  y,
  a,
  unit,
  invert,
  neutral,
  digits = 0,
}: {
  title: string;
  value: string;
  t: number | null;
  y: number | null | undefined;
  a: number | null | undefined;
  unit?: string;
  invert?: boolean;
  neutral?: boolean;
  digits?: number;
}) {
  return (
    <div className="an-metric">
      <div className="an-metric-title">{title}</div>
      <div className="an-metric-value">{value}</div>
      <div className="an-metric-cmp">
        <Delta now={t} vs={y} unit={unit} invert={invert} neutral={neutral} digits={digits} />
        <span className="an-dot">·</span>
        <Delta now={t} vs={a} unit={unit} invert={invert} neutral={neutral} digits={digits} />
      </div>
    </div>
  );
}

function AlertCard({ a, returnTo, compact }: { a: Alert; returnTo: string; compact?: boolean }) {
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

function FlockCardView({ c }: { c: FlockCard }) {
  return (
    <div className={`card an-flock an-${c.status}`}>
      <div className="an-flock-head">
        <div>
          <strong className="an-flock-name">{c.label}</strong>
          <div className="muted an-tiny">
            {c.registerLabel !== c.label ? `register label ${c.registerLabel} · ` : ""}
            {c.tag ?? ""}
            {c.ageWeeks != null ? ` · week ${c.ageWeeks}` : ""}
            {c.breed ? ` · ${c.breed}` : ""}
          </div>
        </div>
        <span className={`an-pill an-pill-${c.status}`}>{STATUS_LABEL[c.status]}</span>
      </div>
      <div className="an-flock-body">
        <div>
          <div className="an-flock-nums">
            <span>
              <b>{c.hd7 != null ? `${n1(c.hd7)}%` : "–"}</b> HD (7-day)
            </span>
            <span>
              <b>{c.stdHd != null ? `${n1(c.stdHd)}%` : "—"}</b> standard
            </span>
          </div>
          <div className="muted an-tiny">
            {c.birds != null ? `${n0(c.birds)} birds` : ""}
            {c.mort7 != null ? ` · ${n1(c.mort7)} deaths/day` : ""}
            {c.feed7 != null ? ` · ${n1(c.feed7)} bags/day` : ""}
          </div>
        </div>
        <Spark values={c.hdSeries} color={SPARK_COLOR[c.status]} />
      </div>
      <p className="an-note">{c.statusNote}</p>
      {c.formerLabels.length > 0 && <p className="muted an-tiny">Earlier register labels: {c.formerLabels.join(", ")}</p>}
    </div>
  );
}
