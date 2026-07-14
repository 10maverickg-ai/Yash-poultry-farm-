import type { Metadata } from "next";
import Link from "next/link";
import { ACTIVE_FARM, ACTIVE_FARM_NAME } from "@/lib/farm";
import "./globals.css";

export const metadata: Metadata = {
  title: ACTIVE_FARM_NAME,
  description: "Register entry and records for Yash Poultry Farm",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            {ACTIVE_FARM_NAME}
          </Link>
          <span className="farm-badge">{ACTIVE_FARM}</span>
          <nav className="site-nav">
            <Link href="/production">Production</Link>
            <Link href="/egg-stock">Egg Stock</Link>
            <Link href="/sales">Sales</Link>
            <Link href="/feed-stock">Feed</Link>
            <Link href="/feed-bag-stock">Feed Bags</Link>
            <Link href="/formulation">Formulation</Link>
            <Link href="/flocks">Flocks</Link>
            <Link href="/chick-batches">Chick Batches</Link>
            <Link href="/sheds">Sheds</Link>
            <Link href="/records">Records</Link>
            <Link href="/flagged">Flagged</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
