import type { Metadata } from "next";
import { LoginForm } from "@/components/LoginForm";
import { authConfig } from "@/lib/auth/env";
import { MESSAGE } from "@/lib/auth/login";
import { safeNext } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Log in", robots: { index: false, follow: false } };

const NOTE: Record<string, string> = { ...MESSAGE, out: "You are logged out.", staffdown: "Staff login is not available right now. Ask the owner.", expired: "Your login has ended. Log in again." };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string; next?: string }> }) {
  const sp = await searchParams;
  const cfg = authConfig();
  if (cfg.mode === "not_set_up") {
    return (
      <div className="card login-card" role="alert">
        <h1 style={{ marginTop: 0 }}>Login is not set up yet</h1>
        <p>Nobody can open the app until the login is set up. This is on purpose: it keeps the farm records closed.</p>
        <p className="muted">The owner finishes it in Vercel (Project Settings, Environment Variables) and then redeploys. The steps are in docs/AUTH.md.</p>
      </div>
    );
  }
  const note = sp.e ? NOTE[sp.e] : null;
  const bad = sp.e && sp.e !== "out" && sp.e !== "expired";
  return (
    <div className="card login-card">
      <h1 style={{ marginTop: 0 }}>Log in</h1>
      {note && (
        <p className={bad ? "error-banner" : "saved-banner"} role="status" aria-live="polite">
          {note}
        </p>
      )}
      <LoginForm next={safeNext(sp.next)} />
    </div>
  );
}
