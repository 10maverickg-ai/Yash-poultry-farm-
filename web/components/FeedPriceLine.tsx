// V19 B2: one line "Feed: <formula> — ₹<price>/kg" for a flock, from the same price rule as the costs.
// On a flock card (the whole card is already a link) it is plain text; on the flock page it links to the formula's card.
import Link from "next/link";
import type { FeedPrice, Formulation } from "@/lib/costs/feedPrice";
import { BAG_KG } from "@/lib/costs/engine";
import { dmy } from "@/lib/format";

export const formulaHref = (f: Pick<Formulation, "code"> | null) => (f ? `/feed-formulas?open=${encodeURIComponent(f.code)}#f-${f.code}` : "/feed-formulas#by-shed");
const rs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FeedPriceLine({ price, next, link = false, className = "muted an-tiny" }: { price: FeedPrice; next?: Formulation | null; link?: boolean; className?: string }) {
  const main =
    price.source === "formula" ? <>Feed: {price.formulation!.name} — {rs(price.perKg!)}/kg</>
    : price.source === "default" ? <>Feed: farm default — {rs(price.perKg!)}/kg{next ? "" : " (no formula yet)"}</>
    : <>Feed price: not entered</>;
  const after = next ? <> · from {dmy(next.effectiveFrom)}: {next.name}, {rs(next.deliveredCostPerKg)}/kg</> : null;
  const title = price.perKg != null ? `${rs(price.perKg * BAG_KG)} per ${BAG_KG} kg bag` : undefined;
  if (!link) return <div className={className} title={title}>{main}{after}</div>;
  return (
    <p className="flock-feed-line">
      <Link href={formulaHref(price.formulation ?? next ?? null)}>{main}{after}</Link>
      {price.perKg != null && <span className="muted an-tiny"> ({rs(price.perKg * BAG_KG)} per {BAG_KG} kg bag)</span>}
    </p>
  );
}
