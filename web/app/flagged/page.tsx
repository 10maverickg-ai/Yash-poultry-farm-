import Link from "next/link";
import { listFlagged, listUnresolvedExtractions } from "@/lib/records";
import { listFlocks } from "@/lib/flocks";
import { markReviewed, resolveExtraction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FlaggedPage() {
  const [items, unresolved, flocks] = await Promise.all([
    listFlagged(),
    listUnresolvedExtractions(),
    listFlocks(),
  ]);
  const activeFlocks = flocks.filter((f) => f.status === "active");

  return (
    <>
      <h1>Flagged records</h1>
      <p className="muted">
        Records that failed a validation rule and haven&apos;t been handled.
        Fix a data error on its entry screen (re-saving re-checks and clears
        the flag), or mark a genuine event as reviewed to acknowledge it.
      </p>

      {unresolved.length > 0 && (
        <>
          <h2>Unmatched flock labels</h2>
          <p className="muted">
            Read from a photo, but the label didn&apos;t match any active
            flock — not even after allowing for spacing, case, or minor
            punctuation differences. Nothing here is lost: pick the flock it
            actually belongs to below and the numbers save normally.
          </p>
          {unresolved.map((item) => (
            <div key={`unresolved-${item.id}`} className="card stack">
              <h3 style={{ margin: 0 }}>
                &ldquo;{item.display_label_as_written}&rdquo;{" "}
                <span className="muted">· {item.date}</span>
              </h3>
              <div className="flag-banner">
                Could not match this label to a known flock — please confirm.
              </div>
              {item.sections_found !== null && (
                <p className="muted" style={{ margin: 0 }}>
                  Model reported {item.sections_found} flock table section
                  {item.sections_found === 1 ? "" : "s"} found in this photo.
                </p>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Shed</th>
                      <th>Mort</th>
                      <th>Feed</th>
                      <th>Total eggs</th>
                      <th>Bal bird</th>
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{item.shed_code ?? "—"}</td>
                      <td>{item.mortality ?? "—"}</td>
                      <td>{item.feed_bags ?? "—"}</td>
                      <td>{item.eggs_total ?? "—"}</td>
                      <td>{item.bird_population ?? "—"}</td>
                      <td>{item.hd_percent ?? "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {item.source_photo_url && (
                <a href={item.source_photo_url} target="_blank" rel="noreferrer">
                  {
                    // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, no next/image loader configured for it
                    <img
                      src={item.source_photo_url}
                      alt={`Source register photo for "${item.display_label_as_written}"`}
                      className="flagged-photo-thumb"
                    />
                  }
                </a>
              )}
              <form action={resolveExtraction.bind(null, item.id)} className="actions-bar" style={{ marginBottom: 0 }}>
                <label className="field" style={{ flex: 1, minWidth: 200 }}>
                  <span>This is actually…</span>
                  <select name="flockInternalId" required defaultValue="">
                    <option value="" disabled>
                      Choose a flock
                    </option>
                    {activeFlocks.map((f) => (
                      <option key={f.flock_internal_id} value={f.flock_internal_id}>
                        {f.display_label}
                        {f.current_shed ? ` — ${f.current_shed}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="btn">
                  Save to this flock
                </button>
              </form>
            </div>
          ))}
          <h2>Flagged records</h2>
        </>
      )}

      {items.length === 0 ? (
        <p className="card muted">
          Nothing in the queue — every saved record passes its checks or has
          been reviewed.
        </p>
      ) : (
        items.map((item) => (
          <div key={`${item.source}-${item.id}`} className="card stack">
            <h2 style={{ margin: 0 }}>
              {item.title} <span className="muted">· {item.date}</span>
            </h2>
            <div className="flag-banner">{item.flag_reason ?? "flagged"}</div>
            {item.sections_found !== null && (
              <p className="muted" style={{ margin: 0 }}>
                Model reported {item.sections_found} flock table section
                {item.sections_found === 1 ? "" : "s"} found in this photo.
              </p>
            )}
            {item.source_photo_url && (
              <a href={item.source_photo_url} target="_blank" rel="noreferrer">
                {
                  // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, no next/image loader configured for it
                  <img
                    src={item.source_photo_url}
                    alt={`Source register photo for ${item.title}`}
                    className="flagged-photo-thumb"
                  />
                }
              </a>
            )}
            <div className="actions-bar" style={{ marginBottom: 0 }}>
              <Link href={item.entry_href} className="btn">
                Open entry screen
              </Link>
              <form action={markReviewed.bind(null, item.source, item.id)}>
                <button type="submit" className="btn-secondary">
                  Mark reviewed
                </button>
              </form>
            </div>
          </div>
        ))
      )}
    </>
  );
}
