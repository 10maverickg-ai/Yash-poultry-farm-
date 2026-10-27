// Loads knowledge/*.json into the knowledge tables. Idempotent; never deletes.
//   DATABASE_URL=… node web/scripts/import-knowledge.mts [--dry-run] [dir]
// Needs Node >= 22.18 and the `pg` package from web/node_modules.
/* eslint-disable @typescript-eslint/no-explicit-any -- JSON input is validated by hand below */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? join(here, "..", "..", "knowledge"));

function validate(doc: any, file: string): string[] {
  const errs: string[] = [];
  const need = (cond: unknown, msg: string) => { if (!cond) errs.push(`${file}: ${msg}`); };
  need(typeof doc.doc_key === "string" && /^[a-z0-9._-]+$/.test(doc.doc_key), "doc_key must be lowercase letters/digits/-/_/.");
  need(typeof doc.company === "string" && doc.company, "company is required");
  need(typeof doc.title === "string" && doc.title, "title is required");
  need(typeof doc.source_url === "string" && doc.source_url, "source_url is required (every fact needs a citation)");
  need(Array.isArray(doc.entries) && doc.entries.length > 0, "entries must be a non-empty array");
  const keys = new Set<string>();
  for (const [i, e] of (doc.entries ?? []).entries()) {
    need(typeof e.entry_key === "string" && e.entry_key, `entries[${i}].entry_key is required`);
    need(!keys.has(e.entry_key), `entries[${i}].entry_key "${e.entry_key}" is repeated`);
    keys.add(e.entry_key);
    need(typeof e.topic === "string" && e.topic, `entries[${i}].topic is required`);
    const seen = new Set<string>();
    for (const [j, s] of (e.standards ?? []).entries()) {
      need(typeof s.metric === "string" && s.metric, `entries[${i}].standards[${j}].metric is required`);
      need(Number.isInteger(s.age_weeks) && s.age_weeks >= 0 && s.age_weeks <= 150, `entries[${i}].standards[${j}].age_weeks must be a whole number of weeks`);
      need(typeof s.value === "number" && Number.isFinite(s.value), `entries[${i}].standards[${j}].value must be a number`);
      const k = `${s.metric}|${s.age_weeks}`;
      need(!seen.has(k), `entries[${i}] repeats ${s.metric} at week ${s.age_weeks}`);
      seen.add(k);
    }
  }
  return errs;
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
if (files.length === 0) { console.log(`No .json files in ${dir}`); process.exit(0); }
const docs = files.map((f) => ({ file: f, doc: JSON.parse(readFileSync(join(dir, f), "utf8")) }));
const errors = docs.flatMap(({ file, doc }) => validate(doc, file));
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`${files.length} file(s) valid.`);
if (dry) process.exit(0);

const require = createRequire(join(here, "..", "package.json"));
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://yash:yash_dev_password@localhost:5432/yash_poultry", ssl: process.env.DATABASE_URL?.includes("sslmode=") ? { rejectUnauthorized: false } : undefined });
await client.connect();
let docsN = 0, entriesN = 0, stdN = 0;
try {
  await client.query("BEGIN");
  for (const { doc } of docs) {
    const d = await client.query(
      `INSERT INTO knowledge_documents (doc_key, company, title, year, source_url) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (doc_key) DO UPDATE SET company = EXCLUDED.company, title = EXCLUDED.title, year = EXCLUDED.year, source_url = EXCLUDED.source_url
       RETURNING id`,
      [doc.doc_key, doc.company, doc.title, doc.year ?? null, doc.source_url]
    );
    docsN++;
    for (const e of doc.entries) {
      const r = await client.query(
        `INSERT INTO knowledge_entries (document_id, entry_key, topic, page, breed, notes) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (document_id, entry_key) DO UPDATE SET topic = EXCLUDED.topic, page = EXCLUDED.page, breed = EXCLUDED.breed, notes = EXCLUDED.notes
         RETURNING id`,
        [d.rows[0].id, e.entry_key, e.topic, e.page ?? null, e.breed ?? null, e.notes ?? null]
      );
      entriesN++;
      for (const s of e.standards ?? []) {
        await client.query(
          `INSERT INTO knowledge_standards (entry_id, metric, age_weeks, value, unit) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (entry_id, metric, age_weeks) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit`,
          [r.rows[0].id, s.metric, s.age_weeks, s.value, s.unit ?? null]
        );
        stdN++;
      }
    }
  }
  await client.query("COMMIT");
  console.log(`Imported ${docsN} document(s), ${entriesN} entries, ${stdN} standard values.`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
