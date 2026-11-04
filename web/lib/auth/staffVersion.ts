// "Log out all staff phones": a number in the database that every staff session must match. Raising it ends them all.
// If the number cannot be read, staff sessions are treated as ended (fail closed); the owner is never affected.
import { pool } from "@/lib/db";

const KEY = "staff_session_version";

export async function getStaffVersion(): Promise<number | null> {
  try {
    const { rows } = await pool.query(`SELECT int_value FROM auth_state WHERE key = $1`, [KEY]);
    return rows[0] ? Number(rows[0].int_value) : 0;
  } catch {
    return null;
  }
}

export async function bumpStaffVersion(): Promise<number | null> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO auth_state (key, int_value) VALUES ($1, 1)
       ON CONFLICT (key) DO UPDATE SET int_value = auth_state.int_value + 1, updated_at = now() RETURNING int_value`,
      [KEY]
    );
    return Number(rows[0].int_value);
  } catch {
    return null;
  }
}
