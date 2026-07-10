import { getFeedBagStockDay } from "@/lib/feedBagStock";
import { FeedBagStockForm } from "@/components/FeedBagStockForm";

export const dynamic = "force-dynamic";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function FeedBagStockPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayISO();
  const day = await getFeedBagStockDay(date);

  return (
    <>
      <h1>Feed Bag Stock</h1>
      <p className="muted">
        Bag-count reconciliation by flock group (as the register shows two
        groups side by side): opening, produced, total, consumed, and where
        unconsumed bags sit — mill (F) or shed (S).
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
          Saved. Arithmetic and cross-check mismatches are flagged on the
          group card.
        </div>
      )}

      <FeedBagStockForm key={date} date={date} day={day} />
    </>
  );
}
