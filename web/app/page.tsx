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
        <Link href="/chick-batches" className="card">
          <h3>Chick Batch Log</h3>
          <p className="muted">Un-numbered chick/grower batches, held until BAB-numbered</p>
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
        <Link href="/feed-bag-stock" className="card">
          <h3>Feed Bag Stock</h3>
          <p className="muted">
            Bag counts by flock group: opening / produced / consumed / mill / shed
          </p>
        </Link>
        <Link href="/formulation" className="card">
          <h3>Feed Formulation</h3>
          <p className="muted">Versioned recipes by flock group</p>
        </Link>
        <Link href="/records" className="card">
          <h3>Records</h3>
          <p className="muted">Read-only view of everything entered</p>
        </Link>
        <Link href="/flagged" className="card">
          <h3>Flagged records</h3>
          <p className="muted">
            Validation flags awaiting a fix or your review
          </p>
        </Link>
      </div>
    </>
  );
}
