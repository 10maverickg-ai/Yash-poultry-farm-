"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { isPlaceholderDate } from "@/lib/ageWeeks";

const iso = /^\d{4}-\d{2}-\d{2}$/;
function back(msg: string, ok = false): never {
  revalidatePath("/medicines");
  redirect(`/medicines?${ok ? "saved" : "error"}=${encodeURIComponent(msg)}`);
}

export async function addMedicinePurchase(formData: FormData) {
  const kind = String(formData.get("kind") ?? "");
  const date = String(formData.get("date") ?? "");
  const item = String(formData.get("item") ?? "").trim();
  const amount = Number(formData.get("amount_inr"));
  if (kind !== "medicine" && kind !== "vaccine") back("Choose medicine or vaccine.");
  if (!iso.test(date)) back("Choose the purchase date.");
  if (!item) back("Say what was bought.");
  if (!Number.isFinite(amount) || amount < 0) back("Enter the price paid in rupees.");
  const qty = String(formData.get("quantity") ?? "").trim();
  await pool.query(
    `INSERT INTO purchases (farm_code, date, category, item, quantity, unit, amount_inr, supplier, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ACTIVE_FARM, date, kind, item, qty === "" ? null : Number(qty), String(formData.get("unit") ?? "") || null, amount, String(formData.get("supplier") ?? "") || null, String(formData.get("note") ?? "") || null]
  );
  back("Purchase saved.", true);
}

// target = "flock:<uuid>" or "batch:<id>"
function parseTarget(t: string): { flock: string | null; batch: number | null } | null {
  if (t.startsWith("flock:") && t.length > 6) return { flock: t.slice(6), batch: null };
  if (t.startsWith("batch:") && Number.isInteger(Number(t.slice(6)))) return { flock: null, batch: Number(t.slice(6)) };
  return null;
}

export async function addVaccination(formData: FormData) {
  const target = parseTarget(String(formData.get("target") ?? ""));
  const vaccine = String(formData.get("vaccine") ?? "").trim();
  const due = String(formData.get("due_date") ?? "");
  if (!target) back("Choose the flock or batch.");
  if (!vaccine) back("Say which vaccine.");
  if (!iso.test(due)) back("Choose the due date.");
  await pool.query(
    `INSERT INTO vaccination_schedule (farm_code, flock_internal_id, chick_batch_id, vaccine, due_date, route, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ACTIVE_FARM, target.flock, target.batch, vaccine, due, String(formData.get("route") ?? "") || null, String(formData.get("note") ?? "") || null]
  );
  back("Vaccination added.", true);
}

export async function markVaccinationGiven(id: number, formData: FormData) {
  const given = String(formData.get("given_date") ?? "");
  if (!iso.test(given)) back("Choose the date it was given.");
  await pool.query(`UPDATE vaccination_schedule SET given_date = $2 WHERE id = $1 AND farm_code = $3`, [id, given, ACTIVE_FARM]);
  back("Marked as given.", true);
}

// Fills a schedule for one batch or flock from a knowledge-library entry whose
// standards are "vaccine:<name>" at an age in weeks. Due date = start + weeks.
// Nothing is added twice (same target + vaccine + due date).
export async function fillScheduleFromLibrary(formData: FormData) {
  const target = parseTarget(String(formData.get("target") ?? ""));
  const entryId = Number(formData.get("entry"));
  if (!target) back("Choose the flock or batch.");
  if (!Number.isInteger(entryId)) back("Choose a library entry.");
  const start: string | null = await (async () => {
    if (target!.batch) {
      const { rows } = await pool.query(`SELECT arrival_date FROM chick_batches WHERE id = $1 AND farm_code = $2`, [target!.batch, ACTIVE_FARM]);
      return rows[0] ? String(rows[0].arrival_date).slice(0, 10) : null;
    }
    const { rows } = await pool.query(`SELECT placement_date, placement_date_confirmed FROM flocks WHERE flock_internal_id = $1 AND farm_code = $2`, [target!.flock, ACTIVE_FARM]);
    const r = rows[0];
    if (!r?.placement_date) return null;
    const d = String(r.placement_date).slice(0, 10);
    return isPlaceholderDate(d, r.placement_date_confirmed) ? null : d;
  })();
  if (!start) back("That flock has no real placement date yet, so due dates cannot be worked out.");
  let added = 0;
  await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT metric, age_weeks, unit FROM knowledge_standards WHERE entry_id = $1 AND metric LIKE 'vaccine:%' ORDER BY age_weeks`, [entryId]);
    const { rows: src } = await client.query(
      `SELECT d.company, d.title, e.notes FROM knowledge_entries e JOIN knowledge_documents d ON d.id = e.document_id WHERE e.id = $1`,
      [entryId]
    );
    const example = /example/i.test(String(src[0]?.title ?? "")) || /example program/i.test(String(src[0]?.notes ?? ""));
    // The stored age is the EARLIEST week of a printed range; ranges and the
    // caveat go in the note so the owner/vet can adjust the date.
    const note = `From the library: ${src[0]?.company ?? ""} — ${src[0]?.title ?? ""}. ${example ? "EXAMPLE PROGRAMME, not a prescription: confirm every date with your vet. " : ""}Due date = the earliest week of the printed range; change it if needed.`;
    for (const r of rows) {
      const due = new Date(Date.parse(start! + "T00:00:00Z") + r.age_weeks * 7 * 86400000).toISOString().slice(0, 10);
      const name = String(r.metric).slice("vaccine:".length);
      const res = await client.query(
        `INSERT INTO vaccination_schedule (farm_code, flock_internal_id, chick_batch_id, vaccine, due_date, route, source_entry_id, note)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8
          WHERE NOT EXISTS (SELECT 1 FROM vaccination_schedule v WHERE v.farm_code = $1 AND v.vaccine = $4 AND v.due_date = $5
                              AND v.flock_internal_id IS NOT DISTINCT FROM $2 AND v.chick_batch_id IS NOT DISTINCT FROM $3)`,
        [ACTIVE_FARM, target!.flock, target!.batch, name, due, r.unit ?? null, entryId, note]
      );
      added += res.rowCount ?? 0;
    }
  });
  back(added ? `Added ${added} vaccination${added === 1 ? "" : "s"} from the library.` : "Nothing new to add (that entry has no vaccine rows, or they are already scheduled).", added > 0);
}

// The owner or the vet can move a due date (library dates are only a starting point).
export async function changeVaccinationDue(id: number, formData: FormData) {
  const due = String(formData.get("due_date") ?? "");
  if (!iso.test(due)) back("Choose the new due date.");
  await pool.query(`UPDATE vaccination_schedule SET due_date = $2 WHERE id = $1 AND farm_code = $3`, [id, due, ACTIVE_FARM]);
  back("Due date changed.", true);
}
