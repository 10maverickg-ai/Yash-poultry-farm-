import { TargetLines } from "@/components/TargetLines";
import { after } from "next/server";
import { refreshWeatherQuietly } from "@/lib/weather/store";
import { buildFarmCtx } from "@/lib/analytics/ctx";
import Link from "next/link";
import { loadEngineInput } from "@/lib/analytics/load";
import { addDays, flockCards, lastDayOfData, SEGMENTS, SEGMENT_NAME } from "@/lib/analytics/engine";
import { loadPeriodExtras } from "@/lib/analytics/periodLoad";
import { allSegmentPanels, farmCheck } from "@/lib/analytics/segments";
import { buildToday, type TodayItem } from "@/lib/analytics/today";
import { chip } from "@/lib/analytics/chips";
import { FarmLine, SegmentPanelView } from "@/components/SegmentPanels";
import { DataStamp } from "@/components/DataStamp";
import { loadCostInput } from "@/lib/costs/load";
import { dayEconomics } from "@/lib/costs/engine";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { dmy, inr, n0, n1 } from "@/lib/format";

export const dynamic = "force-dynamic";

function Item({ it, tone, icon }: { it: TodayItem; tone: "right" | "wrong" | "soon"; icon: string }) {
  return (
    <Link href={it.href} className={`card td-item td-${tone}`}>
      <p className="td-item-title"><span className="td-icon" aria-hidden="true">{icon}</span>{it.title}{it.group !== "farm" && <span className="td-group-tag">{it.group === "main" ? "Main" : "Young"}</span>}</p>
      {it.detail && <p className="td-item-detail">{it.detail}</p>}
      {it.action && <p className="td-item-action"><b>What to do:</b> {it.action}</p>}
    </Link>
  );
}

function Part({ tone, title, icon, intro, items, show }: { tone: "right" | "wrong" | "soon"; title: string; icon: string; intro: string; items: TodayItem[]; show: number }) {
  return (
    <section aria-labelledby={`td-${tone}`}>
      <h2 id={`td-${tone}`} className="td-part">
        <span className={`td-hicon td-hicon-${tone}`} aria-hidden="true">{icon}</span> {title} <span className="td-count">{items.length}</span>
      </h2>
      <p className="muted an-sub td-empty">{intro}</p>
      {items.length === 0 && <p className="card muted">{tone === "wrong" ? "Nothing is wrong right now." : tone === "soon" ? "Nothing to watch." : "Nothing to report."}</p>}
      {items.slice(0, show).map((it) => <Item key={it.id} it={it} tone={tone} icon={icon} />)}
      {items.length > show && (
        <details className="td-more">
          <summary>Show the other {items.length - show}</summary>
          {items.slice(show).map((it) => <Item key={it.id} it={it} tone={tone} icon={icon} />)}
        </details>
      )}
    </section>
  );
}

