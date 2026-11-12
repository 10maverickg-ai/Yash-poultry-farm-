// V15 Compare: two columns A and B, each its own flock and dates (or the same weeks of age), worked out by
// two independent calls of the period engine. Server-rendered; the form is a plain GET, so the state is the address.
import Link from "next/link";
import { buildFarmCtx } from "@/lib/analytics/ctx";
import type { EngineInput } from "@/lib/analytics/engine";
import type { PeriodExtras } from "@/lib/analytics/period";
import type { CostInput } from "@/lib/costs/engine";
import { compareRows, compareSide, presets, readCompare, type CompareRow, type Fmt, type SideResult } from "@/lib/analytics/compare";
import { flockOptions, type FlockOption, type Param } from "@/lib/analytics/rangeParams";
import { dmy, inr, n0, n1, n2 } from "@/lib/format";

const fmtVal = (f: Fmt, v: number | string | null): string => {
  if (v == null) return "–";
  if (typeof v === "string") return f === "date" ? dmy(v) : v;
  switch (f) {
    case "int": return n0(v);
    case "num1": return n1(v);
    case "num2": return n2(v);
    case "pct1": return `${n1(v)}%`;
    case "pct2": return `${v.toFixed(2)}%`;
    case "inr": return inr(v);
    case "inr2": return `₹${n2(v)}`;
    case "age": return `${n0(v)} days (week ${Math.floor(v / 7)})`;
    default: return String(v);
  }
};
const fmtDiff = (f: Fmt, d: number): string => {
  const a = Math.abs(d);
  switch (f) {
    case "pct1": case "pct2": return `${f === "pct2" ? a.toFixed(2) : n1(a)} pts`;
    case "inr": return inr(a);
    case "inr2": return `₹${n2(a)}`;
    case "age": return `${n0(a)} days`;
    case "num1": return n1(a);
    case "num2": return n2(a);
    default: return n0(a);
  }
};

function DiffCell({ r }: { r: CompareRow }) {
  if (r.fmt === "date" || r.fmt === "text") return <span className="muted">–</span>;
  if (r.diff == null) return <span className="muted">{r.aNote || r.bNote ? "–" : "not comparable"}</span>;
  if (Math.abs(r.diff) < 1e-9) return <span className="muted">= no difference</span>;
  const arrow = r.diff > 0 ? "▲" : "▼";
  const pctText = r.diffPct != null && r.fmt !== "pct1" && r.fmt !== "pct2" && r.fmt !== "age" ? ` (${r.diff > 0 ? "+" : "−"}${Math.abs(r.diffPct).toFixed(1)}%)` : "";
  const word = r.good == null ? (r.direction === "none" ? (r.diff > 0 ? "higher" : "lower") : "different days") : r.good ? "better" : "worse";
  return (
    <span className={r.good == null ? "cmp-neutral" : r.good ? "pv-good" : "pv-bad"}>
      {arrow} {r.diff > 0 ? "+" : "−"}{fmtDiff(r.fmt, r.diff)}{pctText} <span className="cmp-word">{word}</span>
    </span>
  );
}

function Value({ r, side }: { r: CompareRow; side: "a" | "b" }) {
  const v = side === "a" ? r.a : r.b;
  const note = side === "a" ? r.aNote : r.bNote;
  if (v == null && note) return <span className="muted cmp-why">{note}</span>;
  return <>{fmtVal(r.fmt, v)}</>;
}

function SideForm({ k, opts, flockId, from, to, today }: { k: "a" | "b"; opts: FlockOption[]; flockId: string | null; from: string; to: string; today: string }) {
  const sel = flockId ? (opts.find((o) => o.id === flockId)?.label ?? "all") : "all";
  return (
    <fieldset className={`cmp-side cmp-side-${k}`}>
      <legend><span className={`cmp-key cmp-key-${k}`} aria-hidden="true" /> {k.toUpperCase()}</legend>
      <label className="field"><span>Flock</span>
        <select name={k} defaultValue={sel}>
          <option value="all">All flocks</option>
          {opts.map((o) => <option key={o.id} value={o.label}>{o.label}{o.registerLabel !== o.label ? ` (register ${o.registerLabel})` : ""}{o.gone ? " — left" : o.segment === "young" ? " — young" : ""}</option>)}
        </select>
      </label>
      <div className="pv-dates">
        <label className="field"><span>From</span><input type="date" name={`${k}f`} defaultValue={from} max={today} /></label>
        <label className="field"><span>To</span><input type="date" name={`${k}t`} defaultValue={to} max={today} /></label>
      </div>
    </fieldset>
  );
}

function sideTitle(x: SideResult): string {
  return `${x.side.key.toUpperCase()}: ${x.side.flockLabel}, ${x.side.range.label}`;
}

