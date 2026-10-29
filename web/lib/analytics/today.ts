// The Today screen in three plain parts (V9 J8): what is right, what is wrong now, what may go wrong soon.
// Every item says one plain sentence, the numbers behind it, what to do (for the wrong ones) and where to tap.
import { slipItems } from "./realistic";
import { forecastAlerts } from "./heat";
import { todayIST } from "@/lib/weather/openMeteo";
import {
  flockCards,
  SEGMENT_NAME,
  watchList,
  type AlertKind,
  type Ctx,
  type FlockCard,
  type FlockHealth,
  flockHealth,
  type Segment,
} from "./engine";
import { allSegmentPanels } from "./segments";
import type { PeriodExtras } from "./period";
import { dayEconomics, type CostInput } from "../costs/engine";
import { n0, n1, n2, inr } from "../format";

export interface TodayItem {
  id: string;
  title: string; // one plain sentence
  detail?: string; // the numbers behind it
  action?: string; // what to do (wrong items)
  href: string;
  group: Segment | "farm";
}
export interface TodaySummary {
  right: TodayItem[];
  wrong: TodayItem[];
  soon: TodayItem[];
}

const ACTION: Record<AlertKind, string> = {
  production_drop: "Check this flock's feed, water, lights and health today, and look at the day's register photo.",
  high_mortality: "Walk the shed, look for sick or crowded birds, and call the vet if deaths continue tomorrow.",
  low_feed_stock: "Order or collect feed today.",
  egg_buildup: "Arrange an egg pick-up or sale.",
  bird_count_anomaly: "Check the bird count and whether a sale or move was not written down.",
  feed_anomaly: "Check the feed figure written for this day.",
  missing_day: "Enter the missing figures for that day.",
  flock_health: "Call the vet today. Walk the shed: look at the dead birds, drinkers and water, feed and shed temperature, and separate any sick birds.",
};
const KIND_TITLE: Record<AlertKind, string> = {
  production_drop: "is laying fewer eggs than usual",
  high_mortality: "had more deaths than usual",
  low_feed_stock: "Feed stock is very low",
  egg_buildup: "Eggs are piling up unsold",
  bird_count_anomaly: "Bird count changed with no record",
  feed_anomaly: "Feed figure looks wrong",
  missing_day: "Figures are missing",
  flock_health: "may be sick: more deaths than usual and fewer eggs",
};

const flockHref = (c: Pick<FlockCard, "flockId">) => `/flocks/${c.flockId}`;
const per100 = (hd: number | null) => (hd == null ? "–" : n1(hd));

