import { listChickBatches } from "@/lib/chickBatchLog";
import { listSheds } from "@/lib/flocks";
import { ChickBatchLogForm } from "@/components/ChickBatchLogForm";

export const dynamic = "force-dynamic";

export default async function ChickBatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const [batches, sheds] = await Promise.all([listChickBatches(), listSheds()]);

  return (
    <>
      <h1>Chick Batch Log</h1>
      <p className="muted">
        Holding place for chick/grower batches that don&apos;t have a BAB
        number yet. Once a batch is numbered, create it properly in the Flock
        Register — nothing here converts automatically.
      </p>
      {saved && <div className="saved-banner">Batch logged.</div>}

      {batches.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Shed</th>
                <th>Total birds</th>
                <th>Source hatchery</th>
                <th>Notes</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.date}</td>
                  <td>{b.shed_code}</td>
                  <td>{b.total_birds?.toLocaleString("en-IN") ?? "—"}</td>
                  <td>{b.source_hatchery ?? "—"}</td>
                  <td style={{ whiteSpace: "normal" }}>{b.notes ?? ""}</td>
                  <td>
                    {b.flagged ? (
                      <span className="badge badge-flagged" title={b.flag_reason ?? ""}>
                        flagged
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ChickBatchLogForm shedCodes={sheds.map((s) => s.shed_code)} />
    </>
  );
}
