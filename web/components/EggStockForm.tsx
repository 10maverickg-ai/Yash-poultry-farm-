"use client";

import { useActionState, useState } from "react";
import { saveEggStock } from "@/app/egg-stock/actions";
import {
  ENTRY_CATEGORIES,
  EGG_STOCK_SECTIONS,
  type ActiveEggFlockOption,
  type EggStockDay,
  type EggStockSection,
} from "@/lib/eggstock-types";

interface Line {
  label: string;
  category: string;
  amount: string; // signed, as written on paper (unchanged convention)
}

// Live running balance preview: opening + production, then cumulative
// signed amounts; null from the first non-numeric input onward. (The DB
// recomputes this authoritatively on save via
// fn_recompute_egg_stock_running_balances.)
function runningBalances(totalLine: string, lines: Line[]): (number | null)[] {
  const out: (number | null)[] = [];
  let bal = totalLine !== "" && Number.isFinite(Number(totalLine)) ? Number(totalLine) : null;
  for (const l of lines) {
    const a = Number(l.amount);
    if (bal === null || l.amount === "" || !Number.isFinite(a)) {
      bal = null;
      out.push(null);
    } else {
      bal += a;
      out.push(bal);
    }
  }
  return out;
}

const SECTION_TITLE: Record<EggStockSection, string> = {
  big: "Big ledger — main flocks (right page, BAB-1..BAB-8)",
  small: "Small ledger — young flocks (left page, BAB-9..BAB-11)",
};

// Two fixed section cards (owner request, 2026-10-19 — the register always
// has exactly these two parallel ledgers, never zero, never more), mirroring
// the field-name-by-index pattern FeedBagStockForm already uses for its
// (dynamic) group cards. One saveEggStock call covers both.
export function EggStockForm({ date, day }: { date: string; day: EggStockDay }) {
  const [state, formAction, pending] = useActionState(saveEggStock.bind(null, date), null);
  const v = state?.values;

  return (
    <form action={formAction} className="stack">
      {state && <div className="error-banner">{state.error}</div>}
      {EGG_STOCK_SECTIONS.map((section) => (
        <SectionCard
          key={section}
          section={section}
          day={day.sections.find((s) => s.section === section)!}
          activeFlocks={day.activeFlocks}
          values={v}
        />
      ))}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save egg stock ledgers"}
      </button>
    </form>
  );
}

