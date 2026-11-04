// Runs before every page, route and server-action call (Next.js 16 "proxy", the new name for middleware). All the thinking is in
// lib/auth/gate.ts; this file only turns its answer into a response. Server actions and routes check the session again themselves.
import { NextResponse, type NextRequest } from "next/server";
import { gate } from "@/lib/auth/gate";
import { SESSION_COOKIE } from "@/lib/auth/session";

export function proxy(req: NextRequest) {
  const r = gate(
    {
      pathname: req.nextUrl.pathname,
      search: req.nextUrl.search,
      method: req.method,
      authorization: req.headers.get("authorization"),
      nextAction: req.headers.get("next-action"),
      cookie: req.cookies.get(SESSION_COOKIE)?.value,
    },
    process.env,
    Date.now()
  );
  const noStore = (res: NextResponse) => {
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  switch (r.kind) {
    case "redirect":
      return noStore(NextResponse.redirect(new URL(r.to, req.url)));
    case "json":
      return noStore(NextResponse.json({ error: r.error }, { status: r.status }));
    case "setup":
      return noStore(NextResponse.rewrite(new URL("/login?e=setup", req.url), { status: 503 }));
    case "next": {
      const res = NextResponse.next();
      if (r.noStore) res.headers.set("Cache-Control", "no-store");
      if (r.setCookie) res.cookies.set(r.setCookie.name, r.setCookie.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: r.setCookie.maxAge });
      return res;
    }
  }
}

// Everything except the built static files. (Static files hold no data; everything else is gated, including icons and the
// service worker, which the gate lets through by name.)
export const config = { matcher: ["/((?!_next/static).*)"] };
