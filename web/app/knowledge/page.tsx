import Link from "next/link";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = { title: "Knowledge library" };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string; topic?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const topic = (sp.topic ?? "").trim().slice(0, 80);
  const [topics, entries] = await Promise.all([
    pool.query(`SELECT topic, count(*)::int AS n FROM knowledge_entries GROUP BY topic ORDER BY topic`),
    pool.query(
      `SELECT e.id, e.topic, e.page, e.breed, e.notes, d.company, d.title, d.year, d.source_url,
              (SELECT count(*)::int FROM knowledge_standards s WHERE s.entry_id = e.id) AS values
         FROM knowledge_entries e JOIN knowledge_documents d ON d.id = e.document_id
        WHERE ($1 = '' OR e.topic = $1)
          AND ($2 = '' OR e.topic ILIKE '%' || $2 || '%' OR e.notes ILIKE '%' || $2 || '%'
               OR d.company ILIKE '%' || $2 || '%' OR d.title ILIKE '%' || $2 || '%' OR e.breed ILIKE '%' || $2 || '%')
        ORDER BY e.topic, d.company, e.id LIMIT 100`,
      [topic, q]
    ),
  ]);
  return (
    <>
      <h1>Knowledge</h1>
      <p className="muted">
        Breeder and veterinary company material, kept as facts with a citation. If a number is not here, the app says “no reference loaded” — it never fills one in.
      </p>
      <form method="get" className="card actions-bar" style={{ alignItems: "end" }}>
        <label className="field" style={{ flex: 1 }}>
          <span>Search</span>
          <input type="search" name="q" defaultValue={q} placeholder="company, breed, topic or note" />
        </label>
        {topic && <input type="hidden" name="topic" value={topic} />}
        <button type="submit" className="btn-secondary">Search</button>
      </form>
      <div className="actions-bar">
        <Link href="/knowledge" className={topic ? "btn btn-secondary" : "btn"}>All topics</Link>
        {topics.rows.map((t) => (
          <Link key={t.topic} href={`/knowledge?topic=${encodeURIComponent(t.topic)}`} className={topic === t.topic ? "btn" : "btn btn-secondary"}>
            {t.topic} ({t.n})
          </Link>
        ))}
      </div>
      {entries.rows.length === 0 ? (
        <p className="card muted">
          {topics.rows.length === 0 ? "Nothing loaded yet. Files in the knowledge/ folder are loaded with the importer script." : "No match."}
        </p>
      ) : (
        entries.rows.map((e) => (
          <div key={e.id} className="card">
            <h3 style={{ margin: 0 }}>
              <Link href={`/knowledge/${e.id}`}>{e.topic}</Link>
              {e.breed ? <span className="muted"> · {e.breed}</span> : null}
            </h3>
            <div className="muted an-tiny">{e.company} — {e.title}{e.year ? ` (${e.year})` : ""}{e.page ? ` · ${e.page}` : ""}</div>
            {e.notes && <p style={{ margin: "0.4rem 0 0" }}>{e.notes}</p>}
            <div className="muted an-tiny">{e.values ? `${e.values} values by week · ` : ""}<a href={e.source_url} target="_blank" rel="noreferrer">source</a></div>
          </div>
        ))
      )}
    </>
  );
}
