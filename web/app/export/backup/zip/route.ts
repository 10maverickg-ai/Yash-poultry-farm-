import { buildBackupZip } from "@/lib/export/backup";
import { guardRoute } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /export/backup/zip — one zip of every operational table as CSV.
export async function GET() {
  const denied = await guardRoute("owner");
  if (denied) return denied;
  const { data, filename } = await buildBackupZip();
  return new Response(data as BodyInit, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
