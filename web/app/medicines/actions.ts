"use server";

import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { isPlaceholderDate } from "@/lib/ageWeeks";
import { randomUUID } from "node:crypto";
import { validateLine, IMPORT_TAG, parseImport, type ImportReport } from "@/lib/medicines/lines";
import { birdsOn, deleteEntryGroup, deleteLine, existingKeys, insertLine, listEntryFlocks, listTargets, matchLinesByName, setMonthNone, updateLine } from "@/lib/medicines/store";
import { createItem, isClash, listCatalogue } from "@/lib/medicines/catalogueStore";
import { listRules, listLayingFlocks } from "@/lib/medicines/boosterStore";
import { describeSplit, planEntry, validateEntry } from "@/lib/medicines/entry";
import { uploadRegisterPhoto } from "@/lib/storage";
import { tableFromFile } from "@/lib/import/file";
import { withTransaction as tx } from "@/lib/db";

const iso = /^\d{4}-\d{2}-\d{2}$/;

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const PHOTO_MAX = 15 * 1024 * 1024;
const STR = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");

/** The register page photo, if one was chosen: type and size are checked here, then it goes to the register-photos bucket (prefix medicines/). */
async function photoFrom(f: FormData, date: string): Promise<{ url: string | null; problem: string | null }> {
  const file = f.get("photo");
  if (!(file instanceof File) || file.size === 0) return { url: null, problem: null };
  if (!PHOTO_TYPES.includes(file.type)) return { url: null, problem: "The photo must be a JPEG, PNG, WebP or HEIC picture." };
  if (file.size > PHOTO_MAX) return { url: null, problem: "The photo is bigger than 15 MB. Take it again at a lower quality." };
  try {
    return { url: await uploadRegisterPhoto(file, "medicines", date), problem: null };
  } catch {
    return { url: null, problem: "The photo could not be stored just now, but the line was saved. Add the photo later by editing the line." };
  }
}

export interface LineState {
  ok: boolean;
  message: string;
  savedId?: number; // changes with every save, so the form can start fresh
  photoUrl?: string | null; // the register page photo, kept for the next line of the same page
  keep?: { date: string; kind: string; target: string; supplier: string };
  deleted?: boolean;
}
export interface EntryState {
  ok: boolean;
  message: string;
  savedId?: string; // changes with every save, so the form can start fresh
  photoUrl?: string | null;
  keep?: { date: string; flockIds: string[]; supplier: string };
}
const fieldsOf = (f: FormData) => ({ date: STR(f, "date"), kind: STR(f, "kind"), item: STR(f, "item"), target: STR(f, "target"), quantity: STR(f, "quantity"), unit: STR(f, "unit"), cost: STR(f, "cost"), supplier: STR(f, "supplier"), note: STR(f, "note") });

