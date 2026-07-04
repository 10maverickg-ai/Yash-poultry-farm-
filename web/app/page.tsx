import Link from "next/link";

export default function Home() {
  return (
    <>
      <h1>Registers</h1>
      <div className="home-menu">
        <Link href="/flocks" className="card">
          <h3>Flock Register</h3>
          <p className="muted">
            Flocks, labels &amp; renumbering, stage transitions, depletion
          </p>
        </Link>
        <Link href="/sheds" className="card">
          <h3>Shed Master</h3>
          <p className="muted">Physical sheds and capacities</p>
        </Link>
        <Link href="/production" className="card">
          <h3>Daily Production</h3>
          <p className="muted">
            Per flock, per day: Mort / Feed / Total / Bal Bird / %
          </p>
        </Link>
        <div className="card disabled">
          <h3>Egg Stock Ledger &amp; Sales</h3>
          <p className="muted">Coming in increment 3</p>
        </div>
        <div className="card disabled">
          <h3>Feed Stock &amp; Formulation</h3>
          <p className="muted">Coming in increment 4</p>
        </div>
      </div>
    </>
  );
}
