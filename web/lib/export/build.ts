import ExcelJS from "exceljs";
import type { Dataset } from "./types";

/** A, B, … Z, AA, AB, … (a sheet can have more than 26 columns). */
const colLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
const isoToDate = (s: string) => new Date(`${s}T00:00:00Z`);

/** Real .xlsx: numbers are numbers, dates are dates, a totals row uses SUM formulas, per-row formulas where the sheet defines them. */
export async function buildXlsx(ds: Dataset): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yash Poultry Farm";
  addSheet(wb, ds, [ds.title]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** V18: one workbook, one sheet per dataset, each starting with the same lines about the file (farm, view, dates, flocks, when made), then the sheet's own title. */
export async function buildBook(sheets: Dataset[], meta: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yash Poultry Farm";
  for (const ds of sheets) addSheet(wb, ds, [...meta, ds.title]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** One sheet: the lines above the table (the first and the last one bold), a blank row, the header (frozen), the rows, a totals row, the notes. */
function addSheet(wb: ExcelJS.Workbook, ds: Dataset, preamble: string[]) {
  const ws = wb.addWorksheet(ds.name.slice(0, 31));
  preamble.forEach((line, i) => {
    const r = ws.addRow([line]);
    r.font = i === 0 ? { bold: true, size: 13 } : i === preamble.length - 1 ? { bold: true } : { color: { argb: "FF475569" } };
  });
  ws.addRow([]);
  const header = ws.addRow(ds.columns.map((c) => c.header));
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: "middle" };
  header.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6EBEF" } }; });
  ds.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? 12;
    if (c.type === "date") col.numFmt = "dd-mmm-yyyy";
    if (c.type === "int") col.numFmt = "#,##0";
    if (c.type === "num") col.numFmt = "#,##0.00";
    if (c.type === "pct") col.numFmt = "0.00";
    if (c.type === "percent") col.numFmt = "0.0%";
  });
  const headerRow = preamble.length + 2;
  const first = headerRow + 1;
  ds.rows.forEach((r, ri) => {
    const rowNo = first + ri;
    const values = ds.columns.map((c) => {
      const f = ds.formulas?.[c.key];
      const v = r[c.key];
      const fx = f ? f(rowNo, ri) : null;
      if (fx) return { formula: fx, result: typeof v === "number" ? v : undefined } as ExcelJS.CellFormulaValue;
      if (v == null || v === "") return null;
      if (c.type === "date") return isoToDate(String(v));
      if (c.type === "int" || c.type === "num" || c.type === "pct" || c.type === "percent") return Number(v);
      if (c.type === "auto") return typeof v === "number" ? v : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? isoToDate(String(v)) : String(v);
      return String(v);
    });
    const row = ws.addRow(values);
    // auto columns: a date cell shows as a date, a whole number without decimals
    ds.columns.forEach((c, i) => {
      if (c.type !== "auto") return;
      const cell = row.getCell(i + 1);
      const v = r[c.key];
      if (typeof v === "number") cell.numFmt = ds.percentCells?.(ri, c.key) ? "0.0%" : ds.ratioCells?.(ri, c.key) ? "0.00" : Number.isInteger(v) ? "#,##0" : "#,##0.00";
      else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) cell.numFmt = "dd-mmm-yyyy";
    });
  });
  const last = first + ds.rows.length - 1;
  if (ds.rows.length > 0 && ds.columns.some((c) => c.total || c.totalFormula)) {
    const letters = Object.fromEntries(ds.columns.map((c, i) => [c.key, colLetter(i)]));
    const totals = ws.addRow(ds.columns.map((c, i) => (i === 0 ? "Total" : c.totalFormula ? ({ formula: c.totalFormula(first, last, letters) } as ExcelJS.CellFormulaValue) : c.total ? ({ formula: `SUM(${colLetter(i)}${first}:${colLetter(i)}${last})` } as ExcelJS.CellFormulaValue) : null)));
    totals.font = { bold: true };
    totals.eachCell((c) => { c.border = { top: { style: "thin" } }; });
  }
  ws.addRow([]);
  for (const n of ds.notes) ws.addRow([n]).font = { italic: true, color: { argb: "FF64748B" } };
  ws.views = [{ state: "frozen", ySplit: headerRow }];
}

const csvCell = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV with a UTF-8 BOM (Excel on Windows/phones reads ₹ and names correctly); dates ISO, numbers plain; percentages × 100. */
export function buildCsv(ds: Dataset, meta: string[] = []): string {
  const pctOut = (v: unknown) => (typeof v === "number" ? Math.round(v * 10000) / 100 : v);
  const lines = [...(meta.length ? [...meta, ds.title].map(csvCell).concat([""]) : []), ds.columns.map((c) => csvCell(c.header)).join(",")];
  ds.rows.forEach((r, ri) => lines.push(ds.columns.map((c) => csvCell(c.type === "percent" || ds.percentCells?.(ri, c.key) ? pctOut(r[c.key]) : r[c.key])).join(",")));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** V18: several sheets as CSV files in one zip (each file starts with the lines about the file). */
export async function buildCsvZip(sheets: Dataset[], meta: string[], stem: string): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const ds of sheets) zip.file(`${stem}-${ds.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, buildCsv(ds, meta));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
