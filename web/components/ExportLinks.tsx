import Link from "next/link";

// "Download this month" buttons for one sheet; plain links (an attachment
// download), so they work in iPhone Safari and Android Chrome without scripts.
export function ExportLinks({ kind, month, label }: { kind: "production" | "ledger" | "sales" | "costs"; month: string; label: string }) {
  return (
    <div className="actions-bar export-links" style={{ marginBottom: 0 }}>
      <span className="muted an-tiny" style={{ alignSelf: "center" }}>{label} {month}:</span>
      <a className="btn btn-secondary" href={`/export/download?kind=${kind}&month=${month}&format=xlsx`} download>Excel</a>
      <a className="btn btn-secondary" href={`/export/download?kind=${kind}&month=${month}&format=csv`} download>CSV</a>
      <Link className="btn btn-secondary" href={`/export?month=${month}`}>More…</Link>
    </div>
  );
}
