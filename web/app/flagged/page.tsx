import Link from "next/link";
import {
  listFlagged,
  listUnresolvedExtractions,
  listOpenPageIssues,
  listOpenLedgerExtractionIssues,
  type DateFilter,
} from "@/lib/records";
import { listFlocks } from "@/lib/flocks";
import { listOpenFlockMovements } from "@/lib/flockMovements";
import {
  markReviewed,
  markPageIssueReviewed,
  deletePageIssue,
  markLedgerIssueReviewed,
  deleteLedgerIssue,
  resolveMovementAsTransfer,
  resolveMovementAsAnilFarm,
  resolveMovementAsSale,
  resolveMovementAsCull,
  resolveMovementAsCountAdjustment,
} from "./actions";
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

  const [items, unresolved, flocks, pageIssues, ledgerIssues, openMovements] = await Promise.all([
    listFlagged(dateFilter),
    listUnresolvedExtractions(dateFilter),
    listFlocks(),
    listOpenPageIssues(dateFilter),
    listOpenLedgerExtractionIssues(dateFilter),
    listOpenFlockMovements(),
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

      {ledgerIssues.length > 0 && (
        <>
          <h2>Ledger/feed box not read</h2>
          <p className="muted">
            The egg stock ledger and feed bag box are read in a separate step,
            after Daily Production has already saved — this never affects
            Daily Production itself. One of these failed or timed out; re-run
            the upload for that date to try again.
          </p>
          {ledgerIssues.map((issue) => (
            <div key={issue.id} className="card stack">
              <h3 style={{ margin: 0 }}>
                {issue.date} <span className="muted">· ledger/feed extraction</span>
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
                <form action={markLedgerIssueReviewed.bind(null, issue.id)}>
                  <button type="submit" className="btn-secondary">
                    Mark reviewed
                  </button>
                </form>
                <form action={deleteLedgerIssue.bind(null, issue.id)}>
                  <button type="submit" className="btn-danger">
                    Delete
                  </button>
                </form>
              </div>
            </div>
          ))}
        </>
      )}

      {openMovements.length > 0 && (
        <>
          <h2>Bird movements needing review</h2>
          <p className="muted">
            The day-to-day bird count for these flocks changed by more than
            mortality explains, and there&apos;s no written destination to go
            on. Pick what actually happened — nothing here guesses on its
            own.
          </p>
          {openMovements.map((m) => {
            const otherFlocks = activeFlocks.filter(
              (f) => f.flock_internal_id !== m.flock_internal_id
            );
            const isOutflow = m.birds_change < 0;
            return (
              <div key={m.id} className="card stack">
                <h3 style={{ margin: 0 }}>
                  {m.flock_label} <span className="muted">· {m.date}</span>
                </h3>
                <div className="flag-banner">
                  {m.flock_label}&apos;s count {isOutflow ? "dropped" : "rose"} by{" "}
                  {Math.abs(m.birds_change).toLocaleString("en-IN")} bird
                  {Math.abs(m.birds_change) === 1 ? "" : "s"} more than mortality
                  explains{m.register_note ? ` — ${m.register_note}` : ""}.
                </div>
                <p className="muted" style={{ margin: 0 }}>What actually happened?</p>
                <div className="actions-bar" style={{ flexWrap: "wrap" }}>
                  <form
                    action={resolveMovementAsTransfer.bind(null, m.id)}
                    className="actions-bar"
                    style={{ marginBottom: 0 }}
                  >
                    <select name="counterpartFlockId" required defaultValue="" aria-label="Which flock">
                      <option value="" disabled>
                        Moved to/from…
                      </option>
                      {otherFlocks.map((f) => (
                        <option key={f.flock_internal_id} value={f.flock_internal_id}>
                          {f.display_label}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="btn">
                      Another flock
                    </button>
                  </form>

                  <form action={resolveMovementAsAnilFarm.bind(null, m.id)}>
                    <button type="submit" className="btn">
                      Anil farm
                    </button>
                  </form>

                  {isOutflow && (
                    <>
                      <form
                        action={resolveMovementAsSale.bind(null, m.id)}
                        className="actions-bar"
                        style={{ marginBottom: 0 }}
                      >
                        <input
                          type="number"
                          name="pricePerBird"
                          placeholder="₹ per bird"
                          min="0"
                          step="0.01"
                          aria-label="Price per bird"
                          style={{ width: "9rem" }}
                        />
                        <button type="submit" className="btn">
                          Sold
                        </button>
                      </form>

                      <form action={resolveMovementAsCull.bind(null, m.id)}>
                        <button type="submit" className="btn">
                          Culled
                        </button>
                      </form>
                    </>
                  )}

                  <form action={resolveMovementAsCountAdjustment.bind(null, m.id)}>
                    <button type="submit" className="btn-secondary">
                      Count is correct, nothing moved
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </>
      )}

      <FlaggedProductionSection
        productionItems={productionItems}
        unresolvedItems={unresolved}
        activeFlocks={activeFlocks}
      />

      {items.length === 0 &&
        unresolved.length === 0 &&
        pageIssues.length === 0 &&
        ledgerIssues.length === 0 &&
        openMovements.length === 0 && (
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
