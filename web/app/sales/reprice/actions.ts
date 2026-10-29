"use server";

import { requireOwner } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { applyReprice } from "@/lib/rates/repriceStore";

const iso = /^\d{4}-\d{2}-\d{2}$/;

// The owner confirmed the before/after totals he was shown. Never called without that form.
export async function confirmReprice(formData: FormData) {
  await requireOwner();
  const date = String(formData.get("date") ?? "");
  if (!iso.test(date)) redirect("/sales/reprice?error=" + encodeURIComponent("Choose a day."));
  const res = await applyReprice(date, Number(formData.get("before")), Number(formData.get("after")));
  revalidatePath("/sales");
  revalidatePath("/sales/reprice");
  if (!res.ok) redirect(`/sales/reprice?date=${date}&error=${encodeURIComponent(res.message)}`);
  redirect(`/sales/reprice?date=${date}&done=${res.changed}&before=${res.before}&after=${res.after}`);
}