// One entry of the register: an item picked from the list, one or more flocks ticked. One line is saved PER FLOCK (so per-flock reports are
// exact); a total quantity or cost is split by the birds in each flock on that date and the screen says so. The answer is shown on the same
// screen, and the next entry keeps the date, flocks, shop and the register-page photo.
export async function saveEntry(_prev: EntryState | null, formData: FormData): Promise<EntryState> {
  try {
    const [items, flocks] = await Promise.all([listCatalogue(), listEntryFlocks()]);
    const v = validateEntry(
      { date: STR(formData, "date"), catalogue_id: STR(formData, "catalogue_id"), new_name: STR(formData, "new_name"), new_kind: STR(formData, "new_kind"), new_purpose: STR(formData, "new_purpose"), flock_ids: formData.getAll("flock_id").map(String), quantity: STR(formData, "quantity"), unit: STR(formData, "unit"), cost: STR(formData, "cost"), supplier: STR(formData, "supplier"), note: STR(formData, "note") },
      items,
      flocks.map((f) => ({ id: f.id, label: f.label, birds: f.birds }))
    );
    if (!v.ok) return { ok: false, message: v.errors.join(" ") };
    const e = v.entry;
    const birds = await birdsOn(e.date, e.flockIds);
    const plan = planEntry(e, flocks.map((f) => ({ id: f.id, label: f.label, birds: birds.get(f.id) ?? f.birds })));
    const photo = await photoFrom(formData, e.date);
    const photoUrl = photo.url ?? (STR(formData, "keep_photo") || null);
    const group = plan.parts.length > 1 ? randomUUID() : null;
    let name = "";
    let created = false;
    await tx(async (c) => {
      let item = e.choice.item ? { id: e.choice.item.id, name: e.choice.item.name, kind: e.choice.item.kind } : null;
      if (!item && e.choice.create) {
        const cr = e.choice.create;
        const id = await createItem(c, { name: cr.name, kind: cr.kind, purpose: cr.purpose, route: null, dose: null, brand: null, unit: null, note: null }, true);
        item = { id, name: cr.name, kind: cr.kind };
        created = true;
      }
      if (!item) throw new Error("no item");
      name = item.name;
      for (const part of plan.parts) {
        await insertLine(
          c,
          { scope: "flock", flockId: part.flockId, shedCode: null, date: e.date, kind: item.kind as "medicine" | "vaccine", item: item.name, quantity: part.quantity, unit: e.unit, cost: part.cost, supplier: e.supplier, note: e.note, catalogueId: item.id, entryGroup: group, costTotal: plan.costTotal, quantityTotal: plan.quantityTotal, splitBasis: plan.basis },
          photoUrl,
          "hand entry"
        );
      }
    });
    const where = plan.parts.map((p) => p.label).join(", ");
    const split = describeSplit(plan, e.unit);
    return {
      ok: true,
      savedId: group ?? `${Date.now()}`,
      photoUrl,
      keep: { date: e.date, flockIds: e.flockIds, supplier: e.supplier ?? "" },
      message: [`Saved: ${name} for ${where}.`, created ? "It was added to the Medicines list and is marked “to confirm”." : "", e.choice.note ?? "", split, photo.problem ?? "", STR(formData, "intent") === "done" ? "" : "Add the next one."].filter(Boolean).join(" "),
    };
  } catch (err) {
    return { ok: false, message: isClash(err) ? "That name is already in the Medicines list. Pick it from the list." : "The entry could not be saved just now. Nothing was lost on your screen; try again in a moment." };
  }
}

export async function saveLineEdit(id: number, _prev: LineState | null, formData: FormData): Promise<LineState> {
  try {
    const f = fieldsOf(formData);
    // the name comes from the list: a picked item decides the name and the type; an old line not matched to the list keeps its typed name
    const cid = Number(STR(formData, "catalogue_id"));
    let catalogueId: number | null = null;
    if (Number.isInteger(cid) && cid > 0) {
      const item = (await listCatalogue()).find((i) => i.id === cid);
      if (!item || item.kind === "management") return { ok: false, message: "Pick a medicine or vaccine from the list." };
      f.item = item.name;
      f.kind = item.kind;
      catalogueId = item.id;
    }
    const v = validateLine(f);
    if (!v.ok) return { ok: false, message: v.errors.join(" ") };
    const photo = await photoFrom(formData, v.line.date);
    const ok = await updateLine(id, { ...v.line, catalogueId }, photo.url);
    return ok ? { ok: true, savedId: id, message: `Changed: ${v.line.item}.${photo.problem ? ` ${photo.problem}` : ""}` } : { ok: false, message: "That line no longer exists." };
  } catch {
    return { ok: false, message: "The change could not be saved just now. Try again in a moment." };
  }
}

// Delete needs the owner to tick the confirmation box (nothing is deleted from a single tap).
export async function removeLine(id: number, _prev: LineState | null, formData: FormData): Promise<LineState> {
  if (STR(formData, "confirm") !== "yes") return { ok: false, message: "Tick “Yes, delete this line” first." };
  try {
    await deleteLine(id);
    return { ok: true, deleted: true, message: "The line was deleted." };
  } catch {
    return { ok: false, message: "The line could not be deleted just now. Try again in a moment." };
  }
}

