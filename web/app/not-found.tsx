import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>Page not found</h1>
      <p>That page does not exist or has moved.</p>
      <p><Link href="/today" className="btn">Go to Today</Link></p>
    </div>
  );
}
