"use client";

import { useActionState, useState } from "react";
import { saveProduction } from "@/app/production/actions";
import type { ProductionSlot } from "@/lib/production";

// One card per flock, mirroring the paper register's columns:
// Mort | Feed | Total | Bal Bird | % — plus the shed as written that day.
// The calculated HD% (eggs ÷ birds) is shown live next to the % input so a
// mismatch with what the paper says is visible before saving; the save still
// goes through and the row simply gets flagged, same as OCR will behave.
export function ProductionEntryForm({
  date,
  slots,
}: {
  date: string;
  slots: ProductionSlot[];
}) {
  const [state, formAction, pending] = useActionState(
    saveProduction.bind(null, date),
    null
  );
  const v = state?.values;

  return (
    <form action={formAction} className="stack">
      {state && <div className="error-banner">{state.error}</div>}
      {slots.map((slot) => (
        <FlockCard key={slot.flock_internal_id} slot={slot} typed={v} />
      ))}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save day's production"}
      </button>
    </form>
  );
}

function FlockCard({
  slot,
  typed,
}: {
  slot: ProductionSlot;
  typed: Record<string, string> | undefined;
}) {
  const id = slot.flock_internal_id;
  // Re-seed priority: what was typed on a failed submit > saved row > blank.
  const seed = (field: string, savedValue: number | string | null) =>
    typed ? typed[`${field}_${id}`] ?? "" : savedValue?.toString() ?? "";

  const [eggs, setEggs] = useState(seed("eggs_total", slot.saved?.eggs_total ?? null));
  const [birds, setBirds] = useState(
    seed("bird_population", slot.saved?.bird_population ?? null)
  );

  const eggsN = Number(eggs);
  const birdsN = Number(birds);
  const calcHd =
    eggs !== "" && birds !== "" && Number.isFinite(eggsN) && Number.isFinite(birdsN) && birdsN > 0
      ? ((eggsN / birdsN) * 100).toFixed(2)
      : null;

  return (
    <div className="card stack" style={{ marginBottom: 0 }}>
      <h2 style={{ margin: 0 }}>
        {slot.display_label}
        {slot.saved?.flagged && <span className="badge badge-flagged"> flagged</span>}
      </h2>
      {slot.saved?.flagged && slot.saved.flag_reason && (
        <div className="flag-banner">{slot.saved.flag_reason}</div>
      )}
      <input type="hidden" name={`label_${id}`} value={slot.display_label} />
      <div className="row2">
        <label className="field">
          <span>Shed</span>
          <input
            name={`shed_${id}`}
            defaultValue={
              typed
                ? typed[`shed_${id}`] ?? ""
                : slot.saved?.shed_code ?? slot.default_shed ?? ""
            }
          />
        </label>
        <label className="field">
          <span>Mortality</span>
          <input
            type="number"
            min="0"
            name={`mortality_${id}`}
            defaultValue={seed("mortality", slot.saved?.mortality ?? null)}
          />
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>
            Feed <span className="hint">(bags, 1 = 45 kg)</span>
          </span>
          <input
            type="number"
            min="0"
            name={`feed_bags_${id}`}
            defaultValue={seed("feed_bags", slot.saved?.feed_bags ?? null)}
          />
        </label>
        <label className="field">
          <span>Eggs total</span>
          <input
            type="number"
            min="0"
            name={`eggs_total_${id}`}
            defaultValue={seed("eggs_total", slot.saved?.eggs_total ?? null)}
            onChange={(e) => setEggs(e.target.value)}
          />
        </label>
      </div>
      <div className="row2">
        <label className="field">
          <span>Bal Bird</span>
          <input
            type="number"
            min="0"
            name={`bird_population_${id}`}
            defaultValue={seed("bird_population", slot.saved?.bird_population ?? null)}
            onChange={(e) => setBirds(e.target.value)}
          />
        </label>
        <label className="field">
          <span>
            HD %{" "}
            <span className="hint">
              {calcHd !== null ? `(calculated: ${calcHd}%)` : "(as on paper)"}
            </span>
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            name={`hd_percent_${id}`}
            defaultValue={seed("hd_percent", slot.saved?.hd_percent ?? null)}
          />
        </label>
      </div>
    </div>
  );
}
