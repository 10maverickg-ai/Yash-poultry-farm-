import Link from "next/link";
import { SEGMENT_NAME, RAMP_DAYS, type Segment } from "@/lib/analytics/engine";
import type { SegmentPanel } from "@/lib/analytics/segments";

const n0 = (x: number) => Math.round(x).toLocaleString("en-IN");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-IN");
const inr = (x: number) => `₹${n0(x)}`;

const WHAT: Record<Segment, string> = {
  main: "Right page of the register: mature flocks, big eggs. Feed is recorded for this group (the one feed box covers these flocks).",
  young: `Left page: young flocks still climbing to peak, small eggs. Feed is not normally recorded for this group. Each flock is "ramping up" for its first ${RAMP_DAYS} days of lay.`,
};

function Cell({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="an-metric">
      <div className="an-metric-title">{title}</div>
      <div className="an-metric-value">{value}</div>
      {sub && <div className="an-metric-cmp">{sub}</div>}
    </div>
  );
}

function trend(now: number | null, prev: number | null): string | undefined {
  if (now == null || prev == null) return undefined;
  const d = now - prev;
  return `${d >= 0 ? "▲ up" : "▼ down"} ${n1(Math.abs(d))} from the 7 days before`;
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
          <Cell title="Deaths" value={n0(t.mort)} sub={p.deathsPerDay7 != null ? `${n1(p.deathsPerDay7)}/day · ${p.mortPct7 != null ? p.mortPct7.toFixed(2) : "–"}% in 7 days` : undefined} />
          {p.feed.recorded ? (
            <Cell
              title="Feed"
              value={`${p.feed.bagsPerDay7 != null ? n0(p.feed.bagsPerDay7) : "–"} bags/day`}
              sub={`${p.feed.gPerBird7 != null ? n0(p.feed.gPerBird7) : "–"} g/bird/day${p.feed.daysLeft != null ? ` · ${n1(p.feed.daysLeft)} days left` : ""}${p.feed.daysRecorded < p.feed.daysInWindow ? ` · recorded on ${p.feed.daysRecorded} of ${p.feed.daysInWindow} days` : ""}`}
            />
          ) : (
            <Cell title="Feed" value="not recorded" sub="feed is not recorded for this group" />
          )}
          <Cell title={p.segment === "main" ? "Big eggs in stock" : "Small eggs in stock"} value={p.stock ? `${n1(p.stock.days)} days` : "–"} sub={p.stock ? `${n0(p.stock.closing)} eggs` : "no ledger row"} />
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
