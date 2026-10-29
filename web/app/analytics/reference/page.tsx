import Link from "next/link";
import { after } from "next/server";
import { loadEngineInput } from "@/lib/analytics/load";
import { buildFarmCtx } from "@/lib/analytics/ctx";
import { REALISTIC_CONFIG as C, SEASON_NAME, SEASONS } from "@/lib/analytics/realistic";
import { SEGMENT_NAME } from "@/lib/analytics/engine";
import type { RealisticBand } from "@/lib/analytics/realisticTypes";
import { FARM_LAT, FARM_LON } from "@/lib/weather/openMeteo";
import { refreshWeatherQuietly } from "@/lib/weather/store";
import { n0, n1, n2, dmy } from "@/lib/format";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SEASON_WHY: Record<string, string> = {
  HOT: "dry heat, up to 45 °C",
  MONSOON: "hot and humid",
  COOL: "the comfortable months",
  COLD: "fog, down to 2–5 °C",
  SPRING: "warming up, mild",
};

export const metadata = { title: "Farm reference" };

export default async function ReferencePage() {
  const input = await loadEngineInput();
  const { ctx, model } = buildFarmCtx(input);
  after(() => refreshWeatherQuietly());
  const w = input.weather ?? [];
  const seasonMonths = SEASONS.map((s) => ({ s, months: MONTHS.filter((_, i) => C.seasonByMonth[i + 1] === s) }));
  const learned = (m: "hd" | "mortality") => model.bands.filter((b) => b.metric === m && (m === "mortality" ? b.learnedRate != null : b.learnedRatio != null));
  const seasonName = (s: string) => (s === "all" ? "All seasons" : SEASON_NAME[s as keyof typeof SEASON_NAME]);
  const limits = (b: RealisticBand) => {
    const st = C.deathStart[C.deathClass[b.season === "all" ? "MONSOON" : b.season]];
    const amber = Math.min(b.rate! * C.deathAmberMultiple, st.red);
    return { amber, red: Math.max(Math.min(b.rate! * C.deathRedMultiple, st.red * C.deathRedCapMultiple), amber * 1.2) };
  };
  const firstW = w[0]?.date, lastW = w[w.length - 1]?.date;

  return (
    <>
      <h1>Farm reference</h1>
      <p className="muted"><Link href="/analytics">← Analytics</Link> · data up to {dmy(ctx.dates[ctx.dates.length - 1])}</p>
      <div className="flag-banner">
        <b>These are this farm&apos;s own working targets, not published standards; confirm them with your vet.</b> The farm is 25 years old, with cage batteries, in Mohali / Dandrala, Punjab. The breeder&apos;s book (BV300) assumes a modern controlled-environment house, so deaths are judged against what this farm and this climate actually do. <Link href="/analytics/targets">How is this learned? →</Link>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>1. Seasons (Punjab)</h2>
        <div className="tl-scroll">
          <table className="tl-table">
            <thead><tr><th>Season</th><th>Months</th><th>What it is like</th></tr></thead>
            <tbody>
              {seasonMonths.map(({ s, months }) => (
                <tr key={s}><td><b>{SEASON_NAME[s].split(" ")[0]}</b></td><td>{months.join(", ")}</td><td>{SEASON_WHY[s]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted an-tiny">The month-to-season map lives in one place in the code (<code>REALISTIC_CONFIG.seasonByMonth</code>). Records so far cover July–October only, so only the monsoon and cool seasons have farm data; the others use the starting values until a year of records (or <Link href="/import">imported old registers</Link>) exists.</p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>2. Deaths: starting values</h2>
        <p>Deaths are measured per week: deaths in 7 days ÷ the week&apos;s average birds × 100. Until a flock&apos;s age band has enough data of its own (at least {C.minHealthyDays} healthy flock-days from {C.minFlocks} flocks), these <b>starting values from the farm&apos;s 2026 data, confirm with the vet</b> are used:</p>
        <div className="tl-scroll">
          <table className="tl-table">
            <thead><tr><th>Months</th><th className="num">Amber above</th><th className="num">Red above</th></tr></thead>
            <tbody>
              <tr><td>Cool, cold and spring (Oct–Nov, Dec–Feb, Mar)</td><td className="num">{C.deathStart.cool.amber}% a week</td><td className="num">{C.deathStart.cool.red}% a week</td></tr>
              <tr><td>Monsoon and hot (Apr–Sep)</td><td className="num">{C.deathStart.hot.amber}% a week</td><td className="num">{C.deathStart.hot.red}% a week</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted an-tiny">Where they come from: this farm&apos;s own 2 Jul – 26 Oct 2026 records. October: most flocks 0.15–0.39% a week (median about 0.19; young flocks 0.18–0.22). July–August: most 0.25–0.57% (median about 0.38), with two bad July weeks (BAB-8 about 1.07%, BAB-7 about 0.88%) that should still alert. BAB-4 (week 115) ran 0.28–0.42% a week all four months.</p>
        <p>Once a band has enough data, <b>our usual</b> = the {C.deathPercentile}th percentile of the farm&apos;s own weekly rates; amber is above our usual × {C.deathAmberMultiple}, red above × {C.deathRedMultiple}. Guard rails: a week above the starting red is always at least amber, and the learned red is never above {C.deathRedCapMultiple}× the starting red. Weeks above the starting red are not counted as &quot;usual&quot;. You can type your own level for any band on the <Link href="/analytics/targets">How is this learned?</Link> screen.</p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>3. What the farm&apos;s own records have taught so far</h2>
        <p className="an-tiny muted">Only bands with enough healthy days are listed; everything else says &quot;not learned yet&quot; on the flock cards and uses the all-seasons value or the starting values. Full tables: <Link href="/analytics/targets">How is this learned?</Link></p>
        <h3>Eggs per 100 birds (ratio to the book, 70th percentile)</h3>
        <div className="tl-scroll">
          <table className="tl-table">
            <thead><tr><th>Group</th><th>Season</th><th>Age (weeks)</th><th className="num">Healthy days</th><th className="num">Flocks</th><th>Dates used</th><th className="num">% of book</th></tr></thead>
            <tbody>
              {learned("hd").map((b) => (
                <tr key={`${b.group}${b.band}${b.season}`}><td>{SEGMENT_NAME[b.group]}</td><td>{seasonName(b.season)}</td><td>{b.fromWeek}–{b.toWeek}</td><td className="num">{n0(b.healthyDays)}</td><td className="num">{b.flocks}</td><td>{dmy(b.dateFrom)} – {dmy(b.dateTo)}</td><td className="num">{n1(b.learnedRatio! * 100)}%</td></tr>
              ))}
              {learned("hd").length === 0 && <tr><td colSpan={7} className="muted">Nothing learned yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <h3>Deaths (our usual, % of birds per week)</h3>
        <div className="tl-scroll">
          <table className="tl-table">
            <thead><tr><th>Group</th><th>Season</th><th>Age (weeks)</th><th className="num">Healthy days</th><th className="num">Flocks</th><th className="num">Our usual</th><th className="num">Amber / red above</th></tr></thead>
            <tbody>
              {learned("mortality").map((b) => {
                const l = limits(b);
                return (
                  <tr key={`${b.group}${b.band}${b.season}`}><td>{SEGMENT_NAME[b.group]}</td><td>{seasonName(b.season)}</td><td>{b.fromWeek}–{b.toWeek}</td><td className="num">{n0(b.healthyDays)}</td><td className="num">{b.flocks}</td><td className="num">{n2(b.learnedRate)}%</td><td className="num">{n2(l.amber)} / {n2(l.red)}</td></tr>
                );
              })}
              {learned("mortality").length === 0 && <tr><td colSpan={7} className="muted">Nothing learned yet: the starting values apply.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>4. Weather</h2>
        <p>From the free Open-Meteo service for Dandrala / Mohali (latitude {FARM_LAT}, longitude {FARM_LON}), refreshed once a day by the server. Columns kept per day: <b>max temperature</b>, <b>min temperature</b>, <b>mean humidity</b>, <b>rain</b>. {w.length > 0 ? <>Now held: {w.length} days, {dmy(firstW)} to {dmy(lastW)}.</> : <b>Weather is not available yet: it fills in by itself after the first daily run. Nothing else in the app depends on it.</b>}</p>
        <ul className="an-list">
          <li><b>Hot day:</b> max above {C.hotMaxC} °C, or above {C.humidHotMaxC} °C with humidity above {C.humidPct}%. A flock with a low HD or high deaths on or after a hot day gets the sentence &quot;hot day: 38 °C, feed intake and eggs usually drop on such days&quot;. It explains; it never changes the colour.</li>
          <li><b>Forecast alerts</b> (next 3 days): max {C.forecastHotC} °C or more → more water, ventilate, shade; min below {C.forecastColdC} °C → cover the curtains.</li>
          <li>The HD and deaths charts show max temperature as a thin dashed line.</li>
        </ul>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>5. What is known (and what is not)</h2>
        <p><b>No published benchmark was found for Indian cage-battery farms by Punjab climate.</b> That is why the targets above are built from this farm&apos;s own 2026 data plus the climate, and are labelled &quot;farm&apos;s own reference, confirm with vet&quot;.</p>
        <p className="an-tiny"><b>From the owner&apos;s brief (29 Oct 2026; the figures were not checked against a source here):</b> layers are comfortable at 18–25 °C; feed intake begins to fall above about 30 °C, by roughly 2–3 g per bird per degree; severe heat stress can cut egg production by 13–57%, egg weight by 3–5% and shell thickness by 1–10%; water intake can double in summer; modern housing systems typically report about 3–5% cumulative mortality at 60 weeks, older conventional-cage farms often above 10%.</p>
        <p className="an-tiny"><b>What published sources found in a web search say</b> (summaries; read the papers before relying on a number):</p>
        <ul className="an-list an-tiny">
          <li>Ontario agriculture ministry guidance (OMAFRA), <a href="https://www.ontario.ca/page/heat-stress-commercial-layers" target="_blank" rel="noreferrer">Heat stress in commercial layers</a> (<a href="https://files.ontario.ca/omafra-heat-stress-in-commerical-layers-20-025-en-2020-08-12.pdf" target="_blank" rel="noreferrer">PDF</a>): intake changes do not affect production up to about 27 °C; above that body temperature climbs and intake drops sharply. So the threshold may be nearer 27 °C than 30 °C.</li>
          <li>Mashaly et al. 2004, <a href="https://internationalegg.com/app/uploads/2010/08/Mashaly_-_2004_1.pdf" target="_blank" rel="noreferrer">heat-stress trial on commercial laying hens (PDF)</a> (continuous 35 °C): intake fell from 86.7 to 41.6 g per bird per day, hen-day production from 87.4% to 56.2%, egg weight from 56.4 to 46.9 g, shell thickness from 34.8 to 28.3 (× 0.01 mm).</li>
          <li>Two open-access articles on heat stress and laying hens, <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11011014" target="_blank" rel="noreferrer">PMC11011014</a> and <a href="https://www.frontiersin.org/journals/veterinary-science/articles/10.3389/fvets.2020.00412/pdf" target="_blank" rel="noreferrer">Frontiers in Veterinary Science 2020</a>: reduced feed intake is typically the first response to heat, with egg weight and shell quality following.</li>
          <li>Schuck-Paim et al. 2021, <a href="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7862694/" target="_blank" rel="noreferrer">Laying hen mortality in different indoor housing systems: a meta-analysis of data from commercial farms in 16 countries</a>: 6,040 flocks; the authors judged the differences between flocks too large to report pooled averages. Cage-free mortality fell as producers gained experience.</li>
          <li>A single-farm US trial reported by <a href="https://wattagnet.com/articles/25709-laying-hen-housing-systems-its-about-trade-offs" target="_blank" rel="noreferrer">WATTAgNet</a>: total cumulative mortality about 4.7% in conventional cages, 5.1% in enriched cages, 11.5% in aviaries. This does <b>not</b> confirm &quot;above 10% for older conventional cages&quot;; it is one old, modern-house trial.</li>
        </ul>
        <p><b>These are this farm&apos;s own working targets, not published standards; confirm them with your vet.</b></p>
      </section>
    </>
  );
}
