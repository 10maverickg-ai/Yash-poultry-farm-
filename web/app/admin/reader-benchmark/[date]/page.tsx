import Link from "next/link";
import type { CSSProperties } from "react";
import {
  runBenchmarkForDate,
  COMPARED_FIELDS,
  FIELD_LABELS,
  SUBTOTAL_FIELDS,
  LEDGER_FIELDS,
  FEED_BOX_FIELDS,
  type BenchmarkResult,
  type FieldComparison,
} from "@/lib/extraction/readerV2/benchmark";

// Runs the reader-rebuild benchmark for ONE date on page load — see
// benchmark.ts's own header comment. Several sequential vision calls can
// happen here (orientation/regions, one call per flock table, egg ledger,
// feed box and chick-rows crop present, plus up to 3 checksum-retry
// rounds on the flock tables), so this needs real time to run on a real
// deployment; maxDuration is raised well past the framework default so a
// legitimate run isn't cut off mid-way.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SUBTOTAL_FIELD_LABELS = FIELD_LABELS;
const LEDGER_FIELD_LABELS: Record<(typeof LEDGER_FIELDS)[number], string> = {
  opening_balance_eggs: "OB",
  total_eggs_produced: "(+) produced",
  total_line_eggs: "Total line",
  closing_balance_eggs: "Closing",
};
const FEED_BOX_FIELD_LABELS: Record<(typeof FEED_BOX_FIELDS)[number], string> = {
  opening_balance_bags: "OB",
  produced_bags: "(+) produced",
  total_bags: "Total",
  closing_balance_bags: "(-) closing",
  consumed_bags: "Consumed",
  mill_inventory_bags: "F (mill)",
  shed_inventory_bags: "S (shed)",
};

function isAuthorized(key: string | undefined): boolean {
  const configured = process.env.READER_BENCHMARK_KEY;
  return !!configured && !!key && key === configured;
}

function cellStyle(match: boolean): CSSProperties | undefined {
  return match ? undefined : { color: "#b91c1c", fontWeight: 600 };
}

