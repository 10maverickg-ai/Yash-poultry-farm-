# Alert review — 2026-09-01 to 2026-09-30

Every alert the current rules raise on the real data for this period, so you can mark each one **real** or **noise**.
The rules have NOT been changed; the thresholds are the ones you decided (production drop ≥5 points or ≥3 points two days running;
high mortality >2× own average AND >0.1% AND ≥5 deaths; low feed under 0.5 day or received below consumption 3 days running;
egg stock over 5 days of production or 4+ days with no Farmfresh sale). August is cleared and not included.

On the Analytics page each alert has **This was real / This was noise** buttons (saved in `alert_feedback`); mark them there or fill the
last column here. Rules will be tuned from your verdicts.

**Count by rule:** production drop 8 · low feed stock 5 · egg buildup 6 · high mortality 2 — **21 alerts**.
**My guess:** 7 look real, 12 look like noise, 2 unclear. These are guesses from the data only.

| Date | Flock (real name) | Rule | Number that triggered it | Known explanation found | My guess and why | Your verdict (real / noise) |
|---|---|---|---|---|---|---|
| 3 Sept | BAB-8 (register BAB-10) | production drop | HD 69.1% vs its own 7-day average 74.9% (−5.8 points, 7,170 eggs). | none found | real: still 3+ points under its own average on the next 3 days (68.8%, 68.3%, 70.1%) | |
| 4 Sept | BAB-7 (register BAB-6) | production drop | HD 80% vs its own 7-day average 83.4% (−3.4 points, 9,120 eggs), and −3.8 points the day before as well. | none found | real: still 3+ points under its own average on the next 2 days (80%, 81.1%, 79%) | |
| 4 Sept | BAB-8 (register BAB-9) | production drop | HD 68.8% vs its own 7-day average 74.6% (−5.7 points, 7,140 eggs). | none found | real: still 3+ points under its own average on the next 3 days (68.3%, 70.1%, 71.2%) | |
| 4 Sept | BAB-10 (register BAB-7) | production drop | HD 74.3% vs its own 7-day average 79.7% (−5.4 points, 4,920 eggs). | none found | real: still 3+ points under its own average on the next 3 days (74.3%, 76.6%, 76.2%) | |
| 5 Sept | BAB-8 (register BAB-9) | production drop | HD 68.3% vs its own 7-day average 73.8% (−5.5 points, 7,080 eggs). | none found | real: still 3+ points under its own average on the next 2 days (70.1%, 71.2%, 69.8%) | |
| 5 Sept | BAB-10 (register BAB-7) | production drop | HD 74.3% vs its own 7-day average 79.1% (−4.8 points, 4,920 eggs), and −5.4 points the day before as well. | none found | unclear: partly recovered the next day | |
| 7 Sept | BAB-1 | production drop | HD 63% vs its own 7-day average 66.1% (−3.1 points, 2,010 eggs; bird count also moved −5,218 that day), and −3.8 points the day before as well. | bird movement: −5,218 sold 7 Sept | probably noise: the bird count moved around this day, so the HD% is measured on a different number of birds | |
| 7 Sept | farm | low feed stock | 83 bags in stock at 166.4 bags/day = 0.5 days (alert under 0.5). | the farm's own mill delivers feed every day (stock about 1 day is normal) | real: consumption fell the next day (149 bags vs 166.4/day average), so feed may really have run short | |
| 7 Sept | farm | egg buildup | 2,95,080 eggs (9,836 trays) in stock vs 49,517 laid/day = 5.96 days (alert above 5). | Farmfresh collects every 3–4 days; a Farmfresh sale followed on 8 Sept | probably noise: collected 1 day(s) later (stock 2,95,080 → 2,64,900) | |
| 8 Sept | farm | egg buildup | 2,64,900 eggs (8,830 trays) in stock vs 48,193 laid/day = 5.5 days (alert above 5). | Farmfresh collects every 3–4 days; a Farmfresh sale followed on 10 Sept | probably noise: collected 2 day(s) later (stock 2,64,900 → 3,08,160) | |
| 9 Sept | farm | egg buildup | 3,08,160 eggs (10,272 trays) in stock vs 46,727 laid/day = 6.59 days (alert above 5). | Farmfresh collects every 3–4 days; a Farmfresh sale followed on 10 Sept | probably noise: collected 1 day(s) later (stock 3,08,160 → 1,94,820) | |
| 11 Sept | farm | egg buildup | 2,38,920 eggs (7,964 trays) in stock vs 45,279 laid/day = 5.28 days (alert above 5). | Farmfresh collects every 3–4 days; a Farmfresh sale followed on 13 Sept | probably noise: collected 2 day(s) later (stock 2,38,920 → 2,84,040) | |
| 12 Sept | farm | low feed stock | 40 bags in stock at 153.6 bags/day = 0.26 days (alert under 0.5). | the farm's own mill delivers feed every day (stock about 1 day is normal) | probably noise: feed was still eaten as normal the next day (151 bags vs 153.6/day average) | |
| 12 Sept | farm | egg buildup | 2,84,040 eggs (9,468 trays) in stock vs 44,880 laid/day = 6.33 days (alert above 5). | Farmfresh collects every 3–4 days; a Farmfresh sale followed on 13 Sept | probably noise: collected 1 day(s) later (stock 2,84,040 → 1,77,000) | |
| 13 Sept | farm | low feed stock | 65 bags in stock at 150.4 bags/day = 0.43 days (alert under 0.5). | the farm's own mill delivers feed every day (stock about 1 day is normal) | probably noise: feed was still eaten as normal the next day (148 bags vs 150.4/day average) | |
| 14 Sept | farm | low feed stock | 49 bags in stock at 149.4 bags/day = 0.33 days (alert under 0.5). | the farm's own mill delivers feed every day (stock about 1 day is normal) | probably noise: feed was still eaten as normal the next day (157 bags vs 149.4/day average) | |
| 14 Sept | farm | egg buildup | 2,23,260 eggs (7,442 trays) in stock vs 44,589 laid/day = 5.01 days (alert above 5). | Farmfresh collects every 3–4 days; a Farmfresh sale followed on 15 Sept | probably noise: collected 1 day(s) later (stock 2,23,260 → 2,02,890) | |
| 15 Sept | farm | low feed stock | 68 bags in stock at 150.6 bags/day = 0.45 days (alert under 0.5). | the farm's own mill delivers feed every day (stock about 1 day is normal) | probably noise: feed was still eaten as normal the next day (144 bags vs 150.6/day average) | |
| 17 Sept | BAB-6 (register BAB-4) | high mortality | 12 deaths vs its own 7-day average 4.3/day (2.8×) and 0.12% of 9,917 birds. | none found | real: deaths stayed high afterwards (9, 6, 8) | |
| 17 Sept | BAB-10 (register BAB-6) | high mortality | 8 deaths vs its own 7-day average 2.7/day (2.9×) and 0.12% of 6,595 birds. | none found | probably noise: a one-day blip (8 deaths = 0.12% of the flock), the next days had 0, 2, 1 | |
| 30 Sept | BAB-4 (register BAB-2) | production drop | HD 67% vs its own 7-day average 73% (−6 points, 6,510 eggs). | none found | unclear: the data ends before the next day, so I cannot say whether it recovered | |
