"use server";

import { requireOwner } from "@/lib/auth/guard";
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
  await requireOwner();
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
  await requireOwner();
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
  await requireOwner();
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

// ---- monthly "inputs still missing" checklist ---------------------------------
const MONTH_INPUTS = ["electricity", "diesel", "medicines", "labour", "packing", "other"] as const;

async function setStatus(month: string, key: string, status: "none" | "confirmed") {
  await pool.query(
    `INSERT INTO monthly_input_status (farm_code, month, input_key, status) VALUES ($1,$2,$3,$4)
     ON CONFLICT (farm_code, month, input_key) DO UPDATE SET status = EXCLUDED.status, created_at = now()`,
    [ACTIVE_FARM, month, key, status]
  );
}

export async function completeMonthInput(month: string, key: string, formData: FormData) {
  await requireOwner();
  if (!/^\d{4}-\d{2}$/.test(month) || !(MONTH_INPUTS as readonly string[]).includes(key)) back("Unknown month or item.");
  const first = `${month}-01`;
  const num = (name: string) => positive(formData.get(name));
  const none = formData.get("none") !== null;

  if (key === "electricity") {
    const v = num("value");
    if (v == null) back("Enter the electricity bill in rupees.");
    await pool.query(
      `INSERT INTO cost_settings (farm_code, cost_type, value, unit, effective_from, month, note) VALUES ($1,'electricity_month',$2,'INR/month',$3,$4,'Entered from the monthly checklist')`,
      [ACTIVE_FARM, v, first, month]
    );
  } else if (key === "diesel") {
    if (none) await setStatus(month, "diesel", "none");
    else {
      const litres = num("litres");
      const amount = num("amount_inr");
      const date = String(formData.get("date") ?? first);
      if (litres == null || litres <= 0 || amount == null) back("Enter litres and amount, or tap “None this month”.");
      if (!iso.test(date) || !date.startsWith(month)) back("The date must be inside that month.");
      await pool.query(`INSERT INTO diesel_purchases (farm_code, date, litres, amount_inr, note) VALUES ($1,$2,$3,$4,'Entered from the monthly checklist')`, [ACTIVE_FARM, date, litres, amount]);
    }
  } else if (key === "medicines") {
    if (none) await setStatus(month, "medicines", "none");
    else {
      const amount = num("amount_inr");
      const item = String(formData.get("item") ?? "").trim();
      const date = String(formData.get("date") ?? first);
      if (!item || amount == null) back("Say what was bought and the amount, or tap “None this month”.");
      if (!iso.test(date) || !date.startsWith(month)) back("The date must be inside that month.");
      await pool.query(`INSERT INTO purchases (farm_code, date, category, item, amount_inr, note) VALUES ($1,$2,'medicine',$3,$4,'Entered from the monthly checklist')`, [ACTIVE_FARM, date, item, amount]);
    }
  } else if (key === "other") {
    if (none) await setStatus(month, "other", "none");
    else {
      const amount = num("amount_inr");
      const item = String(formData.get("item") ?? "").trim();
      const date = String(formData.get("date") ?? first);
      if (!item || amount == null) back("Say what it was and the amount, or tap “None this month”.");
      if (!iso.test(date) || !date.startsWith(month)) back("The date must be inside that month.");
      await pool.query(`INSERT INTO purchases (farm_code, date, category, item, amount_inr, note) VALUES ($1,$2,'other',$3,$4,'Entered from the monthly checklist')`, [ACTIVE_FARM, date, item, amount]);
    }
  } else if (key === "labour") {
    const v = num("value");
    if (v == null) back("Enter the labour total for the month in rupees.");
    await pool.query(
      `INSERT INTO cost_settings (farm_code, cost_type, value, unit, effective_from, month, note) VALUES ($1,'labour_month',$2,'INR/month',$3,$4,'Confirmed from the monthly checklist')`,
      [ACTIVE_FARM, v, first, month]
    );
    await setStatus(month, "labour", "confirmed");
  } else if (key === "packing") {
    const v = num("value");
    if (v == null) back("Enter the packing cost per tray in rupees.");
    const cur = await pool.query(`SELECT value FROM cost_settings WHERE farm_code = $1 AND cost_type = 'packing_per_tray' AND month IS NULL AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`, [ACTIVE_FARM, first]);
    if (!cur.rows[0] || Number(cur.rows[0].value) !== v) {
      await pool.query(`INSERT INTO cost_settings (farm_code, cost_type, value, unit, effective_from, note) VALUES ($1,'packing_per_tray',$2,'INR/tray',$3,'Changed from the monthly checklist')`, [ACTIVE_FARM, v, first]);
    }
    await setStatus(month, "packing", "confirmed");
  }
  revalidatePath("/purchases");
  back("Saved.", true);
}
