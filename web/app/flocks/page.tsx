import Link from "next/link";
import { listFlocks } from "@/lib/flocks";

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
      </div>

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
                <th>Breed</th>
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
                  <td>{f.breed ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
