"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import {
  type ActionState,
  errorMessage,
  formValues,
  optInt,
  optStr,
} from "@/lib/forms";

export async function createShed(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const shedCode = optStr(formData, "shed_code");
    if (!shedCode) throw new Error("Shed code is required");
    await pool.query(
      `INSERT INTO sheds (farm_code, shed_code, shed_type, max_capacity, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        ACTIVE_FARM,
        shedCode,
        optStr(formData, "shed_type"),
        optInt(formData, "max_capacity"),
        optStr(formData, "notes"),
      ]
    );
  } catch (err) {
    let error = errorMessage(err);
    if (error.includes("duplicate key")) error = "That shed code already exists";
    return { error, values: formValues(formData) };
  }
  revalidatePath("/sheds");
  redirect("/sheds");
}

export async function updateShed(
  shedCode: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    await pool.query(
      `UPDATE sheds SET shed_type = $3, max_capacity = $4, notes = $5
        WHERE farm_code = $1 AND shed_code = $2`,
      [
        ACTIVE_FARM,
        shedCode,
        optStr(formData, "shed_type"),
        optInt(formData, "max_capacity"),
        optStr(formData, "notes"),
      ]
    );
  } catch (err) {
    return { error: errorMessage(err), values: formValues(formData) };
  }
  revalidatePath("/sheds");
  redirect("/sheds");
}
