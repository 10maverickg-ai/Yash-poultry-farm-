// Client-only. Runs in the browser before any photo leaves the device, so
// no upload ever depends on the original file size — a 20MB camera photo
// and a 2MB one both end up comfortably under any server limit.
export interface CompressOptions {
  maxDimension?: number;
  quality?: number;
}

export async function compressImageForUpload(
  file: File,
  // Digit-accuracy pass (owner report, 2026-09-28): 1600px/0.82 was
  // shrinking small handwritten digits into a handful of pixels each on a
  // typical two-page-spread register photo, making 3-vs-8 and 1-vs-7
  // confusion more likely before the model ever sees the page. Long edge
  // 2000px + quality 0.9 keeps digits meaningfully sharper while staying
  // well under MAX_UPLOAD_BYTES (UploadForm.tsx) for a typical photo.
  { maxDimension = 2000, quality = 0.9 }: CompressOptions = {}
): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob || blob.size >= file.size) return file; // compression didn't help — keep original

    const newName = file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    // Any decode failure (unsupported format, corrupt file, etc.) — fall
    // back to the original rather than blocking the upload. The server-side
    // body size limit and the pre-submit size check below are what catch
    // this case if the original turns out to be too large.
    return file;
  }
}
