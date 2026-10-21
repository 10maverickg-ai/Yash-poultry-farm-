import Link from "next/link";
import { Fragment } from "react";
import { listSales } from "@/lib/eggstock";
import type { SaleRow } from "@/lib/eggstock-types";

export const dynamic = "force-dynamic";

function monthKey(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function num(v: string | number | null): number {
  if (v === null) return 0;
  return typeof v === "number" ? v : Number(v);
}

function inr(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// Owner request, 2026-10-19: day and month totals, grouped from whatever
// listSales() already returned (newest first) — no separate query, so the
// totals always match exactly what's shown in the table below them.
function groupTotals(sales: SaleRow[]) {
  const byDay = new Map<string, { eggs: number; amount: number }>();
  const byMonth = new Map<string, { eggs: number; amount: number }>();
  for (const s of sales) {
    const eggs = s.eggs_quantity ?? 0;
    const amount = num(s.amount);
    const day = byDay.get(s.date) ?? { eggs: 0, amount: 0 };
    day.eggs += eggs;
    day.amount += amount;
    byDay.set(s.date, day);
    const mk = monthKey(s.date);
    const month = byMonth.get(mk) ?? { eggs: 0, amount: 0 };
    month.eggs += eggs;
    month.amount += amount;
    byMonth.set(mk, month);
  }
  return { byDay, byMonth };
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const sales = await listSales();
  const { byDay, byMonth } = groupTotals(sales);

  return (
    <>
      <h1>Sales</h1>
      <p className="muted">
        Generated from Egg Stock ledger lines categorised “sale” (Farmfresh/wholesaler) or “local sale” —
        there is no separate sales register. Open a row to set type, grade, or the optional price (never
        on paper).
      </p>
      {saved && <div className="saved-banner">Sale details saved.</div>}

      {sales.length === 0 ? (
        <p className="card muted">
          No sales yet. They appear automatically when a ledger line on the Egg Stock page is categorised
          as a sale or a local sale.
        </p>
      ) : (
        <>
          <h2>Month totals</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Eggs</th>
                  <th>Revenue (INR)</th>
                </tr>
              </thead>
              <tbody>
                {[...byMonth.entries()].map(([mk, t]) => (
                  <tr key={mk}>
                    <td>{monthLabel(mk)}</td>
                    <td>{t.eggs.toLocaleString("en-IN")}</td>
                    <td>{inr(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Sales</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Buyer</th>
                  <th>Type</th>
                  <th>Grade</th>
                  <th>Eggs</th>
                  <th>Trays</th>
                  <th>Price/egg</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s, i) => {
                  const isLastOfDay = i === sales.length - 1 || sales[i + 1].date !== s.date;
                  const dayTotal = byDay.get(s.date);
                  return (
                    <Fragment key={s.id}>
                      <tr>
                        <td>
                          <Link href={`/sales/${s.id}`}>{s.date}</Link>
                        </td>
                        <td>{s.buyer_or_recipient ?? "—"}</td>
                        <td>{s.transaction_type?.replaceAll("_", " ") ?? "—"}</td>
                        <td>{s.grade ?? "—"}</td>
                        <td>{s.eggs_quantity?.toLocaleString("en-IN") ?? "—"}</td>
                        <td>{s.trays_quantity ?? "—"}</td>
                        <td>{s.price_per_unit ?? "—"}</td>
                        <td>{s.amount ? inr(num(s.amount)) : "—"}</td>
                      </tr>
                      {isLastOfDay && dayTotal && (
                        <tr className="muted">
                          <td colSpan={4} style={{ textAlign: "right" }}>
                            Day total:
                          </td>
                          <td>{dayTotal.eggs.toLocaleString("en-IN")}</td>
                          <td></td>
                          <td></td>
                          <td>{inr(dayTotal.amount)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
