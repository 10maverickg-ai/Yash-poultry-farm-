// Turns the raw reason a weather fetch failed into a sentence the owner can act on (or safely ignore).
export function plainWeatherError(raw: string | null | undefined): string {
  const m = (raw ?? "").toLowerCase();
  if (!m) return "";
  if (/in time|timeout|timed out/.test(m)) return "The weather service did not answer in time. This usually passes; try again in a few minutes.";
  if (/answered 429|too many|rate limit/.test(m)) return "The weather service said too many requests were made today. Wait an hour or two and try again.";
  if (/answered 5\d\d/.test(m)) return "The weather service is having trouble on its side. Try again later; nothing on this farm's side is wrong.";
  if (/answered 4\d\d/.test(m)) return "The weather service refused the request. If this keeps happening, tell whoever looks after the app.";
  if (/network|fetch failed|enotfound|econn|eai_again|socket|offline/.test(m)) return "The app could not reach the weather service (internet down, or the service is blocked). The last weather stays in use.";
  if (/relation|does not exist|weather_daily|weather_fetch_log/.test(m)) return "The weather tables are missing in the database (a database update has not been run).";
  if (/no weather returned/.test(m)) return "The weather service answered but sent no days. Try again later.";
  return "The weather could not be updated just now. The last weather stays in use.";
}

/** "less than an hour ago", "5 hours ago", "3 days ago". */
export function agoText(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const h = (now - Date.parse(iso)) / 3600000;
  if (h < 1) return "less than an hour ago";
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** The weather counts as stale when nothing has come in for a day and a half. */
export const weatherIsStale = (iso: string | null, now: number = Date.now()): boolean => !iso || (now - Date.parse(iso)) / 3600000 > 36;
