// Bird-transfer detection (owner report, 2026-10-12, production: BAB-5 and
// BAB-6, 2026-08-06 -> 2026-08-07 — BAB-5 dropped from 10908 to 10419
// (about -485 after mortality), BAB-6 rose from 9680 to 10160 (about +480
// after mortality), and each flock's OWN new reading matched its OWN
// written HD exactly. This is a real transfer of ~480 birds from BAB-5 to
// BAB-6 (grower birds moved into layer cages) — not a misread. The old
// bal-bird chain check (balBirdChain.ts) had exactly one explanation for
// "today's reading doesn't continue the chain, but corroborates its own
// written HD": blame the PREVIOUS day's saved value as a likely misread.
// That framing is simply wrong whenever the real cause is a transfer
// between flocks on the SAME page — this module looks for that pattern
// across every candidate on the page before any message is decided.

export interface TransferCandidate {
  label: string;
  // today's extracted/final bal bird minus what the day-to-day chain alone
  // would predict (previous day's bal bird minus today's mortality) — see
  // balBirdChain.ts's "flag_previous" result. Positive = grew more than
  // mortality explains; negative = shrank more than mortality explains.
  unexplainedDelta: number;
}

export interface TransferFinding {
  label: string;
  note: string;
  // Owner request, 2026-10-15: which OTHER flock this candidate paired with
  // (null for a solo "no matching transfer found" finding) — upload/actions.ts
  // uses this to write a structured flock_movements row alongside the flag
  // message above, not just the flag text.
  counterpartLabel: string | null;
}

// "roughly equal size (within about 5%)" — owner's own wording, 2026-10-12.
export const TRANSFER_PAIR_TOLERANCE_FRACTION = 0.05;

/**
 * Pairs opposite-signed, roughly-equal-magnitude unexplained deltas across
 * every flock on the SAME page (section is deliberately not a constraint —
 * birds can be moved between any two cages on the farm) into one shared
 * "likely transfer" message for both flocks. A delta with no matching
 * opposite-signed partner gets its own, honest "no matching transfer
 * found" message instead — never silently dropped, and never blamed on
 * the previous day's row (that row is never touched or referenced here).
 */
export function detectBirdTransfers(candidates: TransferCandidate[]): TransferFinding[] {
  const findings: TransferFinding[] = [];
  const paired = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (paired.has(a.label) || a.unexplainedDelta === 0) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (paired.has(b.label) || b.unexplainedDelta === 0) continue;
      if (Math.sign(a.unexplainedDelta) === Math.sign(b.unexplainedDelta)) continue;

      const magA = Math.abs(a.unexplainedDelta);
      const magB = Math.abs(b.unexplainedDelta);
      const larger = Math.max(magA, magB);
      if (larger === 0 || Math.abs(magA - magB) / larger > TRANSFER_PAIR_TOLERANCE_FRACTION) continue;

      paired.add(a.label);
      paired.add(b.label);
      const fromLabel = a.unexplainedDelta < 0 ? a.label : b.label;
      const toLabel = a.unexplainedDelta < 0 ? b.label : a.label;
      const approxBirds = Math.round((magA + magB) / 2);
      const note = `Likely bird transfer ${fromLabel} -> ${toLabel} (~${approxBirds} birds). Confirm and no correction needed.`;
      findings.push(
        { label: a.label, note, counterpartLabel: b.label },
        { label: b.label, note, counterpartLabel: a.label }
      );
      break;
    }
  }

  for (const c of candidates) {
    if (c.unexplainedDelta === 0 || paired.has(c.label)) continue;
    const signed = c.unexplainedDelta > 0 ? `+${c.unexplainedDelta}` : `${c.unexplainedDelta}`;
    findings.push({
      label: c.label,
      note: `bird count changed by ${signed}, no matching transfer found, please check`,
      counterpartLabel: null,
    });
  }

  return findings;
}
