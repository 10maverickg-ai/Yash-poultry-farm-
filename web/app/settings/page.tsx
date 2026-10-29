import Link from "next/link";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { loadWeatherStatus } from "@/lib/weather/store";
import { plainWeatherError, agoText, weatherIsStale } from "@/lib/weather/plain";
import { WeatherRefresh } from "@/components/WeatherRefresh";
import { refreshWeatherNow } from "./actions";
import { dmy } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) + " (India time)" : "never");

export default async function SettingsPage() {
  const [w, data] = await Promise.all([
    loadWeatherStatus(),
    pool
      .query(
        `SELECT (SELECT max(date) FROM daily_production WHERE farm_code = $1 AND deleted_at IS NULL) AS last_day,
                (SELECT count(DISTINCT date) FROM daily_production WHERE farm_code = $1 AND deleted_at IS NULL)::int AS days,
                (SELECT max(date) FROM daily_egg_rates) AS last_rate`,
        [ACTIVE_FARM]
      )
      .then((r) => r.rows[0] as { last_day: Date | string | null; days: number; last_rate: Date | string | null })
      .catch(() => null),
  ]);
  const d10 = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
  const stale = weatherIsStale(w.fetchedAt);
  const last = w.lastAttempt;
  return (
    <>
      <h1>Settings</h1>
      <p className="muted">Small things the app does in the background, and what to press if one of them is stuck.</p>

      <h2>Weather</h2>
      <section className="card stack">
        {!w.available ? (
          <p className="error-banner" style={{ margin: 0 }}>The weather information could not be read from the database just now. The rest of the app works without it. Try again in a minute.</p>
        ) : w.rows === 0 ? (
          <p style={{ margin: 0 }}><b>No weather saved yet.</b> Everything works without it; heat sentences simply do not appear. Press the button to fetch it.</p>
        ) : (
          <dl className="kv">
            <dt>Last weather came in</dt><dd>{stamp(w.fetchedAt)} <span className="muted">· {agoText(w.fetchedAt)}</span></dd>
            <dt>Days saved</dt><dd>{w.rows} days, {dmy(w.firstDate!)} to {dmy(w.lastDate!)}</dd>
          </dl>
        )}
        {w.available && stale && w.rows > 0 && <p className="flag-banner" style={{ margin: 0 }}>The weather has not been updated for more than a day and a half. Press the button below.</p>}
        {last && (
          <p style={{ margin: 0 }}>
            <b>Last attempt:</b> {stamp(last.at)} ({last.trigger}) —{" "}
            {last.outcome === "ok" ? <span>worked, {last.rows ?? 0} days.</span> : last.outcome === "partial" ? <span>partly worked, {last.rows ?? 0} days. {plainWeatherError(last.message)}</span> : <span><b>did not work.</b> {plainWeatherError(last.message)}</span>}
          </p>
        )}
        <p className="muted an-tiny" style={{ margin: 0 }}>
          The app asks the free Open-Meteo service for Mohali weather once a day by itself. Heat sentences on Today and Analytics use it. If the service is down the app keeps the last weather and carries on.
        </p>
        <WeatherRefresh action={refreshWeatherNow} />
      </section>

      <h2>Your login</h2>
      <section className="card stack">
        <p style={{ margin: 0 }}>You are logged in. The login keeps this phone logged in for 30 days of use.</p>
        <form action="/api/logout" method="post"><button type="submit" className="btn-secondary">Log out of this phone</button></form>
      </section>

      <h2>Your records</h2>
      <section className="card stack">
        {data ? (
          <dl className="kv">
            <dt>Last day saved</dt><dd>{d10(data.last_day) ? dmy(d10(data.last_day)!) : "none yet"} <span className="muted">· {data.days} days in all</span></dd>
            <dt>Latest egg rate</dt><dd>{d10(data.last_rate) ? dmy(d10(data.last_rate)!) : "none yet"}</dd>
          </dl>
        ) : (
          <p className="muted" style={{ margin: 0 }}>The records could not be counted just now.</p>
        )}
        <p style={{ margin: 0 }}>
          <Link href="/day/enter">Enter a day by hand</Link> (when photo reading is not available) · <Link href="/export">Excel / backup</Link> · <Link href="/changes">What changed in the app</Link>
        </p>
      </section>
    </>
  );
}
