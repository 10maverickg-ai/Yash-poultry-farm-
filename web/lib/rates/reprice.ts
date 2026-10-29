// "Re-price this day" (V12 N6): when a rate is edited after sales exist (a subsidy arrives later), the owner can recalculate the
// day's sales at the new rate: Farmfresh = rate − 0.03, local = rate + 0.01 (the same rule as when the sale was created).
// The plan is a pure function; nothing is ever re-priced without the owner seeing the before and after totals and confirming.
import { salePrice } from "./parse";

export interface SaleForReprice {
  id: number;
  transactionType: string | null; // 'sale_farmfresh' = Farmfresh rule; anything else = local rule
  recipient: string | null;
  buyer: string | null;
  grade: string | null;
  eggs: number;
  price: number | null;
  amount: number | null;
}
export interface RepriceRow extends SaleForReprice {
  kind: "farmfresh" | "local";
  newPrice: number;
  newAmount: number;
  changes: boolean;
}
export interface RepricePlan {
  rate: number;
  rows: RepriceRow[];
  totalBefore: number;
  totalAfter: number;
  delta: number;
  changed: number;
}
const r2 = (x: number) => Math.round(x * 100) / 100;

export function repricePlan(rate: number, sales: SaleForReprice[]): RepricePlan {
  const rows: RepriceRow[] = sales.map((s) => {
    const kind = s.transactionType === "sale_farmfresh" ? "farmfresh" : "local";
    const newPrice = salePrice(rate, kind);
    const newAmount = r2(s.eggs * newPrice);
    return { ...s, kind, newPrice, newAmount, changes: s.price == null || Math.abs(s.price - newPrice) > 0.004 || s.amount == null || Math.abs(s.amount - newAmount) > 0.5 };
  });
  const totalBefore = r2(rows.reduce((t, r) => t + (r.amount ?? 0), 0));
  const totalAfter = r2(rows.reduce((t, r) => t + r.newAmount, 0));
  return { rate, rows, totalBefore, totalAfter, delta: r2(totalAfter - totalBefore), changed: rows.filter((r) => r.changes).length };
}
