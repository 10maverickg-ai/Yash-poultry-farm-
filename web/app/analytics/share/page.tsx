import Link from "next/link";
import { buildFarmCtx } from "@/lib/analytics/ctx";
import { loadEngineInput } from "@/lib/analytics/load";
import { quickRanges } from "@/lib/analytics/period";
import { flockOptions, rangeHref, type Param } from "@/lib/analytics/rangeParams";
import { compareHref } from "@/lib/analytics/compare";
import { readShareChoice } from "@/lib/export/analytics";
import { VIEW_LABEL } from "@/lib/export/shareOptions";
import { todayIST } from "@/lib/weather/openMeteo";
import { dmy } from "@/lib/format";
import { SharePanel } from "@/components/SharePanel";

// V18 A1b: the "Choose what to share" page. Every Analytics view links here with its own dates and flocks.
export default async function SharePage({ searchParams }: { searchParams: Promise<Record<string, Param>> }) {
  const sp = await searchParams;
  const { ctx } = buildFarmCtx(await loadEngineInput());
  if (ctx.dates.length === 0) {
    return (
      <>
        <h1>Share Analytics</h1>
        <p className="card muted">No Daily Production rows yet, so there is nothing to share.</p>
      </>
    );
  }
  const today = todayIST();
  const c = readShareChoice(ctx, sp, today);
  const CHIP: Record<string, string> = { last7: "Last 7 days", last14: "Last 14 days", last30: "Last 30 days", thismonth: "This month" };
  const chips = quickRanges(ctx, today).filter((q) => q.key in CHIP).map((q) => ({ key: q.key, label: CHIP[q.key], from: q.range.from, to: q.range.to }));
  const options = flockOptions(ctx).map((o) => ({ label: o.label, first: o.firstDate, last: o.lastDate, note: [o.registerLabel !== o.label ? `register ${o.registerLabel}` : "", o.gone ? `left after ${dmy(o.lastDate)}` : o.segment === "young" ? "young" : "main"].filter(Boolean).join(" · ") }));
  const cmp = c.compare
    ? {
        params: Object.fromEntries(new URL(compareHref(c.compare), "http://farm.local").searchParams),
        a: `${c.compare.a.flockLabel}, ${c.compare.a.range.label}`,
        b: `${c.compare.b.flockLabel}, ${c.compare.b.range.label}`,
      }
    : null;
  const back =
    c.view === "board" ? `/analytics?date=${c.range.to}`
    : c.view === "day" ? `/day?date=${c.range.from}`
    : c.view === "week" || c.view === "month" || c.view === "year" ? `/analytics?view=${c.view}&p=${c.range.from}`
    : c.view === "flock" && c.flockIds.length === 1 ? `/flocks/${c.flockIds[0]}`
    : c.compare ? compareHref(c.compare)
    : rangeHref(c.range.from, c.range.to, c.flockLabels);
  return (
    <>
      <h1>Share Analytics</h1>
      <p className="muted an-sub" style={{ marginTop: 0 }}>
        An Excel or CSV file of the numbers, for WhatsApp, mail or your files. <Link href={back}>← Back to {VIEW_LABEL[c.view]}</Link>
      </p>
      {c.notes.length > 0 && <div className="flag-banner" role="status">{c.notes.map((n, i) => <p key={i} style={{ margin: 0 }}>{n}</p>)}</div>}
      <SharePanel view={c.view} from={c.range.from} to={c.range.to} flocks={c.flockLabels} inc={c.inc} options={options} chips={chips} dataDates={ctx.dates} today={today} compare={cmp} />
    </>
  );
}
