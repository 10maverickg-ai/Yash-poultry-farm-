// Client-only. Runs in the browser before any photo leaves the device, so
// no upload ever depends on the original file size — a 20MB camera photo
// and a 2MB one both end up comfortably under any server limit.
export interface CompressOptions {
  maxDimension?: number;
  quality?: number;
}

// Owner report, 2026-10-13: the Anthropic API this app sends photos to only
// accepts these four media types — anything else (most importantly HEIC/HEIF,
// which iOS has sent as the ORIGINAL file from a Photo Library pick, not an
// auto-converted JPEG, since iOS 13) fails the extraction call outright, with
// no way for the model to ever read the photo. A file whose declared type
// isn't one of these must always end up converted to JPEG below — there is
// no such thing as "uploading the original anyway" for it.
const ANTHROPIC_SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function looksLikeHeic(file: File): boolean {
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

function unsupportedFormatError(file: File): UnsupportedPhotoFormatError {
  if (looksLikeHeic(file)) {
    return new UnsupportedPhotoFormatError(
      "This looks like a HEIC photo, and this browser couldn't convert it to a format the app can read. " +
        'On an iPhone/iPad: Settings → Camera → Formats → "Most Compatible" makes new photos save as JPEG. ' +
        "Or choose a different photo, or take a new one with this app's camera option."
    );
  }
  return new UnsupportedPhotoFormatError(
    "This photo's format isn't supported and this browser couldn't convert it — please choose a JPEG, PNG, GIF, or WebP photo instead."
  );
}

// Thrown only when the ORIGINAL file is in a format the extraction API can
// never accept (see ANTHROPIC_SUPPORTED_TYPES) AND the browser couldn't
// convert it to JPEG either — the one case where silently falling back to
// "upload the original anyway" (every other failure's behavior, unchanged
// below) would just defer this same failure to a confusing, unrelated-
// looking "something went wrong reading this photo" error after a full
// extraction round-trip. The caller (UploadForm.tsx) shows `message`
// directly and keeps the broken file out of the form.
export class UnsupportedPhotoFormatError extends Error {}

export async function compressImageForUpload(
  file: File,
  // Digit-accuracy pass (owner report, 2026-09-28): 1600px/0.82 was
  // shrinking small handwritten digits into a handful of pixels each on a
  // typical two-page-spread register photo, making 3-vs-8 and 1-vs-7
  // confusion more likely before the model ever sees the page. Long edge
  // 2000px + quality 0.9 keeps digits meaningfully sharper while staying
  // well under MAX_UPLOAD_BYTES (UploadForm.tsx) for a typical photo — and
  // under the 2500px legibility floor the owner asked about, 2026-10-13.
  { maxDimension = 2000, quality = 0.9 }: CompressOptions = {}
): Promise<File> {
  const needsFormatConversion = !ANTHROPIC_SUPPORTED_TYPES.has(file.type);
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (needsFormatConversion) throw unsupportedFormatError(file);
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) {
      if (needsFormatConversion) throw unsupportedFormatError(file);
      return file;
    }
    // A format the API can't accept as-is must always use the converted
    // JPEG, even if it happens to come out larger than the original — HEIC
    // commonly compresses smaller than an equivalent-quality JPEG, so the
    // ordinary "keep whichever is smaller" rule below would otherwise throw
    // away the one usable copy and keep the original HEIC. For a format
    // already safe to upload as-is, the original behavior is unchanged:
    // keep whichever is smaller.
    if (!needsFormatConversion && blob.size >= file.size) return file;

    const newName = file.name.replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch (err) {
    if (err instanceof UnsupportedPhotoFormatError) throw err;
    // Any other decode failure (unsupported format, corrupt file, etc.) on
    // a format already safe to upload as-is — fall back to the original
    // rather than blocking the upload, exactly as before. The server-side
    // body size limit and the pre-submit size check in UploadForm.tsx are
    // what catch this case if the original turns out to be too large.
    if (needsFormatConversion) throw unsupportedFormatError(file);
    return file;
  }
}
