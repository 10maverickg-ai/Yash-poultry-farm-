import { TEMPLATE_CSV } from "@/lib/import/paperHistory";
import { guardRoute } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guardRoute("owner");
  if (denied) return denied;
  return new Response(TEMPLATE_CSV, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="paper-history-template.csv"' } });
}
