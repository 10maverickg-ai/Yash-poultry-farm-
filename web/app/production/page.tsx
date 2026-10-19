import { getProductionSheet, type ProductionSlot } from "@/lib/production";
import { ProductionEntryForm } from "@/components/ProductionEntryForm";

export const dynamic = "force-dynamic";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Owner request, 2026-10-19: a day total sits above the per-flock cards,
// same "calculated HD% is the real figure" treatment — eggs and birds are
// summed across every flock with a saved row, and the farm-wide HD% is
// calculated from those sums (never from averaging each flock's own %,
// which would double-count small flocks).
function dayTotals(slots: ProductionSlot[]) {
  let eggs = 0;
  let birds = 0;
  let mortality = 0;
  let feedBags = 0;
  let flocksSaved = 0;
  for (const slot of slots) {
    if (!slot.saved) continue;
    flocksSaved++;
    eggs += slot.saved.eggs_total ?? 0;
    birds += slot.saved.bird_population ?? 0;
    mortality += slot.saved.mortality ?? 0;
    feedBags += slot.saved.feed_bags ?? 0;
  }
  const hd = birds > 0 ? ((eggs / birds) * 100).toFixed(2) : null;
  return { eggs, birds, mortality, feedBags, flocksSaved, hd };
}

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayISO();
  const slots = await getProductionSheet(date);

  return (
    <>
      <h1>Daily Production</h1>

      <form method="get" className="card actions-bar" style={{ alignItems: "end" }}>
        <label className="field" style={{ flex: 1 }}>
          <span>Date</span>
          <input type="date" name="date" defaultValue={date} />
        </label>
        <button type="submit" className="btn-secondary">
          Load
        </button>
      </form>

      {sp.saved && (
        <div className="saved-banner">
          Saved. Any flagged records show their reason on the flock card below.
        </div>
      )}

      {slots.length === 0 ? (
        <p className="card muted">
          No flock labels are effective on {date}. Add flocks in the Flock
          Register first — the production sheet lists whichever labels were in
          use on the chosen date.
        </p>
      ) : (
        <>
          <DayTotalsCard slots={slots} />
          <ProductionEntryForm key={date} date={date} slots={slots} />
        </>
      )}
    </>
  );
}

function DayTotalsCard({ slots }: { slots: ProductionSlot[] }) {
  const t = dayTotals(slots);
  if (t.flocksSaved === 0) {
    return <p className="card muted">No production saved for this date yet.</p>;
  }
  return (
    <div className="card row2" style={{ alignItems: "center" }}>
      <div className="field">
        <span>Farm total — {t.flocksSaved} of {slots.length} flock(s) saved</span>
        <span className="muted">
          {t.eggs.toLocaleString("en-IN")} eggs · {t.birds.toLocaleString("en-IN")} birds · {t.mortality} mortality · {t.feedBags} feed bags
        </span>
      </div>
      <div className="field">
        <span>HD % (calculated, farm-wide)</span>
        <div className="hd-calc">{t.hd !== null ? `${t.hd}%` : "—"}</div>
      </div>
    </div>
  );
}
