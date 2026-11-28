"use client";

// V18 A1b: "Choose what to share". Dates (From / To and four quick chips), flocks (All flocks by default) and what
// goes in the file (everything ticked by default). The choice lives in the address (?from=…&to=…&inc=production,feed),
// not in the browser's storage, so a link or a bookmark gives the same file. No typing: date pickers, chips and ticks.
import { useEffect, useMemo, useState } from "react";
import { BLOCK_LABEL, BLOCKS, cannotShare, MONEY, shareFileStem, shareQuery, sheetsFor, VIEW_LABEL, type Block, type ShareView } from "@/lib/export/shareOptions";
import { ShareAction } from "./ShareAction";

export interface ShareFlockOption {
  label: string;
  note: string;
  first: string;
  last: string;
}

const MAX_DAYS = 366;
const dayMs = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / dayMs) + 1;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pretty = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const iso = /^\d{4}-\d{2}-\d{2}$/;

export function SharePanel(p: {
  view: ShareView;
  from: string;
  to: string;
  flocks: string[];
  inc: Block[];
  options: ShareFlockOption[];
  chips: { key: string; label: string; from: string; to: string }[];
  dataDates: string[];
  today: string;
  compare: { params: Record<string, string>; a: string; b: string } | null;
}) {
  const [from, setFrom] = useState(p.from);
  const [to, setTo] = useState(p.to);
  const [flocks, setFlocks] = useState<string[]>(p.flocks);
  const [inc, setInc] = useState<Block[]>(p.inc);
  const isCompare = p.compare != null;
  const farmLevel = isCompare || flocks.length === 0;

  const query = useMemo(
    () => (p.compare ? shareQuery({ view: p.view, compare: p.compare.params, inc }) : shareQuery({ view: p.view, from, to, flocks, inc })),
    [p.view, p.compare, from, to, flocks, inc]
  );
  // the choice is kept in the address, so the page can be bookmarked or sent and opens the same way
  useEffect(() => {
    window.history.replaceState(window.history.state, "", `/analytics/share?${query}`);
  }, [query]);

  const visible: Block[] = isCompare ? ["production", "feed", "mortality", "sales", "costs"] : [...BLOCKS];
  const why = cannotShare(inc, { farmLevel, compare: isCompare }) ?? (!isCompare && (!iso.test(from) || !iso.test(to)) ? "Pick both dates." : null);
  const sheets = sheetsFor(inc, { farmLevel, compare: isCompare });
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const span = iso.test(lo) && iso.test(hi) ? daysBetween(lo, hi) : 0;
  const spans = p.options.filter((o) => flocks.includes(o.label));
  const withData = p.dataDates.filter((d) => d >= lo && d <= hi && (spans.length === 0 || spans.some((o) => d >= o.first && d <= o.last))).length;
  const file = (format: string) => `/export/share?${query}&format=${format}`;
  const toggle = (b: Block) => setInc((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : BLOCKS.filter((x) => x === b || cur.includes(x))));
  const toggleFlock = (l: string) => setFlocks((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  return (
    <section className="card sh-panel" aria-label="Choose what to share">
      <h2 style={{ marginTop: 0 }}>Choose what to share</h2>
      <p className="muted an-tiny" style={{ marginTop: 0 }}>From the {VIEW_LABEL[p.view]} screen. Everything is ticked to start with; untick what you do not want in the file.</p>

      {p.compare ? (
        <div className="sh-cmp">
          <p style={{ margin: 0 }}><b>A:</b> {p.compare.a}</p>
          <p style={{ margin: 0 }}><b>B:</b> {p.compare.b}</p>
          <p className="muted an-tiny" style={{ margin: 0 }}>To change the flocks or dates, go back to the Compare screen. The file is the Compare table.</p>
        </div>
      ) : (
        <>
          <div className="pv-dates">
            <label className="field"><span>From</span><input type="date" value={from} max={p.today} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
            <label className="field"><span>To</span><input type="date" value={to} max={p.today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
          </div>
          <div className="pv-chips" role="group" aria-label="Quick dates">
            {p.chips.map((c) => {
              const on = c.from === from && c.to === to;
              return (
                <button key={c.key} type="button" className={`pv-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => { setFrom(c.from); setTo(c.to); }}>{c.label}</button>
              );
            })}
          </div>
          <p className="an-tiny" style={{ margin: "0.4rem 0" }} role="status">
            {span > 0 ? `${pretty(lo)} to ${pretty(hi)}: ${span} day${span === 1 ? "" : "s"}, ` : ""}
            {withData === 0 ? <b>no data in these dates — the file will say so.</b> : `${withData} with data.`}
            {from > to ? " From is after To: the two dates will be swapped." : ""}
            {span > MAX_DAYS ? ` A file can cover at most ${MAX_DAYS} days, so it will stop ${MAX_DAYS} days back from ${pretty(hi)}.` : ""}
            {" "}&quot;Last 7 / 14 / 30 days&quot; are the last days that have data.
          </p>
          <details className="pv-flocks">
            <summary>Flocks: <b>{flocks.length ? flocks.join(", ") : "All flocks"}</b></summary>
            <div className="pv-flock-grid" style={{ marginTop: "0.3rem" }}>
              <label className="pv-check">
                <input type="checkbox" checked={flocks.length === 0} onChange={() => setFlocks([])} />
                <span><b>All flocks</b><span className="muted an-tiny">whole farm</span></span>
              </label>
              {p.options.map((o) => (
                <label key={o.label} className="pv-check">
                  <input type="checkbox" checked={flocks.includes(o.label)} onChange={() => toggleFlock(o.label)} />
                  <span><b>{o.label}</b><span className="muted an-tiny">{o.note}</span></span>
                </label>
              ))}
            </div>
          </details>
        </>
      )}

      <fieldset className="sh-blocks">
        <legend>Put in the file</legend>
        <div className="sh-row">
          <button type="button" className="btn btn-secondary" onClick={() => setInc([...BLOCKS])}>Select all</button>
          <button type="button" className="btn btn-secondary" onClick={() => setInc([])}>Clear</button>
        </div>
        <div className="sh-grid">
          {visible.map((b) => {
            const off = !farmLevel && MONEY.includes(b);
            return (
              <label key={b} className={`pv-check${off ? " sh-off" : ""}`}>
                <input type="checkbox" checked={inc.includes(b)} onChange={() => toggle(b)} disabled={off} />
                <span>
                  <b>{BLOCK_LABEL[b]}</b>
                  {off && <span className="muted an-tiny">whole farm only: not in a file for chosen flocks</span>}
                </span>
              </label>
            );
          })}
        </div>
        {isCompare && <p className="muted an-tiny" style={{ margin: "0.3rem 0 0" }}>Alerts and the per-flock and day-by-day tables are not part of Compare.</p>}
      </fieldset>

      <p className="sh-will" role="status">
        {why ? <b>{why}</b> : <>The file will have: <b>{sheets.join(", ")}</b>{sheets.length > 1 ? " (one sheet each in Excel; CSV comes as a .zip with one file each)" : ""}.</>}
      </p>
      <div className="pv-dl">
        {why ? (
          <>
            <button type="button" className="btn btn-secondary" disabled>Excel (.xlsx)</button>
            <button type="button" className="btn btn-secondary" disabled>CSV</button>
            <button type="button" className="btn btn-secondary" disabled>Share</button>
          </>
        ) : (
          <>
            <a className="btn" href={file("xlsx")} download>Excel (.xlsx)</a>
            <a className="btn btn-secondary" href={file("csv")} download>CSV</a>
            <ShareAction key={query} href={file("xlsx")} />
          </>
        )}
      </div>
      <p className="muted an-tiny" style={{ marginBottom: 0 }}>
        File name: {shareFileStem(p.view, isCompare ? p.from : lo, isCompare ? p.to : hi)}.xlsx · Read-only: the numbers are the ones on the screen for these dates and flocks. Missing figures stay empty with the reason beside them, never 0.
      </p>
    </section>
  );
}
