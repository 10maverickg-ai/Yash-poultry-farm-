import { buildBackupZip } from "@/lib/export/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /export/backup/zip — one zip of every operational table as CSV.
export async function GET() {
  const { data, filename } = await buildBackupZip();
  return new Response(data as BodyInit, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
