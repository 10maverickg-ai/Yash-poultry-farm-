import type { Metadata } from "next";
import Link from "next/link";
import { ACTIVE_FARM, ACTIVE_FARM_NAME } from "@/lib/farm";
import { Suspense } from "react";
import { MainNav } from "@/components/MainNav";
import { StackTables } from "@/components/StackTables";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: ACTIVE_FARM_NAME, template: `%s — ${ACTIVE_FARM_NAME}` },
  description: "Register entry and records for Yash Poultry Farm",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to the page</a>
        <header className="site-header">
          <Link href="/" className="brand">
            {ACTIVE_FARM_NAME}
          </Link>
          <span className="farm-badge">{ACTIVE_FARM}</span>
          <Suspense fallback={null}><MainNav position="top" /></Suspense>
        </header>
        <main id="main" tabIndex={-1}>{children}</main>
        <StackTables />
        <Suspense fallback={null}><MainNav position="bottom" /></Suspense>
      </body>
    </html>
  );
}
