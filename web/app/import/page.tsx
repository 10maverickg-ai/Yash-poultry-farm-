import Link from "next/link";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Import old registers" };

export default function ImportPage() {
  return (
    <>
      <h1>Import old paper-register days</h1>
      <p className="muted"><Link href="/analytics/targets">← How our realistic target is learned</Link></p>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Why</h2>
        <p>The app learns what is realistic for this farm from its own records. It has only July–October 2026 so far. Every extra month of older registers makes more age bands learnable, and one extra year is very valuable. Nothing is read by the photo reader: you type or export the numbers, and this screen checks them.</p>
        <h2>What columns to give</h2>
        <ul className="an-list">
          <li><b>date</b> — 2025-03-14 or 14/03/2025</li>
          <li><b>flock label</b> — exactly as in the app (BAB-1, BAB-2 …). Older flocks must first exist on the Flocks screen.</li>
          <li><b>eggs</b> — total eggs that day (big-egg flocks: a multiple of 30)</li>
          <li><b>birds</b> — birds in the flock that day (needed for eggs per 100 birds)</li>
          <li><b>mortality</b> — deaths that day (best to give it as well as birds)</li>
          <li><b>feed bags</b> — bags used that day (leave empty if not written)</li>
        </ul>
        <p><a href="/import/template.csv">Download a template (CSV)</a></p>
        <h2>How to export from Excel</h2>
        <p>Put one row per flock per day, with the headings above in the first row. In Excel: <b>File → Save As → CSV (Comma delimited)</b>, or just upload the <b>.xlsx</b> file. Only the first sheet is read.</p>
        <h2>What happens</h2>
        <p>First press <b>Check only</b>: it lists every problem (wrong date, a date in the future, unknown flock, big eggs not in trays of 30, eggs more than birds, duplicates) and saves nothing. Days that already exist are never overwritten unless you tick the box. Imported days are stored like hand-entered days, tagged <i>paper history import</i>.</p>
      </section>
      <ImportForm />
    </>
  );
}
