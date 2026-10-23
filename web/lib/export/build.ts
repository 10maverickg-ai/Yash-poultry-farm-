import ExcelJS from "exceljs";
import type { Dataset } from "./types";

const colLetter = (i: number) => String.fromCharCode(65 + i);
const isoToDate = (s: string) => new Date(`${s}T00:00:00Z`);

/** Real .xlsx: numbers are numbers, dates are dates, a totals row uses SUM formulas, per-row formulas where the sheet defines them. */
export async function buildXlsx(ds: Dataset): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yash Poultry Farm";
  const ws = wb.addWorksheet(ds.name.slice(0, 31));
  ws.addRow([ds.title]).font = { bold: true, size: 13 };
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
  });
  const first = 4;
  ds.rows.forEach((r, ri) => {
    const rowNo = first + ri;
    const values = ds.columns.map((c) => {
      const f = ds.formulas?.[c.key];
      const v = r[c.key];
      if (f) return { formula: f(rowNo), result: typeof v === "number" ? v : undefined } as ExcelJS.CellFormulaValue;
      if (v == null || v === "") return null;
      if (c.type === "date") return isoToDate(String(v));
      if (c.type === "int" || c.type === "num" || c.type === "pct") return Number(v);
      return String(v);
    });
    ws.addRow(values);
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
  ws.views = [{ state: "frozen", ySplit: 3 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const csvCell = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV with a UTF-8 BOM (Excel on Windows/phones reads ₹ and names correctly); dates ISO, numbers plain. */
export function buildCsv(ds: Dataset): string {
  const lines = [ds.columns.map((c) => csvCell(c.header)).join(",")];
  for (const r of ds.rows) lines.push(ds.columns.map((c) => csvCell(r[c.key])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
