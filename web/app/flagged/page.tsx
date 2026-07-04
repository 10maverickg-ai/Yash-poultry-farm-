import Link from "next/link";
import { listFlagged } from "@/lib/records";
import { markReviewed } from "./actions";

export const dynamic = "force-dynamic";

export default async function FlaggedPage() {
  const items = await listFlagged();

  return (
    <>
      <h1>Flagged records</h1>
      <p className="muted">
        Records that failed a validation rule and haven&apos;t been handled.
        Fix a data error on its entry screen (re-saving re-checks and clears
        the flag), or mark a genuine event as reviewed to acknowledge it.
      </p>

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
