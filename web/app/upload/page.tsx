import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default function UploadPage() {
  return (
    <>
      <h1>Upload a Register Photo</h1>
      <p className="muted">
        Daily Production only, for now — photograph the page, pick the date
        shown on it, and the extracted rows land in the same place manual
        entries do. Anything the model isn&apos;t confident about, or that
        doesn&apos;t add up, gets flagged for review exactly like a manual
        entry would. Egg Stock Ledger and Feed Bag Stock extraction (often on
        the same page) are next.
      </p>
      <UploadForm />
    </>
  );
}
