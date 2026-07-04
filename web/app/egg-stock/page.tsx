import { getEggStockDay } from "@/lib/eggstock";
import { EggStockForm } from "@/components/EggStockForm";

export const dynamic = "force-dynamic";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function EggStockPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayISO();
  const day = await getEggStockDay(date);

  return (
    <>
      <h1>Egg Stock Ledger</h1>

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
          Saved. Sale lines have matching rows on the Sales page; any balance
          mismatch shows as a flag above the form.
        </div>
      )}

      <EggStockForm key={date} date={date} day={day} />
    </>
  );
}
