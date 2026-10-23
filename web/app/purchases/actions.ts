"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

const iso = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = ["feed_ingredient", "chicks", "packing", "electricity", "labour", "medicine", "vaccine", "diesel", "other"];
const COST_TYPES: Record<string, string> = {
  feed_per_kg: "INR/kg",
  labour_month: "INR/month",
  electricity_month: "INR/month",
  packing_per_tray: "INR/tray",
};

function back(msg: string, ok = false): never {
  redirect(`/purchases?${ok ? "saved" : "error"}=${encodeURIComponent(msg)}`);
}
const positive = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function addCostSetting(formData: FormData) {
  const type = String(formData.get("type") ?? "");
  const value = positive(formData.get("value"));
  const from = String(formData.get("effective_from") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!COST_TYPES[type]) back("Choose what the cost is.");
  if (value == null) back("Enter the amount as a number.");
  if (!iso.test(from)) back("Choose the date it applies from.");
  if (type === "electricity_month" && !/^\d{4}-\d{2}$/.test(month)) back("Electricity is entered per month: choose the month.");
  await pool.query(
    `INSERT INTO cost_settings (farm_code, cost_type, value, unit, effective_from, month, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ACTIVE_FARM, type, value, COST_TYPES[type], from, type === "electricity_month" ? month : null, String(formData.get("note") ?? "") || null]
  );
  revalidatePath("/purchases");
  back("Cost saved.", true);
}

export async function addPurchase(formData: FormData) {
  const category = String(formData.get("category") ?? "");
  const date = String(formData.get("date") ?? "");
  const item = String(formData.get("item") ?? "").trim();
  const amount = positive(formData.get("amount_inr"));
  if (!CATEGORIES.includes(category)) back("Choose a category.");
  if (!iso.test(date)) back("Choose the purchase date.");
  if (!item) back("Say what was bought.");
  if (amount == null) back("Enter the amount in rupees.");
  const qty = String(formData.get("quantity") ?? "").trim();
  await pool.query(
    `INSERT INTO purchases (farm_code, date, category, item, quantity, unit, amount_inr, supplier, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ACTIVE_FARM, date, category, item, qty === "" ? null : Number(qty), String(formData.get("unit") ?? "") || null, amount, String(formData.get("supplier") ?? "") || null, String(formData.get("note") ?? "") || null]
  );
  revalidatePath("/purchases");
  revalidatePath("/medicines");
  back("Purchase saved.", true);
}

export async function addDiesel(formData: FormData) {
  const date = String(formData.get("date") ?? "");
  const litres = positive(formData.get("litres"));
  const amount = positive(formData.get("amount_inr"));
  if (!iso.test(date)) back("Choose the date the drum was filled.");
  if (litres == null || litres <= 0) back("Enter the litres.");
  if (amount == null) back("Enter the amount in rupees.");
  await pool.query(
    `INSERT INTO diesel_purchases (farm_code, date, litres, amount_inr, note) VALUES ($1,$2,$3,$4,$5)`,
    [ACTIVE_FARM, date, litres, amount, String(formData.get("note") ?? "") || null]
  );
  revalidatePath("/purchases");
  back("Diesel saved.", true);
}
