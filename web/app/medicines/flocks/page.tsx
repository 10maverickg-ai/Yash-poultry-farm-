import Link from "next/link";
import { loadFlockMedicines } from "@/lib/medicines/boosterStore";
import { FlockMedicinesCard } from "@/components/FlockMedicinesCard";
import { todayIST } from "@/lib/weather/openMeteo";

export const metadata = { title: "What is each flock on" };
export const dynamic = "force-dynamic";

export default async function FlocksMedicinesPage({ searchParams }: { searchParams: Promise<{ flock?: string }> }) {
  const sp = await searchParams;
  const today = todayIST();
  const { rules, views } = await loadFlockMedicines(today, sp.flock && /^[0-9a-f-]{36}$/i.test(sp.flock) ? sp.flock : undefined);
  const groups = [
    { key: "main", title: "Main group", rows: views.filter((v) => v.flock.segment === "main") },
    { key: "young", title: "Young group", rows: views.filter((v) => v.flock.segment === "young") },
    { key: "other", title: "Other flocks", rows: views.filter((v) => !v.flock.segment) },
  ].filter((g) => g.rows.length > 0);
  const missing = views.filter((v) => v.cells.some((c) => c.status === "no_date")).length;
  return (
    <>
      <h1>What is each flock on</h1>
      <p className="muted">
        For every flock: the boosters repeated every {rules[0]?.repeatMonths ?? 6} months ({rules.map((r) => r.label).join(" and ") || "none set up"}) and what was given. <Link href="/medicines">← Medicines &amp; vaccines</Link>
      </p>
      <p className="card an-tiny" style={{ lineHeight: 1.8 }}>
        <span className="md-tl md-tl-green" aria-hidden="true" /> <b>Done</b>: the last booster is recorded and the next one is more than 14 days away.{" "}
        <span className="md-tl md-tl-amber" aria-hidden="true" /> <b>Due soon</b>, or <b>last date not entered</b>: nothing is assumed, so type the date from the register.{" "}
        <span className="md-tl md-tl-red" aria-hidden="true" /> <b>Overdue</b>.
      </p>
      {missing > 0 && <div className="flag-banner">The last booster date is not entered for {missing} flock{missing === 1 ? "" : "s"}. Tap “Enter the last date” on each card.</div>}
      {sp.flock && <p><Link href="/medicines/flocks">← All flocks</Link></p>}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title}>
          <h2>{g.title} <span className="badge">{g.rows.length}</span></h2>
          {g.rows.map((v) => (<FlockMedicinesCard key={v.flock.id} flock={v.flock} cells={v.cells} given={v.given} today={today} showAll={!!sp.flock} />))}
        </section>
      ))}
      {views.length === 0 && <p className="card muted">No flock found.</p>}
    </>
  );
}
