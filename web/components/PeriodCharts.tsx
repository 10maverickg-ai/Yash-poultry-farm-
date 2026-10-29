// Small inline-SVG charts (no chart library). Labelled axes, value labels when
// there are few points, a text summary for screen readers, and a missing day is
// a visible gap — colour is never the only signal.
export interface ChartPoint {
  label: string; // x-axis label (already short, e.g. "Mon" or "12")
  value: number | null;
}

const W = 320;
const H = 170;
const L = 40; // left margin for the y axis
const R = 8;
const R_TEMP = 30; // right margin when a temperature line is drawn
const T = 14;
const B = 28;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(+v.toFixed(1)));

export function SeriesChart({
  title,
  unit,
  points,
  kind,
  yMin,
  yMax,
  labelEvery,
  overlay,
}: {
  title: string;
  unit: string;
  points: ChartPoint[];
  kind: "bar" | "line";
  yMin?: number;
  yMax?: number;
  labelEvery?: number;
  /** A thin line on its own right-hand scale (V11: max temperature, °C). Values align with `points`; null = no weather that day. */
  overlay?: { name: string; unit: string; values: (number | null)[] };
}) {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  if (vals.length === 0) return <p className="muted an-tiny">{title}: no data to draw.</p>;
  const lo = yMin ?? (kind === "bar" ? 0 : Math.floor(Math.min(...vals) / 5) * 5);
  const hi = yMax ?? (kind === "bar" ? niceMax(Math.max(...vals)) : Math.ceil(Math.max(...vals) / 5) * 5 + (Math.max(...vals) % 5 === 0 ? 5 : 0));
  const span = hi - lo || 1;
  const n = points.length;
  const ov = overlay && overlay.values.some((v) => v != null) ? overlay : null;
  const rm = ov ? R_TEMP : R;
  const iw = W - L - rm;
  const ih = H - T - B;
  const x = (i: number) => L + (kind === "bar" ? ((i + 0.5) / n) * iw : n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => T + ih - ((v - lo) / span) * ih;
  const bw = Math.max(2, (iw / n) * 0.7);
  const ticks = [lo, lo + span / 2, hi];
  const every = labelEvery ?? Math.max(1, Math.ceil(n / 8));
  const showVals = n <= 8;
  const ovVals = ov ? ov.values.filter((v): v is number => v != null) : [];
  const ovLo = ov ? Math.floor(Math.min(...ovVals) / 5) * 5 : 0;
  const ovHi = ov ? Math.max(ovLo + 5, Math.ceil(Math.max(...ovVals) / 5) * 5) : 1;
  const yo = (v: number) => T + ih - ((v - ovLo) / (ovHi - ovLo)) * ih;
  const ovSegs: string[] = [];
  if (ov) {
    let cur = "";
    ov.values.forEach((v, i) => {
      if (v == null) { if (cur) ovSegs.push(cur); cur = ""; } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${yo(v).toFixed(1)}`;
    });
    if (cur) ovSegs.push(cur);
  }
  const summary = `${title}: ${points.filter((p) => p.value != null).map((p) => `${p.label} ${compact(p.value!)}`).join(", ")}${ov ? `. ${ov.name}: ${ov.values.map((v, i) => (v == null ? null : `${points[i]?.label} ${Math.round(v)}${ov.unit}`)).filter(Boolean).join(", ")}` : ""}`;
  const segs: string[] = [];
  if (kind === "line") {
    let cur = "";
    points.forEach((p, i) => {
      if (p.value == null) {
        if (cur) segs.push(cur);
        cur = "";
      } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    });
    if (cur) segs.push(cur);
  }
  return (
    <figure className="pc-fig">
      <figcaption className="pc-cap">
        {title} <span className="muted">({unit})</span>
        {ov && <span className="pc-temp-key"> · thin line: {ov.name} ({ov.unit})</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={summary} className="pc-svg">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - rm} y1={y(t)} y2={y(t)} className="pc-grid" />
            <text x={L - 4} y={y(t) + 3} textAnchor="end" className="pc-tick">{compact(t)}</text>
          </g>
        ))}
        {ov && (
          <>
            {ovSegs.map((d, i) => <path key={i} d={d} className="pc-temp" fill="none" />)}
            <text x={W - rm + 3} y={yo(ovHi) + 3} className="pc-tick pc-temp-tick">{ovHi}{ov.unit}</text>
            <text x={W - rm + 3} y={yo(ovLo) + 3} className="pc-tick pc-temp-tick">{ovLo}{ov.unit}</text>
          </>
        )}
        {kind === "bar" &&
          points.map((p, i) =>
            p.value == null ? (
              <text key={i} x={x(i)} y={y(lo) - 3} textAnchor="middle" className="pc-tick">–</text>
            ) : (
              <g key={i}>
                <rect x={x(i) - bw / 2} y={y(p.value)} width={bw} height={Math.max(0, y(lo) - y(p.value))} className="pc-bar" />
                {showVals && <text x={x(i)} y={y(p.value) - 3} textAnchor="middle" className="pc-val">{compact(p.value)}</text>}
              </g>
            )
          )}
        {kind === "line" && (
          <>
            {segs.map((d, i) => <path key={i} d={d} className="pc-line" fill="none" />)}
            {points.map((p, i) =>
              p.value == null ? null : (
                <g key={i}>
                  <circle cx={x(i)} cy={y(p.value)} r={n > 20 ? 1.6 : 3} className="pc-dot" />
                  {showVals && <text x={x(i)} y={y(p.value) - 6} textAnchor="middle" className="pc-val">{compact(p.value)}</text>}
                </g>
              )
            )}
          </>
        )}
        {points.map((p, i) =>
          i % every === 0 ? <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="pc-tick">{p.label}</text> : null
        )}
      </svg>
    </figure>
  );
}
