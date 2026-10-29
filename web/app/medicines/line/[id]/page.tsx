import Link from "next/link";
import { notFound } from "next/navigation";
import { getLine, listSuggestions, listTargets } from "@/lib/medicines/store";
import { MedicineLineForm } from "@/components/MedicineLineForm";
import { defaultsFromLine } from "@/lib/medicines/lines";
import { saveLineEdit, removeLine } from "../../actions";
import { MedicineDelete } from "@/components/MedicineDelete";
import { dmy } from "@/lib/format";

export const metadata = { title: "Change a medicine line" };
export const dynamic = "force-dynamic";

export default async function LinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n)) notFound();
  const [line, targets, suggestions] = await Promise.all([getLine(n), listTargets(), listSuggestions()]);
  if (!line) notFound();
  return (
    <>
      <h1>Change a line</h1>
      <p className="muted"><Link href={`/medicines?month=${line.date.slice(0, 7)}#month`}>← Back to the month</Link> · {line.item} on {dmy(line.date)}{line.sourceTag !== "hand entry" ? ` · ${line.sourceTag}` : ""}</p>
      <MedicineLineForm action={saveLineEdit.bind(null, line.id)} targets={targets} suggestions={suggestions} defaults={defaultsFromLine(line)} mode="edit" backHref={`/medicines?month=${line.date.slice(0, 7)}#month`} />
      {line.photoUrl && <p className="card">Register page photo: <a href={line.photoUrl} target="_blank" rel="noreferrer">open the photo</a>. Choose a file above to replace it.</p>}
      <MedicineDelete action={removeLine.bind(null, line.id)} month={line.date.slice(0, 7)} />
    </>
  );
}