function SectionCard({
  section,
  day,
  activeFlocks,
  values: v,
}: {
  section: EggStockSection;
  day: EggStockDay["sections"][number];
  activeFlocks: ActiveEggFlockOption[];
  values: Record<string, string> | undefined;
}) {
  const p = (name: string) => `${section}_${name}`;
  const seed = (name: string, savedValue: number | string | null | undefined) =>
    v ? v[p(name)] ?? "" : savedValue?.toString() ?? "";

  const initialLines: Line[] = v
    ? Array.from({ length: Number(v[p("line_count")] ?? 0) }, (_, i) => ({
        label: v[p(`label_${i}`)] ?? "",
        category: v[p(`category_${i}`)] ?? "other",
        amount: v[p(`amount_${i}`)] ?? "",
      }))
    : day.entries.map((e) => ({
        label: e.label_as_written,
        category: e.category ?? "other",
        amount: String(e.amount_eggs),
      }));

  const [lines, setLines] = useState<Line[]>(
    initialLines.length > 0 ? initialLines : [{ label: "", category: "sale", amount: "" }]
  );
  const [totalLine, setTotalLine] = useState(seed("total_line_eggs", day.summary?.total_line_eggs));
  const [linkedFlockIds, setLinkedFlockIds] = useState<string[]>(
    v
      ? activeFlocks.map((f) => f.flock_internal_id).filter((id) => v[p(`flock_${id}`)] !== undefined)
      : day.linkedFlockIds
  );

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const runningAfter = runningBalances(totalLine, lines);
  const linkedSum = activeFlocks
    .filter((f) => linkedFlockIds.includes(f.flock_internal_id))
    .reduce<number | null>((sum, f) => (sum === null || f.eggs_total === null ? null : sum + f.eggs_total), 0);

  return (
    <div className="card stack" style={{ marginBottom: 0 }}>
      <h2 style={{ margin: 0 }}>
        {SECTION_TITLE[section]}
        {day.summary?.flagged && <span className="badge badge-flagged"> flagged</span>}
      </h2>
      {day.summary?.flagged && day.summary.flag_reason && !v && (
        <div className="flag-banner">{day.summary.flag_reason}</div>
      )}
      {day.summary?.auto_correction_note && (
        <p className="muted" style={{ margin: 0 }}>{day.summary.auto_correction_note}</p>
      )}

      <input type="hidden" name={p("line_count")} value={lines.length} />

      <div className="grid4">
        <label className="field">
          <span>Opening balance</span>
          <input type="number" min="0" name={p("opening_balance_eggs")} defaultValue={seed("opening_balance_eggs", day.summary?.opening_balance_eggs)} />
        </label>
        <label className="field">
          <span>
            Production (+){" "}
            <span className="hint">
              {day.linkedProductionSum !== null ? `(linked flocks: ${day.linkedProductionSum.toLocaleString("en-IN")})` : ""}
            </span>
          </span>
          <input type="number" min="0" name={p("total_eggs_produced")} defaultValue={seed("total_eggs_produced", day.summary?.total_eggs_produced)} />
        </label>
        <label className="field">
          <span>Total line</span>
          <input
            type="number" min="0" name={p("total_line_eggs")}
            value={totalLine}
            onChange={(e) => setTotalLine(e.target.value)}
          />
        </label>
        <label className="field">
          <span>
            Closing balance{" "}
            <span className="hint">
              {runningAfter.length > 0 && runningAfter[runningAfter.length - 1] !== null
                ? `(calculated: ${runningAfter[runningAfter.length - 1]!.toLocaleString("en-IN")})`
                : ""}
            </span>
          </span>
          <input type="number" min="0" name={p("closing_balance_eggs")} defaultValue={seed("closing_balance_eggs", day.summary?.closing_balance_eggs)} />
        </label>
      </div>
      {day.previousClosing !== null && (
        <p className="muted" style={{ margin: 0 }}>
          Previous day&apos;s closing for this ledger: {day.previousClosing.toLocaleString("en-IN")}
        </p>
      )}

      <div className="row2">
        <label className="field">
          <span>Grade 13</span>
          <input type="number" min="0" name={p("grade_13_eggs")} defaultValue={seed("grade_13_eggs", day.summary?.grade_13_eggs)} />
        </label>
        <label className="field">
          <span>Grade 14</span>
          <input type="number" min="0" name={p("grade_14_eggs")} defaultValue={seed("grade_14_eggs", day.summary?.grade_14_eggs)} />
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>Grade 15</span>
          <input type="number" min="0" name={p("grade_15_eggs")} defaultValue={seed("grade_15_eggs", day.summary?.grade_15_eggs)} />
        </label>
        <label className="field">
          <span>Grade 15+</span>
          <input type="number" min="0" name={p("grade_15plus_eggs")} defaultValue={seed("grade_15plus_eggs", day.summary?.grade_15plus_eggs)} />
        </label>
      </div>

      <h3 style={{ margin: "0.5rem 0 0" }}>Deduction lines</h3>
      {lines.map((line, i) => (
        <div key={i} className="ledger-line">
          <div className="row2">
            <label className="field">
              <span>Label (as written)</span>
              <input name={p(`label_${i}`)} value={line.label} onChange={(e) => setLine(i, { label: e.target.value })} />
            </label>
            <label className="field">
              <span>Category</span>
              <select name={p(`category_${i}`)} value={line.category} onChange={(e) => setLine(i, { category: e.target.value })}>
                {ENTRY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.replaceAll("_", " ")}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="row2" style={{ alignItems: "end" }}>
            <label className="field">
              <span>Amount <span className="hint">(+/− as written)</span></span>
              <input type="number" name={p(`amount_${i}`)} value={line.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
            </label>
            <div className="field">
              <span className="muted">
                {runningAfter[i] !== null ? `balance after: ${runningAfter[i]!.toLocaleString("en-IN")}` : ""}
              </span>
              <button type="button" className="btn-secondary" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                Remove line
              </button>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => setLines((ls) => [...ls, { label: "", category: "sale", amount: "" }])}>
        + Add line
      </button>

      <div className="field">
        <span>
          Flocks in this ledger{" "}
          <span className="hint">
            (drives the production-vs-Daily-Production cross-check{linkedSum !== null && linkedFlockIds.length > 0 ? ` — linked total: ${linkedSum}` : ""})
          </span>
        </span>
        <div className="flock-checklist">
          {activeFlocks.length === 0 && <span className="muted">No flocks effective on this date.</span>}
          {activeFlocks.map((f) => (
            <label key={f.flock_internal_id} className="flock-check">
              <input
                type="checkbox"
                name={p(`flock_${f.flock_internal_id}`)}
                checked={linkedFlockIds.includes(f.flock_internal_id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...linkedFlockIds, f.flock_internal_id]
                    : linkedFlockIds.filter((id) => id !== f.flock_internal_id);
                  setLinkedFlockIds(next);
                }}
              />
              {f.display_label}
              {f.eggs_total !== null ? ` (${f.eggs_total})` : ""}
            </label>
          ))}
        </div>
      </div>

      {day.summary?.closing_balance_trays && (
        <p className="muted" style={{ margin: 0 }}>
          Saved closing balance ≈ {day.summary.closing_balance_trays} trays
        </p>
      )}
    </div>
  );
}
