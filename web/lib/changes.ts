// "What changed": the latest changes to the app, in plain words, newest first. Add a new entry at the top whenever
// the app changes in a way the owner will notice.
export interface Change {
  date: string; // YYYY-MM-DD
  title: string;
  points: string[];
}

export const CHANGES: Change[] = [
  {
    date: "2026-10-29",
    title: "A login for the app, a staff PIN for photo uploads, and the app on your home screen",
    points: [
      "The app now asks for a password before it shows anything. Type the owner password to see everything. Staff type a 4 to 6 digit PIN into the same box and can only upload register photos: they never see Today, Analytics, sales, costs or any record.",
      "Wrong tries are slowed down and counted: five wrong tries in 15 minutes lock that phone for 15 minutes, and 20 wrong PINs in an hour pause the PIN for an hour (your password keeps working). Settings shows Recent logins, whether a staff PIN is set, and a button “Log out all staff phones”.",
      "A phone stays logged in for 30 days of use. “Log out” is in the top bar and in Settings. If the login is not set up yet, every page just says “Login is not set up yet” and shows nothing else.",
      "You can put the app on your phone's home screen (Settings, How to install): on an iPhone tap Share, then Add to Home Screen; on Android tap Install. It opens like an app, with its own egg-and-leaf icon. If there is no signal it says so and offers Retry; it never keeps farm figures on the phone.",
      "Behind the scenes: the database's public door is written up with a ready, untested-on-live fix (docs/SECURITY_V13.md). Nothing was changed there; it needs your decision.",
    ],
  },
  {
    date: "2026-10-29",
    title: "Medicines ready for the register photos, enter a day by hand, health alert, who got the eggs",
    points: [
      "Medicines and vaccines: type a line quickly and tap “Save and add next”, see each month with totals per flock, tap “None this month” when nothing was given, edit or delete a line (it asks first), and import a CSV or Excel file (a template and a dry run that changes nothing come first). A priced line goes into Costs as medicines or vaccines. The vaccination list now says done, due soon, overdue or later.",
      "New screen “Enter a day by hand” (under Upload): type one whole day for all 11 flocks, the feed box, both egg ledgers and the chick rows when photo reading is not available. The app adds up your rows against the page totals, the birds from day to day and the ledgers as you type, and saves into the same tables as a photo, marked “manual entry”. Anything that does not tie is saved with a flag, never guessed.",
      "A flock whose deaths are above its usual two days running while its eggs fall more than 5% in a week now shows under “What is wrong now” with “call the vet”. It speaks once per episode, not every day.",
      "Sales: every sale shows who got the eggs (Farmfresh, Local, Yash P.F. 12, 13 or 14 farm, Anil farm, other) and you can change it without changing the price. After you correct a day's rate, “Re-price the sales of this day” shows the before and after totals and only changes them when you tap to confirm.",
      "New Settings page (under Analytics): when the weather last came in, the last problem in plain words, and a button “Refresh weather now”.",
      "On a phone the wide tables turn into cards, buttons and tick boxes are big enough for a thumb, every page has its own tab title, and the Medicines and Egg stock forms use plain words.",
    ],
  },
  {
    date: "2026-10-29",
    title: "Deaths judged on our own level, by season, and weather in the app",
    points: [
      "Every flock card now shows “deaths this week, our usual, the book”. The colour compares the week with our own usual level, because the breeder's book assumes a modern house. Until a flock's age has enough history, starting limits are used and marked “starting value”.",
      "The realistic targets are learned separately for each Punjab season (hot, monsoon, cool, cold, spring). Where one season has too little history, the card says “all seasons”.",
      "The weather for Mohali (max and min temperature, humidity, rain) is kept each day. A hot day next to a low egg count or high deaths adds a plain sentence; it does not change the colour. A thin line shows max temperature on the egg and deaths charts. A very hot (38 °C or more) or very cold (under 4 °C) forecast shows under “What may go wrong soon”.",
      "New page “Farm reference”: the seasons, the starting death values, what the farm has learned so far, and what is known from research. These are the farm's own working targets, not published standards: confirm them with your vet.",
    ],
  },
  {
    date: "2026-10-28",
    title: "A realistic target, learned from our own records",
    points: [
      "Each flock now shows three lines: the breeder's target (the book), our realistic target (what our own flocks do on a good week at that age) and what the flock actually did. The colours compare it with our realistic target; the gap to the book is just a number.",
      "Where the farm has too little history for an age, the flock is grey and says “realistic target not learned yet for this age”. Nothing is guessed.",
      "New screen “How targets are learned” (under Analytics): which days are used and left out, the table for every age band, a small chart of how the level moved, and a place to set your own level for a band.",
      "New screen “Import old registers”: upload older paper-register days (CSV or Excel). It checks every row first and never overwrites a day without asking. More history means more ages can be learned.",
    ],
  },
  {
    date: "2026-10-28",
    title: "Today now tells you what is right, what is wrong and what may go wrong",
    points: [
      "The Today screen has three parts: ✔ what is right, ✖ what is wrong now (with what to do) and ⚠ what may go wrong soon. Tap any line for the details.",
      "A line at the top says “Data up to <date>” and warns you when the newest day entered is more than a day old.",
      "“HD %” is now explained as eggs per 100 birds, and “standard” as the breeder's target for the flock's age. A flock that has no target says why in one line (placement date missing, past the end of the table…).",
      "Bigger buttons and clearer numbers: Indian digit grouping everywhere (1,23,456) and dates like 26 Oct 2026.",
    ],
  },
  {
    date: "2026-10-28",
    title: "Costs: chicks, feed price and what is not entered",
    points: [
      "Chick purchase is now part of the cost, at the average of ₹52 per chick, counted in the month the chicks arrived (not spread over later months). September carries the 16,000 chicks that arrived on 18 Sep.",
      "Feed uses ₹33.33 per kg (₹1,500 per 45 kg bag). Electricity for Aug, Sep and Oct is included (the bill covers the whole farm including the feed mills).",
      "Diesel, medicines and other costs that have not been entered show “not entered” instead of ₹0, and the profit says it is incomplete. A part-month (October to 26 Oct) says it is “to date”.",
    ],
  },
  {
    date: "2026-10-28",
    title: "Review screen: one-tap answers for ledger lines",
    points: [
      "A ledger line the reader could not classify now has buttons: Farmfresh sale, Local sale, Breakage, Labour took them, Given to Anil farm, Something else. A sale is created at that day's rate (Farmfresh = rate − ₹0.03, local = rate + ₹0.01).",
      "Reasons are written in plain words; the reader's original text is under “Technical detail”.",
      "July is no longer treated as cleared, so the July questions (29 and 30 Jul +300 small eggs, the 30 Jul ledger gap) show up for you to answer.",
    ],
  },
  {
    date: "2026-10-28",
    title: "Rates, uploads and small fixes",
    points: [
      "When you enter rates the screen now asks: is this a BAFTA message (the raw rate) or your own price list (your net selling price)? Your list is saved as your price + 0.03 so Farmfresh gets exactly your price.",
      "Uploading one photo for a day that is already saved now asks before replacing it. If photo reading is paused (for example the reading service needs topping up) you get a plain message and can enter the day by hand.",
      "A flock's group (main / young) can now be cleared back to “not set” on the Flocks screen.",
      "BAB-4 (week 115) now says it is past the end of the breeder's table. BAB-6 to BAB-11 use their confirmed placement dates. Only BAB-3 is treated as moulting, and its start date is marked “not confirmed”.",
      "Young flocks' small eggs now raise a build-up alert only after 6 days without a sale (was 4).",
    ],
  },
  {
    date: "2026-10-27",
    title: "Every board is split into the main and the young flocks",
    points: [
      "Main flocks (BAB-1 to BAB-8, big eggs) and young flocks (BAB-9 to BAB-11, small eggs) are shown separately; the whole farm is shown last because it mixes mature and young birds.",
      "Young flocks are “ramping up” for their first 60 days of laying and are not alerted for low production in that time.",
    ],
  },
];
