import { refreshWeather } from "@/lib/weather/store";

export const dynamic = "force-dynamic";

// Called once a day by the Vercel cron (web/vercel.json). When CRON_SECRET is set, Vercel sends it as a bearer token and
// anything else is refused; without it (local use) the route just refreshes the cache. It never returns weather data.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Not allowed", { status: 401 });
  const result = await refreshWeather({ force: true });
  return Response.json(result);
}
