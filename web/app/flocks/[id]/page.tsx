import { notFound } from "next/navigation";
import { getFlock, getLabelHistory, listSheds } from "@/lib/flocks";
import { depleteFlock, transitionStage, updateFlock } from "../actions";

export const dynamic = "force-dynamic";

const STAGES = ["chick", "grower", "layer"] as const;

export default async function FlockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const flock = await getFlock(id);
  if (!flock) notFound();
  const [history, sheds] = await Promise.all([getLabelHistory(id), listSheds()]);

  const updateAction = updateFlock.bind(null, id);
  const transitionAction = transitionStage.bind(null, id);
  const depleteAction = depleteFlock.bind(null, id);

  return (
    <>
      <h1>
        Flock {flock.display_label}{" "}
        <span className={`badge badge-${flock.status}`}>{flock.status}</span>
      </h1>
      {error && <div className="error-banner">{error}</div>}

      <form action={updateAction} className="stack card">
        <h2 style={{ margin: 0 }}>Details</h2>
        <label className="field">
          <span>
            Display label *{" "}
            <span className="hint">
              (edit here only to fix a typo — label shifts between flocks go
              through the renumbering form)
            </span>
          </span>
          <input name="display_label" defaultValue={flock.display_label} required />
        </label>
        <div className="row2">
          <label className="field">
            <span>Breed</span>
            <input name="breed" defaultValue={flock.breed ?? ""} />
          </label>
          <label className="field">
            <span>Placement date</span>
            <input
              type="date"
              name="placement_date"
              defaultValue={flock.placement_date ?? ""}
            />
          </label>
        </div>
        <div className="row2">
          <label className="field">
            <span>Source hatchery</span>
            <input name="source_hatchery" defaultValue={flock.source_hatchery ?? ""} />
          </label>
          <label className="field">
            <span>Initial chick count</span>
            <input
              type="number"
              name="initial_chick_count"
              min="0"
              defaultValue={flock.initial_chick_count ?? ""}
            />
          </label>
        </div>
        <div className="row2">
          <label className="field">
            <span>Current bird count</span>
            <input
              type="number"
              name="current_bird_count"
              min="0"
              defaultValue={flock.current_bird_count ?? ""}
            />
          </label>
          <label className="field">
            <span>Current shed</span>
            <select name="current_shed" defaultValue={flock.current_shed ?? ""}>
              <option value="">—</option>
              {sheds.map((s) => (
                <option key={s.shed_code} value={s.shed_code}>
                  {s.shed_code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Hatchery bill photo URL</span>
          <input
            name="hatchery_bill_photo_url"
            defaultValue={flock.hatchery_bill_photo_url ?? ""}
          />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea name="notes" rows={2} defaultValue={flock.notes ?? ""} />
        </label>
        <button type="submit">Save details</button>
      </form>

      {flock.status === "active" && (
        <form action={transitionAction} className="stack card">
          <h2 style={{ margin: 0 }}>Stage transition</h2>
          <p className="muted" style={{ margin: 0 }}>
            Current stage: <strong>{flock.current_stage ?? "not set"}</strong>
            {flock.stage_transition_dates &&
              Object.entries(flock.stage_transition_dates).map(([k, v]) => (
                <span key={k}>
                  {" "}
                  · {k.replaceAll("_", " ")}: {v}
                </span>
              ))}
          </p>
          <div className="row2">
            <label className="field">
              <span>New stage</span>
              <select name="new_stage" required>
                {STAGES.filter((s) => s !== flock.current_stage).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Transition date</span>
              <input type="date" name="transition_date" required />
            </label>
          </div>
          <button type="submit">Record transition</button>
        </form>
      )}

      {flock.status === "active" && (
        <form action={depleteAction} className="stack card">
          <h2 style={{ margin: 0 }}>Mark depleted</h2>
          <p className="muted" style={{ margin: 0 }}>
            When the flock is fully sold off. Frees its label for the next
            renumbering event; this cannot be undone from the app.
          </p>
          <label className="field">
            <span>Depletion date</span>
            <input type="date" name="depletion_date" required />
          </label>
          <button type="submit" className="btn-danger">
            Mark depleted
          </button>
        </form>
      )}

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
