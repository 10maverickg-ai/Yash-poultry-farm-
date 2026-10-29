import { TEMPLATE_CSV } from "@/lib/import/paperHistory";

export const dynamic = "force-static";

export function GET() {
  return new Response(TEMPLATE_CSV, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="paper-history-template.csv"' } });
}
