import { NextRequest } from "next/server";
import { buildFarmCtx } from "@/lib/analytics/ctx";
import { loadEngineInput } from "@/lib/analytics/load";
import { loadPeriodExtras } from "@/lib/analytics/periodLoad";
import { loadCostInput } from "@/lib/costs/load";
import { todayIST } from "@/lib/weather/openMeteo";
import { buildShare, readShareChoice } from "@/lib/export/analytics";
import { cannotShare, COMPARE_KEYS } from "@/lib/export/shareOptions";
import { buildBook, buildCsv, buildCsvZip, XLSX_TYPE } from "@/lib/export/build";
import type { Param } from "@/lib/analytics/rangeParams";

export const dynamic = "force-dynamic";

// V18: GET /export/share?view=week&from=2026-11-16&to=2026-11-22[&f=BAB-3][&inc=production,feed]&format=xlsx|csv
//      (view=compare takes the Compare columns instead: a, af, at, b, bf, bt, age, wf, wt)
// Read-only. The same choice as the share page and the screen; the file is sent as an attachment so iPhone Safari
// offers Download / the share sheet. CSV: one file when the choice makes one table, else one CSV per sheet in a .zip.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const sp: Record<string, Param> = { view: q.get("view") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, f: q.getAll("f"), inc: q.get("inc") ?? undefined };
  for (const k of COMPARE_KEYS) sp[k] = q.get(k) ?? undefined;
  const format = q.get("format") === "csv" ? "csv" : "xlsx";
  const [input, cost, extras] = await Promise.all([loadEngineInput(), loadCostInput(), loadPeriodExtras()]);
  const { ctx } = buildFarmCtx(input);
  const choice = readShareChoice(ctx, sp, todayIST());
  const why = cannotShare(choice.inc, { farmLevel: choice.flockIds.length === 0, compare: choice.view === "compare" });
  if (why) return new Response(why, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const file = buildShare(ctx, cost, extras, choice, new Date());
  const head = (type: string, name: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" });
  if (format === "csv") {
    if (file.sheets.length === 1) return new Response(buildCsv(file.sheets[0], file.meta), { headers: head("text/csv; charset=utf-8", `${file.stem}.csv`) });
    return new Response(new Uint8Array(await buildCsvZip(file.sheets, file.meta, file.stem)), { headers: head("application/zip", `${file.stem}.zip`) });
  }
  return new Response(new Uint8Array(await buildBook(file.sheets, file.meta)), { headers: head(XLSX_TYPE, `${file.stem}.xlsx`) });
}
