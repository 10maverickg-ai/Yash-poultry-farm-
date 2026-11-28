// "What changed": the latest changes to the app, in plain words, newest first. Add a new entry at the top whenever
// the app changes in a way the owner will notice.
export interface Change {
  date: string; // YYYY-MM-DD
  title: string;
  points: string[];
}

export const CHANGES: Change[] = [
  {
    date: "2026-11-28",
    title: "Feed formulas for each shed, and feed cost from them",
    points: [
      "New screen “Feed formulas” (Buy menu): one card for each of Dr Bhaskar Choudhary's five formulas of 28 Nov — which sheds eat it, what a kg costs delivered (and a 45 kg bag), the energy, the target intake and his note. Tap a card for the ingredient list and how the price is made up (ingredients + 1% loss + ₹1.50 production + ₹0.90 bagging).",
      "From 28 Nov each shed's feed is costed at its own formula's price: BAB-1 and BAB-4 ₹36.03 a kg, BAB-2 ₹35.39, BAB-3, 5 and 6 ₹36.16, BAB-8 ₹36.69, BAB-9, 10 and 11 ₹38.44. BAB-7 has no formula yet, so it stays at the farm price ₹33.33. Every day before 28 Nov keeps ₹33.33: no earlier number changes.",
      "The farm's feed cost is now each shed's bags × 45 kg × its own price, added up. Profit, cost per egg, the new cost per tray (30 eggs) and feed cost as a share of egg sales use it. A week or month that runs across 28 Nov says “Feed price changed on 28 Nov 2026 (new formulas)”.",
      "Each flock's page and card says what it eats: “Feed: BV-300 Phase IV shed 1 & 4 — ₹36.03/kg”. The Day screen shows each flock's feed cost, and Feed formulas has a table of feed cost by shed for the last 7 days with the cost per egg.",
      "Your averages are now in the costs and the profit, always marked “average”: electricity ₹40,000 a month when there is no bill (from November; August to October keep their bills), diesel ₹10,000 a month when no diesel is entered (August, September and November; October keeps the ₹29,000 entered on 29 Oct), and a new line “Miscellaneous (average)” ₹30,000 a month for vaccines, repairs, transport, vet and anything else.",
      "From 28 Nov, medicines and vaccines say “included in feed price”: no separate cost. Interest and top dressing say “not entered”. The farm pays no rent, so there is no rent line.",
      "A month that is still running is charged only its days so far: November on 28 Nov counts 28 of its 30 days for labour, electricity, diesel and miscellaneous, and the screen says so. A day the register missed (20 Nov) still carries its share of those monthly costs.",
    ],
  },
  {
    date: "2026-11-28",
    title: "Share Analytics as Excel or CSV, and FCR",
    points: [
      "Every Analytics screen (the board, the Day screen, Week, Month, Year, Custom, a flock's page and Compare) has one “Share / Download” button: Excel, CSV, or Share straight to WhatsApp, mail or Files. The file has the numbers on that screen.",
      "“Choose what to share” lets you pick the dates (or Last 7 / 14 / 30 days, This month), the flocks, and what goes in: production, feed, deaths and birds, sales, costs and profit, alerts, the per-flock table, the day-by-day table. Untick sales and costs and the file has no money in it at all. The choice stays in the page's address, so you can bookmark it.",
      "The Excel file has a sheet for each part (Summary, Flocks, Days, Sales, Costs, Alerts), real dates and numbers, totals that Excel works out, and at the top the farm, the dates, the flocks and when it was made. A missing figure is empty with the reason beside it, never 0.",
      "New: FCR, kilos of feed for each kilo of eggs (lower is better). 13–19 Nov, Main flocks: 2.40, the BV300 book says 2.13 for these ages; 142.6 g of feed per egg. The egg weight is the BV300 standard for each flock's age, so the screen says “estimated from standard egg weight”; if you weigh a sample of eggs, the real weight can be stored and FCR becomes exact. BAB-4 is past the end of the book's egg-weight table (week 100), so it gets no FCR and says why.",
      "FCR is on each group card (today, the last 7 days, a 30-day line on Main), the flock cards, every per-flock table, Compare and the downloads. New alert “Feed is giving fewer egg kilos than normal” when the last 7 days are clearly worse than the week before or than the book, with what to check.",
    ],
  },
  {
    date: "2026-11-25",
    title: "Eggs per kg of feed",
    points: [
      "Each group card on Analytics and Today has a new tile “Eggs per kg feed”: the day's figure in big numbers (19 Nov, Main flocks: 7.35 eggs from each kg of feed), the last 7 days (7.01) and whether that is better or worse than the 7 days before. It is all the eggs divided by all the feed (bags × 45 kg), using only days on which feed is written. A day without a feed figure says “feed not recorded”.",
      "The Main flocks card shows the last 30 days as a small line: each day, and the 7-day figure dashed.",
      "Every flock card, the per-flock tables (Day, Week, Month, Year, Custom), the Compare screen and the Excel/CSV downloads have eggs per kg of feed too.",
      "New alert “Feed is giving fewer eggs” when the last 7 days give more than 8% fewer eggs per kg than the 7 days before, with what to check: feed waste, a change in the feed or the mill's mix, sick birds, heat. Moulting flocks are left out.",
      "Hen-housed: each flock now shows eggs per hen housed since it was housed and the hen-housed % (eggs ÷ the hens put into the laying house), next to the usual hen-day %. The gap between the two is what deaths, culls and sales cost. BAB-9, 10 and 11 are counted from their first day in the register (4 Oct) and compared with the BV300 book. For BAB-1 to 8 the app does not know how many hens were housed, so it uses the birds on 2 Jul as a stand-in and says so: send the real numbers and they will be used.",
    ],
  },
  {
    date: "2026-11-21",
    title: "Feed on Analytics: the day's own figure first, the 7-day average labelled",
    points: [
      "The Main flocks card now shows “Feed today” with the bags the register says for that day and the grams per bird for that day (19 Nov: 154 bags, 105 g/bird). Next to it, “Feed, last 7 days” gives the total, the average bags a day and the average grams per bird a day (13–19 Nov: 1,102 bags, 157 a day, 107 g/bird). Before, the 157 average stood among the day's numbers without saying it was an average.",
      "The same on the Young flocks card, on Today, on the Day screen and on every flock card. When the register has no feed for a day it says “feed not recorded”, never 0.",
      "Week, month, year and custom views say “total” and “average a day” for feed, and a day without a feed figure is “not recorded” in the day table.",
    ],
  },
  {
    date: "2026-11-12",
    title: "Analytics for any dates, and compare two flocks side by side",
    points: [
      "Analytics has a fifth tab, “Custom”: pick a From date and a To date (or tap Last 7 days, Last 14, Last 30, This month, Last month, Since 1 Aug) and you get the same view as a month for exactly those days: eggs, eggs per 100 birds, deaths, feed, money, each flock, every day (tap a day to open it), sales by buyer and grade, costs with what is missing, alerts, and a comparison with the same number of days just before. If some days have no data it says how many do.",
      "On the Custom tab, “Flocks: All flocks” lets you tick one or more flocks. Every number is then for those flocks only. Sales, costs and profit are kept for the whole farm, so they are not shown for single flocks; the screen says so.",
      "New screen “Compare flocks” (button on Analytics, on every flock card and on each flock page): column A and column B, each with its own flock and its own dates, for example BAB-3 in September against BAB-5 in October. Every number is shown side by side with B minus A, an arrow and the word better or worse. Tick “Align by flock age” to compare the same weeks of age of two flocks. Two charts put the two lines on top of each other.",
      "“Download this view” gives the Custom range or the comparison as Excel or CSV. Every view has its own address, so you can bookmark it or send it.",
    ],
  },
  {
    date: "2026-11-07",
    title: "One master list of medicines and vaccines, per-flock entry, boosters every 6 months, chick vaccination plan",
    points: [
      "New “Medicines list”: every medicine, vaccine and farm task used on the farm, once, with other spellings (Croyza and Coryza are the same item). It starts with everything you told me. Names or details you were not sure of carry a “to confirm” badge: check them with the vet or the packet, then tap “Mark as confirmed”.",
      "Entering a medicine is now: pick it from the list (search), tick the flocks that got it (Whole farm, Main group and Young group are shortcuts), date, quantity and cost. One line is saved for each flock. A total cost or quantity for several flocks is split by the number of birds in each flock that day, and the screen shows exactly how. If a medicine is not in the list you can add it on the spot (marked “to confirm”).",
      "New screen “What is each flock on”, also on every flock page: the ND and LPAI boosters (every 6 months) with a traffic light that is also written in words, the last date, the next due date, and what was given. A flock with no date entered says “Last date not entered” and offers “Enter the last date”: the app never assumes a date. Today shows ONE line per vaccine when boosters are overdue or due within 14 days, and one line when dates are missing.",
      "New “Chick vaccination plan”: your day-by-day schedule from day 1 (the day the chicks arrive) to day 105, with debeaking and nail cutting as tasks. Type any arrival date to preview the plan; a newly registered chick batch gets its plan by itself; for a batch that is already here tap “Make the plan” and tick off what was really done. Nothing is created for the current flocks.",
      "The Excel/CSV import now takes list names and one or several flocks (BAB-1; BAB-2, main, young or all). A name the list does not know is never added silently: you choose what it means. Older lines typed by hand are matched to the list when the name is exact, or with one tap under “Not matched to the list”.",
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
