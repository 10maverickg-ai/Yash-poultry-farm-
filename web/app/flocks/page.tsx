import Link from "next/link";
import { listFlocks } from "@/lib/flocks";
import { weeksSince, isPlaceholderDate } from "@/lib/ageWeeks";

import { setFlockSegment } from "./segment-actions";
import { compareLabels } from "@/lib/naturalSort";
import { dmy } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FlocksPage() {
  const flocks = await listFlocks();
  const active = flocks.filter((f) => f.status === "active").sort((a, b) => compareLabels(a.display_label, b.display_label));
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
        <b>Group</b> decides which group a flock is counted in on Analytics, Today and the exports. Main = right page of the register (big eggs, mature). Young = left page (small eggs, still ramping up). A flock with no group is counted only in the whole-farm total; nothing is guessed. Moving a flock keeps its past in the old group.
      </p>
      {flocks.length === 0 ? (
        <p className="card muted">
          No flocks yet. Add each currently running flock (BAB-I, BAB-II, …)
          to get started — every other register depends on this list.
        </p>
      ) : (
        <div className="flock-cards">
          {[...active, ...depleted].map((f) => {
            const noAge = !f.placement_date || isPlaceholderDate(f.placement_date, f.placement_date_confirmed);
            return (
              <div key={f.flock_internal_id} className={`card flock-card ${f.status}`}>
                <div className="flock-card-head">
                  <Link href={`/flocks/${f.flock_internal_id}`} className="plain-link flock-card-name">{f.display_label} ›</Link>
                  <span className={`badge badge-${f.status}`}>{f.status === "active" ? "on the farm" : "left the farm"}</span>
                </div>
                <dl className="flock-facts">
                  <div><dt>Birds</dt><dd>{f.current_bird_count?.toLocaleString("en-IN") ?? "—"}</dd></div>
                  <div><dt>Age</dt><dd>{noAge ? <span className="badge badge-flagged">age unknown</span> : `${weeksSince(f.placement_date!)} weeks`}</dd></div>
                  <div><dt>{f.placement_is_chick_date ? "Chicks arrived" : "Placed"}</dt><dd>{f.placement_date ? dmy(String(f.placement_date)) : <span className="badge badge-flagged">not set</span>}{f.placement_date && isPlaceholderDate(f.placement_date, f.placement_date_confirmed) ? " (placeholder)" : ""}</dd></div>
                  <div><dt>Breed</dt><dd>{f.breed ?? "—"}</dd></div>
                  <div><dt>Shed</dt><dd>{f.current_shed ?? "—"}</dd></div>
                </dl>
                <form action={setFlockSegment.bind(null, f.flock_internal_id)} className="seg-form">
                  <label className="field" style={{ flex: 1, margin: 0 }}>
                    <span>Group</span>
                    <select name="segment" defaultValue={f.segment ?? "none"} aria-label={`Group of ${f.display_label}`}>
                      <option value="none">Not set</option>
                      <option value="main">Main (big eggs)</option>
                      <option value="young">Young (small eggs)</option>
                    </select>
                  </label>
                  <button type="submit" className="btn-secondary">Save group</button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
