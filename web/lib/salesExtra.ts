import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

// Two read-only lists the Sales page adds (V5 2.2):
//  - ledger "sale" / "local_sale" lines that have no sales row yet because no
//    BAFTA rate has been entered for their day (never priced with a guess);
//  - bird sales: flock_movements of type 'sale' with a price per bird.

export interface UnpricedLedgerSale {
  entryId: number;
  date: string;
  section: string; // big / small = grade
  label: string;
  category: string;
  eggs: number;
  hasRate: boolean; // a rate exists for the day but the row has not been created yet
}

export async function listUnpricedLedgerSales(): Promise<UnpricedLedgerSale[]> {
  const { rows } = await pool.query(
    `SELECT e.id, s.date, s.section, e.label_as_written, e.category, -e.amount_eggs AS eggs,
            EXISTS (SELECT 1 FROM daily_egg_rates r WHERE r.date = s.date) AS has_rate
       FROM daily_egg_stock_entries e
       JOIN daily_egg_stock_summary s ON s.id = e.egg_stock_summary_id
      WHERE s.farm_code = $1 AND s.deleted_at IS NULL
        AND e.category IN ('sale', 'local_sale')
        AND e.linked_sale_id IS NULL
      ORDER BY s.date DESC, e.id`,
    [ACTIVE_FARM]
  );
  return rows.map((r) => ({
    entryId: Number(r.id),
    date: r.date,
    section: r.section,
    label: r.label_as_written,
    category: r.category,
    eggs: r.eggs,
    hasRate: r.has_rate,
  }));
}

export interface BirdSale {
  id: number;
  date: string;
  flockName: string;
  registerNote: string | null;
  birds: number;
  pricePerBird: number | null;
  amount: number | null;
  buyer: string | null;
}

export async function listBirdSales(): Promise<BirdSale[]> {
  const { rows } = await pool.query(
    `SELECT m.id, m.date, f.display_label AS flock_name, m.register_note, m.birds_change,
            m.price_per_bird, m.buyer
       FROM flock_movements m JOIN flocks f USING (flock_internal_id)
      WHERE m.farm_code = $1 AND m.movement_type = 'sale'
      ORDER BY m.date DESC, m.id`,
    [ACTIVE_FARM]
  );
  return rows.map((r) => {
    const birds = Math.abs(r.birds_change);
    const price = r.price_per_bird != null ? Number(r.price_per_bird) : null;
    return {
      id: Number(r.id),
      date: r.date,
      flockName: r.flock_name,
      registerNote: r.register_note,
      birds,
      pricePerBird: price,
      amount: price != null ? birds * price : null,
      buyer: r.buyer,
    };
  });
}
