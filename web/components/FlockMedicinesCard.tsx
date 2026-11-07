import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { enterLastBooster } from "@/app/medicines/actions";
import { boosterWords, type BoosterCell } from "@/lib/medicines/boosters";
import type { GivenRow } from "@/lib/medicines/boosterStore";
import { dmy, inr } from "@/lib/format";

// What one flock is on: the boosters with a traffic light (green = done, amber = due within 14 days or no date entered, red = overdue)
// and what was given, latest first. Cards, not a wide table, so it reads on a phone. The light is always also written in words.
const LIGHT: Record<BoosterCell["status"], { cls: string; word: string }> = {
  done: { cls: "md-tl-green", word: "Done" },
  soon: { cls: "md-tl-amber", word: "Due soon" },
  no_date: { cls: "md-tl-amber", word: "Last date not entered" },
  overdue: { cls: "md-tl-red", word: "Overdue" },
};

export function FlockMedicinesCard({ flock, cells, given, today, showAll = false, link = true }: { flock: { id: string; label: string; segment: "main" | "young" | null; laying: boolean }; cells: BoosterCell[]; given: GivenRow[]; today: string; showAll?: boolean; link?: boolean }) {
  const shown = showAll ? given : given.slice(0, 5);
  return (
    <section className="card md-flockcard" aria-label={`${flock.label}: medicines and vaccines`}>
      <h3 style={{ margin: 0 }}>
        {link ? <Link href={`/flocks/${flock.id}`}>{flock.label}</Link> : flock.label}
        {flock.segment && <span className="td-group-tag">{flock.segment === "main" ? "Main" : "Young"}</span>}
      </h3>

      {!flock.laying && <p className="muted an-tiny" style={{ margin: 0 }}>Not a laying flock yet: the 6-month boosters do not apply.</p>}
      {cells.map((c) => (
        <div key={c.ruleCode} className="md-booster">
          <div className="md-booster-head">
            <span className={`md-tl ${LIGHT[c.status].cls}`} aria-hidden="true" />
            <b>{c.label}</b> <span className={`md-status ${LIGHT[c.status].cls}-text`}>{LIGHT[c.status].word}</span>
          </div>
          <div className="an-tiny">{boosterWords(c, dmy)}</div>
          <details open={c.status === "no_date"} className="md-enter">
            <summary>{c.status === "no_date" ? "Enter the last date" : "Enter a new date"}</summary>
            <ActionForm action={enterLastBooster.bind(null, flock.id, c.ruleCode)} className="actions-bar" style={{ marginTop: "0.3rem", marginBottom: 0 }}>
              <input type="date" name="date" defaultValue={c.last ?? ""} max={today} aria-label={`Date ${c.label} was given to ${flock.label}`} required />
              <button type="submit">Save the date</button>
            </ActionForm>
            <p className="muted an-tiny" style={{ margin: "0.2rem 0 0" }}>Type the date written in the register. The app never guesses a date.</p>
          </details>
        </div>
      ))}

      <h4 style={{ margin: "0.4rem 0 0" }}>Given</h4>
      {given.length === 0 ? (
        <p className="muted an-tiny" style={{ margin: 0 }}>Nothing entered for this flock yet.</p>
      ) : (
        <ul className="md-given">
          {shown.map((g) => (
            <li key={g.id}>
              <b>{g.name}</b> <span className="muted an-tiny">{dmy(g.date)}{g.scope !== "flock" ? ` · ${g.scope === "farm" ? "whole farm" : "shed"}` : ""}{g.quantity != null ? ` · ${g.quantity} ${g.unit ?? ""}` : ""}{g.cost != null ? ` · ${inr(g.cost)}` : ""}</span>
              {!g.catalogued && <span className="badge badge-confirm" style={{ marginLeft: "0.4rem" }}>not in the list</span>}
            </li>
          ))}
        </ul>
      )}
      {given.length > shown.length && <p className="muted an-tiny" style={{ margin: 0 }}>{given.length - shown.length} older. <Link href={`/medicines/flocks?flock=${flock.id}`}>Show all</Link></p>}
    </section>
  );
}
