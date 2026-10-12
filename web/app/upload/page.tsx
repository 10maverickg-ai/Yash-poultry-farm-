import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default function UploadPage() {
  return (
    <>
      <h1>Upload a Register Photo</h1>
      <p className="muted">
        Photograph the page and pick the date shown on it. Daily Production
        rows land in the same place manual entries do — anything the model
        isn&apos;t confident about, or that doesn&apos;t add up, gets flagged
        for review exactly like a manual entry would. The Egg Stock Ledger
        and Feed Bag Stock boxes (often on the same page) are read too, right
        after Daily Production saves; if that part can&apos;t be read, it&apos;s
        reported separately and never blocks the Daily Production save.
      </p>
      <UploadForm />
    </>
  );
}
