import ExcelJS from "exceljs";
import { parseCsv } from "./paperHistory";

// Reads an uploaded CSV or .xlsx into a table of text cells (first row = headings). Shared by the import screens.
// Only .csv and .xlsx are accepted, at most 5 MB; the first sheet of a workbook is read. Anything else is refused in plain words.
export const IMPORT_MAX_BYTES = 5_000_000;
export async function tableFromFile(file: File): Promise<string[][]> {
  if (file.size > IMPORT_MAX_BYTES) throw new Error("The file is bigger than 5 MB. Split it into years.");
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
  if (!name.endsWith(".csv") && !name.endsWith(".txt")) throw new Error("Only .csv and .xlsx files can be read. In Excel choose Save As → CSV or .xlsx.");
  return parseCsv(await file.text());
}

