import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { rateFor } from "./lookup";
import { repricePlan, type RepricePlan, type SaleForReprice } from "./reprice";

const toSale = (r: Record<string, unknown>): SaleForReprice => ({
  id: Number(r.id),
  transactionType: (r.transaction_type as string) ?? null,
  recipient: (r.recipient as string) ?? null,
  buyer: (r.buyer_or_recipient as string) ?? null,
  grade: (r.grade as string) ?? null,
  eggs: Number(r.eggs_quantity ?? 0),
  price: r.price_per_unit == null ? null : Number(r.price_per_unit),
  amount: r.amount == null ? null : Number(r.amount),
});

const SALES_OF_DAY = `SELECT id, transaction_type::text AS transaction_type, recipient, buyer_or_recipient, grade, eggs_quantity, price_per_unit, amount
                        FROM sales WHERE farm_code = $1 AND date = $2 ORDER BY id`;

/** The plan for one day, or null when the day has no rate (own or carried up to 3 days) or no sales. */
export async function loadRepricePlan(date: string): Promise<{ plan: RepricePlan; rateDate: string; carried: boolean } | null> {
  const rate = await rateFor(pool, date);
  if (!rate) return null;
  const { rows } = await pool.query(SALES_OF_DAY, [ACTIVE_FARM, date]);
  if (rows.length === 0) return null;
  return { plan: repricePlan(rate.rate, rows.map(toSale)), rateDate: rate.rateDate, carried: rate.carried };
}

/** Days whose sales are not at the price the day's rate gives (newest first). Unpriced sales are listed in "waiting for a rate" elsewhere. */
export async function datesNeedingReprice(limit = 30): Promise<{ date: string; sales: number; before: number; after: number }[]> {
  const { rows } = await pool.query(
    `SELECT s.date, s.id, s.transaction_type::text AS transaction_type, s.recipient, s.buyer_or_recipient, s.grade, s.eggs_quantity, s.price_per_unit, s.amount,
            (SELECT r.bafta_rate FROM daily_egg_rates r WHERE r.date <= s.date AND r.date >= s.date - 3 ORDER BY r.date DESC LIMIT 1) AS rate
       FROM sales s WHERE s.farm_code = $1 AND s.price_per_unit IS NOT NULL ORDER BY s.date DESC, s.id`,
    [ACTIVE_FARM]
  );
  const byDate = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) (byDate.get(String(r.date)) ?? byDate.set(String(r.date), []).get(String(r.date))!).push(r);
  const out: { date: string; sales: number; before: number; after: number }[] = [];
  for (const [date, rs] of byDate) {
    const rate = rs[0].rate == null ? null : Number(rs[0].rate);
    if (rate == null) continue;
    const plan = repricePlan(rate, rs.map(toSale));
    if (plan.changed > 0) out.push({ date, sales: plan.changed, before: plan.totalBefore, after: plan.totalAfter });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Applies the plan the owner saw. The before and after totals shown on screen come back with the form; if the data moved in
 * the meantime (they no longer match) nothing is changed and the owner is asked to look again.
 */
export async function applyReprice(date: string, seenBefore: number, seenAfter: number): Promise<{ ok: true; changed: number; before: number; after: number } | { ok: false; message: string }> {
  return withTransaction(async (client) => {
    const rate = await rateFor(client, date);
    if (!rate) return { ok: false as const, message: "There is no rate for that day (or the last 3 days), so there is nothing to re-price with." };
    const { rows } = await client.query(SALES_OF_DAY, [ACTIVE_FARM, date]);
    const plan = repricePlan(rate.rate, rows.map(toSale));
    if (Math.abs(plan.totalBefore - seenBefore) > 0.01 || Math.abs(plan.totalAfter - seenAfter) > 0.01) {
      return { ok: false as const, message: "The sales or the rate changed while you were looking. Nothing was changed; please look at the new before and after totals." };
    }
    for (const r of plan.rows) {
      if (!r.changes) continue;
      await client.query(`UPDATE sales SET price_per_unit = $2, amount = $3 WHERE id = $1 AND farm_code = $4`, [r.id, r.newPrice, r.newAmount, ACTIVE_FARM]);
    }
    return { ok: true as const, changed: plan.changed, before: plan.totalBefore, after: plan.totalAfter };
  });
}
