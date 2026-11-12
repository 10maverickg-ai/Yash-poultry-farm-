import { NextRequest } from "next/server";
import { DATASETS, validMonth, type DatasetKind } from "@/lib/export/data";
import { compareDataset, periodDataset, rangeDataset, validPeriod } from "@/lib/export/period";
import { todayIST } from "@/lib/weather/openMeteo";
import type { Dataset } from "@/lib/export/types";
import { buildCsv, buildXlsx, XLSX_TYPE } from "@/lib/export/build";

export const dynamic = "force-dynamic";

// GET /export/download?kind=production|ledger|sales|costs&month=YYYY-MM&format=xlsx|csv
//     /export/download?kind=range&from=2026-09-01&to=2026-09-15[&f=BAB-3][&segment=main]&format=…   (V15 Custom range)
//     /export/download?kind=compare&a=BAB-3&af=…&at=…&b=BAB-5&bf=…&bt=…&age=0&format=…            (V15 Compare)
// Read-only. The file is sent as an attachment so iPhone Safari offers
// Download / the share sheet.
async function send(ds: Dataset, stem: string, format: "csv" | "xlsx") {
  if (format === "csv") return new Response(buildCsv(ds), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${stem}.csv"`, "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(await buildXlsx(ds)), { headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${stem}.xlsx"`, "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") as DatasetKind | "week" | "month" | "year" | "range" | "compare";
  const month = q.get("month") ?? "";
  const format = q.get("format") === "csv" ? "csv" : "xlsx";
  if (kind === "range") {
    const sg = q.get("segment") ?? "all";
    if (sg !== "all" && sg !== "main" && sg !== "young") return new Response("segment must be main, young or all", { status: 400 });
    const { ds, stem } = await rangeDataset({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, f: q.getAll("f") }, sg, todayIST());
    return send(ds, stem, format);
  }
  if (kind === "compare") {
    const sp: Record<string, string | undefined> = {};
    for (const k of ["a", "af", "at", "b", "bf", "bt", "age", "wf", "wt"]) sp[k] = q.get(k) ?? undefined;
    const { ds, stem } = await compareDataset(sp, todayIST());
    return send(ds, stem, format);
  }
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
