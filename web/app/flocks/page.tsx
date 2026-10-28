import Link from "next/link";
import { listFlocks } from "@/lib/flocks";
import { weeksSince, isPlaceholderDate } from "@/lib/ageWeeks";

import { setFlockSegment } from "./segment-actions";

export const dynamic = "force-dynamic";

export default async function FlocksPage() {
  const flocks = await listFlocks();
  const active = flocks.filter((f) => f.status === "active");
  const depleted = flocks.filter((f) => f.status === "depleted");

  return (
    <>
      <h1>Flock Register</h1>
      <div className="actions-bar">
        <Link href="/flocks/new" className="btn">
          + New flock
        </Link>
        <Link href="/flocks/renumber" className="btn btn-secondary">
          Renumbering event
        </Link>
        <Link href="/flocks/batches" className="btn btn-secondary">
          Chick batches
        </Link>
        <Link href="/flocks/moulting" className="btn btn-secondary">
          Moulting
        </Link>
      </div>

      <p className="muted an-sub">
        <b>Segment</b> decides which group a flock is counted in on Analytics, Today and the exports. Main = right page of the register (big eggs, mature). Young = left page (small eggs, still ramping up). A flock with no segment is counted only in the whole-farm total; nothing is guessed. Moving a flock keeps its past in the old group.
      </p>
      {flocks.length === 0 ? (
        <p className="card muted">
          No flocks yet. Add each currently running flock (BAB-I, BAB-II, …)
          to get started — every other register depends on this list.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Status</th>
                <th>Stage</th>
                <th>Shed</th>
                <th>Birds</th>
                <th>Placed</th>
                <th>Age</th>
                <th>Breed</th>
                <th>Segment</th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...depleted].map((f) => (
                <tr key={f.flock_internal_id} className={f.status}>
                  <td>
                    <Link href={`/flocks/${f.flock_internal_id}`}>
                      {f.display_label}
                    </Link>
                  </td>
                  <td>
                    <span className={`badge badge-${f.status}`}>{f.status}</span>
                  </td>
                  <td>{f.current_stage ?? "—"}</td>
                  <td>{f.current_shed ?? "—"}</td>
                  <td>{f.current_bird_count?.toLocaleString("en-IN") ?? "—"}</td>
                  <td>{f.placement_date ?? "—"}</td>
                  <td>
                    {!f.placement_date || isPlaceholderDate(f.placement_date, f.placement_date_confirmed)
                      ? <span className="badge badge-flagged">age unknown</span>
                      : `${weeksSince(f.placement_date)} wk`}
                  </td>
                  <td>{f.breed ?? "—"}</td>
                  <td>
                    <form action={setFlockSegment.bind(null, f.flock_internal_id)} className="seg-form">
                      <select name="segment" defaultValue={f.segment ?? ""} aria-label={`Segment of ${f.display_label}`}>
                        {!f.segment && <option value="" disabled>segment not set</option>}
                        <option value="main">Main (big eggs)</option>
                        <option value="young">Young (small eggs)</option>
                      </select>
                      <button type="submit" className="btn-secondary an-small">Set</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
