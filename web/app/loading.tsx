export default function Loading() {
  return (
    <div className="card loading-card" role="status" aria-live="polite">
      <div className="loading-bar" aria-hidden="true" />
      <p style={{ margin: 0 }}><b>Loading…</b> Getting the latest figures from the farm records. This can take a few seconds on a slow connection.</p>
    </div>
  );
}
