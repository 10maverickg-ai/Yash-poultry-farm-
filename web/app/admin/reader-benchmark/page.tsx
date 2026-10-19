import Link from "next/link";
import { listBenchmarkDates } from "@/lib/extraction/readerV2/benchmark";

// Protected admin page (owner's "V4 build prompt", Phase 1): lets the owner
// run the NEW region-cropped reader against photos already stored by this
// app, from their phone, on a real Vercel deployment (never locally — there
// is no ANTHROPIC_API_KEY in a dev sandbox). Protection is a single shared
// secret in the URL, checked against READER_BENCHMARK_KEY — this is a new,
// standalone gate for this one diagnostic page, not a change to the app's
// existing (deliberately absent) login/auth model.
//
// Never writes anything — see benchmark.ts's own header comment. Visiting
// this page, or any date under it, cannot affect what a real upload saves.

export const dynamic = "force-dynamic";

function isAuthorized(key: string | undefined): boolean {
  const configured = process.env.READER_BENCHMARK_KEY;
  if (!configured) return false;
  if (!key) return false;
  return key === configured;
}

export default async function ReaderBenchmarkPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const sp = await searchParams;

  if (!process.env.READER_BENCHMARK_KEY) {
    return (
      <>
        <h1>Reader benchmark</h1>
        <p className="card muted">
          READER_BENCHMARK_KEY is not set on this deployment. Add it as an
          environment variable (any private value you choose) and redeploy —
          env var edits do not apply to an already-built deployment.
        </p>
      </>
    );
  }

  if (!isAuthorized(sp.key)) {
    return (
      <>
        <h1>Reader benchmark</h1>
        <p className="card muted">Not authorized.</p>
      </>
    );
  }

  const dates = await listBenchmarkDates();

  return (
    <>
      <h1>Reader benchmark</h1>
      <p className="muted">
        Taps the NEW region-cropped reader against a photo already stored
        for that date, and compares its reads field by field against what&apos;s
        currently saved. Read-only — this never changes any saved data.
        Pick a date you already trust (a reviewed, unflagged day is the most
        meaningful test).
      </p>
      {dates.length === 0 ? (
        <p className="card muted">No dates with a stored photo yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Flocks saved</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{d.flockCount}</td>
                  <td>
                    <Link
                      className="btn"
                      href={`/admin/reader-benchmark/${d.date}?key=${encodeURIComponent(sp.key ?? "")}`}
                    >
                      Run
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
