import Link from "next/link";
import { listSales } from "@/lib/eggstock";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const sales = await listSales();

  return (
    <>
      <h1>Sales</h1>
      <p className="muted">
        Generated from Egg Stock ledger lines with category “sale” — there is
        no separate sales register. Open a row to set type, grade, or the
        optional price (never on paper).
      </p>
      {saved && <div className="saved-banner">Sale details saved.</div>}

      {sales.length === 0 ? (
        <p className="card muted">
          No sales yet. They appear automatically when a ledger line on the
          Egg Stock page is categorised as a sale.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Buyer</th>
                <th>Type</th>
                <th>Eggs</th>
                <th>Trays</th>
                <th>Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/sales/${s.id}`}>{s.date}</Link>
                  </td>
                  <td>{s.buyer_or_recipient ?? "—"}</td>
                  <td>{s.transaction_type?.replaceAll("_", " ") ?? "—"}</td>
                  <td>{s.eggs_quantity?.toLocaleString("en-IN") ?? "—"}</td>
                  <td>{s.trays_quantity ?? "—"}</td>
                  <td>{s.price_per_unit ?? "—"}</td>
                  <td>{s.amount ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
