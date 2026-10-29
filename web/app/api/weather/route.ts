import { refreshWeather } from "@/lib/weather/store";

export const dynamic = "force-dynamic";

// Called once a day by the Vercel cron (web/vercel.json). When CRON_SECRET is set, Vercel sends it as a bearer token and
// anything else is refused. Without it (local use, or the secret not set yet) the route is open to anyone who knows the address, so it
// only refreshes when the cache is more than 12 hours old (it can never be used to hammer the weather service). It never returns weather data.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Not allowed", { status: 401 });
  const result = await refreshWeather({ force: !!secret, trigger: "daily job" });
  return Response.json(result);
}
