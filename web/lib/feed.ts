import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

// One slot per raw material for the chosen date, left-joined with any saved
// row. Values stored in kg (schema-normalized); the form displays the
// quintal columns as quintals, exactly like the paper page.
export interface FeedStockSlot {
  material_name: string;
  previous_closing_kg: string | null; // most recent earlier closing (pg numeric)
  saved: null | {
    opening_balance_kg: string | null;
    purchase_kg: string | null;
    consumed_kg: string | null;
    closing_balance_kg: string | null;
    flagged: boolean;
    flag_reason: string | null;
  };
}

export async function getFeedStockSheet(date: string): Promise<FeedStockSlot[]> {
  const { rows } = await pool.query(
    `SELECT m.material_name,
            fs.opening_balance_kg, fs.purchase_kg, fs.consumed_kg,
            fs.closing_balance_kg, fs.flagged, fs.flag_reason,
            fs.id AS row_id,
            prev.closing_balance_kg AS previous_closing_kg
       FROM feed_materials m
       LEFT JOIN feed_stock fs
         ON fs.material_name = m.material_name
        AND fs.farm_code = $1 AND fs.date = $2
       LEFT JOIN LATERAL (
            SELECT closing_balance_kg FROM feed_stock p
             WHERE p.material_name = m.material_name
               AND p.farm_code = $1 AND p.date < $2
               AND p.closing_balance_kg IS NOT NULL
             ORDER BY p.date DESC LIMIT 1
       ) prev ON true
      ORDER BY m.material_name`,
    [ACTIVE_FARM, date]
  );
  return rows.map((r) => ({
    material_name: r.material_name,
    previous_closing_kg: r.previous_closing_kg,
    saved:
      r.row_id === null
        ? null
        : {
            opening_balance_kg: r.opening_balance_kg,
            purchase_kg: r.purchase_kg,
            consumed_kg: r.consumed_kg,
            closing_balance_kg: r.closing_balance_kg,
            flagged: r.flagged,
            flag_reason: r.flag_reason,
          },
  }));
}

// Formulation versions, one row per (group, effective_date), lines aggregated
// for display — versioned reference data, not daily entry.
export interface FormulationVersion {
  formulation_group: string;
  effective_date: string;
  batch_total_kg: string | null;
  reason_for_change: string | null;
  materials: string; // "Maize 550 kg, Soya 200 kg, …"
  line_count: number;
}

export async function listFormulationVersions(): Promise<FormulationVersion[]> {
  const { rows } = await pool.query(
    `SELECT formulation_group, effective_date,
            trim_scale(max(batch_total_kg)) AS batch_total_kg,
            max(reason_for_change) AS reason_for_change,
            string_agg(material_name || ' ' || trim_scale(quantity_kg) || ' kg',
                       ', ' ORDER BY material_name) AS materials,
            count(*)::int AS line_count
       FROM feed_formulation
      WHERE farm_code = $1
      GROUP BY formulation_group, effective_date
      ORDER BY effective_date DESC, formulation_group`,
    [ACTIVE_FARM]
  );
  return rows;
}

export async function listMaterialNames(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT material_name FROM feed_materials ORDER BY material_name`
  );
  return rows.map((r) => r.material_name);
}
