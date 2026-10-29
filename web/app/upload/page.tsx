import Link from "next/link";
import { QueueUploader } from "@/components/QueueUploader";
import { QueueList } from "@/components/QueueList";
import { listQueue } from "@/lib/uploadQueue/store";
import { StaffUpload } from "@/components/StaffUpload";
import { currentSession } from "@/lib/auth/guard";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
// Reading one register photo takes a while (several vision calls); give each
// queue step room. Photos are read one per request.
export const maxDuration = 300;

export const metadata = { title: "Upload register photos" };

export default async function UploadPage() {
  const session = await currentSession();
  if (!session) redirect("/login?e=expired");
  // A staff phone gets a bare photo picker: no queue, no saved days, no flock names, nothing read from the registers.
  if (session.role === "staff") {
    return (
      <>
        <h1>Upload register photos</h1>
        <p className="muted">Take a clear photo of each register page, with the whole page in view. Choose the date written on the page.</p>
        <StaffUpload />
      </>
    );
  }
  const items = await listQueue();
  const count = (s: string) => items.filter((i) => i.status === s).length;
  return (
    <>
      <h1>Upload register photos</h1>
      <p className="muted">
        Pick one or many photos and the date shown on each page. They are stored, then read one by one in date order. Anything that does
        not add up is flagged for you, never saved as a guess; a date that is already saved is never overwritten without asking; and if the
        date on the page is not the date you entered, I stop and ask.
      </p>
      <p className="card" style={{ margin: "0 0 0.75rem" }}>
        Photo reading not available, or one page will not read? <Link href="/day/enter"><b>Enter a day by hand →</b></Link> It checks everything the reader checks and saves to the same tables.
      </p>
      <QueueUploader waiting={count("waiting")} reading={count("reading")} />
      <div className="queue-summary">
        {(["waiting", "reading", "saved", "needs_review", "failed", "duplicate"] as const).map((s) => (
          <span key={s} className="badge badge-depleted">{count(s)} {s.replace("_", " ")}</span>
        ))}
      </div>
      <QueueList items={items} />
      <p className="muted an-tiny"><Link href="/upload/single">Upload a single photo the old way</Link> · <Link href="/flagged">Review flags</Link></p>
    </>
  );
}
