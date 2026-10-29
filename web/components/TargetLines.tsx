import type { FlockCard } from "@/lib/analytics/engine";
import { n1 } from "@/lib/format";

// V10: three lines per flock — the breeder's book (neutral reference), OUR realistic target (what the traffic light
// is judged against), and what the flock actually did. The gap to the book is a plain number, never coloured.
export function TargetLines({ c, compact = false }: { c: Pick<FlockCard, "stdHd" | "hd7" | "gap" | "realisticHd" | "realisticSource" | "realisticReason" | "status" | "refReason">; compact?: boolean }) {
  if (c.stdHd == null) return null; // no book for this flock/age: the chip and the note already say why
  const gap = c.gap;
  return (
    <dl className={`tl${compact ? " tl-compact" : ""}`}>
      <div>
        <dt>Breeder&apos;s target (book)</dt>
        <dd className="tl-book">{n1(c.stdHd)}</dd>
      </div>
      <div>
        <dt>Our realistic target{c.realisticSource === "owner" ? " · set by owner" : ""}</dt>
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
  );
}
