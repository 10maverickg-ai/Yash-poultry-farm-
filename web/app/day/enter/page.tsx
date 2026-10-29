import Link from "next/link";
import { loadManualContext } from "@/lib/day/manualLoad";
import { listProductionDates } from "@/lib/day/load";
import { ManualDayForm } from "@/components/ManualDayForm";
import { saveManualDay } from "./actions";
import { dmy } from "@/lib/format";
import { todayIST } from "@/lib/weather/openMeteo";

export const dynamic = "force-dynamic";

export const metadata = { title: "Enter a day by hand" };

const iso = /^\d{4}-\d{2}-\d{2}$/;
const addDay = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);

export default async function EnterDayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const dates = await listProductionDates();
  const latest = dates.length ? dates[dates.length - 1] : null;
  const today = todayIST();
  // the day after the last saved day, but never a day that has not happened yet
  const next = latest ? addDay(latest) : today;
  const date = iso.test(sp.date ?? "") ? sp.date! : next > today ? today : next;
  const ctx = await loadManualContext(date);
  const rateNote = ctx.rate
    ? `Egg rate for ${dmy(ctx.rate.rateDate)}: ₹${ctx.rate.effective.toFixed(2)} per egg${ctx.rate.carried ? " (carried from an earlier day: rate not updated)" : ""}.`
    : "No egg rate saved for this day yet: sales are saved without a price and appear under “Days with sales but no rate”.";
  return (
    <>
      <h1>Enter a day by hand</h1>
      <p className="muted">
        For when the photo reader is not available. Type one day from the register: the birds, opening stocks and layout are filled in from yesterday{ctx.prevDate ? ` (${dmy(ctx.prevDate)})` : ""}.
        The checks below add up your rows against the page totals, the birds from day to day, the feed box and both egg ledgers. The day is saved in exactly the
        same tables as a photo, marked “manual entry”. Anything that does not tie is saved with a flag, never guessed.
      </p>
      <form method="get" className="day-pick" style={{ marginBottom: "0.75rem" }}>
        <label className="field" style={{ margin: 0 }}><span>Date of the page</span><input type="date" name="date" defaultValue={date} max={today} /></label>
        <button type="submit" className="btn-secondary">Open this day</button>
      </form>
      <ManualDayForm key={date + String(ctx.saved)} initial={ctx.day} action={saveManualDay} saved={ctx.saved} savedBy={ctx.savedBy} rateNote={rateNote} movements={ctx.movements} />
      <p className="muted an-tiny"><Link href="/upload">← Upload photos</Link> · <Link href="/day">Day view</Link></p>
    </>
  );
}
