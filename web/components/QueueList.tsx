import Link from "next/link";
import type { QueueItem } from "@/lib/uploadQueue/store";
import { chooseDate, dismissPhoto, keepSavedDay, replaceSavedDay, retryPhoto } from "@/app/upload/queue-actions";

const LABEL: Record<string, string> = {
  waiting: "Waiting",
  reading: "Reading…",
  saved: "Saved",
  needs_review: "Needs review",
  failed: "Failed",
  duplicate: "Date already saved",
};

export function QueueList({ items }: { items: QueueItem[] }) {
  if (items.length === 0) return <p className="card muted">The queue is empty.</p>;
  return (
    <div className="stack">
      {items.map((it) => {
        const mismatch = it.status === "needs_review" && it.pageDate;
        const d = it.detail as { flocks?: { label: string; flagged: boolean }[]; unresolved?: string[]; pageIssue?: string | null; ledgerIssue?: string | null; ledgerFlags?: string[] } | null;
        const flagged = d?.flocks?.filter((f) => f.flagged).length ?? 0;
        return (
          <div key={it.id} className={`card queue-item queue-s-${it.status}`}>
            <div className="queue-head">
              <a href={it.photoUrl} target="_blank" rel="noreferrer" aria-label="Open the photo full size">
                {
                  // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
                  <img src={it.photoUrl} alt={`Register photo for ${it.enteredDate}`} className="queue-thumb" loading="lazy" />
                }
              </a>
              <div>
                <strong>{it.enteredDate}</strong> <span className={`badge ${it.status === "saved" ? "badge-active" : it.status === "waiting" || it.status === "reading" ? "badge-depleted" : "badge-flagged"}`}>{LABEL[it.status] ?? it.status}</span>
                <div className="muted an-tiny">{it.name ?? ""}{it.attempts > 1 ? ` · attempt ${it.attempts}` : ""}</div>
              </div>
            </div>

            {it.message && <div className={it.status === "failed" ? "error-banner" : "flag-banner"}>{it.message}</div>}

            {it.status === "duplicate" && (
              <>
                <div className="queue-sbs">
                  <div>
                    <div className="muted an-tiny">Already saved{it.savedDay ? `: ${it.savedDay.rows} flocks, ${it.savedDay.eggs.toLocaleString("en-IN")} eggs` : ""}</div>
                    {it.savedDay?.photoUrl ? (
                      <a href={it.savedDay.photoUrl} target="_blank" rel="noreferrer">
                        {
                          // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
                          <img src={it.savedDay.photoUrl} alt="Photo of the saved day" className="queue-sbs-img" loading="lazy" />
                        }
                      </a>
                    ) : <div className="queue-sbs-img muted an-tiny">No photo stored for the saved day.</div>}
                  </div>
                  <div>
                    <div className="muted an-tiny">This new photo</div>
                    {
                      // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL
                      <img src={it.photoUrl} alt="The new photo" className="queue-sbs-img" loading="lazy" />
                    }
                  </div>
                </div>
                <div className="actions-bar" style={{ marginBottom: 0 }}>
                  <form action={keepSavedDay.bind(null, it.id)}><button type="submit">Keep what is saved</button></form>
                  <form action={replaceSavedDay.bind(null, it.id)}><button type="submit" className="btn-danger">Replace with this photo</button></form>
                </div>
                <p className="muted an-tiny" style={{ margin: 0 }}>Nothing is overwritten unless you choose “Replace”.</p>
              </>
            )}

            {mismatch && (
              <div className="actions-bar" style={{ marginBottom: 0 }}>
                <form action={chooseDate.bind(null, it.id, it.pageDate!)}><button type="submit">Use the page date {it.pageDate}</button></form>
                <form action={chooseDate.bind(null, it.id, it.enteredDate)}><button type="submit" className="btn-secondary">Use my date {it.enteredDate}</button></form>
              </div>
            )}

            {it.status === "needs_review" && !mismatch && (
              <>
                <p style={{ margin: 0 }}>
                  Saved {d?.flocks?.length ?? 0} flock rows; {flagged} flagged{d?.unresolved?.length ? `; ${d.unresolved.length} label(s) not matched` : ""}.
                  {d?.pageIssue ? ` Page check: ${d.pageIssue}` : ""}{d?.ledgerIssue ? ` ${d.ledgerIssue}` : ""}
                </p>
                {d?.ledgerFlags?.map((f, i) => (<div key={i} className="flag-banner">{f}</div>))}
                <div className="actions-bar" style={{ marginBottom: 0 }}>
                  <Link href={`/flagged?from=${it.enteredDate}&to=${it.enteredDate}`} className="btn">Review this day</Link>
                  <Link href={`/day?date=${it.enteredDate}`} className="btn btn-secondary">Open the day</Link>
                  <form action={dismissPhoto.bind(null, it.id)}><button type="submit" className="btn-secondary">Hide from the list</button></form>
                </div>
              </>
            )}

            {it.status === "saved" && (
              <div className="actions-bar" style={{ marginBottom: 0 }}>
                <Link href={`/day?date=${it.pageDate ?? it.forceDate ?? it.enteredDate}`} className="btn btn-secondary">Open the day</Link>
                <form action={dismissPhoto.bind(null, it.id)}><button type="submit" className="btn-secondary">Hide from the list</button></form>
              </div>
            )}

            {it.status === "failed" && (
              <>
                {it.technical && <p className="muted an-tiny" style={{ margin: 0 }}>Technical detail (for reporting this): {it.technical}</p>}
                <div className="actions-bar" style={{ marginBottom: 0 }}>
                  <form action={retryPhoto.bind(null, it.id)}><button type="submit">Retry this photo</button></form>
                  <form action={dismissPhoto.bind(null, it.id)}><button type="submit" className="btn-secondary">Remove</button></form>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
