import Link from "next/link";
import { MedicineImportForm } from "./MedicineImportForm";

export const metadata = { title: "Import medicine lines" };
export const dynamic = "force-dynamic";

export default function MedicineImportPage() {
  return (
    <>
      <h1>Import medicine and vaccine lines</h1>
      <p className="muted"><Link href="/medicines">← Medicines &amp; vaccines</Link></p>
      <section className="card">
        <p style={{ marginTop: 0 }}>For many lines at once, for example four months of register pages typed into Excel. Nothing is read by the photo reader. The names come from the <Link href="/medicines/list">Medicines list</Link>.</p>
        <h2>What columns to give</h2>
        <ul className="an-list">
          <li><b>date</b>: 2026-07-04 or 04/07/2026</li>
          <li><b>name</b>: a name from the Medicines list (another spelling of it also works, for example Coryza for Croyza)</li>
          <li><b>flock</b>: one or more flocks separated by a semicolon (<i>BAB-1; BAB-2</i>), <i>main</i>, <i>young</i>, or <i>all</i> (empty also means the whole farm)</li>
          <li><b>quantity</b> and <b>unit</b>: the total, for example 3 and bottles (optional; a quantity needs a unit)</li>
          <li><b>cost</b>: the total in rupees (optional; empty means “cost not entered”, not ₹0)</li>
          <li><b>supplier</b>, <b>note</b>: optional</li>
        </ul>
        <p>One line is saved for each flock. A total quantity or cost for several flocks is <b>split by the number of birds in each flock on that date</b>.</p>
        <p><a href="/medicines/template.csv">Download the template (CSV)</a>. In Excel use <b>File → Save As → CSV</b>, or upload the <b>.xlsx</b> file (first sheet).</p>
        <p>Press <b>Check only</b> first: it lists every problem and saves nothing. A name the list does not know is <b>never added silently</b>: you choose what it means. A line that is already in the register (same date, item and flock) is never added twice. Imported lines are tagged <i>register import</i>.</p>
      </section>
      <MedicineImportForm />
    </>
  );
}
