import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default function SingleUploadPage() {
  return (
    <>
      <h1>Upload one photo</h1>
      <p className="muted">The original one-photo form (same reader, same date rule). For many photos use the queue on the Upload page.</p>
      <UploadForm />
    </>
  );
}