// Delete every line that was saved together (one entry for several flocks); also needs the tick.
export async function removeEntry(group: string, _prev: LineState | null, formData: FormData): Promise<LineState> {
  if (STR(formData, "confirm") !== "yes") return { ok: false, message: "Tick “Yes, delete the whole entry” first." };
  try {
    const n = await deleteEntryGroup(group);
    return { ok: true, deleted: true, message: `The entry was deleted (${n} line${n === 1 ? "" : "s"}).` };
  } catch {
    return { ok: false, message: "The entry could not be deleted just now. Try again in a moment." };
  }
}

// One tap: every old line typed with this name gets the picked list item.
export async function matchUnmatched(itemText: string, _prev: LineState | null, formData: FormData): Promise<LineState> {
  const id = Number(STR(formData, "catalogue_id"));
  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: "Pick the list item these lines mean." };
  try {
    const n = await matchLinesByName(itemText, id);
    return n > 0 ? { ok: true, message: `Matched ${n} line${n === 1 ? "" : "s"}.` } : { ok: false, message: "Nothing to match: those lines were already matched, or that item cannot be used." };
  } catch {
    return { ok: false, message: "That could not be saved just now. Try again in a moment." };
  }
}

// "None this month" for medicines and vaccines (monthly_input_status), and taking it back. The answer is shown on the same screen.
export async function markMonthNone(month: string, _prev: LineState | null, formData: FormData): Promise<LineState> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: "Unknown month." };
  const undo = STR(formData, "undo") === "1";
  try {
    await setMonthNone(month, !undo);
    return { ok: true, message: undo ? "Taken back: the month is open again." : "Saved: no medicines or vaccines this month." };
  } catch {
    return { ok: false, message: "Could not save just now. Try again in a moment." };
  }
}

export interface MedImportState { mode: "preview" | "imported" | "error"; message: string; report?: ImportReport }

// Import from CSV / Excel with a dry run. Lines already in the register (same date, type, name, target, quantity, unit) are skipped, never doubled.
export async function importMedicines(_prev: MedImportState | null, formData: FormData): Promise<MedImportState> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { mode: "error", message: "Choose a CSV or Excel file first." };
    const table = await tableFromFile(file);
    const [t, existing] = await Promise.all([listTargets(), existingKeys()]);
    const report = parseImport(table, t.flocks.map((f) => ({ id: f.id, label: f.label })), t.sheds, existing);
    if (report.columnProblems.length) return { mode: "error", message: report.columnProblems.join(" "), report };
    if (STR(formData, "intent") !== "import") return { mode: "preview", message: "Dry run: nothing was saved.", report };
    if (report.counts.error > 0 && formData.get("skip_errors") !== "on") return { mode: "preview", message: "Some lines have errors. Fix the file, or tick “import the good lines and skip the others”.", report };
    let written = 0;
    await tx(async (c) => {
      for (const r of report.rows) if (r.state === "ok" && r.input) { await insertLine(c, r.input, null, IMPORT_TAG); written++; }
    });
    return { mode: "imported", message: `Imported ${written} line${written === 1 ? "" : "s"}; skipped ${report.rows.length - written}. They are tagged “${IMPORT_TAG}”. Lines with a cost now count on the Costs screen.`, report };
  } catch (e) {
    return { mode: "error", message: e instanceof Error ? e.message : "Could not read the file." };
  }
}


// target = "flock:<uuid>" or "batch:<id>"
function parseTarget(t: string): { flock: string | null; batch: number | null } | null {
  if (t.startsWith("flock:") && t.length > 6) return { flock: t.slice(6), batch: null };
  if (t.startsWith("batch:") && Number.isInteger(Number(t.slice(6)))) return { flock: null, batch: Number(t.slice(6)) };
  return null;
}

