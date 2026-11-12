import Link from "next/link";
import { buildFarmCtx } from "@/lib/analytics/ctx";
import { loadEngineInput } from "@/lib/analytics/load";
import { loadPeriodExtras } from "@/lib/analytics/periodLoad";
import { lastDayOfData } from "@/lib/analytics/engine";
import { loadCostInput } from "@/lib/costs/load";
import { todayIST } from "@/lib/weather/openMeteo";
import { CompareView } from "@/components/CompareView";
import { DataStamp } from "@/components/DataStamp";
import type { Param } from "@/lib/analytics/rangeParams";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare flocks" };

// Read-only. ?a=BAB-3&af=2026-09-01&at=2026-09-15&b=BAB-5&bf=2026-10-01&bt=2026-10-15&age=0
export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, Param>> }) {
  const sp = await searchParams;
  const [input, cost, extras] = await Promise.all([loadEngineInput(), loadCostInput(), loadPeriodExtras()]);
  const { ctx } = buildFarmCtx(input);
  return (
    <>
      <h1>Compare flocks</h1>
      <p className="muted an-sub" style={{ marginTop: 0 }}>
        Two columns, each with its own flock (or all flocks) and its own dates. <Link href="/analytics">← Back to Analytics</Link>
      </p>
      {ctx.dates.length === 0 ? (
        <p className="card muted">No Daily Production rows yet.</p>
      ) : (
        <>
          <DataStamp latest={lastDayOfData(ctx)} today={new Date().toISOString().slice(0, 10)} />
          <CompareView input={input} cost={cost} extras={extras} sp={sp} today={todayIST()} />
        </>
      )}
    </>
  );
}