export function buildToday(
  ctx: Ctx,
  extras: PeriodExtras,
  cost: CostInput,
  asOf: string,
  missing: { text: string; href: string; cta: string }[],
  todayDate: string = todayIST()
): TodaySummary {
  const right: TodayItem[] = [];
  const wrong: TodayItem[] = [];
  const soon: TodayItem[] = [];
  const panels = allSegmentPanels(ctx, extras, asOf);
  const cards = flockCards(ctx, asOf).filter((c) => c.status !== "left");
  const money = dayEconomics(cost, asOf);

  for (const p of panels) {
    if (!p.hasData) continue;
    const g = p.segment;
    const name = SEGMENT_NAME[g];
    const mine = cards.filter((c) => c.segment === g);
    const onTarget = mine.filter((c) => c.status === "green");
    // ---- right
    if (p.hd7 != null) {
      right.push({
        id: `hd-${g}`,
        title: `${name}: ${per100(p.hd7)} eggs per 100 birds over the last 7 days.`,
        detail: `${n0(p.today?.eggs)} eggs today from ${n0(p.today?.birds)} birds.${p.hdPrev7 != null ? ` The 7 days before: ${per100(p.hdPrev7)}.` : ""}`,
        href: `/analytics?date=${asOf}`,
        group: g,
      });
    }
    if (onTarget.length > 0) {
      right.push({
        id: `green-${g}`,
        title: `${onTarget.length} of ${mine.length} ${g === "main" ? "main" : "young"} flocks are meeting our realistic target for their age.`,
        detail: onTarget.map((c) => c.label).join(", "),
        href: `/analytics?date=${asOf}#flocks`,
        group: g,
      });
    }
    if (p.mortPct7 != null && p.mortPct7 < 0.5) {
      right.push({ id: `mort-${g}`, title: `Deaths are low in the ${g === "main" ? "main" : "young"} flocks.`, detail: `${n1(p.deathsPerDay7)} deaths a day; ${p.mortPct7.toFixed(2)}% of the birds in 7 days.`, href: `/analytics?date=${asOf}`, group: g });
    }
    if (p.alerts.length === 0) right.push({ id: `noalert-${g}`, title: `No alerts for the ${g === "main" ? "main" : "young"} flocks today.`, href: `/analytics?date=${asOf}#alerts`, group: g });
    if (p.stock && p.stock.days <= 4) right.push({ id: `stock-${g}`, title: `${g === "main" ? "Big" : "Small"} egg stock is ${n1(p.stock.days)} days of laying — eggs are moving.`, detail: `${n0(p.stock.closing)} eggs in the ledger.`, href: `/egg-stock?date=${asOf}`, group: g });
    if (g === "main" && p.feed.daysLeft != null && p.feed.daysLeft >= 1) right.push({ id: "feed-ok", title: `Feed stock is ${n1(p.feed.daysLeft)} days.`, detail: "The mill delivers every day, so about 1 day in stock is normal.", href: "/feed-bag-stock", group: g });

    // ---- wrong now
    // flock health (V12): deaths above usual 2 days running AND eggs falling more than 5% in a week. Shown while it lasts (one item per
    // flock; three or more flocks are grouped into one), and instead of the separate "more deaths" lines for the same flock.
    const sick = mine.map((c) => ({ c, h: flockHealth(ctx, c.flockId, asOf) })).filter((x): x is { c: FlockCard; h: FlockHealth } => x.h != null);
    if (sick.length >= 3) {
      wrong.push({
        id: `health-${g}`,
        title: `${sick.length} ${g === "main" ? "main" : "young"} flocks have more deaths than usual and fewer eggs: ${sick.map((x) => x.c.label).join(", ")}.`,
        detail: sick.map((x) => x.h.text).join(" "),
        action: sick[0].h.action,
        href: "/analytics#flocks",
        group: g,
      });
    } else {
      for (const x of sick) wrong.push({ id: `health-${x.c.flockId}`, title: `${x.c.label} may be sick: more deaths than usual and fewer eggs.`, detail: x.h.text, action: x.h.action, href: flockHref(x.c), group: g });
    }
    const sickIds = new Set(sick.map((x) => x.c.flockId));
    for (const a of p.alerts) {
      if (a.kind === "flock_health") continue; // shown above from today's state, not once per episode
      const flock = a.flockLabel;
      wrong.push({
        id: a.key,
        title: flock ? `${flock} ${KIND_TITLE[a.kind]}.` : `${KIND_TITLE[a.kind]}.`,
        detail: a.reason,
        action: ACTION[a.kind],
        href: a.flockId ? `/day?date=${a.date}` : a.kind === "egg_buildup" ? `/egg-stock?date=${a.date}` : `/analytics?date=${a.date}#alerts`,
        group: g,
      });
    }
    for (const c of mine.filter((x) => x.status === "red")) {
      wrong.push({
        id: `red-${c.flockId}`,
        title: `${c.label} is laying far below our realistic target for its age.`,
        detail: c.statusNote,
        action: "Check feed, water, health and lights; compare with the day's register photo.",
        href: flockHref(c),
        group: g,
      });
    }
    // ---- soon
    for (const w of watchList(ctx, asOf, g)) {
      if (w.kind === "feed_days") continue; // shown once below
      soon.push({
        id: `watch-${g}-${w.kind}-${w.flockId}`,
        title: w.kind === "trending_below" ? `${w.label} is slipping further below its target.` : `${w.label}'s deaths per day are creeping up.`,
        detail: w.text,
        href: w.flockId ? `/flocks/${w.flockId}` : `/analytics?date=${asOf}`,
        group: g,
      });
    }
    // deaths this week, judged against OUR usual level (V11); the heat sentence explains, it never changes the colour
    for (const c of mine) {
      const d = c.death;
      if (!d || d.weekPct == null || (d.status !== "red" && d.status !== "amber") || sickIds.has(c.flockId)) continue;
      const item: TodayItem = {
        id: `deaths-${d.status}-${c.flockId}`,
        title: `${c.label}: ${d.status === "red" ? "many more birds are dying than usual" : "a few more birds are dying than usual"} (${n2(d.weekPct)}% this week).`,
        detail: `${d.usual != null ? `Our usual is ${n2(d.usual)}% a week (${d.seasonLabel}); ` : `Our usual is not learned yet, so the starting limits apply (amber ${n2(d.amber)}%, red ${n2(d.red)}%); `}the breeder's book says ${d.bookPct != null ? n2(d.bookPct) + "%" : "–"}.${c.heatNote ? ` ${c.heatNote[0].toUpperCase()}${c.heatNote.slice(1)}.` : ""}`,
        href: flockHref(c),
        group: g,
      };
      if (d.status === "red") wrong.push({ ...item, action: "Look at the dead birds, water, feed and shed temperature today; call the vet if it continues." });
      else soon.push(item);
    }
    for (const sl of slipItems(ctx).filter((x) => x.group === g)) soon.push({ id: sl.id, title: sl.title, detail: sl.detail, href: "/analytics/targets", group: g });
    for (const c of mine.filter((x) => x.status === "amber")) {
      soon.push({ id: `amber-${c.flockId}`, title: `${c.label} is a little below our realistic target.`, detail: c.statusNote, href: flockHref(c), group: g });
    }
    if (p.stock && p.stock.days > 4) {
      soon.push({ id: `stock-high-${g}`, title: `${g === "main" ? "Big" : "Small"} eggs are building up: ${n1(p.stock.days)} days of laying in stock.`, detail: `${n0(p.stock.closing)} eggs. Sell or collect soon.`, href: `/egg-stock?date=${asOf}`, group: g });
    }
    if (g === "main" && p.feed.daysLeft != null && p.feed.daysLeft < 1) {
      soon.push({ id: "feed-low", title: `Feed will run out in about ${n1(p.feed.daysLeft)} days without a delivery.`, detail: `${n0(p.feed.bagsPerDay7)} bags a day are used.`, href: "/feed-bag-stock", group: g });
    }
  }

  // ---- farm-wide: data gaps are wrong now; unpriced sales and unentered costs are things to fix soon
  for (const m of missing) {
    const isGap = /photo|rate/i.test(m.text);
    (isGap ? wrong : soon).push({ id: `missing-${m.text.slice(0, 24)}`, title: m.text, action: m.cta + ".", href: m.href, group: "farm" });
  }
  if (money.revenue > 0 && money.costPerEgg != null && money.revenuePerEgg != null && money.revenuePerEgg < money.costPerEgg) {
    soon.push({
      id: "rev-vs-cost",
      title: `On the day, each egg sold earned less (₹${n2(money.revenuePerEgg)}) than it cost to produce (₹${n2(money.costPerEgg)}).`,
      detail: `Cost is incomplete (${money.missing.join(", ") || "all inputs entered"}), so the real cost per egg is higher.`,
      href: "/purchases",
      group: "farm",
    });
  }
  // 3-day weather forecast (V11): very hot or very cold days coming
  for (const f of forecastAlerts(ctx.input.weather ?? [], todayDate)) soon.unshift({ id: f.id, title: f.title, detail: f.detail, href: "/analytics/reference", group: "farm" });
  if (money.missing.length === 0 && money.revenue > 0) right.push({ id: "cash", title: `Cash for the day: ${inr(money.revenue)} from eggs sold; estimated cost ${inr(money.cost.total)}.`, href: "/purchases", group: "farm" });
  if (extras.sales.length && money.unpricedEggsSold === 0) right.push({ id: "priced", title: "Every egg sold is priced.", href: "/sales", group: "farm" });
  return { right, wrong, soon };
}
