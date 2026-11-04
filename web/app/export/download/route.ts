import { NextRequest } from "next/server";
import { guardRoute } from "@/lib/auth/guard";
import { DATASETS, validMonth, type DatasetKind } from "@/lib/export/data";
import { periodDataset, validPeriod } from "@/lib/export/period";
import { buildCsv, buildXlsx, XLSX_TYPE } from "@/lib/export/build";

export const dynamic = "force-dynamic";

// GET /export/download?kind=production|ledger|sales|costs&month=YYYY-MM&format=xlsx|csv
// Read-only. The file is sent as an attachment so iPhone Safari offers
// Download / the share sheet.
export async function GET(req: NextRequest) {
  const denied = await guardRoute("owner");
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") as DatasetKind | "week" | "month" | "year";
  const month = q.get("month") ?? "";
  const format = q.get("format") === "csv" ? "csv" : "xlsx";
  if (kind === "week" || kind === "month" || kind === "year") {
    const p = q.get("p") ?? "";
    if (!validPeriod(kind, p)) return new Response("Choose a period like 2026-09-07, 2026-09 or 2026", { status: 400 });
    const sg = q.get("segment") ?? "all";
    if (sg !== "all" && sg !== "main" && sg !== "young") return new Response("segment must be main, young or all", { status: 400 });
    const pds = await periodDataset(kind, p, sg);
    const pstem = `yash-farm-${kind}-summary-${p}-${sg === "all" ? "whole-farm" : sg}`;
    if (format === "csv") {
      return new Response(buildCsv(pds), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${pstem}.csv"`, "Cache-Control": "no-store" } });
    }
    return new Response(new Uint8Array(await buildXlsx(pds)), { headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${pstem}.xlsx"`, "Cache-Control": "no-store" } });
  }
  if (!(kind in DATASETS)) return new Response("Unknown sheet", { status: 400 });
  if (!validMonth(month)) return new Response("Choose a month like 2026-09", { status: 400 });
  const ds = await DATASETS[kind as DatasetKind](month);
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
