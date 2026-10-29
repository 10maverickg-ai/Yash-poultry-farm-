import { guardRoute } from "@/lib/auth/guard";
import { handleUpload } from "@/lib/staffUpload";
import { photoProblem, uploadRegisterPhoto } from "@/lib/storage";
import { enqueue } from "@/lib/uploadQueue/store";
import { todayIST } from "@/lib/weather/openMeteo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/upload: one photo (+ the date written on the page) into the upload queue. This is the only thing a staff phone may do besides
// opening the Upload page. It stores the photo and queues it; reading it (which costs credit) happens later, from the owner's Upload page.
export async function POST(req: Request) {
  const denied = await guardRoute("user");
  if (denied) return denied;
  const form = await req.formData().catch(() => null);
  const a = await handleUpload(form, {
    photoProblem,
    store: (file, date) => uploadRegisterPhoto(file, "production", date),
    enqueue,
    today: () => todayIST(),
  });
  return Response.json(a.body, { status: a.status, headers: { "Cache-Control": "no-store" } });
}