export function CompareView({ input, cost, extras, sp, today }: { input: EngineInput; cost: CostInput; extras: PeriodExtras; sp: Record<string, Param>; today: string }) {
  const { ctx } = buildFarmCtx(input);
  const st = readCompare(ctx, sp, today);
  // two independent engine calls
  const A = compareSide(ctx, cost, extras, st.a);
  const B = compareSide(ctx, cost, extras, st.b);
  const rows = compareRows(A, B);
  const opts = flockOptions(ctx);
  const groups = [...new Set(rows.map((r) => r.group))];
  const weekOpts = Array.from({ length: 131 }, (_, i) => i);
  const identical = st.a.flockId === st.b.flockId && st.a.range.from === st.b.range.from && st.a.range.to === st.b.range.to;
  const both = [A, B];

  return (
    <>
      <nav className="cmp-presets" aria-label="Quick set-ups">
        {presets(ctx, st).map((p) => (
          <a key={p.key} href={p.href} className={`pv-chip${p.on ? " on" : ""}`} aria-current={p.on ? "true" : undefined}>{p.label}</a>
        ))}
      </nav>

      <form method="get" action="/analytics/compare" className="card cmp-form">
        <div className="cmp-sides">
          <SideForm k="a" opts={opts} flockId={st.a.flockId} from={st.a.range.from} to={st.a.range.to} today={today} />
          <SideForm k="b" opts={opts} flockId={st.b.flockId} from={st.b.range.from} to={st.b.range.to} today={today} />
        </div>
        <fieldset className="cmp-age">
          <legend>Align by flock age</legend>
          <label className="pv-check"><input type="checkbox" name="age" value="1" defaultChecked={st.age} /> <span>Compare the same weeks of age of each flock (the dates above are then worked out from each flock&apos;s placement date)</span></label>
          <div className="pv-dates">
            <label className="field"><span>From week</span>
              <select name="wf" defaultValue={String(st.weeks?.from ?? "")}>
                {!st.weeks && <option value="">–</option>}
                {weekOpts.map((w) => <option key={w} value={w}>week {w}</option>)}
              </select>
            </label>
            <label className="field"><span>To week</span>
              <select name="wt" defaultValue={String(st.weeks?.to ?? "")}>
                {!st.weeks && <option value="">–</option>}
                {weekOpts.map((w) => <option key={w} value={w}>week {w}</option>)}
              </select>
            </label>
          </div>
        </fieldset>
        <button type="submit" className="pv-show">Compare</button>
      </form>

      {[...st.notes, ...st.a.notes.map((x) => `A: ${x}`), ...st.b.notes.map((x) => `B: ${x}`)].length > 0 && (
        <div className="flag-banner" role="status">
          {[...st.notes, ...st.a.notes.map((x) => `A: ${x}`), ...st.b.notes.map((x) => `B: ${x}`)].map((x, i) => <p key={i} style={{ margin: 0 }}>{x}</p>)}
        </div>
      )}

      <section className="cmp-heads" aria-label="What is compared">
        {both.map((x) => (
          <div key={x.side.key} className={`card cmp-head cmp-head-${x.side.key}`}>
            <div><span className={`cmp-key cmp-key-${x.side.key}`} aria-hidden="true" /> <b>{x.side.key.toUpperCase()}: {x.side.flockLabel}</b></div>
            <div>{x.side.range.label} · {x.side.range.days} day{x.side.range.days === 1 ? "" : "s"}{st.age && st.weeks ? ` · weeks ${st.weeks.from}–${st.weeks.to} of age` : ""}</div>
            <div className="an-sub"><b>{x.s.dataNote}</b>.{x.coverageNote ? ` ${x.coverageNote}` : ""}</div>
            {!x.s.farmLevel && <div className="muted an-tiny">One flock: its own birds and eggs only. Sales, costs and ledger breakage are farm-level, not split by flock.</div>}
            {x.side.flockId && <div className="an-tiny"><Link href={`/flocks/${x.side.flockId}`}>Open {x.side.flockLabel} →</Link></div>}
          </div>
        ))}
      </section>
      {identical && <p className="card an-sub">A and B are the same flock and the same dates, so every difference is 0.</p>}

      <section aria-label="Side by side" className="cmp-table">
        <div className="cmp-row cmp-row-head" aria-hidden="true">
          <div className="cmp-label">Measure</div>
          <div className="cmp-a"><span className="cmp-key cmp-key-a" /> A</div>
          <div className="cmp-b"><span className="cmp-key cmp-key-b" /> B</div>
          <div className="cmp-d">B − A</div>
        </div>
        {groups.map((g) => (
          <div key={g} className="card cmp-group">
            <h3 className="cmp-gh">{g}</h3>
            {rows.filter((r) => r.group === g).map((r) => (
              <div key={r.key} className="cmp-row" role="group" aria-label={r.label}>
                <div className="cmp-label">{r.label}</div>
                <div className="cmp-a"><span className="cmp-tag">A</span> <Value r={r} side="a" /></div>
                <div className="cmp-b"><span className="cmp-tag">B</span> <Value r={r} side="b" /></div>
                <div className="cmp-d"><span className="cmp-tag">B − A</span> <DiffCell r={r} /></div>
                {r.note && <div className="cmp-note muted an-tiny">{r.note}</div>}
              </div>
            ))}
          </div>
        ))}
        <p className="muted an-foot">
          B − A: ▲ B is higher, ▼ B is lower; &quot;better&quot; / &quot;worse&quot; is written out (more eggs is better, more deaths is worse). Days, ages and bird counts have no better or worse. HD % is pooled: all eggs ÷ all bird-days, never an average of daily percentages. Profit is an estimate.
        </p>
      </section>
    </>
  );
}
