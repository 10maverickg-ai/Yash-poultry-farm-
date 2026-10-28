import Link from "next/link";
import { dmy, daysBetween } from "@/lib/format";

// "Data up to <date>" on every board, and a visible warning when the latest day entered is more than a day old.
export function DataStamp({ latest, today }: { latest: string; today: string }) {
  const age = daysBetween(latest, today);
  const stale = age > 1;
  return (
    <div className={`data-stamp ${stale ? "data-stamp-old" : ""}`} role={stale ? "alert" : undefined}>
      <b>Data up to {dmy(latest)}</b>
      {age <= 0 ? " — today." : age === 1 ? " — yesterday." : "."}
      {stale && (
        <span>
          {" "}⚠ The latest day entered is {age} days old, so everything below describes {dmy(latest)}, not today. <Link href="/upload">Upload the newer register photos</Link>.
        </span>
      )}
    </div>
  );
}
