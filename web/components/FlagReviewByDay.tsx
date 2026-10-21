import Link from "next/link";
import type { ReviewDay, ReviewItem } from "@/lib/flagReview";
import { markReviewed, markPageIssueReviewed, markEggEntryReviewed } from "@/app/flagged/actions";
import { MovementAnswers } from "@/components/MovementAnswers";

const n = (x: number | null | undefined) => (x == null ? "–" : x.toLocaleString("en-IN"));
const pretty = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Read({ value, check, extra }: { value: React.ReactNode; check: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <dl className="fr-read">
      <dt>Value read</dt>
      <dd className="fr-value">{value}</dd>
      {extra}
      <dt>Failing check</dt>
      <dd>{check}</dd>
    </dl>
  );
}

function Item({ item }: { item: ReviewItem }) {
  switch (item.kind) {
    case "production": {
      const c = item.cells;
      const cell =
        item.focus === "feed" ? `Feed: ${n(c.feed)} bags`
        : item.focus === "eggs" ? `Eggs: ${n(c.eggs)}`
        : item.focus === "mortality" ? `Deaths: ${n(c.mortality)}`
        : item.focus === "birds" ? `Birds: ${n(c.birds)}`
        : `Feed ${n(c.feed)} · Eggs ${n(c.eggs)} · Deaths ${n(c.mortality)} · Birds ${n(c.birds)}`;
      return (
        <div className="card fr-item">
          <h3 style={{ margin: 0 }}>
            {item.label} <span className="muted">· Daily Production{item.tag ? ` · ${item.tag}` : ""}</span>
          </h3>
          <Read
            value={cell}
            extra={
              <dd className="muted">
                Row: feed {n(c.feed)} · eggs {n(c.eggs)} · deaths {n(c.mortality)} · birds {n(c.birds)}
                {c.hd ? ` · HD ${c.hd}%` : ""}
              </dd>
            }
            check={item.reason}
          />
          <div className="fr-answers">
            <form action={markReviewed.bind(null, "production", item.id)}>
              <button type="submit">Right as read</button>
            </form>
            <Link href={`/production?date=${item.date}`} className="btn btn-secondary">
              Wrong — correct it
            </Link>
          </div>
        </div>
      );
    }
    case "ledger_gap": {
      const diff = item.opening - item.previousClosing;
      return (
        <div className="card fr-item">
          <h3 style={{ margin: 0 }}>
            Egg stock ledger <span className="muted">· {item.section} section</span>
          </h3>
          <Read
            value={`Opening ${n(item.opening)} eggs`}
            check={`Yesterday closed at ${n(item.previousClosing)}, so today should open at ${n(item.previousClosing)} — it opens ${n(Math.abs(diff))} eggs ${diff < 0 ? "short" : "over"} (${n(Math.abs(diff) / 30)} tray${Math.abs(diff) === 30 ? "" : "s"}).`}
          />
          <div className="fr-answers">
            <form action={markReviewed.bind(null, "egg_stock", item.id)}>
              <button type="submit">Opening is right as written</button>
            </form>
            <Link href={`/egg-stock?date=${item.date}`} className="btn btn-secondary">
              Wrong — correct it
            </Link>
          </div>
        </div>
      );
    }
    case "egg_entry":
      return (
        <div className="card fr-item">
          <h3 style={{ margin: 0 }}>
            Egg ledger line <span className="muted">· {item.category.replace(/_/g, " ")}</span>
          </h3>
          <Read value={`“${item.label}” ${item.amount != null ? `${n(item.amount)} eggs` : ""}`} check={item.reason} />
          <div className="fr-answers">
            <form action={markEggEntryReviewed.bind(null, item.id)}>
              <button type="submit">Right as read</button>
            </form>
            <Link href={`/egg-stock?date=${item.date}`} className="btn btn-secondary">
              Wrong — correct it
            </Link>
          </div>
        </div>
      );
    case "movement": {
      const out = item.change < 0;
      return (
        <div className="card fr-item">
          <h3 style={{ margin: 0 }}>
            {item.label} <span className="muted">· bird {out ? "departure" : "arrival"}{item.tag ? ` · ${item.tag}` : ""}</span>
          </h3>
          <Read
            value={`${out ? "−" : "+"}${n(Math.abs(item.change))} birds${item.before != null ? ` (${n(item.before)} → ${item.after != null ? n(item.after) : "gone from the register"})` : ""}`}
            check={`The count changed by more than mortality explains and no destination is written.${item.note ? ` Register: ${item.note}.` : ""}`}
          />
          <p className="muted" style={{ margin: 0 }}>What actually happened?</p>
          <MovementAnswers
            id={item.id}
            birdsChange={item.change}
            others={item.others.map((o) => ({ id: o.id, label: o.tag ? `${o.label} (${o.tag})` : o.label }))}
          />
        </div>
      );
    }
    case "page_issue":
      return (
        <div className="card fr-item">
          <h3 style={{ margin: 0 }}>Page checksum</h3>
          <Read value="Subtotal vs flock rows" check={item.text} />
          <div className="fr-answers">
            <form action={markPageIssueReviewed.bind(null, item.id)}>
              <button type="submit">Right as read</button>
            </form>
            <Link href={`/production?date=${item.date}`} className="btn btn-secondary">
              Open entry screen
            </Link>
          </div>
        </div>
      );
  }
}

export function FlagReviewByDay({
  days,
  otherOpen,
}: {
  days: ReviewDay[];
  otherOpen: { unresolved: number; ledgerIssues: number };
}) {
  const total = days.reduce((s, d) => s + d.items.length, 0);
  return (
    <>
      <p className="muted">
        {total === 0
          ? "Nothing open."
          : `${total} open item${total === 1 ? "" : "s"} across ${days.length} day${days.length === 1 ? "" : "s"}, oldest first. `}
        Each card shows what was read, which check it failed, and one-tap answers. “Right as read” marks the record reviewed
        (it leaves the queue and stops alerting); “Wrong — correct it” opens the entry screen.
      </p>
      {days.map((d) => (
        <section key={d.date} aria-label={d.date}>
          <h2 className="fr-day">
            {pretty(d.date)} <span className="muted">· {d.items.length}</span>
          </h2>
          {d.items.map((item) => (
            <Item key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </section>
      ))}
      {(otherOpen.unresolved > 0 || otherOpen.ledgerIssues > 0) && (
        <p className="card muted">
          Also open, shown in <Link href="/flagged?view=type">By type</Link>:{" "}
          {otherOpen.unresolved > 0 ? `${otherOpen.unresolved} unmatched extracted row${otherOpen.unresolved === 1 ? "" : "s"}` : ""}
          {otherOpen.unresolved > 0 && otherOpen.ledgerIssues > 0 ? ", " : ""}
          {otherOpen.ledgerIssues > 0 ? `${otherOpen.ledgerIssues} ledger/feed read failure${otherOpen.ledgerIssues === 1 ? "" : "s"}` : ""}.
        </p>
      )}
    </>
  );
}