export async function addVaccination(_prev: LineState | null, formData: FormData): Promise<LineState> {
  const target = parseTarget(String(formData.get("target") ?? ""));
  const vaccine = String(formData.get("vaccine") ?? "").trim();
  const due = String(formData.get("due_date") ?? "");
  if (!target) return { ok: false, message: "Choose the flock or batch." };
  if (!vaccine) return { ok: false, message: "Say which vaccine." };
  if (!iso.test(due)) return { ok: false, message: "Choose the due date." };
  await pool.query(
    `INSERT INTO vaccination_schedule (farm_code, flock_internal_id, chick_batch_id, vaccine, due_date, route, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ACTIVE_FARM, target.flock, target.batch, vaccine, due, String(formData.get("route") ?? "") || null, String(formData.get("note") ?? "") || null]
  );
  return { ok: true, message: "Vaccination added to the schedule." };
}

export async function markVaccinationGiven(id: number, _prev: LineState | null, formData: FormData): Promise<LineState> {
  const given = String(formData.get("given_date") ?? "");
  if (!iso.test(given)) return { ok: false, message: "Choose the date it was given." };
  await pool.query(`UPDATE vaccination_schedule SET given_date = $2 WHERE id = $1 AND farm_code = $3`, [id, given, ACTIVE_FARM]);
  return { ok: true, message: "Marked as given." };
}

// Fills a schedule for one batch or flock from a knowledge-library entry whose
// standards are "vaccine:<name>" at an age in weeks. Due date = start + weeks.
// Nothing is added twice (same target + vaccine + due date).
export async function fillScheduleFromLibrary(_prev: LineState | null, formData: FormData): Promise<LineState> {
  const target = parseTarget(String(formData.get("target") ?? ""));
  const entryId = Number(formData.get("entry"));
  if (!target) return { ok: false, message: "Choose the flock or batch." };
  if (!Number.isInteger(entryId)) return { ok: false, message: "Choose a library entry." };
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
  if (!start) return { ok: false, message: "That flock has no real placement date yet, so due dates cannot be worked out." };
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
  return { ok: added > 0, message: added ? `Added ${added} vaccination${added === 1 ? "" : "s"} from the library.` : "Nothing new to add: that entry has no vaccine rows, or they are already scheduled." };
}

// The owner or the vet can move a due date (library dates are only a starting point).
export async function changeVaccinationDue(id: number, _prev: LineState | null, formData: FormData): Promise<LineState> {
  const due = String(formData.get("due_date") ?? "");
  if (!iso.test(due)) return { ok: false, message: "Choose the new due date." };
  await pool.query(`UPDATE vaccination_schedule SET due_date = $2 WHERE id = $1 AND farm_code = $3`, [id, due, ACTIVE_FARM]);
  return { ok: true, message: "Due date changed." };
}


// "Enter last date": one tap on a flock's booster when no date is recorded (or to add a newer one). It writes a normal register line for
// that flock with the rule's own list item and no cost, so it counts exactly like any other entry. A date is always typed, never assumed.
export async function enterLastBooster(flockId: string, ruleCode: string, _prev: LineState | null, formData: FormData): Promise<LineState> {
  const date = STR(formData, "date");
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  if (!iso.test(date)) return { ok: false, message: "Choose the date it was given." };
  if (date > today) return { ok: false, message: "That date is in the future. Choose the date it was given." };
  if (date < "2015-01-01") return { ok: false, message: "That date looks wrong. Check the year." };
  try {
    const [rules, flocks, items] = await Promise.all([listRules(), listLayingFlocks(), listCatalogue()]);
    const rule = rules.find((r) => r.code === ruleCode);
    const flock = flocks.find((f) => f.id === flockId);
    const item = items.find((i) => i.id === rule?.mainItemId);
    if (!rule || !flock || !item) return { ok: false, message: "That flock or booster is not in the app." };
    const dup = await pool.query(`SELECT 1 FROM medicine_lines WHERE farm_code = $1 AND flock_internal_id = $2 AND catalogue_id = $3 AND date = $4`, [ACTIVE_FARM, flockId, item.id, date]);
    if (dup.rows.length) return { ok: false, message: `${flock.label} already has ${rule.label} on that date.` };
    await tx((c) => insertLine(c, { scope: "flock", flockId, shedCode: null, date, kind: "vaccine", item: item.name, quantity: null, unit: null, cost: null, supplier: null, note: "Last date entered from the booster screen", catalogueId: item.id }, null, "booster last date"));
    return { ok: true, message: `Saved: ${rule.label} for ${flock.label} on ${date}.` };
  } catch {
    return { ok: false, message: "That could not be saved just now. Try again in a moment." };
  }
}
