import { notFound } from "next/navigation";
import { isPlaceholderDate } from "@/lib/ageWeeks";
import { getFlock, getLabelHistory, listSheds } from "@/lib/flocks";
import { FlockEditForm } from "@/components/FlockEditForm";
import { StageTransitionForm } from "@/components/StageTransitionForm";
import { DepleteFlockForm } from "@/components/DepleteFlockForm";
import { CorrectStageForm } from "@/components/CorrectStageForm";
import Link from "next/link";
import { weeksSince } from "@/lib/ageWeeks";
import { getStageHistory, getFlockMovements, sameLabelFlocks } from "@/lib/flocklife/load";
import { addStageEvent } from "../life-actions";

export const dynamic = "force-dynamic";

export default async function FlockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { id } = await params;
  const flock = await getFlock(id);
  if (!flock) notFound();
  const [history, sheds, stageEvents, movements, sameLabel] = await Promise.all([getLabelHistory(id), listSheds(), getStageHistory(id), getFlockMovements(id), sameLabelFlocks(id, flock.display_label)]);
  const placeholder = isPlaceholderDate(flock.placement_date, flock.placement_date_confirmed);
  const ageWeeks = flock.placement_date && !placeholder ? weeksSince(flock.placement_date) : null;
  const TYPE: Record<string, string> = { transfer_out: "moved out", transfer_in: "moved in", sale: "sold", cull: "culled", unexplained_out: "left (destination not known)", unexplained_in: "arrived (source not known)", count_adjustment: "count adjusted" };

  return (
    <>
      <h1>
        Flock {flock.display_label}{" "}
        <span className={`badge badge-${flock.status}`}>{flock.status}</span>
      </h1>

      {sp.saved && <div className="saved-banner">{sp.saved}</div>}
      {sp.error && <div className="error-banner">{sp.error}</div>}
      {placeholder && (
        <div className="flag-banner">
          The placement date {flock.placement_date?.toString().slice(0, 10)} is a placeholder, so this flock&apos;s age is unknown and the standard check is off. Enter the real date below and tick “This is the real date”.
        </div>
      )}
      {ageWeeks != null && (
        <p className="muted">
          Age {ageWeeks} weeks{flock.placement_is_chick_date ? ` (placed as day-old chicks; lay starts about week 18)` : ""}.
          {flock.placement_date_confirmed !== true ? " Date not marked as confirmed." : ""}
        </p>
      )}

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
          placement_is_chick_date: flock.placement_is_chick_date,
          placement_date_confirmed: flock.placement_date_confirmed,
        }}
      />

      {flock.status === "active" && (
        <StageTransitionForm
          flockId={id}
          currentStage={flock.current_stage}
          transitions={Object.entries(flock.stage_transition_dates ?? {})}
        />
      )}

      {flock.status === "active" && (
        <CorrectStageForm flockId={id} currentStage={flock.current_stage} />
      )}

      {flock.status === "active" && <DepleteFlockForm flockId={id} />}

      <h2>Lifecycle</h2>
      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          Chick → grower → pre-lay → layer → moulting → sold / depleted. Current stage: <b>{flock.current_stage ?? "not set"}</b>
          {" "}· <Link href="/flocks/moulting">Moulting</Link> · <Link href="/flocks/batches">Chick batches</Link>
        </p>
        {stageEvents.length > 0 && (
          <ul className="an-list">
            {stageEvents.map((e) => (<li key={e.id}><b>{e.stage.replace("_", "-")}</b> from {e.from}{e.to ? ` to ${e.to}` : " (now)"}{e.note ? <span className="muted"> — {e.note}</span> : null}</li>))}
          </ul>
        )}
        <form action={addStageEvent.bind(null, id)} className="stack">
          <div className="row2">
            <label className="field"><span>New stage</span>
              <select name="stage" defaultValue="">
                <option value="" disabled>Choose…</option>
                <option value="chick">Chick</option><option value="grower">Grower</option><option value="pre_lay">Pre-lay</option>
                <option value="layer">Layer</option><option value="moulting">Moulting</option><option value="sold">Sold</option><option value="depleted">Depleted</option>
              </select>
            </label>
            <label className="field"><span>From</span><input type="date" name="from_date" /></label>
          </div>
          <label className="field"><span>Note</span><input type="text" name="note" /></label>
          <button type="submit" className="btn-secondary">Add stage change</button>
        </form>
      </div>

      <h2>Bird movements</h2>
      {movements.length === 0 ? (
        <p className="card muted">No bird movements recorded for this flock.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Birds</th><th>What</th><th>Who / price</th><th>Reason</th></tr></thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{m.date}</td>
                  <td>{m.change > 0 ? "+" : "−"}{Math.abs(m.change).toLocaleString("en-IN")}</td>
                  <td>{TYPE[m.type] ?? m.type}</td>
                  <td>{[m.counterpart, m.buyer, m.price != null ? `₹${m.price}/bird` : null].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="muted">{m.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sameLabel.length > 0 && (
        <p className="card muted">
          The label {flock.display_label} has also been used by {sameLabel.length} other flock{sameLabel.length === 1 ? "" : "s"}:{" "}
          {sameLabel.map((o) => (<span key={o.id + o.from}><Link href={`/flocks/${o.id}`}>{o.name}</Link> ({o.from}{o.to ? ` to ${o.to}` : ""}) </span>))}
          — each is a separate flock with its own history.
        </p>
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
