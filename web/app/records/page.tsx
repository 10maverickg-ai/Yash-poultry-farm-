import Link from "next/link";
import {
  listEggStockRecords,
  listFeedStockRecords,
  listProductionRecords,
} from "@/lib/records";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "production", label: "Daily Production" },
  { key: "egg-stock", label: "Egg Stock" },
  { key: "feed", label: "Feed Stock" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function FlagCell({
  flagged,
  reviewed,
}: {
  flagged: boolean;
  reviewed: boolean;
}) {
  if (!flagged) return <td>—</td>;
  return (
    <td>
      <span className="badge badge-flagged">flagged</span>
      {reviewed && <span className="muted"> reviewed</span>}
    </td>
  );
}

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.table)?.key ??
    "production") as TabKey;

  return (
    <>
      <h1>Records</h1>
      <p className="muted">
        Read-only view of what&apos;s been entered, most recent first. Open a
        date on its entry screen to correct anything.
      </p>
      <div className="actions-bar">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/records?table=${t.key}`}
            className={`btn ${tab === t.key ? "" : "btn-secondary"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "production" && <ProductionTable />}
      {tab === "egg-stock" && <EggStockTable />}
      {tab === "feed" && <FeedTable />}
    </>
  );
}

async function ProductionTable() {
  const rows = await listProductionRecords();
  if (rows.length === 0)
    return <p className="card muted">No production entries yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Flock</th>
            <th>Shed</th>
            <th>Mort</th>
            <th>Feed</th>
            <th>Eggs</th>
            <th>Bal Bird</th>
            <th>HD%</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/production?date=${r.date}`}>{r.date}</Link>
              </td>
              <td>{r.display_label_as_written ?? "—"}</td>
              <td>{r.shed_code ?? "—"}</td>
              <td>{r.mortality ?? "—"}</td>
              <td>{r.feed_bags ?? "—"}</td>
              <td>{r.eggs_total?.toLocaleString("en-IN") ?? "—"}</td>
              <td>{r.bird_population?.toLocaleString("en-IN") ?? "—"}</td>
              <td>{r.hd_percent ?? "—"}</td>
              <FlagCell flagged={r.flagged} reviewed={r.reviewed_by_owner} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function EggStockTable() {
  const rows = await listEggStockRecords();
  if (rows.length === 0)
    return <p className="card muted">No egg stock entries yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Total</th>
            <th>13</th>
            <th>14</th>
            <th>15</th>
            <th>15+</th>
            <th>Lines</th>
            <th>Closing</th>
            <th>Trays</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/egg-stock?date=${r.date}`}>{r.date}</Link>
              </td>
              <td>{r.total_eggs_produced?.toLocaleString("en-IN") ?? "—"}</td>
              <td>{r.grade_13_eggs ?? "—"}</td>
              <td>{r.grade_14_eggs ?? "—"}</td>
              <td>{r.grade_15_eggs ?? "—"}</td>
              <td>{r.grade_15plus_eggs ?? "—"}</td>
              <td>{r.entry_count}</td>
              <td>{r.closing_balance_eggs?.toLocaleString("en-IN") ?? "—"}</td>
              <td>{r.closing_balance_trays ?? "—"}</td>
              <FlagCell flagged={r.flagged} reviewed={r.reviewed_by_owner} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function FeedTable() {
  const rows = await listFeedStockRecords();
  if (rows.length === 0)
    return <p className="card muted">No feed stock entries yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Material</th>
            <th>Opening kg</th>
            <th>Purchase kg</th>
            <th>Consumed kg</th>
            <th>Closing kg</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/feed-stock?date=${r.date}`}>{r.date}</Link>
              </td>
              <td>{r.material_name}</td>
              <td>{r.opening_balance_kg ?? "—"}</td>
              <td>{r.purchase_kg ?? "—"}</td>
              <td>{r.consumed_kg ?? "—"}</td>
              <td>{r.closing_balance_kg ?? "—"}</td>
              <FlagCell flagged={r.flagged} reviewed={r.reviewed_by_owner} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
