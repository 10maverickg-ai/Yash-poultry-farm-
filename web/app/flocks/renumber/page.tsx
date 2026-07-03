import { listFlocks } from "@/lib/flocks";
import { renumberFlocks } from "../actions";

export const dynamic = "force-dynamic";

export default async function RenumberPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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
      {error && <div className="error-banner">{error}</div>}

      {active.length === 0 ? (
        <p className="card muted">No active flocks to renumber.</p>
      ) : (
        <form action={renumberFlocks} className="stack card">
          <label className="field">
            <span>
              Effective from *{" "}
              <span className="hint">
                (first day the new labels are used on paper)
              </span>
            </span>
            <input type="date" name="effective_from" required />
          </label>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Current label</th>
                  <th>Placed</th>
                  <th>New label</th>
                </tr>
              </thead>
              <tbody>
                {active.map((f) => (
                  <tr key={f.flock_internal_id}>
                    <td>{f.display_label}</td>
                    <td>{f.placement_date ?? "—"}</td>
                    <td>
                      <input
                        name={`label_${f.flock_internal_id}`}
                        defaultValue={f.display_label}
                        required
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Flocks whose label is unchanged are left untouched.
          </p>
          <button type="submit">Apply renumbering</button>
        </form>
      )}
    </>
  );
}
