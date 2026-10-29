import { IMPORT_TEMPLATE } from "@/lib/medicines/lines";
import { guardRoute } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guardRoute("owner");
  if (denied) return denied;
  return new Response(IMPORT_TEMPLATE, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="medicines-template.csv"' } });
}
