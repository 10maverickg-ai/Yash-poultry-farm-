import Link from "next/link";
import { BACKUP_TABLES } from "@/lib/export/backup";

export const dynamic = "force-dynamic";

export default function BackupPage() {
  return (
    <>
      <h1>Backup</h1>
      <div className="flag-banner" style={{ fontSize: "1rem" }}>
        <b>Do this on the 1st of every month</b> and keep the file in Google Drive.
      </div>
      <div className="card stack">
        <p style={{ margin: 0 }}>
          One zip with every table of the farm database as a CSV file (production, egg ledger, feed, chick deaths, bird movements, sales, rates,
          flocks, moulting, chick batches, purchases and costs, vaccinations, the knowledge library, alert verdicts). The file name carries the date and time.
          Deleted rows are included and marked. Nothing here changes any data.
        </p>
        <div className="actions-bar" style={{ marginBottom: 0 }}>
          <a className="btn" href="/export/backup/zip" download>Download the backup (.zip)</a>
        </div>
        <p className="muted an-tiny" style={{ margin: 0 }}>It takes a few seconds. On an iPhone, choose “Download” and then “Save to Files” → Google Drive.</p>
      </div>
      <details className="card">
        <summary>Tables in the backup ({BACKUP_TABLES.length})</summary>
        <p className="muted an-tiny">{BACKUP_TABLES.join(" · ")}</p>
      </details>
      <p><Link href="/export">← Excel downloads</Link></p>
    </>
  );
}
