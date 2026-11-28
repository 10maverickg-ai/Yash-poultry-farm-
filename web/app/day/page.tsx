import Link from "next/link";
import { listProductionDates, loadDay, hdOf } from "@/lib/day/load";
import { ExportLinks } from "@/components/ExportLinks";
import { dmy } from "@/lib/format";
import { SEGMENT_NAME, buildCtx } from "@/lib/analytics/engine";
import { loadEngineInput } from "@/lib/analytics/load";
import { flockFeed, segmentFeed } from "@/lib/analytics/feed";
import { FeedCells } from "@/components/SegmentPanels";
import { feedEfficiency } from "@/lib/analytics/feedEfficiency";
import { fcrOf } from "@/lib/analytics/fcr";
import { ShareMenu } from "@/components/ShareMenu";
import { shareQuery } from "@/lib/export/shareOptions";

export const dynamic = "force-dynamic";

const iso = /^\d{4}-\d{2}-\d{2}$/;
const n0 = (x: number | null | undefined) => (x == null ? "–" : x.toLocaleString("en-IN"));
const pretty = (d: string) => dmy(d);
const TYPE: Record<string, string> = {
  transfer_out: "moved out",
  transfer_in: "moved in",
  sale: "sold",
  cull: "culled",
  unexplained_out: "left (destination not known)",
  unexplained_in: "arrived (source not known)",
  count_adjustment: "count adjusted",
};

export const metadata = { title: "Daily production (day view)" };

/** V16: the flock's feed over its last 7 rows, labelled as such (nothing when it has no feed in that window). */
function FlockWeekFeed({ w }: { w: ReturnType<typeof flockFeed>["week"] | undefined }) {
  if (!w || w.daysRecorded === 0) return null;
  return (
    <div className="muted an-tiny">
      Feed, last 7 days: {(Math.round((w.bagsPerDay ?? 0) * 10) / 10).toLocaleString("en-IN")} bags a day on average · {w.gPerBird != null ? `${Math.round(w.gPerBird)} g/bird a day` : "–"}
      {w.daysRecorded < w.days ? ` (feed on ${w.daysRecorded} of ${w.days} days)` : ""}
    </div>
  );
}

