import type { RegisterReader, ReaderRequest, ReaderResponse } from "./index";
import { uploadAndExtractDailyProduction, type UploadOutcome } from "@/app/upload/actions";

// The existing reader, unchanged: it is driven through the same server
// function the single-photo form uses (so the pipeline, its checks and its
// flags are exactly what they were). The photo is fetched back from storage
// and handed over together with its stored URL, so it is not stored twice.
async function fetchPhoto(url: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch the stored photo (${res.status})`);
  const type = res.headers.get("content-type") || "image/jpeg";
  const blob = await res.blob();
  return new File([blob], url.split("/").pop() || "register.jpg", { type });
}

function toResponse(o: UploadOutcome): ReaderResponse {
  if (o.dateMismatch) {
    return { status: "needs_review", message: o.error, technical: null, dateMismatch: o.dateMismatch, summary: null };
  }
  if (o.error) {
    return { status: "failed", message: o.error, technical: o.technicalDetail, dateMismatch: null, summary: null };
  }
  const flagged = o.written.some((w) => w.flagged) || o.unresolved.length > 0 || !!o.pageIssue || !!o.ledgerFeedIssue ||
    (o.ledgerFeed ? o.ledgerFeed.eggFlags.length + o.ledgerFeed.feedFlags.length > 0 : false);
  return {
    status: flagged ? "needs_review" : "saved",
    message: null,
    technical: null,
    dateMismatch: null,
    summary: {
      date: o.date,
      flocks: o.written.map((w) => ({ label: w.label, flagged: w.flagged, reason: w.flagReason })),
      unresolved: o.unresolved,
      pageIssue: o.pageIssue,
      ledgerIssue: o.ledgerFeedIssue,
      ledgerFlags: o.ledgerFeed ? [...o.ledgerFeed.eggFlags.map((f) => `${f.section} ledger: ${f.flagReason}`), ...o.ledgerFeed.feedFlags.map((f) => `${f.flockGroup} feed box: ${f.flagReason}`)] : [],
      autoCorrections: o.autoCorrections.length,
    },
  };
}

export const oldReader: RegisterReader = {
  name: "old",
  async read(req: ReaderRequest): Promise<ReaderResponse> {
    try {
      const file = await fetchPhoto(req.photoUrl);
      const fd = new FormData();
      fd.set("photo", file);
      fd.set("date", req.dateHint);
      fd.set("existing_photo_url", req.photoUrl);
      if (req.forceDate) fd.set("force_date", req.forceDate);
      return toResponse(await uploadAndExtractDailyProduction(null, fd));
    } catch (err) {
      console.error("[reader:old] unexpected failure", err);
      return {
        status: "failed",
        message: "Something went wrong reading this photo. You can retry it; the other photos are not affected.",
        technical: err instanceof Error ? err.message : String(err),
        dateMismatch: null,
        summary: null,
      };
    }
  },
};
