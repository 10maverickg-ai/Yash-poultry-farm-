import { listSheds } from "@/lib/flocks";
import { createShed, updateShed } from "./actions";

export const dynamic = "force-dynamic";

const SHED_TYPES = ["chick", "grower", "layer"] as const;

export default async function ShedsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; edit?: string }>;
}) {
  const { error, edit } = await searchParams;
  const sheds = await listSheds();
  const editing = edit ? sheds.find((s) => s.shed_code === edit) : undefined;

  return (
    <>
      <h1>Shed Master</h1>
      {error && <div className="error-banner">{error}</div>}

      {sheds.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Shed</th>
                <th>Type</th>
                <th>Max capacity</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sheds.map((s) => (
                <tr key={s.shed_code}>
                  <td>{s.shed_code}</td>
                  <td>{s.shed_type ?? "—"}</td>
                  <td>{s.max_capacity?.toLocaleString("en-IN") ?? "—"}</td>
                  <td style={{ whiteSpace: "normal" }}>{s.notes ?? ""}</td>
                  <td>
                    <a href={`/sheds?edit=${encodeURIComponent(s.shed_code)}`}>
                      edit
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <form
          action={updateShed.bind(null, editing.shed_code)}
          className="stack card"
        >
          <h2 style={{ margin: 0 }}>Edit {editing.shed_code}</h2>
          <div className="row2">
            <label className="field">
              <span>Type</span>
              <select name="shed_type" defaultValue={editing.shed_type ?? ""}>
                <option value="">—</option>
                {SHED_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Max capacity</span>
              <input
                type="number"
                name="max_capacity"
                min="0"
                defaultValue={editing.max_capacity ?? ""}
              />
            </label>
          </div>
          <label className="field">
            <span>Notes</span>
            <textarea name="notes" rows={2} defaultValue={editing.notes ?? ""} />
          </label>
          <div className="actions-bar" style={{ marginBottom: 0 }}>
            <button type="submit">Save</button>
            <a href="/sheds" className="btn btn-secondary">
              Cancel
            </a>
          </div>
        </form>
      ) : (
        <form action={createShed} className="stack card">
          <h2 style={{ margin: 0 }}>Add shed</h2>
          <div className="row2">
            <label className="field">
              <span>
                Shed code * <span className="hint">(e.g. Shed 4)</span>
              </span>
              <input name="shed_code" required />
            </label>
            <label className="field">
              <span>Type</span>
              <select name="shed_type" defaultValue="">
                <option value="">—</option>
                {SHED_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row2">
            <label className="field">
              <span>Max capacity</span>
              <input type="number" name="max_capacity" min="0" />
            </label>
            <label className="field">
              <span>Notes</span>
              <input name="notes" />
            </label>
          </div>
          <button type="submit">Add shed</button>
        </form>
      )}
    </>
  );
}
