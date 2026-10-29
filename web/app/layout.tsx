import type { Metadata } from "next";
import Link from "next/link";
import { ACTIVE_FARM, ACTIVE_FARM_NAME } from "@/lib/farm";
import { Suspense } from "react";
import { MainNav } from "@/components/MainNav";
import { StackTables } from "@/components/StackTables";
import { peekSession } from "@/lib/auth/guard";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: ACTIVE_FARM_NAME, template: `%s — ${ACTIVE_FARM_NAME}` },
  description: "Register entry and records for Yash Poultry Farm",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Who is looking decides what the menu shows: a staff phone and the login screen get no menu at all.
  const session = await peekSession();
  const owner = session?.role === "owner";
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to the page</a>
        <header className="site-header">
          <div className="header-row">
            <Link href={owner ? "/" : session ? "/upload" : "/login"} className="brand">
              {ACTIVE_FARM_NAME}
            </Link>
            {owner && <span className="farm-badge">{ACTIVE_FARM}</span>}
            {session && (
              <form action="/api/logout" method="post" className="logout-form">
                <button type="submit" className="logout-btn">Log out</button>
              </form>
            )}
          </div>
          {owner && <Suspense fallback={null}><MainNav position="top" /></Suspense>}
        </header>
        <main id="main" tabIndex={-1}>{children}</main>
        <StackTables />
        {owner && <Suspense fallback={null}><MainNav position="bottom" /></Suspense>}
      </body>
    </html>
  );
}
