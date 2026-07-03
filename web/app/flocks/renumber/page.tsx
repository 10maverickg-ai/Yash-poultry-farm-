import { listFlocks } from "@/lib/flocks";
import { RenumberForm } from "@/components/RenumberForm";

export const dynamic = "force-dynamic";

export default async function RenumberPage() {
  const active = (await listFlocks()).filter((f) => f.status === "active");

  return (
    <>
      <h1>Renumbering event</h1>
      <p className="muted">
        Use this when labels shift — typically after the oldest flock is
        depleted and all younger flocks move down one number. Old production
        entries keep pointing at the right flock via the label history; from
        the effective date, each label refers to its newly assigned flock.
      </p>

      {active.length === 0 ? (
        <p className="card muted">No active flocks to renumber.</p>
      ) : (
        <RenumberForm
          rows={active.map((f) => ({
            flockId: f.flock_internal_id,
            label: f.display_label,
            placed: f.placement_date,
          }))}
        />
      )}
    </>
  );
}
