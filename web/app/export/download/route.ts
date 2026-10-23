import { NextRequest } from "next/server";
import { DATASETS, validMonth, type DatasetKind } from "@/lib/export/data";
import { buildCsv, buildXlsx, XLSX_TYPE } from "@/lib/export/build";

export const dynamic = "force-dynamic";

// GET /export/download?kind=production|ledger|sales|costs&month=YYYY-MM&format=xlsx|csv
// Read-only. The file is sent as an attachment so iPhone Safari offers
// Download / the share sheet.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") as DatasetKind;
  const month = q.get("month") ?? "";
  const format = q.get("format") === "csv" ? "csv" : "xlsx";
  if (!(kind in DATASETS)) return new Response("Unknown sheet", { status: 400 });
  if (!validMonth(month)) return new Response("Choose a month like 2026-09", { status: 400 });
  const ds = await DATASETS[kind](month);
  const stem = `yash-farm-${kind}-${month}`;
  if (format === "csv") {
    return new Response(buildCsv(ds), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${stem}.csv"`, "Cache-Control": "no-store" },
    });
  }
  const buf = await buildXlsx(ds);
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${stem}.xlsx"`, "Cache-Control": "no-store" },
  });
}
