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
        <Link href="/egg-stock" className="card">
          <h3>Egg Stock Ledger</h3>
          <p className="muted">
            Day total, grading, +/- ledger lines, closing balance
          </p>
        </Link>
        <Link href="/sales" className="card">
          <h3>Sales</h3>
          <p className="muted">
            Generated from sale ledger lines; type, grade &amp; optional price
          </p>
        </Link>
        <Link href="/feed-stock" className="card">
          <h3>Feed Stock</h3>
          <p className="muted">
            Mill-level per material: opening / purchase / consumed / closing
          </p>
        </Link>
        <Link href="/formulation" className="card">
          <h3>Feed Formulation</h3>
          <p className="muted">Versioned recipes by flock group</p>
        </Link>
      </div>
    </>
  );
}
