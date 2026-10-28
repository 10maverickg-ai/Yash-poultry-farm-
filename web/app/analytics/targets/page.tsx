import Link from "next/link";
import { loadEngineInput } from "@/lib/analytics/load";
import { buildFarmCtx } from "@/lib/analytics/ctx";
import { REALISTIC_CONFIG as C, findSlips } from "@/lib/analytics/realistic";
import { lastDayOfData, SEGMENT_NAME } from "@/lib/analytics/engine";
import type { RealisticBand, RGroup, RMetric } from "@/lib/analytics/realisticTypes";
import { n0, n1, dmy } from "@/lib/format";
import { clearOverride, setOverride } from "./actions";

export const dynamic = "force-dynamic";

const METRIC_NAME: Record<RMetric, string> = { hd: "Eggs per 100 birds (HD)", feed: "Feed per bird per day (g)", mortality: "Deaths per week (% of birds)" };
const pctTxt = (r: number | null) => (r == null ? "–" : `${(r * 100).toFixed(1)}%`);

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const input = await loadEngineInput();
  const { ctx, model, history } = buildFarmCtx(input);
  const book = (metric: RMetric, age: number): number | null => {
    const row = input.std.find((s) => s.age === age);
    if (!row) return null;
    if (metric === "hd") return row.hdp;
    if (metric === "feed") return row.feedG ?? null;
    const prev = input.std.find((s) => s.age === age - 1);
    return row.cumDepl != null && prev?.cumDepl != null ? row.cumDepl - prev.cumDepl : null;
  };
  const slips = findSlips(history);
  const groups: RGroup[] = ["main", "young"];
  const mainHd = history.map((h) => {
    const bs = h.bands.filter((b) => b.group === "main" && b.metric === "hd" && b.learnedRatio != null);
    return { asOf: h.asOf, mean: bs.length ? (bs.reduce((s, b) => s + b.learnedRatio!, 0) / bs.length) * 100 : null, n: bs.length };
  });
  const pts = mainHd.filter((p) => p.mean != null);

  const Row = ({ b }: { b: RealisticBand }) => {
    const mid = b.fromWeek + 2;
    const bk = book(b.metric, mid);
    const unit = b.metric === "mortality" ? "%" : "";
    return (
      <tr>
        <td>{b.fromWeek}–{b.toWeek}</td>
        <td className="num">{n0(b.healthyDays)} <span className="muted">of {n0(b.daysSeen)}</span></td>
        <td className="num">{b.flocks}</td>
        <td>{b.dateFrom ? `${dmy(b.dateFrom)} – ${dmy(b.dateTo!)}` : "–"}</td>
        <td className="num">{b.learnedRatio != null ? pctTxt(b.learnedRatio) : <span className="muted">not learned yet</span>}{b.learnedRatio == null && b.notLearnedReason ? <div className="muted an-tiny">{b.notLearnedReason}</div> : null}</td>
        <td className="num">{bk != null ? (b.metric === "mortality" ? bk.toFixed(2) : n1(bk)) + unit : "–"}</td>
        <td className="num">{b.ratio != null && bk != null ? <b>{(b.metric === "mortality" ? (bk * b.ratio).toFixed(2) : n1(bk * b.ratio)) + unit}</b> : "–"}{b.source === "owner" && <div className="an-tiny"><span className="badge badge-flagged">set by owner</span> {pctTxt(b.override)}</div>}</td>
        <td>
          <form action={setOverride} className="tl-ov">
            <input type="hidden" name="grp" value={b.group} />
            <input type="hidden" name="metric" value={b.metric} />
            <input type="hidden" name="band_start" value={b.fromWeek} />
            <input name="ratio_pct" inputMode="decimal" aria-label={`Owner level for weeks ${b.fromWeek} to ${b.toWeek}, percent of book`} placeholder="% of book" size={6} defaultValue={b.override != null ? (b.override * 100).toFixed(1) : ""} />
            <button type="submit" className="btn-small">Set</button>
          </form>
          {b.source === "owner" && (
            <form action={clearOverride}>
              <input type="hidden" name="grp" value={b.group} />
              <input type="hidden" name="metric" value={b.metric} />
              <input type="hidden" name="band_start" value={b.fromWeek} />
              <button type="submit" className="btn-small">Go back to learned</button>
            </form>
          )}
        </td>
      </tr>
    );
  };

  return (
    <>
      <h1>How is our realistic target learned?</h1>
      {sp.saved && <div className="saved-banner">{sp.saved}</div>}
      {sp.error && <div className="error-banner">{sp.error}</div>}
      <p className="muted"><Link href="/analytics">← Analytics</Link> · computed from the records up to {dmy(lastDayOfData(ctx))}</p>

      {slips.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid #b7791f" }}>
          <strong>⚠ Our realistic level is slipping — check housing, feed, ventilation.</strong>
          <ul className="an-list">
            {slips.map((s, i) => (
              <li key={i}>{SEGMENT_NAME[s.group]}, weeks {s.band.fromWeek}–{s.band.toWeek}, {METRIC_NAME[s.metric]}: {pctTxt(s.from.ratio)} at {dmy(s.from.asOf)} → {pctTxt(s.to.ratio)} at {dmy(s.to.asOf)} ({s.points.toFixed(1)} points).</li>
            ))}
          </ul>
        </div>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0 }}>In plain words</h2>
        <p>The breeder&apos;s book describes a flock in perfect conditions. A farm like ours rarely reaches it, so beside the book we show <b>our realistic target</b>: what <i>our own</i> flocks actually do on a good week at that age. The traffic lights compare a flock with our realistic target. The book stays on the screen as a plain reference, and the gap to it is shown as a number without a colour. Our target is never above the book.</p>
        <p><b>How:</b> for every day and every flock we divide what it laid by what the book says for its age. That ratio is averaged over 7 days at a time. In each 5-week age band (counted from the placement date; for flocks placed as day-old chicks, from laying age = age − {C.chickToLayingWeeks} weeks) we take the <b>{C.percentile}th percentile</b> of those 7-day ratios, which means &quot;a good week for us&quot;, not the best day and not the average. Our realistic target = the book for the flock&apos;s age × that ratio. Feed per bird and deaths per week are learned the same way. The main and young groups are learned separately and never borrow from each other.</p>
        <p><b>Days we use:</b> only healthy days. <b>Days we leave out, and why:</b></p>
        <ul className="an-list">
          <li>days flagged as a data problem and not accepted by the owner (the numbers may be wrong);</li>
          <li>days in a moult (hens stop laying on purpose);</li>
          <li>the first {C.rampDays} days of lay (a flock is still ramping up);</li>
          <li>days with more than {C.spikeMultiple}× the flock&apos;s own usual deaths (something went wrong that day);</li>
          <li>days with eggs, birds or (main group) feed missing;</li>
          <li>the last {C.departedTrailingDays} days of a flock that has left the farm (being sold or moved).</li>
        </ul>
        <p>A band needs at least <b>{C.minHealthyDays} healthy flock-days from at least {C.minFlocks} flocks</b>. Otherwise it says &quot;not learned yet&quot; and that flock gets a grey card (with the book shown) instead of a colour. Nothing is guessed. More history makes more bands appear: <Link href="/import">import older paper registers</Link>.</p>
        <p className="muted an-tiny">All these numbers live in one place in the code (REALISTIC_CONFIG). The target is recomputed every time the data changes (at least daily).</p>
      </section>

      <section className="card tl-trend">
        <h2 style={{ marginTop: 0 }}>How the realistic level moved</h2>
        {pts.length < 2 ? (
          <p className="muted">Only {pts.length === 1 ? "one monthly computation" : "no learned bands"} so far, so there is no trend to draw yet.</p>
        ) : (
          <Trend pts={pts as { asOf: string; mean: number; n: number }[]} />
        )}
        <p className="muted an-tiny">Main group, eggs per 100 birds: the average learned level across the age bands that could be learned at each month-end, as % of the book. The number of bands can change from month to month as data grows.</p>
      </section>

      {groups.map((g) => (
        <section key={g}>
          <h2>{SEGMENT_NAME[g]}</h2>
          {(["hd", "feed", "mortality"] as RMetric[]).map((m) => {
            const rows = model.bands.filter((b) => b.group === g && b.metric === m);
            if (m === "feed" && g === "young") return <p key={m} className="muted">Feed per bird: the young group has no feed column in the register, so nothing is learned.</p>;
            return (
              <div key={m} className="card">
                <h3 style={{ marginTop: 0 }}>{METRIC_NAME[m]}</h3>
                {rows.length === 0 ? (
                  <p className="muted">No records in this group yet.</p>
                ) : (
                  <div className="tl-scroll">
                    <table className="tl-table">
                      <thead>
                        <tr><th>Age (weeks)</th><th className="num">Healthy days</th><th className="num">Flocks</th><th>Dates used</th><th className="num">Learned, % of book</th><th className="num">Book (mid-band)</th><th className="num">Our realistic target</th><th>Owner level</th></tr>
                      </thead>
                      <tbody>{rows.map((b) => <Row key={b.band} b={b} />)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}

function Trend({ pts }: { pts: { asOf: string; mean: number; n: number }[] }) {
  const W = 320, H = 110, pad = 28;
  const lo = Math.min(...pts.map((p) => p.mean)) - 2;
  const hi = Math.max(...pts.map((p) => p.mean)) + 2;
  const x = (i: number) => pad + (i * (W - pad - 8)) / (pts.length - 1);
  const y = (v: number) => 8 + ((hi - v) * (H - 28)) / (hi - lo || 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Average learned level over recent months, percent of the book">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts.map((p, i) => `${x(i)},${y(p.mean)}`).join(" ")} />
      {pts.map((p, i) => (
        <g key={p.asOf}>
          <circle cx={x(i)} cy={y(p.mean)} r="3" fill="currentColor" />
          <text x={x(i)} y={y(p.mean) - 6} fontSize="9" textAnchor="middle" fill="currentColor">{p.mean.toFixed(1)}</text>
          <text x={x(i)} y={H - 4} fontSize="8" textAnchor="middle" fill="currentColor">{p.asOf.slice(5, 7)}/{p.asOf.slice(2, 4)}</text>
        </g>
      ))}
    </svg>
  );
}