function AccuracySummaryTable<F extends string>({
  fields,
  labels,
  summary,
}: {
  fields: readonly F[];
  labels: Record<F, string>;
  summary: Record<F, { comparable: number; correct: number }>;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Correct</th>
            <th>Comparable</th>
            <th>Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const s = summary[f];
            const pct = s.comparable > 0 ? Math.round((s.correct / s.comparable) * 100) : null;
            return (
              <tr key={f}>
                <td>{labels[f]}</td>
                <td>{s.correct}</td>
                <td>{s.comparable}</td>
                <td>{pct === null ? "—" : `${pct}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldCell({ c }: { c: FieldComparison }) {
  return (
    <td style={cellStyle(c.match)}>
      {c.actual ?? "—"}
      {!c.match && <span className="muted"> (saved: {c.expected ?? "—"})</span>}
    </td>
  );
}

export default async function ReaderBenchmarkDatePage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ key?: string; photoDate?: string }>;
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
    result = await runBenchmarkForDate(date, undefined, sp.photoDate);
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

      {result.dateMismatch && (
        <div className="error-banner">
          <strong>
            This photo looks like {result.v2DateRead}, not {date}.
          </strong>{" "}
          {result.photoDateUsed === date ? (
            <>
              It&apos;s currently filed under {date}, but the reader thinks it&apos;s actually from{" "}
              {result.v2DateRead}.{" "}
              {result.v2DateRead && (
                <Link
                  className="btn"
                  href={`/admin/reader-benchmark/${result.v2DateRead}?key=${encodeURIComponent(sp.key ?? "")}&photoDate=${encodeURIComponent(date)}`}
                >
                  Compare against {result.v2DateRead} instead
                </Link>
              )}
            </>
          ) : (
            <>This run is already comparing the photo filed under {result.photoDateUsed} against {date}&apos;s saved data, and the reader still reads a different date from the photo — double check both dates by eye.</>
          )}
        </div>
      )}

      <div className="card">
        <p>
          Photo: <a href={result.photoUrl} target="_blank" rel="noreferrer">view</a>
          {result.photoDateUsed !== date && (
            <span className="muted"> (filed under {result.photoDateUsed}, compared here against {date}&apos;s saved data)</span>
          )}
        </p>
        <p>
          New reader read the date as{" "}
          <strong>{result.v2DateRead ?? "(illegible)"}</strong>.
        </p>
        <p>
          Checksum-guided retry rounds run (flock tables): <strong>{result.retryRoundsRun}</strong>
          {result.retriedLabels.length > 0 && (
            <span> (re-asked about: {result.retriedLabels.join(", ")})</span>
          )}
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Page split: {result.debugImages.spineConfidence === "detected"
            ? `spine detected at pixel column ${result.debugImages.spineX}`
            : `no clear spine found — split down the exact middle instead (column ${result.debugImages.spineX})`}
          .
        </p>
        {result.v2PageNotes && <p className="muted">Page notes: {result.v2PageNotes}</p>}
      </div>

      <h2>What the model actually saw</h2>
      <p className="muted">
        The whole upright page with the detected spine line drawn on it, and each half exactly as sent to
        its own vision call, plus any crop sent for a checksum-guided retry. If a reading looks wrong,
        check here first — a wrong split or an unexpectedly empty half explains itself immediately; a bad
        NUMBER on an otherwise-correct half is a different kind of problem.
      </p>
      {result.debugImages.unavailableNote && (
        <p className="card muted">{result.debugImages.unavailableNote}</p>
      )}
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Whole page, spine line drawn:
        </p>
        {result.debugImages.fullPageWithSpine ? (
          // eslint-disable-next-line @next/next/no-img-element -- base64 debug image, never a static asset
          <img
            src={`data:image/jpeg;base64,${result.debugImages.fullPageWithSpine}`}
            alt="Upright page with detected spine line"
            style={{ maxWidth: "100%", height: "auto", border: "1px solid var(--line)", borderRadius: 8 }}
          />
        ) : (
          <p className="muted">debug picture unavailable</p>
        )}
      </div>
      <div className="table-wrap" style={{ padding: "0.8rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem" }}>
          {result.debugImages.halves.map((h) => (
            <div key={h.side} style={{ maxWidth: 420 }}>
              <p className="muted" style={{ margin: "0 0 0.3rem" }}>
                {h.side} half (sent to its own vision call)
              </p>
              {h.base64 ? (
                // eslint-disable-next-line @next/next/no-img-element -- base64 debug image, never a static asset
                <img
                  src={`data:image/jpeg;base64,${h.base64}`}
                  alt={`${h.side} half sent to the reader`}
                  style={{ maxWidth: "100%", height: "auto", border: "1px solid var(--line)", borderRadius: 8 }}
                />
              ) : (
                <p className="muted">debug picture unavailable</p>
              )}
            </div>
          ))}
        </div>
      </div>
      {result.debugImages.retries.length > 0 && (
        <div className="table-wrap" style={{ padding: "0.8rem" }}>
          <p className="muted" style={{ margin: "0 0 0.3rem" }}>
            Checksum-guided retries (ledger/feed box) — same half-page image resent with a hint about what
            didn&apos;t add up:
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem" }}>
            {result.debugImages.retries.map((r, i) => (
              <div key={i} style={{ maxWidth: 420 }}>
                <p className="muted" style={{ margin: "0 0 0.3rem" }}>{r.label}</p>
                {r.base64 ? (
                  // eslint-disable-next-line @next/next/no-img-element -- base64 debug image, never a static asset
                  <img
                    src={`data:image/jpeg;base64,${r.base64}`}
                    alt={r.label}
                    style={{ maxWidth: "100%", height: "auto", border: "1px solid var(--line)", borderRadius: 8 }}
                  />
                ) : (
                  <p className="muted">debug picture unavailable</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <h2>New reader vs. old reader (same photo, same ground truth)</h2>
      {result.oldReader.error ? (
        <p className="card muted">The old reader failed on this photo: {result.oldReader.error}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>New reader</th>
                <th>Old reader (live today)</th>
              </tr>
            </thead>
            <tbody>
              {COMPARED_FIELDS.map((f) => {
                const n = result.summary[f];
                const o = result.oldReader.summary[f];
                const nPct = n.comparable > 0 ? Math.round((n.correct / n.comparable) * 100) : null;
                const oPct = o.comparable > 0 ? Math.round((o.correct / o.comparable) * 100) : null;
                return (
                  <tr key={f}>
                    <td>{FIELD_LABELS[f]}</td>
                    <td>{nPct === null ? "—" : `${nPct}% (${n.correct}/${n.comparable})`}</td>
                    <td>{oPct === null ? "—" : `${oPct}% (${o.correct}/${o.comparable})`}</td>
                  </tr>
                );
              })}
              <tr>
                <td>Margin note</td>
                <td>
                  {result.marginNoteSummary.comparable > 0
                    ? `${Math.round((result.marginNoteSummary.correct / result.marginNoteSummary.comparable) * 100)}%`
                    : "—"}
                </td>
                <td>
                  {result.oldReader.marginNoteSummary.comparable > 0
                    ? `${Math.round((result.oldReader.marginNoteSummary.correct / result.oldReader.marginNoteSummary.comparable) * 100)}%`
                    : "—"}
                </td>
              </tr>
              {LEDGER_FIELDS.map((f) => {
                const n = result.ledgerSummary[f];
                const o = result.oldReader.ledgerSummary[f];
                const nPct = n.comparable > 0 ? Math.round((n.correct / n.comparable) * 100) : null;
                const oPct = o.comparable > 0 ? Math.round((o.correct / o.comparable) * 100) : null;
                return (
                  <tr key={`ledger-${f}`}>
                    <td>Ledger: {LEDGER_FIELD_LABELS[f]}</td>
                    <td>{nPct === null ? "—" : `${nPct}% (${n.correct}/${n.comparable})`}</td>
                    <td>{oPct === null ? "—" : `${oPct}% (${o.correct}/${o.comparable})`}</td>
                  </tr>
                );
              })}
              {FEED_BOX_FIELDS.map((f) => {
                const n = result.feedBoxSummary[f];
                const o = result.oldReader.feedBoxSummary[f];
                const nPct = n.comparable > 0 ? Math.round((n.correct / n.comparable) * 100) : null;
                const oPct = o.comparable > 0 ? Math.round((o.correct / o.comparable) * 100) : null;
                return (
                  <tr key={`feed-${f}`}>
                    <td>Feed box: {FEED_BOX_FIELD_LABELS[f]}</td>
                    <td>{nPct === null ? "—" : `${nPct}% (${n.correct}/${n.comparable})`}</td>
                    <td>{oPct === null ? "—" : `${oPct}% (${o.correct}/${o.comparable})`}</td>
                  </tr>
                );
              })}
              <tr>
                <td>Chick rows</td>
                <td colSpan={2} className="muted">
                  {result.oldReader.chickNote}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <h2>Flock tables — accuracy by field</h2>
      <AccuracySummaryTable fields={COMPARED_FIELDS} labels={FIELD_LABELS} summary={result.summary} />
      <p className="muted">
        Margin notes: {result.marginNoteSummary.correct} / {result.marginNoteSummary.comparable} flock-days
        agreed on whether a movement happened and roughly how big it was (expected figure is the sum of
        any saved flock_movements for that flock/date — see the cell-by-cell table below).
      </p>

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

      <h2>Flock tables — cell by cell</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Flock</th>
              <th>Saved flag</th>
              {COMPARED_FIELDS.map((f) => (
                <th key={f}>{FIELD_LABELS[f]}</th>
              ))}
              <th>Margin note</th>
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
                {COMPARED_FIELDS.map((f) => <FieldCell key={f} c={row.fields[f]} />)}
                <td style={cellStyle(row.marginNote.match)}>
                  {row.marginNote.actualText ?? "—"}
                  {!row.marginNote.match && (
                    <span className="muted">
                      {" "}
                      (expected magnitude: {row.marginNote.expectedMagnitude || "none"})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Subtotal rows</h2>
      <p className="muted">
        Expected is computed by summing that section&apos;s matched flocks&apos; SAVED values (never the new
        reader&apos;s own reads) — Bal Bird allows the same small tolerance the production checksum already
        does, and % is calculated from the expected eggs/Bal Bird rather than a separately saved figure.
      </p>
      <AccuracySummaryTable fields={SUBTOTAL_FIELDS} labels={SUBTOTAL_FIELD_LABELS} summary={result.subtotalSummary} />
      {result.subtotals.length === 0 ? (
        <p className="card muted">No subtotal row read from either table on this photo.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Section</th>
                <th>Flocks used for expected</th>
                {SUBTOTAL_FIELDS.map((f) => <th key={f}>{SUBTOTAL_FIELD_LABELS[f]}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.subtotals.map((s) => (
                <tr key={s.section}>
                  <td>{s.section}</td>
                  <td>{s.flocksUsedForExpected}</td>
                  {SUBTOTAL_FIELDS.map((f) => <FieldCell key={f} c={s.fields[f]} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Egg ledger</h2>
      <AccuracySummaryTable fields={LEDGER_FIELDS} labels={LEDGER_FIELD_LABELS} summary={result.ledgerSummary} />
      {result.ledgers.length === 0 ? (
        <p className="card muted">No saved egg ledger data for this date.</p>
      ) : (
        result.ledgers.map((l) => (
          <div className="card" key={l.section}>
            <h3>{l.section === "big" ? "Big ledger (BAB-1..7)" : "Small ledger (BAB-8..10)"}</h3>
            <p className="muted" style={{ margin: 0 }}>
              Checksum retry rounds: {result.ledgerRetryRounds[l.section] ?? 0}
            </p>
            {l.stillFailingChecks.length > 0 && (
              <div className="error-banner">
                <strong>Needs review — still fails its own arithmetic after retries:</strong>
                <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.2rem" }}>
                  {l.stillFailingChecks.map((msg, i) => <li key={i}>{msg}</li>)}
                </ul>
              </div>
            )}
            {l.crossDayNote && <p className="muted">{l.crossDayNote}</p>}
            {l.note && <p className="muted">{l.note}</p>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>{LEDGER_FIELDS.map((f) => <th key={f}>{LEDGER_FIELD_LABELS[f]}</th>)}</tr>
                </thead>
                <tbody>
                  <tr>{LEDGER_FIELDS.map((f) => <FieldCell key={f} c={l.fields[f]} />)}</tr>
                </tbody>
              </table>
            </div>
            {l.deductions.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Saved label</th>
                      <th>Saved amount</th>
                      <th>Reader label</th>
                      <th>Reader amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.deductions.map((d) => (
                      <tr key={d.position}>
                        <td>{d.position}</td>
                        <td>{d.expectedLabel ?? "—"}</td>
                        <td>{d.expectedAmount ?? "—"}</td>
                        <td style={cellStyle(d.match)}>{d.actualLabel ?? "—"}</td>
                        <td style={cellStyle(d.match)}>{d.actualAmount ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      )}

      <h2>Feed box</h2>
      <AccuracySummaryTable fields={FEED_BOX_FIELDS} labels={FEED_BOX_FIELD_LABELS} summary={result.feedBoxSummary} />
      {result.feedBoxes.length === 0 ? (
        <p className="card muted">No saved feed box data for this date.</p>
      ) : (
        result.feedBoxes.map((f) => (
          <div className="card" key={f.groupLabel}>
            <h3>{f.groupLabel === "ALL" ? "Single box (covers every flock)" : `Box: ${f.groupLabel}`}</h3>
            <p className="muted" style={{ margin: 0 }}>
              Checksum retry rounds: {result.feedBoxRetryRounds[f.groupLabel] ?? 0}
            </p>
            {f.stillFailingChecks.length > 0 && (
              <div className="error-banner">
                <strong>Needs review — still fails its own arithmetic after retries:</strong>
                <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.2rem" }}>
                  {f.stillFailingChecks.map((msg, i) => <li key={i}>{msg}</li>)}
                </ul>
              </div>
            )}
            {f.note && <p className="muted">{f.note}</p>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>{FEED_BOX_FIELDS.map((k) => <th key={k}>{FEED_BOX_FIELD_LABELS[k]}</th>)}</tr>
                </thead>
                <tbody>
                  <tr>{FEED_BOX_FIELDS.map((k) => <FieldCell key={k} c={f.fields[k]} />)}</tr>
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      <h2>Chick rows</h2>
      <p className="muted">
        Unlike everything above, there is no existing extraction prompt for chick rows anywhere in this
        app — chick_daily_mortality has always been filled in by hand. Treat this section as new and
        unproven, not as inheriting the old reader&apos;s track record.
      </p>
      {result.chickRows.note && <p className="card muted">{result.chickRows.note}</p>}
      {result.chickRows.rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Saved deaths</th>
                <th>Reader deaths</th>
              </tr>
            </thead>
            <tbody>
              {result.chickRows.rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{r.expectedDeaths ?? "—"}</td>
                  <td style={cellStyle(r.match)}>{r.actualDeaths ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.chickRows.unmatchedExtracted.length > 0 && (
        <p className="card muted">
          Reader found a row that didn&apos;t match any saved chick row:{" "}
          {result.chickRows.unmatchedExtracted.join(", ")}
        </p>
      )}
    </>
  );
}
