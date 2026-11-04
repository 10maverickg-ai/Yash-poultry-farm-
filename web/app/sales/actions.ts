"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import {
  type ActionState,
  errorMessage,
  formValues,
  optNum,
  optStr,
} from "@/lib/forms";
import { isRecipient } from "@/lib/sales/recipients";

const TRANSACTION_TYPES = [
  "sale_farmfresh",
  "sale_wholesaler",
  "local",
  "gift",
  "staff_allocation",
  "other",
];

// Sale detail the ledger line doesn't carry: type, grade, and the optional
// price/amount (no paper source — manual only, per the schema spec).
// date/buyer/quantity stay derived from the ledger entry and aren't editable.
export async function updateSale(
  saleId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const ttype = optStr(formData, "transaction_type");
    if (ttype && !TRANSACTION_TYPES.includes(ttype))
      throw new Error("Invalid transaction type");

    const recipient = optStr(formData, "recipient");
    if (recipient && !isRecipient(recipient)) throw new Error("Choose who got the eggs from the list.");
    const res = await pool.query(
      `UPDATE sales
          SET transaction_type = $2, grade = $3, price_per_unit = $4, amount = $5, recipient = COALESCE($7, recipient)
        WHERE id = $1 AND farm_code = $6`,
      [
        saleId,
        ttype,
        optStr(formData, "grade"),
        optNum(formData, "price_per_unit"),
        optNum(formData, "amount"),
        ACTIVE_FARM,
        recipient,
      ]
    );
    if (res.rowCount === 0) throw new Error("Sale not found");
  } catch (err) {
    return { error: errorMessage(err), values: formValues(formData) };
  }
  revalidatePath("/sales");
  redirect("/sales?saved=1");
}

// The buyer of an old-bird sale is not recorded yet; the owner can add it here.
// Left empty it stays empty (nothing is guessed). Only movements of type 'sale'
// can be changed through this.
export async function setBirdSaleBuyer(id: number, formData: FormData) {
  const buyer = String(formData.get("buyer") ?? "").trim().slice(0, 80);
  await pool.query(
    `UPDATE flock_movements SET buyer = $2 WHERE id = $1 AND farm_code = $3 AND movement_type = 'sale'`,
    [id, buyer === "" ? null : buyer, ACTIVE_FARM]
  );
  revalidatePath("/sales");
  redirect("/sales");
}

// Quick change of who got the eggs, straight from the Sales list. Never touches the price or the amount.
export async function setSaleRecipient(saleId: number, formData: FormData) {
  const recipient = String(formData.get("recipient") ?? "");
  if (!isRecipient(recipient)) redirect("/sales?error=" + encodeURIComponent("Choose who got the eggs from the list."));
  await pool.query(`UPDATE sales SET recipient = $2 WHERE id = $1 AND farm_code = $3`, [saleId, recipient, ACTIVE_FARM]);
  revalidatePath("/sales");
  redirect("/sales?saved=1");
}
