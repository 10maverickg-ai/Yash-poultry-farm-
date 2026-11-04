import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { productionLike } from "@/lib/auth/env";

export const dynamic = "force-dynamic";

// POST /api/logout: ends this phone's session. A plain form post (works without JavaScript); the answer is a redirect to the login screen.
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login?e=out", req.url), 303);
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: productionLike(), sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
