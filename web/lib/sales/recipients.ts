// Who got the eggs (V12 N6). The recipient never changes a price: a sale to a Yash P.F. farm is priced like a Farmfresh sale
// at the day's selling price, exactly as before. Pure functions, tested by scripts/reprice-check.mts.
export const RECIPIENTS = [
  { key: "farmfresh", label: "Farmfresh" },
  { key: "local", label: "Local" },
  { key: "yash_12", label: "Yash P.F. 12 farm" },
  { key: "yash_13", label: "Yash P.F. 13 farm" },
  { key: "yash_14", label: "Yash P.F. 14 farm" },
  { key: "yash_farms", label: "Yash P.F. farms (several together)" },
  { key: "anil", label: "Anil farm" },
  { key: "other", label: "Other" },
] as const;
export type RecipientKey = (typeof RECIPIENTS)[number]["key"];

export const isRecipient = (k: string): k is RecipientKey => RECIPIENTS.some((r) => r.key === k);
export const recipientLabel = (k: string | null | undefined): string => RECIPIENTS.find((r) => r.key === k)?.label ?? "Not set";

/** The recipient a ledger line most likely means: Yash P.F. farms named in the label (one farm = that farm, several = "several"), Anil farm, else the sale kind. */
export function recipientFor(kind: "farmfresh" | "local", label: string): RecipientKey {
  if (/yash\s*p\.?\s*f/i.test(label)) {
    const farms = new Set([...label.matchAll(/\b(12|13|14)\s*farm\b/gi)].map((m) => m[1]));
    return farms.size === 1 ? (`yash_${[...farms][0]}` as RecipientKey) : "yash_farms";
  }
  if (/\banil\b/i.test(label)) return "anil";
  return kind;
}
