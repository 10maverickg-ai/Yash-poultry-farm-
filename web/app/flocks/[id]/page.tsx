import { notFound } from "next/navigation";
import { getFlock, getLabelHistory, listSheds } from "@/lib/flocks";
import { FlockEditForm } from "@/components/FlockEditForm";
import { StageTransitionForm } from "@/components/StageTransitionForm";
import { DepleteFlockForm } from "@/components/DepleteFlockForm";

export const dynamic = "force-dynamic";

export default async function FlockDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const flock = await getFlock(id);
  if (!flock) notFound();
  const [history, sheds] = await Promise.all([getLabelHistory(id), listSheds()]);

  return (
    <>
      <h1>
        Flock {flock.display_label}{" "}
        <span className={`badge badge-${flock.status}`}>{flock.status}</span>
      </h1>

      <FlockEditForm
        flockId={id}
        shedCodes={sheds.map((s) => s.shed_code)}
        flock={{
          display_label: flock.display_label,
          breed: flock.breed,
          placement_date: flock.placement_date,
          source_hatchery: flock.source_hatchery,
          hatchery_bill_photo_url: flock.hatchery_bill_photo_url,
          initial_chick_count: flock.initial_chick_count,
          current_bird_count: flock.current_bird_count,
          current_shed: flock.current_shed,
          notes: flock.notes,
        }}
      />

      {flock.status === "active" && (
        <StageTransitionForm
          flockId={id}
          currentStage={flock.current_stage}
          transitions={Object.entries(flock.stage_transition_dates ?? {})}
        />
      )}

      {flock.status === "active" && <DepleteFlockForm flockId={id} />}

      <h2>Label history</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>From</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{h.display_label}</td>
                <td>{h.effective_from}</td>
                <td>{h.effective_to ?? "current"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
