// Builds an EngineInput from a directory of exported JSON (live-table dumps).
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync, existsSync } from "node:fs";
import type { EngineInput } from "../lib/analytics/engine.ts";

export function loadInput(dir: string): EngineInput {
  const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
  const num = (x: unknown) => (x == null ? null : Number(x));
  const junction: { feed_bag_stock_id: number; flock_internal_id: string }[] = j("junction");
  return {
    flocks: j("flocks").map((f: any) => ({
      id: f.flock_internal_id,
      label: f.display_label,
      breed: f.breed,
      placementDate: f.placement_date,
      placementConfirmed: f.placement_date_confirmed === true,
      segment: f.segment ?? null,
      placementIsChickDate: f.placement_is_chick_date === true,
    })),
    prod: j("dp").map((r: any) => ({
      id: r.id,
      date: r.date,
      flockId: r.flock_internal_id,
      label: r.lbl,
      mort: num(r.mortality),
      feed: num(r.feed_bags),
      eggs: num(r.eggs_total),
      pop: num(r.bird_population),
      hd: num(r.hd_percent),
      flagged: r.flagged,
      reviewed: r.reviewed_by_owner,
      // owner-confirmed never-flag rows (V5 section 3): Sep 8/9 feed cells, Sep 15 BAB-3 eggs
      neverFlag: !!r.flagged && (r.date === "2026-09-08" || r.date === "2026-09-09" || r.id === 727),
    })),
    movements: j("movements").map((m: any) => ({
      id: m.id,
      date: m.date,
      flockId: m.flock_internal_id,
      change: m.birds_change,
      type: m.movement_type,
      needsReview: m.needs_review,
      reviewed: m.reviewed_by_owner,
    })),
    egg: j("egg").map((e: any) => ({
      id: e.id,
      date: e.date,
      section: e.section,
      produced: num(e.tp),
      opening: num(e.ob),
      closing: num(e.cb),
      reviewed: e.reviewed_by_owner,
    })),
    feedBoxes: j("feedbox").map((b: any) => ({
      id: b.id,
      date: b.date,
      group: b.g,
      opening: num(b.ob),
      produced: num(b.prod),
      consumed: num(b.cons),
      closing: num(b.cb),
      reviewed: b.reviewed_by_owner,
      flockIds: junction.filter((x) => x.feed_bag_stock_id === b.id).map((x) => x.flock_internal_id),
    })),
    farmfreshDates: j("farmfresh"),
    farmfreshBySection: existsSync(`${dir}/farmfresh_sec.json`) ? j("farmfresh_sec") : undefined,
    moulting: existsSync(`${dir}/moulting.json`) ? j("moulting").map((m: any) => ({ flockId: m.flock_internal_id, start: m.start_date, end: m.end_date, confirmed: m.confirmed_by_owner })) : [],
    chick: j("chick").map((c: any) => ({ date: c.date, deaths: Number(c.d) })),
    std: j("bv").map((b: any) => ({ age: b.age_weeks, hdp: Number(b.std_hdp_percent), feedG: num(b.feed_per_day_g), cumDepl: num(b.cumulative_depletion_percent) })),
    realisticOverrides: existsSync(`${dir}/overrides.json`) ? j("overrides").map((o: any) => ({ group: o.grp, metric: o.metric, bandStart: o.band_start, ratioPct: Number(o.ratio_pct), note: o.note ?? null })) : [],
    };
}
