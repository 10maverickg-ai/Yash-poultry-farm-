import { refreshWeather } from "@/lib/weather/store";
import { cronAllowed } from "@/lib/auth/gate";

export const dynamic = "force-dynamic";

// Called once a day by the Vercel cron (web/vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>" once CRON_SECRET is set
// in the project; that header, and nothing else (a login cookie does not open it), is accepted. Without CRON_SECRET the route is
// closed (503), never open. The proxy checks the same thing first; this is the second lock. It never returns weather data.
export async function GET(req: Request) {
  const c = cronAllowed(req.headers.get("authorization"), process.env);
  if (c === "not_set_up") return Response.json({ error: "cron_not_set_up" }, { status: 503 });
  if (c === "denied") return Response.json({ error: "bearer_required" }, { status: 401 });
  const result = await refreshWeather({ force: true, trigger: "daily job" });
  return Response.json(result);
}
