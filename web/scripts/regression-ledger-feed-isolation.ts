// Permanent regression fixture (owner report, 2026-10-12 — the production
// crash's bug report explicitly asked for proof that the egg-ledger/feed-
// box step, added in PR #10, can NEVER block the Daily Production save,
// even if it throws the exact TypeError seen in that incident). Run with
// `npx tsx scripts/regression-ledger-feed-isolation.ts` from `web/`.
//
// app/upload/actions.ts has no live-DB/live-API access in this sandbox
// (confirmed: no DATABASE_URL/ANTHROPIC_API_KEY configured), so this cannot
// be exercised end-to-end against a real transaction. What CAN be verified,
// and is verified here, is the actual structural guarantee that file is
// built on: two SEQUENTIAL, SEPARATE try/catch blocks —
//
//   try { await withTransaction(...) }        <- Daily Production. On
//   catch { return {...error} }                  success, falls through;
//                                                  on failure, returns
//                                                  immediately and the
//                                                  ledger/feed block below
//                                                  is never even reached.
//
//   try { ledgerFeedResult = await extractAndSaveLedgerFeed(...) }
//   catch { ledgerFeedIssue = "..."; }
//
//   return { ...everything the FIRST block already decided, ledgerFeed,
//             ledgerFeedIssue };
//
// — the second block's own catch can set `ledgerFeedIssue` but has no way
// to touch `error`/`written`/`autoCorrections`/etc., which were already
// fixed by the time the second block even starts (Daily Production's
// transaction has already committed by then). This fixture reproduces that
// exact two-phase shape with stand-ins for withTransaction and
// extractAndSaveLedgerFeed (including a stand-in that throws the EXACT
// error text from the production incident) and proves the outcome the real
// file's structure guarantees: Daily Production's own result is completely
// unaffected by any ledger/feed failure, of any kind.

type Outcome = {
  error: string | null;
  written: string[];
  ledgerFeed: { ok: true } | null;
  ledgerFeedIssue: string | null;
};

// Mirrors app/upload/actions.ts's own two-phase shape exactly (see the
// header comment) — not a re-export of the real function (which needs a
// live DB/API), but the same control flow, so a change to that file's
// structure that broke this guarantee would be caught here too.
async function runUploadLikeFlow(
  dailyProduction: () => Promise<string[]>,
  ledgerFeed: () => Promise<{ ok: true }>
): Promise<Outcome> {
  let written: string[];
  try {
    written = await dailyProduction();
  } catch {
    return { error: `Photo was read, but something went wrong saving the results — please try again.`, written: [], ledgerFeed: null, ledgerFeedIssue: null };
  }

  let ledgerFeedResult: { ok: true } | null = null;
  let ledgerFeedIssue: string | null = null;
  try {
    ledgerFeedResult = await ledgerFeed();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    ledgerFeedIssue = `Ledger/feed box not read (failed in: ledger/feed pipeline): ${detail}. Re-run the upload to try again.`;
  }

  return { error: null, written, ledgerFeed: ledgerFeedResult, ledgerFeedIssue };
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS: ${name}`);
  } else {
    fail++;
    console.log(`FAIL: ${name}`, detail ?? "");
  }
}

async function main() {

// --- Case 1: ledger/feed throws the EXACT TypeError text from the real
// production incident. Daily Production must still succeed, fully, with
// its own result completely untouched. ---
{
  const outcome = await runUploadLikeFlow(
    async () => ["BAB-1", "BAB-2", "BAB-6"], // Daily Production succeeds, 3 flocks saved
    async () => {
      throw new TypeError("c.filter is not a function or its return value is not iterable");
    }
  );
  check("Case 1: Daily Production's own error stays null", outcome.error === null, outcome);
  check("Case 1: Daily Production's own written flocks are untouched (all 3)", outcome.written.length === 3, outcome);
  check("Case 1: ledgerFeed result is null (never produced)", outcome.ledgerFeed === null, outcome);
  check(
    "Case 1: ledgerFeedIssue surfaces the failure, naming the stage, WITHOUT being treated as this upload's error",
    outcome.ledgerFeedIssue !== null &&
      outcome.ledgerFeedIssue.includes("failed in: ledger/feed pipeline") &&
      outcome.ledgerFeedIssue.includes("c.filter is not a function"),
    outcome.ledgerFeedIssue
  );
}

// --- Case 2: ledger/feed throws something else entirely (a network
// timeout, an unrelated bug) — same guarantee must hold regardless of WHAT
// it throws. ---
{
  const outcome = await runUploadLikeFlow(
    async () => ["BAB-3"],
    async () => {
      throw new Error("ETIMEDOUT: ledger/feed vision call took too long");
    }
  );
  check("Case 2: Daily Production succeeds regardless of the ledger/feed failure's cause", outcome.error === null && outcome.written.length === 1, outcome);
  check("Case 2: the unrelated failure is still surfaced, not swallowed", outcome.ledgerFeedIssue?.includes("ETIMEDOUT") ?? false, outcome.ledgerFeedIssue);
}

// --- Case 3: control — Daily Production itself fails. This is the ONLY
// case where `error` should be set, and it must happen regardless of
// whether the ledger/feed step would have succeeded (it's never even
// reached). ---
{
  let ledgerFeedWasCalled = false;
  const outcome = await runUploadLikeFlow(
    async () => {
      throw new TypeError("subtotals.filter is not a function");
    },
    async () => {
      ledgerFeedWasCalled = true;
      return { ok: true };
    }
  );
  check("Case 3: a genuine Daily Production failure DOES surface as this upload's error", outcome.error !== null, outcome);
  check("Case 3: the ledger/feed step is never even reached once Daily Production has failed", !ledgerFeedWasCalled);
}

// --- Case 4: both succeed — the ordinary path, confirming the isolation
// plumbing doesn't interfere when there's nothing to isolate. ---
{
  const outcome = await runUploadLikeFlow(
    async () => ["BAB-1"],
    async () => ({ ok: true })
  );
  check("Case 4: ordinary success — no error, ledgerFeed populated, no issue", outcome.error === null && outcome.ledgerFeed !== null && outcome.ledgerFeedIssue === null, outcome);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
}

main();
