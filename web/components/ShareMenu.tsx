// V18 A1: one "Share / Download" button on every Analytics view. It opens a small menu: Excel (.xlsx), CSV and Share,
// for exactly what the screen shows (everything ticked), and "Choose what to share" for the dates, flocks and blocks.
// Server-safe: the menu is a plain <details>; only the Share action runs in the browser.
import { ShareAction } from "./ShareAction";

export function ShareMenu({ query, what }: { query: string; what: string }) {
  const file = (format: string) => `/export/share?${query}&format=${format}`;
  return (
    <details className="sh-menu">
      <summary className="btn btn-secondary">Share / Download</summary>
      <div className="sh-pop card">
        <p className="an-tiny" style={{ margin: 0 }}>{what}</p>
        <div className="pv-dl">
          <a className="btn btn-secondary" href={file("xlsx")} download>Excel (.xlsx)</a>
          <a className="btn btn-secondary" href={file("csv")} download>CSV</a>
          <ShareAction href={file("xlsx")} />
        </div>
        <a className="sh-choose" href={`/analytics/share?${query}`}>Choose what to share →</a>
        <p className="muted an-tiny" style={{ margin: 0 }}>Read-only: the file has the numbers on this screen. Sales and costs are in it only for all flocks.</p>
      </div>
    </details>
  );
}
