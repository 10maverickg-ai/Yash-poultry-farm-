"use client";

import Link from "next/link";

// A failed request never shows a blank page or a raw error: a plain sentence and a Try again button.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card error-card" role="alert">
      <h1 style={{ marginTop: 0 }}>This page could not load</h1>
      <p>The farm records did not answer (usually a slow or dropped connection). Nothing has been lost or changed.</p>
      <div className="actions-bar" style={{ marginBottom: 0 }}>
        <button type="button" onClick={() => reset()}>Try again</button>
        <Link href="/today" className="btn btn-secondary">Go to Today</Link>
      </div>
      {error.digest && <p className="muted an-tiny">Reference for support: {error.digest}</p>}
    </div>
  );
}