export default async function TodayPage() {
  const realToday = new Date().toISOString().slice(0, 10);
  const realYesterday = addDays(realToday, -1);
  // one wave of parallel reads
  const [input, costInput, extras, photoQ, queueQ, rateQ] = await Promise.all([
    loadEngineInput(),
    loadCostInput(),
    loadPeriodExtras(),
    pool.query(`SELECT count(*)::int AS n FROM daily_production WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`, [ACTIVE_FARM, realYesterday]),
    pool.query(`SELECT count(*)::int AS n FROM upload_queue WHERE farm_code = $1 AND entered_date = $2 AND status IN ('waiting','reading','saved','needs_review')`, [ACTIVE_FARM, realYesterday]),
    pool.query(`SELECT count(*)::int AS n FROM daily_egg_rates WHERE date = $1`, [realYesterday]),
  ]);
  const { ctx } = buildFarmCtx(input);
  after(() => refreshWeatherQuietly()); // after the page is sent: the page never waits for the weather service
  if (ctx.dates.length === 0)
    return (
      <>
        <h1>Today</h1>
        <p className="card muted">No days have been entered yet. <Link href="/upload">Upload the first register photo</Link>.</p>
      </>
    );

  const latest = lastDayOfData(ctx);
  const panels = allSegmentPanels(ctx, extras, latest);
  const chk = farmCheck(ctx, latest);
  const cards = flockCards(ctx, latest).filter((c) => c.status !== "left");
  const money = dayEconomics(costInput, latest);

  // what is missing: only facts that can be checked from the database
  const missing: { text: string; href: string; cta: string }[] = [];
  if (photoQ.rows[0].n === 0 && queueQ.rows[0].n === 0) missing.push({ text: `No register photo has been uploaded for ${dmy(realYesterday)}.`, href: "/upload", cta: "Upload the photos" });
  else if (photoQ.rows[0].n === 0) missing.push({ text: `The photos for ${dmy(realYesterday)} are uploaded but not saved yet.`, href: "/upload", cta: "Open the upload queue" });
  if (rateQ.rows[0].n === 0) missing.push({ text: `No egg rate has been entered for ${dmy(realYesterday)}.`, href: "/sales/rates", cta: "Enter the rate" });
  if (money.unpricedEggsSold > 0) missing.push({ text: `${n0(money.unpricedEggsSold)} eggs sold on ${dmy(latest)} have no rate, so the money for that day is left out.`, href: "/sales/rates", cta: "Enter the rate" });
  if (money.missing.length) missing.push({ text: `The cost is incomplete, so profit is not final: ${money.missing.join(", ")} not entered.`, href: "/purchases", cta: "Open Costs and fill them in" });

  const t = buildToday(ctx, extras, costInput, latest, missing);

  return (
    <>
      <h1>Today</h1>
      <DataStamp latest={latest} today={realToday} />
      <p className="muted an-sub">
        <Link href="/changes">What changed in the app →</Link><br />
        HD % means <b>eggs per 100 birds</b>. The <b>breeder&apos;s target</b> is the book (perfect conditions). <b>Our realistic target</b> is what this farm&apos;s own good weeks show a flock of this age can lay. <Link href="/analytics/targets">How is this learned? →</Link>
      </p>
      <p className="actions-bar">
        <Link href="/analytics?view=week" className="btn btn-secondary">This week</Link>
        <Link href="/analytics?view=month" className="btn btn-secondary">This month</Link>
        <Link href="/analytics?view=year" className="btn btn-secondary">This year</Link>
      </p>

      <Part tone="right" icon="✔" title="What is right" intro="Things that are going well." items={t.right} show={4} />
      <Part tone="wrong" icon="✖" title="What is wrong now" intro="Act on these today. Tap one for the details." items={t.wrong} show={50} />
      <Part tone="soon" icon="⚠" title="What may go wrong soon" intro="Not a problem yet, but the numbers are heading the wrong way." items={t.soon} show={5} />

      <h2 className="td-part">The two groups</h2>
      <div className="seg-pair">
        {panels.map((p) => (
          <SegmentPanelView key={p.segment} p={p} detailHref={`/analytics?date=${latest}#alerts`} />
        ))}
      </div>
      <FarmLine panels={panels} eggs={chk.all?.eggs ?? 0} birds={chk.all?.birds ?? 0} hd={chk.all?.hd ?? null} unassigned={chk.unassigned} ok={chk.ok} />

      <section className="card" aria-labelledby="td-flocks">
        <h2 id="td-flocks" style={{ marginTop: 0 }}>Each flock</h2>
        {[...SEGMENTS, null].map((g) => {
          const list = cards.filter((c) => c.segment === g);
          if (list.length === 0) return null;
          return (
            <div key={g ?? "none"}>
              <h3 className="an-daystamp">{g ? SEGMENT_NAME[g] : "Group not set"}</h3>
              {list.map((c) => {
                const row = (ctx.byFlock.get(c.flockId) ?? []).find((r) => r.date === latest);
                const ch = chip(c);
                return (
                  <Link key={c.flockId} href={`/flocks/${c.flockId}`} className="td-flock td-flock-link">
                    <span className={`an-pill an-pill-${ch.css}`}><span aria-hidden="true">{ch.icon}</span> {ch.label}</span>
                    <div>
                      <b>{c.label}</b>{" "}
                      <span className="muted">
                        {row ? `${n0(row.eggs ?? 0)} eggs · ${row.hd != null ? n1(row.hd) : "–"} per 100 birds` : "no row that day"}
                      </span>
                      <TargetLines c={c} compact />
                      <div className="muted an-tiny">{c.statusNote}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </section>

      <section className="card" aria-labelledby="td-cash">
        <h2 id="td-cash" style={{ marginTop: 0 }}>Cash on {dmy(latest)} <span className="badge badge-flagged">estimate</span></h2>
        <div className="an-grid">
          <div className="an-metric"><div className="an-metric-title">Eggs sold for</div><div className="an-metric-value">{money.revenue ? inr(money.revenue) : "—"}</div><div className="an-metric-cmp">{n0(money.eggsSold)} eggs sold</div></div>
          <div className="an-metric"><div className="an-metric-title">Cost so far{money.missing.length ? " (incomplete)" : ""}</div><div className="an-metric-value">{inr(money.cost.total)}</div></div>
        </div>
        <p className="muted an-foot"><Link href="/purchases">Open Costs →</Link></p>
      </section>
    </>
  );
}
