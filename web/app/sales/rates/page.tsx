import Link from "next/link";
import { listRates } from "@/lib/rates/store";
import { RatesForm } from "@/components/RatesForm";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

export const dynamic = "force-dynamic";

export default async function RatesPage() {
  const rates = await listRates(45);
  // Days that have ledger sale lines but no rate of their own.
  const { rows: missing } = await pool.query(
    `SELECT s.date, count(*)::int AS lines
       FROM daily_egg_stock_entries e
       JOIN daily_egg_stock_summary s ON s.id = e.egg_stock_summary_id
      WHERE s.farm_code = $1 AND s.deleted_at IS NULL AND e.category IN ('sale','local_sale')
        AND NOT EXISTS (SELECT 1 FROM daily_egg_rates r WHERE r.date = s.date)
      GROUP BY s.date ORDER BY s.date`,
    [ACTIVE_FARM]
  );
  return (
    <>
      <h1>BAFTA egg rate</h1>
      <p className="muted">
        Paste the daily SMS. The number after RS. is the price per 100 eggs (560 → ₹5.60 per egg). Farmfresh pays the rate − ₹0.03 for big and small eggs;
        local sales go at the rate + ₹0.01 (a person&apos;s name, “local”, or any lot up to about 150 eggs). A day without its own rate reuses the previous day&apos;s for up to 3 days and says “rate not updated”.
      </p>
      <RatesForm />

      {missing.length > 0 && (
        <>
          <h2>Days with sales but no rate ({missing.length})</h2>
          <p className="card muted" style={{ lineHeight: 1.7 }}>
            {missing.map((m) => `${m.date} (${m.lines})`).join(" · ")}
          </p>
        </>
      )}

      <h2>Saved rates</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Date</th><th>Rate</th><th>Farmfresh</th><th>Local</th><th>Subsidy</th><th>Source</th></tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td>{r.bafta.toFixed(2)}</td>
                <td>{(r.bafta - 0.03).toFixed(2)}</td>
                <td>{(r.bafta + 0.01).toFixed(2)}</td>
                <td>{r.subsidyPaise ? `${r.subsidyPaise} p` : "0"}</td>
                <td className="muted">{r.source ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p><Link href="/sales">← Sales</Link></p>
    </>
  );
}