export default async function DayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const dates = await listProductionDates();
  if (dates.length === 0) return (<><h1>Daily production</h1><p className="card muted">No days saved yet. Upload a register photo first.</p></>);
  const date = iso.test(sp.date ?? "") ? sp.date! : dates[dates.length - 1];
  // V16: feed on the day AND over the last 7 days, from the same engine as Analytics (one read of the rows)
  const [d, engineInput] = await Promise.all([loadDay(date), loadEngineInput()]);
  const ctx = buildCtx(engineInput);
  const flockFeeds = new Map(d.rows.map((r) => [r.id, flockFeed(ctx, r.flockId, date)]));

  const eggs = d.rows.reduce((s, r) => s + (r.eggs ?? 0), 0);
  const birds = d.rows.reduce((s, r) => s + (r.birds ?? 0), 0);
  const mort = d.rows.reduce((s, r) => s + (r.mortality ?? 0), 0);
  const feed = d.rows.reduce((s, r) => s + (r.feed ?? 0), 0);
  const chickDeaths = d.chick.reduce((s, c) => s + c.deaths, 0);
  const hd = hdOf(d.rows.length ? eggs : null, birds);
  // per group: a group's HD uses only its own eggs and birds (the whole farm mixes mature and young birds)
  const groups = (["main", "young", null] as const)
    .map((g) => {
      const rs = d.rows.filter((r) => r.segment === g);
      const e = rs.reduce((t, r) => t + (r.eggs ?? 0), 0);
      const b = rs.reduce((t, r) => t + (r.birds ?? 0), 0);
      const fedRows = rs.filter((r) => r.feed != null);
      return { g, rs, eggs: e, birds: b, mort: rs.reduce((t, r) => t + (r.mortality ?? 0), 0), feed: fedRows.reduce((t, r) => t + (r.feed ?? 0), 0), fed: fedRows.length > 0, hd: hdOf(rs.length ? e : null, b), pair: g ? segmentFeed(ctx, date, g) : null, eff: feedEfficiency(rs.map((r) => ({ date, eggs: r.eggs, feed: r.feed }))) };
    })
    .filter((x) => x.rs.length > 0);

  return (
    <>
      <h1>Daily production</h1>
      <div className="day-nav">
        {d.prevDate ? <Link className="btn btn-secondary" href={`/day?date=${d.prevDate}`}>← {d.prevDate.slice(5)}</Link> : <span />}
        <form method="get" className="day-pick">
          <input type="date" name="date" defaultValue={date} aria-label="Date" />
          <button type="submit" className="btn-secondary">Go</button>
        </form>
        {d.nextDate ? <Link className="btn btn-secondary" href={`/day?date=${d.nextDate}`}>{d.nextDate.slice(5)} →</Link> : <span />}
      </div>
      {d.rows.length > 0 && <ShareMenu query={shareQuery({ view: "day", from: date, to: date })} what={`${dmy(date)}, all flocks: the day's eggs, feed, deaths, sales, costs and alerts.`} />}

      <div className="card stack">
        <ExportLinks kind="production" month={date.slice(0, 7)} label="Daily production" />
        <ExportLinks kind="ledger" month={date.slice(0, 7)} label="Egg ledger" />
      </div>

      <section className="card an-today" aria-labelledby="day-total-h">
        <h2 id="day-total-h">{pretty(date)}</h2>
        {d.rows.length === 0 ? (
          <p className="muted">No production rows saved for this day.</p>
        ) : (
          <>
            {groups.map((x) => (
              <div key={x.g ?? "none"} style={{ marginBottom: "0.8rem" }}>
                <h3 className="an-daystamp" style={{ marginTop: 0 }}>{x.g ? SEGMENT_NAME[x.g] : "Segment not set"} · {x.rs.length} flock{x.rs.length === 1 ? "" : "s"}</h3>
                <div className="an-grid">
                  <div className="an-metric"><div className="an-metric-title">HD % (eggs ÷ birds)</div><div className="an-metric-value">{x.hd != null ? `${x.hd.toFixed(1)}%` : "–"}</div></div>
                  <div className="an-metric"><div className="an-metric-title">Eggs</div><div className="an-metric-value">{n0(x.eggs)}</div><div className="an-metric-cmp">{n0(Math.round(x.eggs / 30))} trays</div></div>
                  <div className="an-metric"><div className="an-metric-title">Birds</div><div className="an-metric-value">{n0(x.birds)}</div></div>
                  <div className="an-metric"><div className="an-metric-title">Deaths</div><div className="an-metric-value">{n0(x.mort)}</div></div>
                  {x.pair ? <FeedCells f={x.pair} onDay /> : <div className="an-metric"><div className="an-metric-title">Feed on this day</div><div className={`an-metric-value${x.fed ? "" : " an-metric-words"}`}>{x.fed ? `${n0(x.feed)} bags` : "feed not recorded"}</div></div>}
                  <div className="an-metric"><div className="an-metric-title">Eggs per kg feed (that day)</div><div className={`an-metric-value${x.eff.eggsPerKg == null ? " an-metric-words" : ""}`}>{x.eff.eggsPerKg != null ? x.eff.eggsPerKg.toFixed(2) : "feed not recorded"}</div>{x.eff.eggsPerKg != null && x.eff.kgPer100Eggs != null ? <div className="an-metric-cmp">{x.eff.kgPer100Eggs.toFixed(1)} kg feed per 100 eggs</div> : null}</div>
                </div>
              </div>
            ))}
            <p className="muted an-sub" style={{ marginBottom: 0 }}>
              <b>Whole farm</b> (sum of the groups; it mixes mature and young birds, so its HD % describes neither): {n0(eggs)} eggs · {n0(birds)} birds · {n0(mort)} deaths · {groups.some((x) => x.fed) ? `feed ${n0(feed)} bags that day${groups.some((x) => !x.fed) ? ` (groups that record feed: ${groups.filter((x) => x.fed).map((x) => (x.g ? SEGMENT_NAME[x.g].split(" (")[0].toLowerCase() : "segment not set")).join(", ")})` : ""}` : "feed not recorded"} · HD {hd != null ? `${hd.toFixed(1)}%` : "–"}.
            </p>
          </>
        )}
        <div className="actions-bar" style={{ marginTop: "0.8rem", marginBottom: 0 }}>
          <Link className="btn btn-secondary" href={`/production?date=${date}`}>Correct this day</Link>
          <Link className="btn btn-secondary" href={`/egg-stock?date=${date}`}>Egg ledger</Link>
        </div>
      </section>

      {groups.map((x) => (
        <div key={x.g ?? "none"}>
          <h2 className="an-daystamp">{x.g ? SEGMENT_NAME[x.g] : "Segment not set"}</h2>
          {x.rs.map((r) => (
        <div key={r.id} className={`card day-flock${r.flagged && !r.reviewed ? " day-flagged" : ""}`}>
          <div className="day-flock-head">
            <div>
              <strong className="an-flock-name"><Link href={`/flocks/${r.flockId}`} className="plain-link">{r.flockName}</Link></strong>
              <div className="muted an-tiny">
                {r.registerLabel && r.registerLabel !== r.flockName ? `written in the register as ${r.registerLabel}` : ""}
              </div>
            </div>
            <div className="day-hd">
              <div className="hd-calc-value">{r.hdCalc != null ? `${r.hdCalc.toFixed(1)}%` : "–"}</div>
              <div className="muted an-tiny">HD</div>
            </div>
          </div>
          <div className="day-nums">
            <span><b>{n0(r.eggs)}</b> eggs</span>
            <span><b>{n0(r.birds)}</b> birds</span>
            <span><b>{n0(r.mortality)}</b> deaths</span>
            <span>{r.feed != null ? <><b>{n0(r.feed)}</b> bags{flockFeeds.get(r.id)?.day.gPerBird != null ? ` · ${n0(Math.round(flockFeeds.get(r.id)!.day.gPerBird!))} g/bird that day` : ""}</> : "feed not recorded"}</span>
            <span>{(() => { const e = feedEfficiency([{ date, eggs: r.eggs, feed: r.feed }]); return e.eggsPerKg != null ? <><b>{e.eggsPerKg.toFixed(2)}</b> eggs per kg feed</> : "eggs per kg: feed not recorded"; })()}</span>
            <span>{(() => { const f = fcrOf(ctx, [{ date, flockId: r.flockId, eggs: r.eggs, feed: r.feed }]); return f.fcr != null ? <>FCR <b>{f.fcr.toFixed(2)}</b> (est.){f.standardFcr != null ? ` · book ${f.standardFcr.toFixed(2)}` : ""}</> : r.feed == null ? null : `FCR: ${f.why ?? "not available"}`; })()}</span>
          </div>
          <FlockWeekFeed w={flockFeeds.get(r.id)?.week} />
          {r.hdWritten != null && <div className="muted an-tiny">Supervisor wrote {r.hdWritten}%</div>}
          {r.flagged && !r.reviewed && r.flagReason && <div className="flag-banner">{r.flagReason}</div>}
        </div>
          ))}
        </div>
      ))}

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Chick shed deaths</h3>
        {d.chick.length === 0 ? <p className="muted" style={{ margin: 0 }}>None recorded.</p> : (
          <ul className="an-list">
            {d.chick.map((c) => (<li key={c.position}>{c.label}: <b>{c.deaths}</b>{c.note ? <span className="muted"> — {c.note}</span> : null}</li>))}
            <li className="muted">Total {chickDeaths}</li>
          </ul>
        )}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Bird movements</h3>
        {d.movements.length === 0 ? <p className="muted" style={{ margin: 0 }}>None.</p> : (
          <ul className="an-list">
            {d.movements.map((m) => (
              <li key={m.id}>
                <b>{m.flockName}</b> {m.change > 0 ? "+" : "−"}{n0(Math.abs(m.change))} — {TYPE[m.type] ?? m.type}
                {m.buyer ? `, ${m.buyer}` : ""}{m.pricePerBird != null ? ` at ₹${m.pricePerBird}/bird` : ""}
                {m.needsReview ? <span className="badge badge-flagged"> needs review</span> : null}
                {m.reason ? <div className="muted an-tiny">{m.reason}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Egg ledger</h3>
        {d.ledger.length === 0 ? <p className="muted" style={{ margin: 0 }}>No ledger saved.</p> : (
          <table className="an-table" style={{ minWidth: 0 }}>
            <thead><tr><th>Section</th><th className="num">Opening</th><th className="num">Produced</th><th className="num">Closing</th></tr></thead>
            <tbody>{d.ledger.map((l) => (<tr key={l.section}><td>{l.section}</td><td className="num">{n0(l.opening)}</td><td className="num">{n0(l.produced)}</td><td className="num">{n0(l.closing)}</td></tr>))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
