import Link from "next/link";
import { notFound } from "next/navigation";
import { getLine, groupLines, listSuggestions, listTargets } from "@/lib/medicines/store";
import { listCatalogue } from "@/lib/medicines/catalogueStore";
import { MedicineEntryDelete } from "@/components/MedicineEntryDelete";
import { MedicineLineForm } from "@/components/MedicineLineForm";
import { defaultsFromLine } from "@/lib/medicines/lines";
import { saveLineEdit, removeLine, removeEntry } from "../../actions";
import { MedicineDelete } from "@/components/MedicineDelete";
import { dmy, inr } from "@/lib/format";

export const metadata = { title: "Change a medicine line" };
export const dynamic = "force-dynamic";

export default async function LinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n)) notFound();
  const [line, targets, suggestions, catalogue] = await Promise.all([getLine(n), listTargets(), listSuggestions(), listCatalogue()]);
  if (!line) notFound();
  const together = line.entryGroup ? await groupLines(line.entryGroup) : [];
  const options = catalogue.filter((i) => i.kind !== "management" && (i.active || i.id === line.catalogueId)).map((i) => ({ id: i.id, name: i.name, kind: i.kind }));
  return (
    <>
      <h1>Change a line</h1>
      <p className="muted"><Link href={`/medicines?month=${line.date.slice(0, 7)}#month`}>← Back to the month</Link> · {line.item} on {dmy(line.date)}{line.sourceTag !== "hand entry" ? ` · ${line.sourceTag}` : ""}</p>
      {together.length > 1 && (
        <div className="flag-banner">
          This line is one of {together.length} saved together for {together.map((l) => l.targetLabel).join(", ")}
          {line.costTotal != null ? `; the cost ${inr(line.costTotal)} was split ${line.splitBasis === "birds" ? "by the number of birds" : "equally"}` : ""}. Changing it changes only this line: the others stay as they are.
        </div>
      )}
      <MedicineLineForm action={saveLineEdit.bind(null, line.id)} targets={targets} suppliers={suggestions.suppliers} options={options} defaults={defaultsFromLine(line)} backHref={`/medicines?month=${line.date.slice(0, 7)}#month`} />
      {line.photoUrl && <p className="card">Register page photo: <a href={line.photoUrl} target="_blank" rel="noreferrer">open the photo</a>. Choose a file above to replace it.</p>}
      <MedicineDelete action={removeLine.bind(null, line.id)} month={line.date.slice(0, 7)} />
      {line.entryGroup && together.length > 1 && <MedicineEntryDelete action={removeEntry.bind(null, line.entryGroup)} month={line.date.slice(0, 7)} count={together.length} />}
    </>
  );
}
