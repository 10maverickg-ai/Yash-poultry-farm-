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

const TRANSACTION_TYPES = [
  "sale_farmfresh",
  "sale_wholesaler",
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

    const res = await pool.query(
      `UPDATE sales
          SET transaction_type = $2, grade = $3, price_per_unit = $4, amount = $5
        WHERE id = $1 AND farm_code = $6`,
      [
        saleId,
        ttype,
        optStr(formData, "grade"),
        optNum(formData, "price_per_unit"),
        optNum(formData, "amount"),
        ACTIVE_FARM,
      ]
    );
    if (res.rowCount === 0) throw new Error("Sale not found");
  } catch (err) {
    return { error: errorMessage(err), values: formValues(formData) };
  }
  revalidatePath("/sales");
  redirect("/sales?saved=1");
}
