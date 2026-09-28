import Link from "next/link";
import { listFlagged, listUnresolvedExtractions, listOpenPageIssues, type DateFilter } from "@/lib/records";
import { listFlocks } from "@/lib/flocks";
import { markReviewed, markPageIssueReviewed, deletePageIssue } from "./actions";
import { FlaggedProductionSection } from "@/components/FlaggedProductionSection";

export const dynamic = "force-dynamic";

export default async function FlaggedPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const dateFilter: DateFilter = {
    from: /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from : undefined,
    to: /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to : undefined,
  };

  const [items, unresolved, flocks, pageIssues] = await Promise.all([
    listFlagged(dateFilter),
    listUnresolvedExtractions(dateFilter),
    listFlocks(),
    listOpenPageIssues(dateFilter),
  ]);
  const activeFlocks = flocks.filter((f) => f.status === "active");
  const productionItems = items.filter((i) => i.source === "production");
  const otherItems = items.filter((i) => i.source !== "production");

  return (
    <>
      <h1>Flagged records</h1>
      <p className="muted">
        Records that failed a validation rule and haven&apos;t been handled.
        Fix a data error on its entry screen (re-saving re-checks and clears
        the flag), or mark a genuine event as reviewed to acknowledge it.
        Wrong or duplicate data (e.g. an old test upload) can be deleted
        instead — that&apos;s a separate action from marking it reviewed.
      </p>

      <form method="get" className="card date-filter-form">
        <div className="date-filter-fields">
          <label className="field date-filter-field">
            <span>From</span>
            <input
              type="date"
              name="from"
              defaultValue={dateFilter.from ?? ""}
              aria-label="From date"
            />
          </label>
          <label className="field date-filter-field">
            <span>To</span>
            <input
              type="date"
              name="to"
              defaultValue={dateFilter.to ?? ""}
              aria-label="To date"
            />
          </label>
        </div>
        <div className="date-filter-actions">
          <button type="submit" className="btn-secondary">
            Filter
          </button>
          {(dateFilter.from || dateFilter.to) && (
            <Link href="/flagged" className="btn-secondary">
              Clear filter
            </Link>
          )}
        </div>
      </form>

      {pageIssues.length > 0 && (
        <>
          <h2>Page-level issues</h2>
          <p className="muted">
            Something about a whole uploaded page didn&apos;t add up — usually
            the register&apos;s own subtotal row not matching what the
            flocks on that page sum to. This doesn&apos;t mean every flock
            on the page is wrong, just that one number is worth a second
            look against the photo.
          </p>
          {pageIssues.map((issue) => (
            <div key={issue.id} className="card stack">
              <h3 style={{ margin: 0 }}>
                {issue.date} <span className="muted">· page checksum</span>
              </h3>
              <div className="flag-banner">{issue.issue_text}</div>
              {issue.source_photo_url && (
                <a href={issue.source_photo_url} target="_blank" rel="noreferrer">
                  {
                    // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, no next/image loader configured for it
                    <img
                      src={issue.source_photo_url}
                      alt={`Source register photo for ${issue.date}`}
                      className="flagged-photo-thumb"
                    />
                  }
                </a>
              )}
              <div className="actions-bar" style={{ marginBottom: 0 }}>
                <Link href={`/production?date=${issue.date}`} className="btn">
                  Open entry screen
                </Link>
                <form action={markPageIssueReviewed.bind(null, issue.id)}>
                  <button type="submit" className="btn-secondary">
                    Mark reviewed
                  </button>
                </form>
                <form action={deletePageIssue.bind(null, issue.id)}>
                  <button type="submit" className="btn-danger">
                    Delete
                  </button>
                </form>
              </div>
            </div>
          ))}
        </>
      )}

      <FlaggedProductionSection
        productionItems={productionItems}
        unresolvedItems={unresolved}
        activeFlocks={activeFlocks}
      />

      {items.length === 0 && unresolved.length === 0 && pageIssues.length === 0 && (
        <p className="card muted">
          Nothing in the queue{dateFilter.from || dateFilter.to ? " for this date range" : ""} —
          every saved record passes its checks or has been reviewed.
        </p>
      )}

      {otherItems.map((item) => (
        <div key={`${item.source}-${item.id}`} className="card stack">
          <h2 style={{ margin: 0 }}>
            {item.title} <span className="muted">· {item.date}</span>
          </h2>
          <div className="flag-banner">{item.flag_reason ?? "flagged"}</div>
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
      ))}
    </>
  );
}
