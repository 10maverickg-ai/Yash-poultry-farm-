"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { IMPORT_SOURCE_TAG, parseCsv, readTable, validateRows, type ImportReport } from "@/lib/import/paperHistory";

export interface ImportState {
  mode: "preview" | "imported" | "error";
  message: string;
  report?: ImportReport;
  written?: number;
  skipped?: number;
}

async function tableFromFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await file.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const out: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) {
        const v = row.getCell(c).value;
        cells.push(v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : typeof v === "object" && "result" in v ? String((v as { result: unknown }).result ?? "") : String(v));
      }
      out.push(cells);
    });
    return out;
  }
  if (name.endsWith(".xls")) throw new Error("Old .xls files are not supported. In Excel choose Save As → CSV or .xlsx.");
  return parseCsv(await file.text());
}

// Preview / dry run (default) or import. Never overwrites a day that already exists unless "replace" is ticked on the
// import step. Never calls the reader / Anthropic. Rows are stored like hand-entered days, tagged "paper history import".
export async function paperHistoryAction(_prev: ImportState | null, formData: FormData): Promise<ImportState> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { mode: "error", message: "Choose a CSV or Excel file first." };
    if (file.size > 5_000_000) return { mode: "error", message: "The file is bigger than 5 MB. Split it into years." };
    const intent = String(formData.get("intent") ?? "preview");
    const replace = formData.get("replace") === "on";
    const parsed = readTable(await tableFromFile(file));
    const [fl, ex] = await Promise.all([
      pool.query(`SELECT flock_internal_id AS id, display_label AS label, segment FROM flocks WHERE farm_code = $1`, [ACTIVE_FARM]),
      pool.query(`SELECT flock_internal_id AS id, to_char(date,'YYYY-MM-DD') AS d FROM daily_production WHERE farm_code = $1 AND deleted_at IS NULL`, [ACTIVE_FARM]),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const report = validateRows(parsed, fl.rows.map((f) => ({ id: f.id, label: f.label, big: f.segment !== "young" })), new Set(ex.rows.map((r) => `${r.id}|${r.d}`)), today);
    if (parsed.columnProblems.length) return { mode: "error", message: parsed.columnProblems.join(" "), report };
    if (intent !== "import") return { mode: "preview", message: "Dry run: nothing was saved.", report };
    if (report.counts.error > 0 && formData.get("skip_errors") !== "on") return { mode: "preview", message: "Some rows have errors. Fix the file, or tick “import the good rows and skip the rows with errors”.", report };
    let written = 0, skipped = 0;
    await withTransaction(async (client) => {
      for (const r of report.results) {
        if (r.state === "error" || (r.state === "exists" && !replace)) { skipped++; continue; }
        const x = r.row;
        const { rows } = await client.query(
          `INSERT INTO daily_production (date, farm_code, flock_internal_id, display_label_as_written, mortality, feed_bags, eggs_total, bird_population, source_tag)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (flock_internal_id, date) WHERE deleted_at IS NULL DO UPDATE SET
             display_label_as_written = EXCLUDED.display_label_as_written, mortality = EXCLUDED.mortality, feed_bags = EXCLUDED.feed_bags,
             eggs_total = EXCLUDED.eggs_total, bird_population = EXCLUDED.bird_population, source_tag = EXCLUDED.source_tag, reviewed_by_owner = false
           RETURNING id`,
          [x.date, ACTIVE_FARM, r.flockId, x.flockLabel, x.mortality, x.feedBags, x.eggs, x.birds, IMPORT_SOURCE_TAG],
        );
        await client.query(
          `UPDATE daily_production SET flagged = cardinality(v.reasons) > 0, flag_reason = nullif(array_to_string(v.reasons, '; '), ''), hd_percent_note = v.hd_percent_note
             FROM fn_validate_daily_production($1) v WHERE id = $1`,
          [rows[0].id],
        );
        written++;
      }
    });
    revalidatePath("/analytics");
    revalidatePath("/analytics/targets");
    return { mode: "imported", message: `Imported ${written} day${written === 1 ? "" : "s"}; skipped ${skipped}. They are tagged “${IMPORT_SOURCE_TAG}”, and the realistic target now learns from them.`, report, written, skipped };
  } catch (e) {
    return { mode: "error", message: e instanceof Error ? e.message : "Could not read the file." };
  }
}
