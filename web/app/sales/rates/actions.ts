"use server";

import { requireOwner } from "@/lib/auth/guard";
import { revalidatePath } from "next/cache";
import { parseRateMessages, parseNetPriceList, rateNumbers } from "@/lib/rates/parse";
import { friendlyReaderError } from "@/lib/reader/friendlyError";
import { existingRateDates, saveRates, type RateToSave } from "@/lib/rates/store";
import { getAnthropicClient, EXTRACTION_MODEL } from "@/lib/extraction/anthropicClient";

export interface PreviewRow {
  key: string;
  messageDate: string | null;
  enteredDate: string | null; // the date the owner said he is entering, if any
  per100: number;
  subsidyPaise: number;
  original: string;
  notes: string[];
  existing: number | null; // rate already stored for the date (will be replaced)
  effective: number;
  farmfresh: number;
  local: number;
  source: "sms" | "list"; // a pasted BAFTA message (raw rate) or the owner's own net price list
}
export interface PreviewState {
  rows: PreviewRow[];
  error?: string;
  saved?: string;
}

const iso = /^\d{4}-\d{2}-\d{2}$/;

// Screenshot -> text. This is the ONLY place the rate flow can call the
// Anthropic API (vision). It is optional: pasted text needs no API at all. Any
// failure is reported in plain words and nothing is saved.
async function textFromScreenshot(file: File): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Reading a screenshot needs the Anthropic key, which is not set here. Paste the message text instead.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const mediaType = (file.type === "image/png" || file.type === "image/webp" || file.type === "image/gif" ? file.type : "image/jpeg") as "image/png" | "image/webp" | "image/gif" | "image/jpeg";
  const res = await getAnthropicClient().messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 600,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") } },
          { type: "text", text: "Transcribe every egg-rate SMS visible in this screenshot exactly as written, one message per line, including its date. Output only the text." },
        ],
      },
    ],
  });
  return res.content.map((c) => (c.type === "text" ? c.text : "")).join("\n").trim();
}

export async function previewRates(_prev: PreviewState | null, formData: FormData): Promise<PreviewState> {
  await requireOwner();
  try {
    let text = String(formData.get("text") ?? "");
    const shot = formData.get("screenshot");
    if (shot instanceof File && shot.size > 0) text += "\n" + (await textFromScreenshot(shot));
    const entered = String(formData.get("enteredDate") ?? "");
    const enteredDate = iso.test(entered) ? entered : null;
    const source: "list" | "sms" | null = formData.get("source") === "list" ? "list" : formData.get("source") === "sms" ? "sms" : null;
    if (!source) return { rows: [], error: "First say what these numbers are: a BAFTA message (the raw rate) or your own price list (your net selling price)." };
    const parsed = source === "list" ? parseNetPriceList(text) : parseRateMessages(text);
    if (parsed.length === 0) {
      return {
        rows: [],
        error: source === "list"
          ? "I could not find a price in that text. Write one line per day, for example: 19 Oct 2026  5.22"
          : "I could not find a rate in that text. It should look like: OCTOBER 19, 2026 BFTA EGG RATE RS.560/- Subsidy for 0 Paise",
      };
    }
    const dates = [...new Set(parsed.flatMap((p) => [p.date, enteredDate]).filter((d): d is string => !!d))];
    const existing = await existingRateDates(dates);
    const rows = parsed.map((p, i) => {
      const n = rateNumbers(p.per100, p.subsidyPaise);
      const date = p.date ?? enteredDate;
      return {
        key: String(i),
        messageDate: p.date,
        enteredDate,
        per100: p.per100,
        subsidyPaise: p.subsidyPaise,
        original: p.original,
        notes: p.notes,
        existing: date ? existing.get(date) ?? null : null,
        effective: n.effective,
        farmfresh: n.farmfresh,
        local: n.local,
        source,
      };
    });
    return { rows };
  } catch (e) {
    const paused = friendlyReaderError(e);
    return { rows: [], error: paused ? paused.friendly : e instanceof Error ? e.message : "Could not read the message." };
  }
}

export async function confirmRates(_prev: PreviewState | null, formData: FormData): Promise<PreviewState> {
  await requireOwner();
  try {
    const toSave: RateToSave[] = [];
    const seen = new Set<string>();
    for (const key of formData.getAll("key").map(String)) {
      if (formData.get(`use_${key}`) !== "on") continue;
      const date = String(formData.get(`date_${key}`) ?? "");
      const per100 = Number(formData.get(`per100_${key}`));
      const subsidy = Number(formData.get(`subsidy_${key}`) ?? 0);
      if (!iso.test(date)) return { rows: [], error: `Row ${Number(key) + 1}: choose a valid date.` };
      if (!(per100 >= 100 && per100 <= 2000)) return { rows: [], error: `Row ${Number(key) + 1}: the rate ${per100} per 100 does not look right.` };
      if (!(subsidy >= 0 && subsidy <= 200)) return { rows: [], error: `Row ${Number(key) + 1}: subsidy ${subsidy} paise does not look right.` };
      if (seen.has(date)) return { rows: [], error: `Two rows are for ${date}. Keep one.` };
      seen.add(date);
      // A date that differs from the one being entered must be confirmed explicitly.
      const msgDate = String(formData.get(`msgdate_${key}`) ?? "");
      const entered = String(formData.get(`entered_${key}`) ?? "");
      if (msgDate && entered && msgDate !== entered && formData.get(`confirmdate_${key}`) !== "on") {
        return { rows: [], error: `Row ${Number(key) + 1}: the message says ${msgDate} but you are entering ${entered}. Tick "the message date is right" or fix the date.` };
      }
      const src = formData.get(`src_${key}`) === "list" ? "list" : "sms";
      toSave.push({ date, per100, subsidyPaise: Math.round(subsidy), original: String(formData.get(`orig_${key}`) ?? ""), dateInMessage: iso.test(msgDate) ? msgDate : null, source: src === "list" ? "owner price list (net selling price, stored +0.03)" : "pasted rate message" });
    }
    if (toSave.length === 0) return { rows: [], error: "Nothing selected to save." };
    const { saved, salesCreated } = await saveRates(toSave);
    revalidatePath("/sales");
    revalidatePath("/sales/rates");
    return { rows: [], saved: `Saved ${saved} rate${saved === 1 ? "" : "s"}${salesCreated ? `; created ${salesCreated} sales row${salesCreated === 1 ? "" : "s"} from ledger lines` : ""}.` };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "Could not save the rates." };
  }
}
