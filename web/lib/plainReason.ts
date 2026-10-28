// Flag reasons are written by the reader for developers ("bird_population readings disagree: …"). The review screen
// shows them in plain words; the original text stays one tap away under "Technical detail".
const num = (s: string) => Number(String(s).replace(/,/g, ""));
const fmt = (x: number) => x.toLocaleString("en-IN");
const list = (s: string) => s.split(/[,\s]+/).filter(Boolean).map((x) => fmt(num(x))).join(" and ");

export function plainFlagReason(raw: string): string {
  const parts = raw.split(/;\s+(?=[A-Za-z])/).map((p) => p.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = translate(p);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.length ? out.join(" ") : raw;
}

function translate(p: string): string {
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^HD% mismatch: written ([\d.]+)%, calculated ([\d.]+)% \(([\d,]+) eggs \/ ([\d,]+) birds/i)))
    return `The supervisor wrote ${m[1]} eggs per 100 birds, but ${fmt(num(m[3]))} eggs from ${fmt(num(m[4]))} birds gives ${m[2]}. One of the numbers was probably misread.`;
  if ((m = p.match(/^bird_population readings disagree: ([\d, ]+?)\s*[—-]\s*([\d,]+) looks right/i)))
    return `The bird count was read two ways (${list(m[1])}). ${fmt(num(m[2]))} fits the written percentage, so it is probably right.`;
  if ((m = p.match(/^bird_population readings disagree: ([\d, ]+)$/i))) return `The bird count was read two ways (${list(m[1])}) and the photo does not settle which is right.`;
  if ((m = p.match(/^Previous day's saved bird_population \(([\d,]+)\) looks misread.*?Suggested value for this row: ([\d,]+)/i)))
    return `Yesterday's bird count (${fmt(num(m[1]))}) looks misread. Today's figures suggest ${fmt(num(m[2]))}.`;
  if ((m = p.match(/^mortality outlier: (\d+) vs trailing 7-day average ([\d.]+)/i))) return `${m[1]} deaths is far more than the usual ${m[2]} a day.`;
  if ((m = p.match(/^low OCR confidence on (\w+)/i))) return `The photo was hard to read for ${friendlyField(m[1])}.`;
  if ((m = p.match(/^missing field: (\w+)/i))) return `No ${friendlyField(m[1])} figure could be read.`;
  if ((m = p.match(/^eggs_total ([\d,]+) is not a multiple of 30.*?suggested: ([\d,]+)/i)))
    return `${fmt(num(m[1]))} eggs is not a whole number of trays (30 eggs each); ${fmt(num(m[2]))} is more likely.`;
  if ((m = p.match(/^bird_population may not match the previous day's chain: extracted ([\d,]+), but previous day's bal bird \(([\d,]+)\) minus today's mortality \((\d+)\) expects ([\d,]+)/i)))
    return `Today's bird count (${fmt(num(m[1]))}) does not follow from yesterday's (${fmt(num(m[2]))}) minus ${m[3]} deaths (${fmt(num(m[4]))}). One of the two days may be misread.`;
  return p;
}

function friendlyField(f: string): string {
  return ({ feed_bags: "feed", mortality: "deaths", eggs_total: "eggs", bird_population: "bird count", hd_percent_written: "written percentage" } as Record<string, string>)[f] ?? f.replace(/_/g, " ");
}
