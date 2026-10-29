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
        <p style={{ marginTop: 0 }}>For many lines at once, for example four months of register pages typed into Excel. Nothing is read by the photo reader.</p>
        <h2>What columns to give</h2>
        <ul className="an-list">
          <li><b>date</b> — 2026-07-04 or 04/07/2026</li>
          <li><b>type</b> — medicine or vaccine</li>
          <li><b>name</b> — for example Enrofloxacin</li>
          <li><b>for</b> — a flock name such as BAB-3, a shed name, or <i>farm</i> (empty also means the whole farm)</li>
          <li><b>quantity</b> and <b>unit</b> — 2 and bottles (optional; a quantity needs a unit)</li>
          <li><b>cost</b> — rupees (optional; empty means “cost not entered”, not ₹0)</li>
          <li><b>supplier</b>, <b>note</b> — optional</li>
        </ul>
        <p><a href="/medicines/template.csv">Download the template (CSV)</a>. In Excel use <b>File → Save As → CSV</b>, or upload the <b>.xlsx</b> file (first sheet).</p>
        <p>Press <b>Check only</b> first: it lists every problem and saves nothing. A line that is already in the register (same date, type, name, flock, quantity and unit) is never added twice. Imported lines are tagged <i>register import</i>.</p>
      </section>
      <MedicineImportForm />
    </>
  );
}
