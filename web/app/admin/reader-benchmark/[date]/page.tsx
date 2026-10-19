import Link from "next/link";
import {
  runBenchmarkForDate,
  COMPARED_FIELDS,
  FIELD_LABELS,
  type BenchmarkResult,
} from "@/lib/extraction/readerV2/benchmark";

// Runs the reader-rebuild benchmark for ONE date on page load — see
// benchmark.ts's own header comment. Several sequential vision calls can
// happen here (orientation/regions, one per flock-table crop, up to 3
// checksum-retry rounds), so this needs real time to run on a real
// deployment; maxDuration is raised well past the framework default so a
// legitimate run isn't cut off mid-way.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isAuthorized(key: string | undefined): boolean {
  const configured = process.env.READER_BENCHMARK_KEY;
  return !!configured && !!key && key === configured;
}

export default async function ReaderBenchmarkDatePage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { date } = await params;
  const sp = await searchParams;

  if (!isAuthorized(sp.key)) {
    return (
      <>
        <h1>Reader benchmark</h1>
        <p className="card muted">Not authorized.</p>
      </>
    );
  }

  const backHref = `/admin/reader-benchmark?key=${encodeURIComponent(sp.key ?? "")}`;

  let result: BenchmarkResult;
  try {
    result = await runBenchmarkForDate(date);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return (
      <>
        <h1>Reader benchmark — {date}</h1>
        <p className="card muted">Couldn&apos;t run the benchmark: {detail}</p>
        <p>
          <Link href={backHref}>&larr; Back to date list</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Reader benchmark — {date}</h1>
      <p>
        <Link href={backHref}>&larr; Back to date list</Link>
      </p>

      <div className="card">
        <p>
          Photo: <a href={result.photoUrl} target="_blank" rel="noreferrer">view</a>
        </p>
        <p>
          New reader read the date as{" "}
          <strong>{result.v2DateRead ?? "(illegible)"}</strong>
          {result.v2DateRead !== date && (
            <span className="muted"> — this page is saved under {date}</span>
          )}
          .
        </p>
        <p>
          Checksum-guided retry rounds run: <strong>{result.retryRoundsRun}</strong>
          {result.retriedLabels.length > 0 && (
            <span> (re-asked about: {result.retriedLabels.join(", ")})</span>
          )}
        </p>
        {result.v2PageNotes && <p className="muted">Page notes: {result.v2PageNotes}</p>}
      </div>

      <h2>Accuracy by field</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Correct</th>
              <th>Comparable rows</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {COMPARED_FIELDS.map((f) => {
              const s = result.summary[f];
              const pct = s.comparable > 0 ? Math.round((s.correct / s.comparable) * 100) : null;
              return (
                <tr key={f}>
                  <td>{FIELD_LABELS[f]}</td>
                  <td>{s.correct}</td>
                  <td>{s.comparable}</td>
                  <td>{pct === null ? "—" : `${pct}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {result.missingFromExtraction.length > 0 && (
        <p className="card">
          <strong>Saved but not matched by the new reader at all:</strong>{" "}
          {result.missingFromExtraction.join(", ")}
        </p>
      )}
      {result.unmatchedExtractedLabels.length > 0 && (
        <p className="card muted">
          New reader read a label that didn&apos;t match any saved flock:{" "}
          {result.unmatchedExtractedLabels.join(", ")}
        </p>
      )}

      <h2>Cell by cell</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Flock</th>
              <th>Saved flag</th>
              {COMPARED_FIELDS.map((f) => (
                <th key={f}>{FIELD_LABELS[f]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>
                  {row.dbFlagged ? (
                    <span className="badge badge-flagged" title={row.dbFlagReason ?? undefined}>
                      flagged
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                {COMPARED_FIELDS.map((f) => {
                  const c = row.fields[f];
                  return (
                    <td key={f} style={{ color: c.match ? undefined : "#b91c1c", fontWeight: c.match ? undefined : 600 }}>
                      {c.actual ?? "—"}
                      {!c.match && <span className="muted"> (saved: {c.expected ?? "—"})</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
