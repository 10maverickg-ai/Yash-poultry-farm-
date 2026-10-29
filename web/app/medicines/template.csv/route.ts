import { IMPORT_TEMPLATE } from "@/lib/medicines/lines";

export const dynamic = "force-static";

export function GET() {
  return new Response(IMPORT_TEMPLATE, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="medicines-template.csv"' } });
}
