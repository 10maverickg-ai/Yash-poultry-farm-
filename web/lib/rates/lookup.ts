import type { PoolClient } from "pg";

type Q = Pick<PoolClient, "query">;

export interface RateForDay {
  date: string; // the day asked for
  rateDate: string; // the day the rate actually belongs to
  rate: number; // effective BAFTA rate (after subsidy) of rateDate
  carried: boolean; // true = "rate not updated": an earlier day's rate reused
}

// A day with no rate of its own reuses the previous day's — but only when
// that rate is at most CARRY_DAYS old. Anything older is NOT guessed: the
// sale stays unpriced until rates are entered.
export const CARRY_DAYS = 3;

export async function rateFor(db: Q, date: string): Promise<RateForDay | null> {
  const { rows } = await db.query(
    `SELECT date, bafta_rate FROM daily_egg_rates
      WHERE date <= $1 AND date >= ($1::date - $2::int)
      ORDER BY date DESC LIMIT 1`,
    [date, CARRY_DAYS]
  );
  const r = rows[0];
  if (!r) return null;
  return { date, rateDate: r.date, rate: Number(r.bafta_rate), carried: r.date !== date };
}

