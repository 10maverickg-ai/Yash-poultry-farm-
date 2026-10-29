"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// The seven sections of the app. Phones get a fixed bottom bar (big tap
// targets); wider screens get the same links in the header. The second row
// lists the pages inside the active section, so every older page stays
// reachable without a long menu.
export const SECTIONS = [
  { key: "upload", label: "Upload", icon: "📷", href: "/upload", match: ["/upload", "/flagged"],
    subs: [["/upload", "Upload photos"], ["/flagged", "Review flags"]] },
  { key: "day", label: "Day", icon: "🥚", href: "/day", match: ["/day", "/production", "/egg-stock", "/feed-bag-stock", "/records", "/export"],
    subs: [["/day", "Day view"], ["/production", "Correct a day"], ["/egg-stock", "Egg ledger"], ["/feed-bag-stock", "Feed bags"], ["/records", "Records"], ["/export", "Excel / backup"]] },
  { key: "sales", label: "Sales", icon: "₹", href: "/sales", match: ["/sales"],
    subs: [["/sales", "Egg & bird sales"], ["/sales/rates", "BAFTA rates"]] },
  { key: "purchases", label: "Buy", icon: "🧾", href: "/purchases", match: ["/purchases", "/feed-stock", "/formulation"],
    subs: [["/purchases", "Purchases & costs"], ["/feed-stock", "Feed stock"], ["/formulation", "Formulation"]] },
  { key: "medicines", label: "Meds", icon: "💉", href: "/medicines", match: ["/medicines", "/knowledge"],
    subs: [["/medicines", "Medicines & vaccines"], ["/medicines/import", "Import lines"], ["/knowledge", "Knowledge"]] },
  { key: "flocks", label: "Flocks", icon: "🐔", href: "/flocks", match: ["/flocks", "/chick-batches", "/sheds"],
    subs: [["/flocks", "Flocks"], ["/flocks/batches", "Chick batches"], ["/flocks/moulting", "Moulting"], ["/chick-batches", "Chick log"], ["/sheds", "Sheds"]] },
  { key: "analytics", label: "Analytics", icon: "📊", href: "/analytics", match: ["/analytics", "/today", "/import"],
    subs: [["/today", "Today"], ["/analytics", "Analytics"], ["/analytics/targets", "How targets are learned"], ["/analytics/reference", "Farm reference"], ["/import", "Import old registers"]] },
] as const;

function active(path: string, match: readonly string[]) {
  return match.some((m) => path === m || path.startsWith(m + "/"));
}

export function MainNav({ position }: { position: "top" | "bottom" }) {
  const path = usePathname() ?? "/";
  const view = useSearchParams()?.get("view") ?? "";
  const current = SECTIONS.find((s) => active(path, s.match));
  if (position === "bottom") {
    return (
      <nav className="bottom-nav" aria-label="Sections">
        {SECTIONS.map((s) => (
          <Link key={s.key} href={s.href} className={current?.key === s.key ? "on" : ""} aria-current={current?.key === s.key ? "page" : undefined}>
            <span className="bn-icon" aria-hidden="true">{s.icon}</span>
            <span className="bn-label">{s.label}</span>
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <>
      <nav className="site-nav top-sections" aria-label="Sections">
        {SECTIONS.map((s) => (
          <Link key={s.key} href={s.href} className={current?.key === s.key ? "on" : ""}>
            {s.label}
          </Link>
        ))}
      </nav>
      {current && current.subs.length > 1 && (
        <nav className="sub-nav" aria-label={`${current.label} pages`}>
          {current.subs.map(([href, label]) => (
            <Link key={href} href={href} className={(() => {
                const [hp, hq] = href.split("?");
                const hv = new URLSearchParams(hq ?? "").get("view") ?? "";
                return path === hp && (hp !== "/analytics" || hv === view) ? "on" : "";
              })()}>
              {label}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
