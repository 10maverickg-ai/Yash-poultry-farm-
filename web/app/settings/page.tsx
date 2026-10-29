import Link from "next/link";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { loadWeatherStatus } from "@/lib/weather/store";
import { plainWeatherError, agoText, weatherIsStale } from "@/lib/weather/plain";
import { WeatherRefresh } from "@/components/WeatherRefresh";
import { refreshWeatherNow, logOutStaffPhones } from "./actions";
import { StaffLogoutButton } from "@/components/StaffLogoutButton";
import { InstallSteps } from "@/components/InstallSteps";
import { requireOwner } from "@/lib/auth/guard";
import { getStore } from "@/lib/auth/attempts";
import { staffEnabled } from "@/lib/auth/session";
import { dmy } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) + " (India time)" : "never");

const WHEN = (ms: number) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

export default async function SettingsPage() {
  await requireOwner();
  const store = getStore();
  const [recent, w, data] = await Promise.all([
    store.recent(30),
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

      <h2>Staff PIN</h2>
      <section className="card stack">
        <p style={{ margin: 0 }}>
          Staff PIN: <b>{staffEnabled(process.env) ? "set" : "not set"}</b>.{" "}
          {staffEnabled(process.env) ? "A phone that logs in with the PIN can only upload register photos." : "Until it is set, nobody can log in as staff."}
        </p>
        <p className="muted an-tiny" style={{ margin: 0 }}>
          The PIN is changed in Vercel, not here (so it is never typed into this app): run <code>npx tsx scripts/make-password-hash.mts</code>, type <b>staff</b>, choose 4 to 6 digits, paste the line it prints as <code>APP_STAFF_PIN_HASH</code> in Vercel (Project Settings, Environment Variables) and redeploy. Changing it logs every staff phone out. The steps are in docs/AUTH.md.
        </p>
        <StaffLogoutButton action={logOutStaffPhones} />
      </section>

      <h2>Recent logins</h2>
      <section className="card stack">
        {recent.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No logins recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When (India time)</th><th>Tried</th><th>Result</th><th>Phone / address</th></tr></thead>
              <tbody>
                {recent.map((a) => (
                  <tr key={a.ref}>
                    <td>{WHEN(a.at)}</td>
                    <td>{a.role === "staff" ? "Staff PIN" : "Owner password"}</td>
                    <td>{a.ok ? "Logged in" : a.blocked ? "Refused (too many tries)" : "Wrong"}</td>
                    <td className="muted">{a.ip.slice(0, 6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted an-tiny" style={{ margin: 0 }}>
          Wrong tries are counted in {store.kind() === "database" ? "the database (table login_attempts)" : "memory on this server only (the table login_attempts is not reachable, so the counts reset when the server restarts)"}. The last column is a short code for the address, not the address itself: the same code means the same phone or network. Five wrong tries in 15 minutes lock that address and that phone for 15 minutes; 20 wrong PINs in an hour pause the PIN for an hour (the owner password keeps working).
        </p>
      </section>

      <h2>How to install</h2>
      <InstallSteps />

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
