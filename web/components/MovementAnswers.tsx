import {
  resolveMovementAsTransfer,
  resolveMovementAsAnilFarm,
  resolveMovementAsSale,
  resolveMovementAsPurchased,
  resolveMovementAsCull,
  resolveMovementAsCountAdjustment,
} from "@/app/flagged/actions";

// The one-tap answers for an open bird movement — the same six resolutions
// (and the same server actions) the "By type" view has always offered, in one
// place so both views stay identical. Sold/Culled only render for an outflow,
// Purchased only for an inflow (the actions enforce this again server-side).
export function MovementAnswers({
  id,
  birdsChange,
  others,
}: {
  id: number;
  birdsChange: number;
  others: { id: string; label: string }[];
}) {
  const isOutflow = birdsChange < 0;
  return (
    <div className="actions-bar" style={{ flexWrap: "wrap", marginBottom: 0 }}>
      <form action={resolveMovementAsTransfer.bind(null, id)} className="actions-bar" style={{ marginBottom: 0 }}>
        <select name="counterpartFlockId" required defaultValue="" aria-label="Which flock">
          <option value="" disabled>
            Moved to/from…
          </option>
          {others.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn">
          Another flock
        </button>
      </form>

      <form action={resolveMovementAsAnilFarm.bind(null, id)}>
        <button type="submit" className="btn">
          Anil farm
        </button>
      </form>

      {isOutflow ? (
        <>
          <form action={resolveMovementAsSale.bind(null, id)} className="actions-bar" style={{ marginBottom: 0 }}>
            <input
              type="number"
              name="pricePerBird"
              placeholder="₹ per bird"
              min="0"
              step="0.01"
              aria-label="Price per bird"
              style={{ width: "9rem" }}
            />
            <button type="submit" className="btn">
              Sold
            </button>
          </form>
          <form action={resolveMovementAsCull.bind(null, id)}>
            <button type="submit" className="btn">
              Culled
            </button>
          </form>
        </>
      ) : (
        <form action={resolveMovementAsPurchased.bind(null, id)}>
          <button type="submit" className="btn">
            Purchased
          </button>
        </form>
      )}

      <form action={resolveMovementAsCountAdjustment.bind(null, id)}>
        <button type="submit" className="btn-secondary">
          Count is correct, nothing moved
        </button>
      </form>
    </div>
  );
}
