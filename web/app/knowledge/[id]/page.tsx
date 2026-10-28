import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { breedKey } from "@/lib/analytics/engine";
import { isPlaceholderDate } from "@/lib/ageWeeks";

export const dynamic = "force-dynamic";

// One knowledge entry: its source, and every standard value by week. For a
// hen-day or feed metric it also lines the farm's own flocks (same breed) up
// against the standard for their current age — straight from the numbers, no
// extrapolation: a week the table does not have shows "no reference loaded".
export default async function KnowledgeEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId)) notFound();
  const { rows } = await pool.query(
    `SELECT e.id, e.topic, e.page, e.breed, e.notes, d.company, d.title, d.year, d.source_url
       FROM knowledge_entries e JOIN knowledge_documents d ON d.id = e.document_id WHERE e.id = $1`,
    [entryId]
  );
  const e = rows[0];
  if (!e) notFound();
  const stds = await pool.query(`SELECT metric, age_weeks, value, unit FROM knowledge_standards WHERE entry_id = $1 ORDER BY metric, age_weeks`, [entryId]);
  const byMetric = new Map<string, { age: number; value: number; unit: string | null }[]>();
  for (const s of stds.rows) {
    const list = byMetric.get(s.metric) ?? [];
    list.push({ age: s.age_weeks, value: Number(s.value), unit: s.unit });
    byMetric.set(s.metric, list);
  }
  const hasHd = byMetric.has("hen_day_percent");
  const flocks = hasHd && e.breed
    ? await pool.query(
        `SELECT f.display_label, f.breed, f.placement_date, f.placement_date_confirmed,
                (SELECT avg(hd) FROM (SELECT hd_percent AS hd FROM daily_production
                   WHERE flock_internal_id = f.flock_internal_id AND deleted_at IS NULL ORDER BY date DESC LIMIT 7) x) AS hd7
           FROM flocks f
          WHERE f.farm_code = $1 AND f.status = 'active'
          ORDER BY f.display_label`,
        [ACTIVE_FARM]
      ).then((r) => ({ rows: r.rows.filter((f) => breedKey(f.breed) === breedKey(e.breed)) })) // "Bowan" and "Bovans White" are one breed
    : { rows: [] as { display_label: string; placement_date: string | null; placement_date_confirmed: boolean | null; hd7: string | null }[] };
  const hdStd = new Map((byMetric.get("hen_day_percent") ?? []).map((s) => [s.age, s.value]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <p><Link href="/knowledge">← Knowledge</Link></p>
      <h1>{e.topic}{e.breed ? ` · ${e.breed}` : ""}</h1>
      <p className="muted">
        {e.company} — {e.title}{e.year ? ` (${e.year})` : ""}{e.page ? ` · ${e.page}` : ""} ·{" "}
        <a href={e.source_url} target="_blank" rel="noreferrer">source</a>
      </p>
      {e.notes && <p className="card">{e.notes}</p>}
      {[...byMetric.entries()].map(([metric, list]) => (
        <div key={metric} className="card an-scroll">
          <h3 style={{ marginTop: 0 }}>{metric.replace(/_/g, " ")}</h3>
          <table className="an-table" style={{ minWidth: 0 }}>
            <thead><tr><th>Age (weeks)</th><th className="num">Standard{list[0].unit ? ` (${list[0].unit})` : ""}</th></tr></thead>
            <tbody>{list.map((s) => (<tr key={s.age}><td>{s.age}</td><td className="num">{s.value}</td></tr>))}</tbody>
          </table>
        </div>
      ))}
      {byMetric.size === 0 && <p className="card muted">This entry has notes only; no numeric standards are loaded.</p>}

      {hasHd && (
        <>
          <h2>Your flocks against this standard</h2>
          <div className="card">
            <ul className="an-list">
              {flocks.rows.map((f) => {
                if (!f.placement_date || isPlaceholderDate(f.placement_date, f.placement_date_confirmed)) {
                  return <li key={f.display_label}><b>{f.display_label}</b>: age unknown, no standard check (set the real placement date on the Flocks screen).</li>;
                }
                const age = Math.floor((Date.parse(today) - Date.parse(String(f.placement_date).slice(0, 10))) / 86400000 / 7);
                const std = hdStd.get(age);
                return (
                  <li key={f.display_label}>
                    <b>{f.display_label}</b>, week {age}:{" "}
                    {std == null ? "no reference loaded for this week" : `standard ${std}%`}
                    {f.hd7 != null ? `; last 7 rows average ${Number(f.hd7).toFixed(1)}%` : ""}
                  </li>
                );
              })}
              {flocks.rows.length === 0 && <li className="muted">No active flocks of breed {e.breed}.</li>}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
