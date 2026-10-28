import type { CardStatus, RefReason } from "./engine";

// The chip on a flock: a word AND an icon (colour is never the only signal). "No reference loaded" is never
// shown: when a flock has no age-based target the chip says why, in plain words.
const BY_STATUS: Record<Exclude<CardStatus, "no_reference">, { icon: string; label: string; tone: "green" | "amber" | "red" | "blue" | "grey" }> = {
  green: { icon: "✔", label: "On target", tone: "green" },
  amber: { icon: "⚠", label: "Below target", tone: "amber" },
  red: { icon: "✖", label: "Well below target", tone: "red" },
  moult: { icon: "◐", label: "Moulting", tone: "blue" },
  ramping: { icon: "↗", label: "Ramping up", tone: "blue" },
  left: { icon: "–", label: "Left the farm", tone: "grey" },
};
const BY_REASON: Partial<Record<RefReason, string>> = {
  no_date: "Placement date missing",
  placeholder_date: "Placement date missing",
  beyond_table: "Past the target table",
  before_table: "Too young for the table",
  no_breed_ref: "No target for this breed",
  no_age_row: "No target for this week",
};

export function chip(c: { status: CardStatus; refReason?: RefReason }): { icon: string; label: string; tone: string; css: string } {
  if (c.status === "no_reference") {
    const label = BY_REASON[c.refReason ?? "no_age_row"] ?? "No age-based target";
    return { icon: "ⓘ", label, tone: "grey", css: "no_reference" };
  }
  const x = BY_STATUS[c.status];
  return { ...x, css: c.status };
}
