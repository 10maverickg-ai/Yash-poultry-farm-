import { listSheds } from "@/lib/flocks";
import { createFlock } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewFlockPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const sheds = await listSheds();

  return (
    <>
      <h1>New flock</h1>
      {error && <div className="error-banner">{error}</div>}
      <form action={createFlock} className="stack card">
        <label className="field">
          <span>
            Display label * <span className="hint">(as on paper, e.g. BAB-I)</span>
          </span>
          <input name="display_label" required />
        </label>
        <div className="row2">
          <label className="field">
            <span>Breed</span>
            <input name="breed" defaultValue="BV300" />
          </label>
          <label className="field">
            <span>
              Placement date <span className="hint">(chick arrival)</span>
            </span>
            <input type="date" name="placement_date" />
          </label>
        </div>
        <div className="row2">
          <label className="field">
            <span>Source hatchery</span>
            <input name="source_hatchery" placeholder="e.g. Venky's" />
          </label>
          <label className="field">
            <span>Initial chick count</span>
            <input type="number" name="initial_chick_count" min="0" />
          </label>
        </div>
        <div className="row2">
          <label className="field">
            <span>
              Current bird count{" "}
              <span className="hint">(defaults to initial count)</span>
            </span>
            <input type="number" name="current_bird_count" min="0" />
          </label>
          <label className="field">
            <span>Current shed</span>
            <select name="current_shed" defaultValue="">
              <option value="">—</option>
              {sheds.map((s) => (
                <option key={s.shed_code} value={s.shed_code}>
                  {s.shed_code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Current stage</span>
          <select name="current_stage" defaultValue="chick">
            <option value="chick">chick</option>
            <option value="grower">grower</option>
            <option value="layer">layer</option>
          </select>
        </label>
        <label className="field">
          <span>
            Hatchery bill photo URL{" "}
            <span className="hint">(optional; photo upload comes with Phase 3)</span>
          </span>
          <input name="hatchery_bill_photo_url" />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea name="notes" rows={2} />
        </label>
        <button type="submit">Create flock</button>
      </form>
    </>
  );
}
