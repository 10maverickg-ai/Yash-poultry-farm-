import { CHANGES } from "@/lib/changes";
import { dmy } from "@/lib/format";

export default function ChangesPage() {
  return (
    <>
      <h1>What changed</h1>
      <p className="muted an-sub">The latest changes to the app, in plain words. Newest first.</p>
      {CHANGES.map((c, i) => (
        <section key={i} className="card">
          <p className="muted an-tiny" style={{ margin: 0 }}>{dmy(c.date)}</p>
          <h2 style={{ marginTop: "0.1rem" }}>{c.title}</h2>
          <ul className="an-list">{c.points.map((p, j) => <li key={j}>{p}</li>)}</ul>
        </section>
      ))}
    </>
  );
}
