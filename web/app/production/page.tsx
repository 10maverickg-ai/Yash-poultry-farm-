import { getProductionSheet } from "@/lib/production";
import { ProductionEntryForm } from "@/components/ProductionEntryForm";

export const dynamic = "force-dynamic";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
        <ProductionEntryForm key={date} date={date} slots={slots} />
      )}
    </>
  );
}
