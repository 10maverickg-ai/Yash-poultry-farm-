import { pool } from "@/lib/db";

// "Extra references" for the flock cards: hen-day % standards from the
// knowledge library for OTHER breeds (or other companies) at the flock's age.
// BV300 (the bv300_standard_laying table) stays the PRIMARY standard and is the
// only one that colours a card; these are shown as plain extra lines, never as
// replacements. Only the exact metric "hen_day_percent" is used: any other metric
// (hen_day_percent_low / _high, feed, body weight, vaccines, …) is stored and
// shown on the Knowledge screens but never enters this comparison.
export interface ExtraRef {
  company: string;
  title: string;
  breed: string | null;
  value: number;
  entryId: number;
  sameBreed: boolean;
}

export async function extraHenDayRefs(ageWeeks: number, flockBreed: string | null): Promise<ExtraRef[]> {
  const { rows } = await pool.query(
    `SELECT e.id, d.company, d.title, e.breed, s.value
       FROM knowledge_standards s
       JOIN knowledge_entries e ON e.id = s.entry_id
       JOIN knowledge_documents d ON d.id = e.document_id
      WHERE s.metric = 'hen_day_percent' AND s.age_weeks = $1
        AND upper(coalesce(e.breed, '')) <> 'BV300'
      ORDER BY d.company, e.id`,
    [ageWeeks]
  );
  return rows.map((r) => ({
    company: r.company,
    title: r.title,
    breed: r.breed,
    value: Number(r.value),
    entryId: Number(r.id),
    sameBreed: !!flockBreed && !!r.breed && String(r.breed).toLowerCase().includes(flockBreed.toLowerCase()),
  }));
}
