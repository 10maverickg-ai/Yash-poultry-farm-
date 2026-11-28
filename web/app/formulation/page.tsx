import { listFormulationVersions, listMaterialNames } from "@/lib/feed";
import { FormulationForm } from "@/components/FormulationForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = { title: "Feed formulation" };

export default async function FormulationPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const [versions, materials] = await Promise.all([
    listFormulationVersions(),
    listMaterialNames(),
  ]);

  return (
    <>
      <h1>Feed Formulation</h1>
      <p className="muted">
        Versioned reference — a recipe change is a new version with its own
        effective date, never an edit of the old one. This is what lets the
        dashboard later overlay “what changed in the feed” on the production
        timeline.
      </p>
      <p className="an-sub">The nutritionist&apos;s formulas for each shed (28 Nov 2026), with their prices, are on <Link href="/feed-formulas">Feed formulas →</Link>. This page is the older hand-entered recipe log.</p>
      {saved && <div className="saved-banner">Formulation version saved.</div>}

      {versions.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Effective</th>
                <th>Batch (kg)</th>
                <th>Materials</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((f) => (
                <tr key={`${f.formulation_group}|${f.effective_date}`}>
                  <td>{f.formulation_group}</td>
                  <td>{f.effective_date}</td>
                  <td>{f.batch_total_kg ?? "—"}</td>
                  <td style={{ whiteSpace: "normal" }}>{f.materials}</td>
                  <td style={{ whiteSpace: "normal" }}>{f.reason_for_change ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormulationForm materials={materials} />
    </>
  );
}
