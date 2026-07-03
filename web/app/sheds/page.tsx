import { listSheds } from "@/lib/flocks";
import { AddShedForm, EditShedForm } from "@/components/ShedForms";

export const dynamic = "force-dynamic";

export default async function ShedsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const sheds = await listSheds();
  const editing = edit ? sheds.find((s) => s.shed_code === edit) : undefined;

  return (
    <>
      <h1>Shed Master</h1>

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
        <EditShedForm
          shed={{
            shed_code: editing.shed_code,
            shed_type: editing.shed_type,
            max_capacity: editing.max_capacity,
            notes: editing.notes,
          }}
        />
      ) : (
        <AddShedForm />
      )}
    </>
  );
}
