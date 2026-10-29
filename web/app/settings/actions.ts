"use server";

import { requireOwner } from "@/lib/auth/guard";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { refreshWeather } from "@/lib/weather/store";
import { plainWeatherError } from "@/lib/weather/plain";

export interface WeatherState { ok: boolean; message: string }

/** The "Refresh weather now" button. Answers on the same screen (no redirect); the page refreshes itself when ok. */
export async function refreshWeatherNow(): Promise<WeatherState> {
  await requireOwner();
  try {
    // one press per minute: a second tap while the first is still running (or just after) would only hammer the free service
    const { rows } = await pool
      .query(`SELECT 1 FROM weather_fetch_log WHERE farm_code = $1 AND trigger = 'button' AND attempted_at > now() - interval '60 seconds' LIMIT 1`, [ACTIVE_FARM])
      .catch(() => ({ rows: [] as unknown[] }));
    if (rows.length) return { ok: false, message: "The weather service was just asked a moment ago. Wait a minute before pressing again." };
    const r = await refreshWeather({ force: true, trigger: "button" });
    if (r.status === "unavailable") return { ok: false, message: plainWeatherError(r.error) };
    if (r.status === "refreshed") {
      return r.error
        ? { ok: true, message: `Weather updated (${r.rows} days), but part of it did not come in. ${plainWeatherError(r.error)}` }
        : { ok: true, message: `Weather updated: ${r.rows} days came in.` };
    }
    return { ok: true, message: "The weather is already up to date." };
  } catch {
    return { ok: false, message: "The weather could not be updated just now. Nothing was changed; try again in a few minutes." };
  }
}
