"use client";

import { useActionState } from "react";
import { previewRates, confirmRates, type PreviewState } from "@/app/sales/rates/actions";

// Two steps on purpose: paste -> see exactly what was read (date, per-100 rate,
// per-egg, big, small) -> confirm. Nothing is saved from the first step.
export function RatesForm() {
  const [preview, readAction, reading] = useActionState<PreviewState | null, FormData>(previewRates, null);
  const [result, saveAction, saving] = useActionState<PreviewState | null, FormData>(confirmRates, null);

  return (
    <div className="stack">
      <form action={readAction} className="card stack">
        <label className="field">
          <span>Paste the rate message(s) — one or many days at once</span>
          <textarea name="text" rows={6} placeholder="OCTOBER 19, 2026 BFTA EGG RATE RS.560/- Subsidy for 0 Paise" />
        </label>
        <label className="field">
          <span>
            Date you are entering <span className="hint">(optional — I will stop and ask if the message says a different date)</span>
          </span>
          <input type="date" name="enteredDate" />
        </label>
        <label className="field">
          <span>Or a screenshot <span className="hint">(optional, read with vision)</span></span>
          <input type="file" name="screenshot" accept="image/*" />
        </label>
        <button type="submit" disabled={reading}>{reading ? "Reading…" : "Read the message"}</button>
        {preview?.error && <div className="error-banner">{preview.error}</div>}
      </form>

      {result?.saved && <div className="saved-banner">{result.saved}</div>}
      {result?.error && <div className="error-banner">{result.error}</div>}

      {preview && preview.rows.length > 0 && (
        <form action={saveAction} className="card stack">
          <h2 style={{ margin: 0 }}>Check what I read</h2>
          {preview.rows.map((r) => {
            const mismatch = !!r.messageDate && !!r.enteredDate && r.messageDate !== r.enteredDate;
            return (
              <div key={r.key} className="rate-row">
                <input type="hidden" name="key" value={r.key} />
                <input type="hidden" name={`per100_${r.key}`} value={r.per100} />
                <input type="hidden" name={`subsidy_${r.key}`} value={r.subsidyPaise} />
                <input type="hidden" name={`orig_${r.key}`} value={r.original} />
                <input type="hidden" name={`msgdate_${r.key}`} value={r.messageDate ?? ""} />
                <input type="hidden" name={`entered_${r.key}`} value={r.enteredDate ?? ""} />
                <label className="rate-use">
                  <input type="checkbox" name={`use_${r.key}`} defaultChecked /> Save
                </label>
                <label className="field">
                  <span>Date {r.messageDate ? "(from the message)" : "(none in the message — choose)"}</span>
                  <input type="date" name={`date_${r.key}`} defaultValue={r.messageDate ?? r.enteredDate ?? ""} required />
                </label>
                <div className="rate-nums">
                  <span><b>₹{(r.per100 / 100).toFixed(2)}</b> per egg ({r.per100} per 100)</span>
                  <span>subsidy {r.subsidyPaise} paise → <b>₹{r.effective.toFixed(2)}</b></span>
                  <span>big ₹{r.big.toFixed(2)} · small ₹{r.small.toFixed(2)}</span>
                </div>
                {r.existing != null && <div className="flag-banner">Replaces the rate already saved for this date (₹{r.existing.toFixed(2)}).</div>}
                {mismatch && (
                  <label className="flag-banner rate-confirm">
                    <input type="checkbox" name={`confirmdate_${r.key}`} /> The message says {r.messageDate} but you are entering {r.enteredDate}. Tick if the message date is right.
                  </label>
                )}
                {r.notes.map((n, i) => (<div key={i} className="flag-banner">{n}</div>))}
                <div className="muted an-tiny">“{r.original}”</div>
              </div>
            );
          })}
          <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save rates"}</button>
        </form>
      )}
    </div>
  );
}
