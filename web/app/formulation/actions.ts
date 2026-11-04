"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import {
  type ActionState,
  errorMessage,
  formValues,
  optDate,
  optInt,
  optNum,
  optStr,
} from "@/lib/forms";

// Records one formulation version: a set of material+quantity lines sharing
// the group label, effective date, batch total, and reason. Versioned
// reference data (spec Table 7) — a recipe change is a NEW effective_date
// for the group, not an edit of old rows, which is what lets Phase 4 overlay
// formulation changes on the production timeline.
export async function saveFormulation(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const group = optStr(formData, "formulation_group");
    const effectiveDate = optDate(formData, "effective_date");
    if (!group || !effectiveDate)
      throw new Error("Group and effective date are required");
    const batchTotal = optNum(formData, "batch_total_kg");
    const reason = optStr(formData, "reason_for_change");

    const count = optInt(formData, "line_count") ?? 0;
    const lines: { material: string; qty: number }[] = [];
    for (let i = 0; i < count; i++) {
      const material = optStr(formData, `material_${i}`);
      const qty = optNum(formData, `quantity_${i}`);
      if (material === null && qty === null) continue;
      if (material === null || qty === null)
        throw new Error(`Line ${i + 1} needs both a material and a quantity`);
      lines.push({ material, qty });
    }
    if (lines.length === 0) throw new Error("Add at least one material line");
    const names = lines.map((l) => l.material);
    if (new Set(names).size !== names.length)
      throw new Error("A material appears twice — each material once per version");

    await withTransaction(async (client) => {
      for (const line of lines) {
        await client.query(
          `INSERT INTO feed_formulation
               (effective_date, farm_code, formulation_group, material_name,
                quantity_kg, batch_total_kg, reason_for_change)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [effectiveDate, ACTIVE_FARM, group, line.material, line.qty, batchTotal, reason]
        );
      }
    });
  } catch (err) {
    let error = errorMessage(err);
    if (error.includes("duplicate key"))
      error =
        "A version for this group and effective date already exists — pick a different date for the new version";
    return { error, values: formValues(formData) };
  }
  revalidatePath("/formulation");
  redirect("/formulation?saved=1");
}
