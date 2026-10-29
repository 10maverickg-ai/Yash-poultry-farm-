"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { checkDay, derive, autoBirds, fmt, LEFT_ANSWERS, ADDED_ANSWERS, lineSign, type AnswerKey, type Check, type ManualDay } from "@/lib/day/manualDay";
import type { DayState } from "@/app/day/enter/actions";

// "Enter a day by hand" (V12 N4). Everything typed here is kept as text while typing, turned into numbers for the checks, and sent as
// one JSON "payload" when the day is saved. The checks run live; a day that does not tie is still saved, but flagged.
type S = string;
interface FlockState { flockId: string; label: string; group: "main" | "young"; prevBirds: number | null; moved: number; mortality: S; feed: S; eggs: S; birds: S; birdsTouched: boolean }
interface LineState { answer: AnswerKey; eggs: S; label: S }
interface LedgerState { prevClosing: number | null; opening: S; closing: S; lines: LineState[] }

const t = (v: number | null | undefined): S => (v == null ? "" : String(v));
const num = (s: S): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

export function ManualDayForm({ initial, action, saved, savedBy, rateNote, movements }: { initial: ManualDay; action: (prev: DayState | null, fd: FormData) => Promise<DayState>; saved: boolean; savedBy: string | null; rateNote: string; movements: string[] }) {
  const [state, formAction, pending] = useActionState<DayState | null, FormData>(action, null);
  const [flocks, setFlocks] = useState<FlockState[]>(initial.flocks.map((f) => ({ flockId: f.flockId, label: f.label, group: f.group, prevBirds: f.prevBirds, moved: f.moved ?? 0, mortality: t(f.mortality), feed: t(f.feed), eggs: t(f.eggs), birds: t(f.birds), birdsTouched: f.birds != null })));
  const [pages, setPages] = useState({ rightDeaths: "", rightFeed: "", rightEggs: "", leftDeaths: "", leftEggs: "" });
  const [feed, setFeed] = useState({ opening: t(initial.feed.opening), produced: t(initial.feed.produced), mill: t(initial.feed.mill), shed: t(initial.feed.shed) });
  const mkLedger = (l: ManualDay["big"]): LedgerState => ({ prevClosing: l.prevClosing, opening: t(l.opening), closing: t(l.closing), lines: l.lines.map((x) => ({ answer: x.answer, eggs: String(x.eggs), label: x.label })) });
  const [big, setBig] = useState<LedgerState>(mkLedger(initial.big));
  const [small, setSmall] = useState<LedgerState>(mkLedger(initial.small));
  const [chick, setChick] = useState(initial.chick.map((c) => ({ label: c.label, deaths: t(c.deaths) })));
  const [replace, setReplace] = useState(false);

  const day: ManualDay = useMemo(() => ({
    date: initial.date,
    flocks: flocks.map((f) => ({ flockId: f.flockId, label: f.label, group: f.group, prevBirds: f.prevBirds, moved: f.moved, mortality: num(f.mortality), feed: num(f.feed), eggs: num(f.eggs), birds: num(f.birds) })),
    pages: { rightDeaths: num(pages.rightDeaths), rightFeed: num(pages.rightFeed), rightEggs: num(pages.rightEggs), leftDeaths: num(pages.leftDeaths), leftEggs: num(pages.leftEggs) },
    feed: { prevClosing: initial.feed.prevClosing, opening: num(feed.opening), produced: num(feed.produced), mill: num(feed.mill), shed: num(feed.shed) },
    big: { prevClosing: big.prevClosing, opening: num(big.opening), closing: num(big.closing), lines: big.lines.map((l) => ({ answer: l.answer, eggs: Math.round(num(l.eggs) ?? 0), label: l.label })) },
    small: { prevClosing: small.prevClosing, opening: num(small.opening), closing: num(small.closing), lines: small.lines.map((l) => ({ answer: l.answer, eggs: Math.round(num(l.eggs) ?? 0), label: l.label })) },
    chick: chick.map((c) => ({ label: c.label, deaths: num(c.deaths) })),
  }), [flocks, pages, feed, big, small, chick, initial]);
  const x = derive(day);
  const checks = useMemo(() => checkDay(day), [day]);
  const bad = checks.filter((c) => c.level !== "ok");
  const touched = flocks.some((f) => f.mortality || f.eggs || f.feed || f.birds);

  const setFlock = (id: string, patch: Partial<FlockState>) =>
    setFlocks((fs) => fs.map((f) => {
      if (f.flockId !== id) return f;
      const n = { ...f, ...patch };
      // birds left follow yesterday's birds less today's deaths until the owner types them himself
      if (patch.mortality !== undefined && !n.birdsTouched) {
        const a = autoBirds(n.prevBirds, num(n.mortality), n.moved);
        n.birds = a == null ? "" : String(a);
      }
      return n;
    }));

  const flockCard = (f: FlockState) => {
    const mine = checks.filter((c) => c.flockId === f.flockId && c.level !== "ok");
    return (
      <div key={f.flockId} className={`card md-flock${mine.length ? " md-flag" : ""}`}>
        <div className="md-flock-head"><b>{f.label}</b><span className="muted an-tiny">{f.prevBirds != null ? `yesterday ${fmt(f.prevBirds)} birds${f.moved ? `, ${f.moved > 0 ? "+" : "−"}${fmt(Math.abs(f.moved))} moved today` : ""}` : "no row yesterday"}</span></div>
        <div className="row2">
          <label className="field"><span>Deaths</span><input type="number" inputMode="numeric" min="0" value={f.mortality} onChange={(e) => setFlock(f.flockId, { mortality: e.target.value })} aria-label={`${f.label} deaths today`} /></label>
          {f.group === "main" ? (
            <label className="field"><span>Feed bags</span><input type="number" inputMode="numeric" min="0" value={f.feed} onChange={(e) => setFlock(f.flockId, { feed: e.target.value })} aria-label={`${f.label} feed bags today`} /></label>
          ) : (
            <div className="field"><span>Feed</span><span className="muted an-tiny">not written for this page</span></div>
          )}
        </div>
        <div className="row2">
          <label className="field"><span>Eggs laid</span><input type="number" inputMode="numeric" min="0" step="30" value={f.eggs} onChange={(e) => setFlock(f.flockId, { eggs: e.target.value })} aria-label={`${f.label} eggs today`} /></label>
          <label className="field"><span>Birds left <span className="hint">(fills itself)</span></span><input type="number" inputMode="numeric" min="0" value={f.birds} onChange={(e) => setFlock(f.flockId, { birds: e.target.value, birdsTouched: true })} aria-label={`${f.label} birds left today`} /></label>
        </div>
        {mine.map((c) => (<p key={c.id} className="md-note">⚠ {c.text}</p>))}
      </div>
    );
  };

  const pageTotals = (side: "right" | "left") => (
    <details className="card" key={`totals-${side}`}>
      <summary><b>Totals written at the bottom of the {side} page</b> <span className="muted an-tiny">(optional: the app checks your rows against them)</span></summary>
      <div className="row2" style={{ marginTop: "0.5rem" }}>
        <label className="field"><span>Deaths total</span><input type="number" inputMode="numeric" min="0" value={side === "right" ? pages.rightDeaths : pages.leftDeaths} onChange={(e) => setPages((p) => ({ ...p, [side === "right" ? "rightDeaths" : "leftDeaths"]: e.target.value }))} /></label>
        {side === "right" && <label className="field"><span>Feed bags total</span><input type="number" inputMode="numeric" min="0" value={pages.rightFeed} onChange={(e) => setPages((p) => ({ ...p, rightFeed: e.target.value }))} /></label>}
        <label className="field"><span>Eggs total</span><input type="number" inputMode="numeric" min="0" value={side === "right" ? pages.rightEggs : pages.leftEggs} onChange={(e) => setPages((p) => ({ ...p, [side === "right" ? "rightEggs" : "leftEggs"]: e.target.value }))} /></label>
      </div>
    </details>
  );

  const ledger = ({ title, id, led, set, produced, total, closing, ledgerFlocks }: { title: string; id: "big" | "small"; led: LedgerState; set: (f: (l: LedgerState) => LedgerState) => void; produced: number; total: number | null; closing: number | null; ledgerFlocks: string }) => (
    <section key={id} className="card stack md-ledger" aria-label={title}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <p className="muted an-tiny" style={{ margin: 0 }}>Eggs laid by {ledgerFlocks}: <b>{fmt(produced)}</b> (added up from the flock rows).</p>
      <div className="row2">
        <label className="field"><span>Eggs in stock this morning <span className="hint">(yesterday closed at {led.prevClosing != null ? fmt(led.prevClosing) : "?"})</span></span><input type="number" inputMode="numeric" min="0" value={led.opening} onChange={(e) => set((l) => ({ ...l, opening: e.target.value }))} /></label>
        <div className="field"><span>Total line <span className="hint">(morning stock + laid)</span></span><b className="md-calc">{total != null ? fmt(total) : "–"}</b></div>
      </div>
      <h4 style={{ margin: "0.3rem 0 0" }}>What left or came in during the day</h4>
      {led.lines.length === 0 && <p className="muted an-tiny" style={{ margin: 0 }}>No lines yet. Add one for each sale, breakage, gift or addition written in the ledger.</p>}
      {led.lines.map((ln, i) => {
        const added = lineSign({ answer: ln.answer }) === 1;
        const answers = added ? ADDED_ANSWERS : LEFT_ANSWERS;
        const upd = (p: Partial<LineState>) => set((l) => ({ ...l, lines: l.lines.map((x, j) => (j === i ? { ...x, ...p } : x)) }));
        return (
          <div key={i} className="md-line">
            <div className="md-dir" role="group" aria-label="Did the eggs leave or come in?">
              <button type="button" className={!added ? "md-on" : ""} aria-pressed={!added} onClick={() => upd({ answer: "sale" })}>Eggs left (−)</button>
              <button type="button" className={added ? "md-on" : ""} aria-pressed={added} onClick={() => upd({ answer: "late" })}>Eggs added (+)</button>
            </div>
            <div className="md-chips" role="radiogroup" aria-label="What was it?">
              {answers.map((a) => (
                <button key={a.key} type="button" role="radio" aria-checked={ln.answer === a.key} className={`md-chip${ln.answer === a.key ? " md-on" : ""}`} onClick={() => upd({ answer: a.key })}>{a.label}</button>
              ))}
            </div>
            <div className="row2">
              <label className="field"><span>Eggs</span><input type="number" inputMode="numeric" min="0" value={ln.eggs} onChange={(e) => upd({ eggs: e.target.value })} aria-label={`Eggs for ${answerText(ln.answer)}`} /></label>
              <label className="field"><span>Words in the register <span className="hint">(optional)</span></span><input type="text" value={ln.label} maxLength={120} onChange={(e) => upd({ label: e.target.value })} /></label>
            </div>
            {(ln.answer === "sale" || ln.answer === "local_sale") && <p className="muted an-tiny" style={{ margin: 0 }}>{rateNote} The sale is created automatically.</p>}
            <button type="button" className="btn-secondary" onClick={() => set((l) => ({ ...l, lines: l.lines.filter((_, j) => j !== i) }))}>Remove this line</button>
          </div>
        );
      })}
      <button type="button" className="btn-secondary" onClick={() => set((l) => ({ ...l, lines: [...l.lines, { answer: "sale", eggs: "", label: "" }] }))}>+ Add a line</button>
      <div className="row2">
        <div className="field"><span>Eggs left tonight <span className="hint">(worked out)</span></span><b className="md-calc">{closing != null ? fmt(closing) : "–"}</b></div>
        <label className="field"><span>Closing as written <span className="hint">(optional)</span></span><input type="number" inputMode="numeric" min="0" value={led.closing} onChange={(e) => set((l) => ({ ...l, closing: e.target.value }))} aria-label={`${id} ledger closing as written`} /></label>
      </div>
    </section>
  );

  const main = flocks.filter((f) => f.group === "main");
  const young = flocks.filter((f) => f.group === "young");
  const payload = JSON.stringify(day);
  const checksBox = (list: Check[], key: string) => (
    <section key={key} className={`card md-checks ${list.length ? "md-checks-bad" : "md-checks-ok"}`} aria-live="polite" aria-label="Checks">
      <b>{touched ? (list.length === 0 ? "✓ Everything ties" : `⚠ ${list.length} thing${list.length === 1 ? "" : "s"} do${list.length === 1 ? "es" : ""} not tie`) : "Type the page: the checks appear here as you go."}</b>
      {list.length > 0 && <ul className="an-list">{list.map((c) => (<li key={c.id}>{c.text}</li>))}</ul>}
      {touched && list.length > 0 && <p className="muted an-tiny" style={{ margin: 0 }}>You can still save: each of these is saved with a flag so it appears under Flagged records for review. Nothing is guessed.</p>}
    </section>
  );

  return (
    <form action={formAction} className="stack">
      {saved && (
        <div className="flag-banner">
          <b>This day is already saved</b> ({savedBy}). The figures below are what is saved. If you save again, the saved day is replaced.
          <label className="check-line"><input type="checkbox" name="replace" value="yes" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> <span>Replace the saved day</span></label>
        </div>
      )}
      {movements.length > 0 && <div className="card muted an-tiny">{movements.map((m) => (<div key={m}>{m}</div>))}</div>}
      {checksBox(bad, "checks-top")}

      <h2 id="right">1. Right page: BAB-1 to BAB-8 (big eggs, with feed)</h2>
      {main.map((f) => flockCard(f))}
      {pageTotals("right")}

      <h2 id="feed">2. Feed box</h2>
      <section className="card stack">
        <div className="row2">
          <label className="field"><span>Bags in stock this morning <span className="hint">(yesterday closed at {initial.feed.prevClosing != null ? fmt(initial.feed.prevClosing) : "?"})</span></span><input type="number" inputMode="numeric" min="0" value={feed.opening} onChange={(e) => setFeed((s) => ({ ...s, opening: e.target.value }))} /></label>
          <label className="field"><span>Bags made today</span><input type="number" inputMode="numeric" min="0" value={feed.produced} onChange={(e) => setFeed((s) => ({ ...s, produced: e.target.value }))} /></label>
        </div>
        <div className="row2">
          <div className="field"><span>Total line</span><b className="md-calc">{x.feedTotal != null ? fmt(x.feedTotal) : "–"}</b></div>
          <div className="field"><span>Bags fed today <span className="hint">(the flocks added up)</span></span><b className="md-calc">{fmt(x.feedConsumed)}</b></div>
        </div>
        <div className="row2">
          <label className="field"><span>Bags left at the mill</span><input type="number" inputMode="numeric" min="0" value={feed.mill} onChange={(e) => setFeed((s) => ({ ...s, mill: e.target.value }))} /></label>
          <label className="field"><span>Bags left in the shed</span><input type="number" inputMode="numeric" min="0" value={feed.shed} onChange={(e) => setFeed((s) => ({ ...s, shed: e.target.value }))} /></label>
        </div>
        <p className="muted an-tiny" style={{ margin: 0 }}>Bags that should be left: {x.feedClosing != null ? <b>{fmt(x.feedClosing)}</b> : "–"}; mill + shed: {x.feedShedMill != null ? <b>{fmt(x.feedShedMill)}</b> : "–"}.</p>
      </section>

      <h2 id="big">3. Big egg ledger</h2>
      {ledger({ title: "Big eggs (right page flocks)", id: "big", led: big, set: setBig, produced: x.big.produced, total: x.big.totalLine, closing: x.big.closing, ledgerFlocks: "BAB-1 to BAB-8" })}

      <h2 id="left">4. Left page: BAB-9 to BAB-11 (small eggs)</h2>
      {young.map((f) => flockCard(f))}
      {pageTotals("left")}

      <h2 id="small">5. Small egg ledger</h2>
      {ledger({ title: "Small eggs (left page flocks)", id: "small", led: small, set: setSmall, produced: x.small.produced, total: x.small.totalLine, closing: x.small.closing, ledgerFlocks: "BAB-9 to BAB-11" })}

      <h2 id="chick">6. Chick rows</h2>
      <section className="card stack">
        {chick.map((c, i) => (
          <div key={i} className="row2">
            <label className="field"><span>Row name</span><input type="text" value={c.label} maxLength={60} onChange={(e) => setChick((cs) => cs.map((x2, j) => (j === i ? { ...x2, label: e.target.value } : x2)))} /></label>
            <label className="field"><span>Chick deaths</span><input type="number" inputMode="numeric" min="0" value={c.deaths} onChange={(e) => setChick((cs) => cs.map((x2, j) => (j === i ? { ...x2, deaths: e.target.value } : x2)))} /></label>
          </div>
        ))}
        <button type="button" className="btn-secondary" onClick={() => setChick((cs) => [...cs, { label: `Chicks ${cs.length + 1}`, deaths: "" }])}>+ Add a chick row</button>
      </section>

      {checksBox(bad, "checks-bottom")}
      {state && (
        <div className={state.ok ? "saved-banner" : "error-banner"} role="status" aria-live="polite">
          {state.message}
          {state.ok && state.problems && state.problems.length > 0 && <ul className="an-list">{state.problems.map((p, i) => (<li key={i}>{p}</li>))}</ul>}
          {state.ok && state.date && <p style={{ margin: "0.4rem 0 0" }}><Link href={`/day?date=${state.date}`}>See the saved day →</Link> · <Link href="/flagged">Flagged records →</Link></p>}
        </div>
      )}
      <input type="hidden" name="payload" value={payload} />
      <div className="actions-bar">
        <button type="submit" disabled={pending || !touched}>{pending ? "Saving…" : saved ? "Save and replace the day" : "Save the day"}</button>
      </div>
    </form>
  );
}

function answerText(k: AnswerKey) {
  return [...LEFT_ANSWERS, ...ADDED_ANSWERS].find((a) => a.key === k)?.label ?? "line";
}
