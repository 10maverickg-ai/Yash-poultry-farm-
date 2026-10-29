"use server";

import { revalidatePath } from "next/cache";
import { uploadRegisterPhoto, photoProblem } from "@/lib/storage";
import { pickReader } from "@/lib/reader/pick";
import { claimNext, enqueue, finish, parkAsDuplicate, savedDaySummary, setStatus } from "@/lib/uploadQueue/store";

const iso = /^\d{4}-\d{2}-\d{2}$/;

export interface EnqueueResult {
  ok: boolean;
  error: string | null;
  status: string | null;
}

// Stores ONE photo and puts it in the queue. The browser sends photos one by
// one, so a failure on one never loses the others, and everything already
// stored stays in the queue even if the browser is closed.
export async function enqueuePhoto(formData: FormData): Promise<EnqueueResult> {
  try {
    const file = formData.get("photo");
    const date = formData.get("date");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No photo received.", status: null };
    if (typeof date !== "string" || !iso.test(date)) return { ok: false, error: "Choose the date shown on the page.", status: null };
    const problem = photoProblem(file);
    if (problem) return { ok: false, error: problem, status: null };
    const url = await uploadRegisterPhoto(file, "production", date);
    const r = await enqueue(url, file.name || null, date);
    revalidatePath("/upload");
    return { ok: true, error: null, status: r.status };
  } catch (err) {
    console.error("[queue] enqueue failed", err);
    return { ok: false, error: "That photo could not be stored. Try it again; the other photos are not affected.", status: null };
  }
}

export interface ProcessResult {
  done: boolean; // nothing left waiting
  id: number | null;
  status: string | null;
}

// Reads the next waiting photo with the current reader. Never throws and never
// touches any other photo: whatever happens is written to THIS photo's row.
export async function processNext(): Promise<ProcessResult> {
  let claimed: Awaited<ReturnType<typeof claimNext>> = null;
  try {
    claimed = await claimNext();
    if (!claimed) return { done: true, id: null, status: null };
    // A day that already has saved rows must never be overwritten silently.
    const target = claimed.forceDate ?? claimed.enteredDate;
    if (!claimed.replaceOk) {
      const saved = await savedDaySummary(target);
      if (saved) {
        await parkAsDuplicate(claimed.id, `${target} already has ${saved.rows} saved flock rows (${saved.eggs.toLocaleString("en-IN")} eggs).`);
        revalidatePath("/upload");
        return { done: false, id: claimed.id, status: "duplicate" };
      }
    }
    const res = await pickReader().read({ photoUrl: claimed.photoUrl, dateHint: claimed.enteredDate, forceDate: claimed.forceDate });
    await finish(claimed.id, res);
    revalidatePath("/upload");
    revalidatePath("/flagged");
    return { done: false, id: claimed.id, status: res.status };
  } catch (err) {
    console.error("[queue] processNext failed", err);
    if (claimed) {
      await finish(claimed.id, {
        status: "failed",
        message: "Something went wrong reading this photo. Retry it; the other photos are not affected.",
        technical: err instanceof Error ? err.message : String(err),
        dateMismatch: null,
        summary: null,
      }).catch(() => undefined);
      return { done: false, id: claimed.id, status: "failed" };
    }
    return { done: true, id: null, status: null };
  }
}

// ---- the owner's decisions ---------------------------------------------------
const refresh = () => revalidatePath("/upload");

export async function keepSavedDay(id: number) {
  await setStatus(id, { status: "dismissed", message: "Kept the saved day; this photo was not used." });
  refresh();
}
export async function replaceSavedDay(id: number) {
  await setStatus(id, { status: "waiting", replaceOk: true, message: "Will replace the saved day." });
  refresh();
}
export async function retryPhoto(id: number) {
  await setStatus(id, { status: "waiting", message: null });
  refresh();
}
export async function chooseDate(id: number, date: string) {
  if (!iso.test(date)) return;
  await setStatus(id, { status: "waiting", forceDate: date, message: `Reading with the date ${date}.` });
  refresh();
}
export async function dismissPhoto(id: number) {
  await setStatus(id, { status: "dismissed", message: null });
  refresh();
}
