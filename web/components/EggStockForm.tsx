"use client";

import { useActionState, useState } from "react";
import { saveEggStock } from "@/app/egg-stock/actions";
import { ENTRY_CATEGORIES, type EggStockDay } from "@/lib/eggstock-types";

interface Line {
  label: string;
  category: string;
  amount: string; // signed, as written on paper
}

// Live running balance preview: total, then cumulative signed amounts; null
// from the first non-numeric input onward. (The DB recomputes this
// authoritatively on save via fn_recompute_egg_stock_running_balances.)
function runningBalances(total: string, lines: Line[]): (number | null)[] {
  const out: (number | null)[] = [];
  let bal = total !== "" && Number.isFinite(Number(total)) ? Number(total) : null;
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

// Mirrors the paper ledger: top total, grading counts, a variable list of
// labeled +/- lines, closing balance. Running balance is computed live per
// line; the DB recomputes it authoritatively on save.
export function EggStockForm({ date, day }: { date: string; day: EggStockDay }) {
  const [state, formAction, pending] = useActionState(
    saveEggStock.bind(null, date),
    null
  );
  const v = state?.values;

  // Seed lines from what was typed on a failed submit, else the saved rows.
  const initialLines: Line[] = v
    ? Array.from({ length: Number(v.line_count ?? 0) }, (_, i) => ({
        label: v[`label_${i}`] ?? "",
        category: v[`category_${i}`] ?? "other",
        amount: v[`amount_${i}`] ?? "",
      }))
    : day.entries.map((e) => ({
        label: e.label_as_written,
        category: e.category ?? "other",
        amount: String(e.amount_eggs),
      }));

  const [lines, setLines] = useState<Line[]>(
    initialLines.length > 0 ? initialLines : [{ label: "", category: "sale", amount: "" }]
  );
  const [total, setTotal] = useState(
    v ? v.total_eggs_produced ?? "" : day.summary?.total_eggs_produced?.toString() ?? ""
  );

  const seed = (name: string, savedValue: number | null | undefined) =>
    v ? v[name] ?? "" : savedValue?.toString() ?? "";

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const runningAfter = runningBalances(total, lines);

  return (
    <form action={formAction} className="stack">
      {state && <div className="error-banner">{state.error}</div>}
      {day.summary?.flagged && day.summary.flag_reason && !state && (
        <div className="flag-banner">{day.summary.flag_reason}</div>
      )}

      <div className="card stack" style={{ marginBottom: 0 }}>
        <h2 style={{ margin: 0 }}>Day totals</h2>
        <label className="field">
          <span>
            Total eggs produced{" "}
            <span className="hint">
              {day.productionSum !== null
                ? `(Daily Production sum: ${day.productionSum.toLocaleString("en-IN")})`
                : "(no Daily Production rows for this date yet)"}
            </span>
          </span>
          <input
            type="number"
            min="0"
            name="total_eggs_produced"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        <div className="row2">
          <label className="field">
            <span>Grade 13</span>
            <input
              type="number"
              min="0"
              name="grade_13_eggs"
              defaultValue={seed("grade_13_eggs", day.summary?.grade_13_eggs)}
            />
          </label>
          <label className="field">
            <span>Grade 14</span>
            <input
              type="number"
              min="0"
              name="grade_14_eggs"
              defaultValue={seed("grade_14_eggs", day.summary?.grade_14_eggs)}
            />
          </label>
        </div>
        <div className="row2">
          <label className="field">
            <span>Grade 15</span>
            <input
              type="number"
              min="0"
              name="grade_15_eggs"
              defaultValue={seed("grade_15_eggs", day.summary?.grade_15_eggs)}
            />
          </label>
          <label className="field">
            <span>Grade 15+</span>
            <input
              type="number"
              min="0"
              name="grade_15plus_eggs"
              defaultValue={seed("grade_15plus_eggs", day.summary?.grade_15plus_eggs)}
            />
          </label>
        </div>
      </div>

      <div className="card stack" style={{ marginBottom: 0 }}>
        <h2 style={{ margin: 0 }}>Ledger lines</h2>
        <p className="muted" style={{ margin: 0 }}>
          Lines exactly as the register shows them, top-to-bottom, with the
          sign in the amount. Category is picked by hand until Phase 3’s
          classifier takes over.
        </p>
        <input type="hidden" name="line_count" value={lines.length} />
        {lines.map((line, i) => (
          <div key={i} className="ledger-line">
            <div className="row2">
              <label className="field">
                <span>Label (as written)</span>
                <input
                  name={`label_${i}`}
                  value={line.label}
                  onChange={(e) => setLine(i, { label: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Category</span>
                <select
                  name={`category_${i}`}
                  value={line.category}
                  onChange={(e) => setLine(i, { category: e.target.value })}
                >
                  {ENTRY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row2" style={{ alignItems: "end" }}>
              <label className="field">
                <span>
                  Amount <span className="hint">(+/− as written)</span>
                </span>
                <input
                  type="number"
                  name={`amount_${i}`}
                  value={line.amount}
                  onChange={(e) => setLine(i, { amount: e.target.value })}
                />
              </label>
              <div className="field">
                <span className="muted">
                  {runningAfter[i] !== null
                    ? `balance after: ${runningAfter[i]!.toLocaleString("en-IN")}`
                    : ""}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  Remove line
                </button>
              </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            setLines((ls) => [...ls, { label: "", category: "sale", amount: "" }])
          }
        >
          + Add line
        </button>
      </div>

      <div className="card stack" style={{ marginBottom: 0 }}>
        <h2 style={{ margin: 0 }}>Closing balance</h2>
        <label className="field">
          <span>
            Closing balance (eggs){" "}
            <span className="hint">
              {runningAfter.length > 0 && runningAfter[runningAfter.length - 1] !== null
                ? `(calculated: ${runningAfter[runningAfter.length - 1]!.toLocaleString("en-IN")})`
                : ""}
              {day.previousClosing !== null &&
                ` — previous day's closing: ${day.previousClosing.toLocaleString("en-IN")}`}
            </span>
          </span>
          <input
            type="number"
            name="closing_balance_eggs"
            defaultValue={seed("closing_balance_eggs", day.summary?.closing_balance_eggs)}
          />
        </label>
        {day.summary?.closing_balance_trays && (
          <p className="muted" style={{ margin: 0 }}>
            Saved closing balance ≈ {day.summary.closing_balance_trays} trays
          </p>
        )}
      </div>

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save egg stock ledger"}
      </button>
    </form>
  );
}
