"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Phone-width tables (V12 audit A1): below 600 px every wide table is shown as a stack of cards, one card per row, with the
// column heading beside each value (CSS in globals.css: table[data-stacked]). This only adds `data-label` attributes and a
// `data-stacked` flag; the server-rendered table is unchanged, so without JavaScript it still scrolls sideways as before.
// Tables with 4 columns or fewer, tables marked class "no-stack", and tables whose header has merged cells stay as they are.

function prepare(table: HTMLTableElement) {
  if (table.classList.contains("no-stack") || table.dataset.stacked) return;
  const head = table.tHead?.rows[0];
  if (!head) return;
  const cols = [...head.cells];
  if (cols.length <= 4 || cols.some((c) => c.colSpan > 1)) return;
  const labels = cols.map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
  const rows = [...table.tBodies].flatMap((b) => [...b.rows]);
  for (const r of rows) {
    const cells = [...r.cells];
    if (cells.length === labels.length && !cells.some((c) => c.colSpan > 1)) cells.forEach((c, i) => c.setAttribute("data-label", labels[i]));
    else r.setAttribute("data-wide", "1");
  }
  table.dataset.stacked = "1";
  if (cols.length >= 8) table.dataset.heavy = "1"; // 8 or more columns: cards on a tablet too
}

function scan() {
  document.querySelectorAll<HTMLTableElement>("main table").forEach(prepare);
}

export function StackTables() {
  const path = usePathname();
  useEffect(() => {
    scan();
    let t: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(scan, 60);
    });
    mo.observe(document.querySelector("main") ?? document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      clearTimeout(t);
    };
  }, [path]);
  return null;
}
