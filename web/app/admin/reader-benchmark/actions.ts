"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { uploadBenchmarkPhoto } from "@/lib/storage";

export interface UploadBenchmarkPhotoOutcome {
  error: string | null;
  success: boolean;
}

// Owner request, 2026-10-19: lets the owner attach a photo to a date that
// already has verified daily_production rows (most of August, entered by
// hand from the paper register with no photo ever uploaded through the
// app) so the benchmark page has something to run the new reader against.
// Writes ONLY to reader_benchmark_photos — never daily_production or any
// other production table, and the upload path below (uploadBenchmarkPhoto)
// stores the file under its own "benchmark/" prefix precisely so it's
// never confusable with a real register upload.
export async function uploadBenchmarkPhotoAction(
  _prev: UploadBenchmarkPhotoOutcome | null,
  formData: FormData
): Promise<UploadBenchmarkPhotoOutcome> {
  const key = formData.get("key");
  const configured = process.env.READER_BENCHMARK_KEY;
  if (!configured || typeof key !== "string" || key !== configured) {
    return { error: "Not authorized.", success: false };
  }

  const date = formData.get("date");
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Pick a valid date first.", success: false };
  }

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo first.", success: false };
  }

  let photoUrl: string;
  try {
    photoUrl = await uploadBenchmarkPhoto(file, date);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { error: `Photo couldn't be uploaded: ${detail}`, success: false };
  }

  try {
    await pool.query(
      `INSERT INTO reader_benchmark_photos (farm_code, date, photo_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (farm_code, date) DO UPDATE SET
           photo_url = EXCLUDED.photo_url,
           uploaded_at = now()`,
      [ACTIVE_FARM, date, photoUrl]
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { error: `Photo uploaded, but saving its record failed: ${detail}`, success: false };
  }

  revalidatePath("/admin/reader-benchmark");
  return { error: null, success: true };
}
