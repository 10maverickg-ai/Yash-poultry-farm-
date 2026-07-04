import { getFeedStockSheet } from "@/lib/feed";
import { FeedStockForm } from "@/components/FeedStockForm";

export const dynamic = "force-dynamic";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function FeedStockPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayISO();
  const slots = await getFeedStockSheet(date);

  return (
    <>
      <h1>Feed Stock</h1>
      <p className="muted">
        Mill level, one row per raw material. Opening / Purchase / Closing in
        quintals as on paper (stored ×100 in kg); Consumed in kg as written.
        Materials left fully blank get no row for the day.
      </p>

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
          Saved. Balance mismatches are flagged on the material row.
        </div>
      )}

      <FeedStockForm key={date} date={date} slots={slots} />
    </>
  );
}
