import type { FlockCard } from "@/lib/analytics/engine";
import { n1, n2 } from "@/lib/format";

type Props = Pick<FlockCard, "stdHd" | "hd7" | "gap" | "realisticHd" | "realisticSource" | "realisticReason" | "status" | "refReason" | "realisticSeason" | "death" | "heatNote">;

const DEATH_WORD = { green: "✔ normal", amber: "⚠ high", red: "✖ very high", none: "" } as const;

// V10: three lines per flock — the breeder's book (neutral reference), OUR realistic target (what the traffic light
// is judged against), and what the flock actually did. The gap to the book is a plain number, never coloured.
// V11: which season's data our target comes from, the deaths line (judged against our usual only), and the heat sentence.
export function TargetLines({ c, compact = false }: { c: Props; compact?: boolean }) {
  const gap = c.gap;
  const d = c.death;
  return (
    <>
      {c.stdHd != null && (
        <dl className={`tl${compact ? " tl-compact" : ""}`}>
          <div>
            <dt>Breeder&apos;s target (book)</dt>
            <dd className="tl-book">{n1(c.stdHd)}</dd>
          </div>
          <div>
            <dt>
              Our realistic target
              {c.realisticSeason ? <span className="muted an-tiny"> · {c.realisticSeason}</span> : null}
            </dt>
            <dd>{c.realisticHd != null ? <b>{n1(c.realisticHd)}</b> : <span className="muted">not learned yet for this age</span>}</dd>
          </div>
          <div>
            <dt>Actual (7 days)</dt>
            <dd>{c.hd7 != null ? <b>{n1(c.hd7)}</b> : "–"}</dd>
          </div>
          {gap != null && !compact && (
            <div className="tl-gap muted">
              {n1(Math.abs(gap))} points {gap > 0 ? "below" : "above"} the book
            </div>
          )}
        </dl>
      )}
      {d && d.weekPct != null && (
        <p className={`dl dl-${d.status}`} aria-label="Deaths this week">
          <span>
            Deaths this week <b>{n2(d.weekPct)}%</b>
          </span>
          <span>
            {d.usual != null ? (
              <>our usual {n2(d.usual)}% <span className="muted">({d.seasonLabel})</span></>
            ) : (
              <>our usual not learned yet <span className="muted">(starting limits: amber {n2(d.amber)}, red {n2(d.red)})</span></>
            )}
          </span>
          <span className="muted">book {d.bookPct != null ? `${n2(d.bookPct)}%` : "–"}</span>
          {d.status !== "none" && <span className="dl-pill">{DEATH_WORD[d.status]}</span>}
        </p>
      )}
      {c.heatNote && <p className="heat-note">☀ {c.heatNote}</p>}
    </>
  );
}
