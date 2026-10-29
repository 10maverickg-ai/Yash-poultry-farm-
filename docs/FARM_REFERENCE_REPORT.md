# Farm reference report (M6, read-only, V11)

Printed before anything was shown in the app. Nothing here is invented: a season with no records (HOT, COLD, SPRING) is not shown, and a band with too little healthy data says "not learned yet". These are this farm's own working numbers from its 2026 records, not published standards: confirm them with the vet.

Method: `web/lib/analytics/realistic.ts` (`REALISTIC_CONFIG`). HD ratio = eggs per 100 birds ÷ the breeder's book for the flock's age, 70th percentile of 7-day rolling healthy-day values, per group, 5-week age band and season (fall back to all seasons when the season alone has fewer than 28 healthy flock-days or fewer than 2 flocks). Deaths = the farm's own weekly death rate (% of birds per week), 70th percentile of weekly rates; amber at usual × 1.5 and red at usual × 2.5, with two guard rails (amber never above the starting red limit, red never above 2 × the starting red) and bad weeks (above the starting red) not counted as "usual". Until a band has enough data the starting limits apply: cool/cold/spring 0.35 amber, 0.6 red; monsoon/hot 0.55 amber, 0.9 red.

Reproduce: `npx tsx scripts/farm-reference-report.mts <fixture-dir>` (the fixture = the local copy of the live data, refreshed to 28 Oct 2026).

Seasons present in the data: MONSOON (91 days), COOL (28 days). Seasons with no records (HOT, COLD, SPRING) are not shown and nothing is invented for them.

Starting death limits (percent of birds per week): cool/cold/spring amber 0.35, red 0.6; monsoon/hot amber 0.55, red 0.9. Learned limits = usual x 1.5 (amber) and x 2.5 (red).


## main group, MONSOON

| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |
|---|---|---|---|---|---|---|---|---|
| 20–24 | 18 | 2 | not learned yet | – | not learned yet (18 days, 2 flocks) | – | 0.55 / 0.9 | 0.02 |
| 25–29 | 84 | 3 | 75.5% | 73.3 (97.0) | 0.68 (86, 3) | 1.03 / 1.71 | 0.55 / 0.9 | 0.05 |
| 30–34 | 104 | 3 | 74.8% | 73.3 (98.0) | 0.39 (105, 3) | 0.58 / 0.97 | 0.55 / 0.9 | 0.05 |
| 35–39 | 35 | 3 | 80.7% | 78.6 (97.5) | 0.29 (36, 3) | 0.43 / 0.72 | 0.55 / 0.9 | 0.07 |
| 40–44 | 15 | 1 | not learned yet | – | not learned yet (15 days, 1 flock) | – | 0.55 / 0.9 | 0.08 |
| 45–49 | 35 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | 0.55 / 0.9 | 0.10 |
| 50–54 | 35 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | 0.55 / 0.9 | 0.11 |
| 55–59 | 57 | 4 | 90.3% | 83.8 (92.8) | 0.31 (57, 4) | 0.47 / 0.79 | 0.55 / 0.9 | 0.12 |
| 60–64 | 92 | 3 | 92.2% | 84.2 (91.3) | 0.34 (93, 3) | 0.51 / 0.84 | 0.55 / 0.9 | 0.13 |
| 65–69 | 74 | 3 | 86.0% | 77.1 (89.7) | 0.36 (74, 3) | 0.54 / 0.90 | 0.55 / 0.9 | 0.14 |
| 70–74 | 12 | 1 | not learned yet | – | not learned yet (12 days, 1 flock) | – | 0.55 / 0.9 | 0.15 |
| 75–79 | 29 | 1 | not learned yet | – | not learned yet (29 days, 1 flock) | – | 0.55 / 0.9 | 0.15 |
| 80–84 | 28 | 1 | not learned yet | – | not learned yet (28 days, 1 flock) | – | 0.55 / 0.9 | 0.15 |
| 95–99 | 8 | 1 | not learned yet | – | not learned yet (8 days, 1 flock) | – | 0.55 / 0.9 | 0.15 |
| 100–104 | 7 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | 0.55 / 0.9 | – |
| 105–109 | 0 | 0 | not learned yet | – | 0.35 (63, 2) | 0.53 / 0.88 | 0.55 / 0.9 | – |
| 110–114 | 0 | 0 | not learned yet | – | 0.51 (47, 2) | 0.77 / 1.28 | 0.55 / 0.9 | – |
| 115–119 | 0 | 0 | not learned yet | – | not learned yet (0 days, 0 flocks) | – | 0.55 / 0.9 | – |

## main group, COOL

| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |
|---|---|---|---|---|---|---|---|---|
| 35–39 | 59 | 3 | 89.9% | 87.6 (97.5) | 0.23 (63, 3) | 0.34 / 0.57 | 0.35 / 0.6 | 0.07 |
| 40–44 | 19 | 1 | not learned yet | – | not learned yet (21 days, 1 flock) | – | 0.35 / 0.6 | 0.08 |
| 55–59 | 26 | 1 | not learned yet | – | not learned yet (28 days, 1 flock) | – | 0.35 / 0.6 | 0.12 |
| 70–74 | 72 | 3 | 93.8% | 82.5 (87.9) | 0.31 (78, 3) | 0.46 / 0.77 | 0.35 / 0.6 | 0.15 |
| 75–79 | 5 | 1 | not learned yet | – | not learned yet (5 days, 1 flock) | – | 0.35 / 0.6 | 0.15 |
| 110–114 | 0 | 0 | not learned yet | – | not learned yet (22 days, 1 flock) | – | 0.35 / 0.6 | – |
| 115–119 | 0 | 0 | not learned yet | – | not learned yet (6 days, 1 flock) | – | 0.35 / 0.6 | – |

## main group, all seasons together

| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |
|---|---|---|---|---|---|---|---|---|
| 20–24 | 18 | 2 | not learned yet | – | not learned yet (18 days, 2 flocks) | – | (depends on season) | 0.02 |
| 25–29 | 84 | 3 | 75.5% | 73.3 (97.0) | 0.68 (86, 3) | 1.03 / 1.71 | (depends on season) | 0.05 |
| 30–34 | 104 | 3 | 74.8% | 73.3 (98.0) | 0.39 (105, 3) | 0.58 / 0.97 | (depends on season) | 0.05 |
| 35–39 | 94 | 3 | 87.1% | 84.9 (97.5) | 0.24 (99, 3) | 0.35 / 0.59 | (depends on season) | 0.07 |
| 40–44 | 34 | 2 | 89.4% | 86.3 (96.5) | 0.20 (36, 2) | 0.30 / 0.50 | (depends on season) | 0.08 |
| 45–49 | 35 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | (depends on season) | 0.10 |
| 50–54 | 35 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | (depends on season) | 0.11 |
| 55–59 | 83 | 4 | 91.6% | 85.0 (92.8) | 0.29 (85, 4) | 0.43 / 0.71 | (depends on season) | 0.12 |
| 60–64 | 92 | 3 | 92.2% | 84.2 (91.3) | 0.34 (93, 3) | 0.51 / 0.84 | (depends on season) | 0.13 |
| 65–69 | 74 | 3 | 86.0% | 77.1 (89.7) | 0.36 (74, 3) | 0.54 / 0.90 | (depends on season) | 0.14 |
| 70–74 | 84 | 3 | 91.5% | 80.4 (87.9) | 0.32 (90, 3) | 0.48 / 0.81 | (depends on season) | 0.15 |
| 75–79 | 34 | 2 | 87.8% | 75.6 (86.1) | 0.30 (34, 2) | 0.45 / 0.75 | (depends on season) | 0.15 |
| 80–84 | 28 | 1 | not learned yet | – | not learned yet (28 days, 1 flock) | – | (depends on season) | 0.15 |
| 95–99 | 8 | 1 | not learned yet | – | not learned yet (8 days, 1 flock) | – | (depends on season) | 0.15 |
| 100–104 | 7 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | (depends on season) | – |
| 105–109 | 0 | 0 | not learned yet | – | 0.35 (63, 2) | 0.53 / 0.88 | (depends on season) | – |
| 110–114 | 0 | 0 | not learned yet | – | 0.48 (69, 2) | 0.72 / 1.19 | (depends on season) | – |
| 115–119 | 0 | 0 | not learned yet | – | not learned yet (6 days, 1 flock) | – | (depends on season) | – |

## young group, COOL

| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |
|---|---|---|---|---|---|---|---|---|
| 0–4 | 24 | 3 | not learned yet | – | not learned yet (24 days, 3 flocks) | – | 0.35 / 0.6 | – |
| 5–9 | 9 | 1 | not learned yet | – | not learned yet (9 days, 1 flock) | – | 0.35 / 0.6 | – |

## young group, all seasons together

| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |
|---|---|---|---|---|---|---|---|---|
| 0–4 | 24 | 3 | not learned yet | – | not learned yet (24 days, 3 flocks) | – | (depends on season) | – |
| 5–9 | 9 | 1 | not learned yet | – | not learned yet (9 days, 1 flock) | – | (depends on season) | – |

## Weeks that crossed amber or red (calendar weeks Monday to Sunday, at least 5 days of rows)

Judged two ways: (A) the limits the app will use (our usual from the farm's own data; the starting values where a band is not learned yet) and (B) the starting values alone.

| flock | week (Mon–Sun) | season | deaths | avg birds | deaths % that week | A: our usual / amber / red | A verdict | B: starting amber / red | B verdict |
|---|---|---|---|---|---|---|---|---|---|
| BAB-1 | 2026-09-28 – 2026-10-04 | COOL | 25 | 6537 | 0.38 | 0.31 / 0.46 / 0.77 (learned, cool) | ok | 0.35 / 0.6 | amber |
| BAB-1 | 2026-10-12 – 2026-10-18 | COOL | 25 | 6491 | 0.39 | 0.31 / 0.46 / 0.77 (learned, cool) | ok | 0.35 / 0.6 | amber |
| BAB-2 | 2026-10-19 – 2026-10-25 | COOL | 41 | 9636 | 0.43 | 0.31 / 0.46 / 0.77 (learned, cool) | ok | 0.35 / 0.6 | amber |
| BAB-4 | 2026-09-28 – 2026-10-04 | COOL | 43 | 9808 | 0.44 | 0.48 / 0.60 / 1.19 (learned, all seasons) | ok | 0.35 / 0.6 | amber |
| BAB-4 | 2026-10-12 – 2026-10-18 | COOL | 38 | 9732 | 0.39 | 0.48 / 0.60 / 1.19 (learned, all seasons) | ok | 0.35 / 0.6 | amber |
| BAB-4 | 2026-10-19 – 2026-10-25 | COOL | 36 | 9699 | 0.37 | starting / 0.35 / 0.60 (starting) | amber | 0.35 / 0.6 | amber |
| BAB-6 | 2026-07-06 – 2026-07-12 | MONSOON | 56 | 6417 | 0.87 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-6 | 2026-07-13 – 2026-07-19 | MONSOON | 36 | 6374 | 0.56 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-7 | 2026-07-06 – 2026-07-12 | MONSOON | 47 | 4491 | 1.05 | starting / 0.55 / 0.90 (starting) | RED | 0.55 / 0.9 | RED |
| BAB-7 | 2026-07-13 – 2026-07-19 | MONSOON | 25 | 4465 | 0.56 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-8 | 2026-07-06 – 2026-07-12 | MONSOON | 73 | 10157 | 0.72 | starting / 0.55 / 0.90 (starting) | amber | 0.55 / 0.9 | amber |
| BAB-8 | 2026-07-13 – 2026-07-19 | MONSOON | 165 | 10037 | 1.64 | 0.68 / 0.90 / 1.71 (learned, monsoon) | amber | 0.55 / 0.9 | RED |
| BAB-8 | 2026-07-20 – 2026-07-26 | MONSOON | 90 | 9904 | 0.91 | 0.68 / 0.90 / 1.71 (learned, monsoon) | amber | 0.55 / 0.9 | RED |
| BAB-8 | 2026-07-27 – 2026-08-02 | MONSOON | 75 | 9827 | 0.76 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-8 | 2026-08-03 – 2026-08-09 | MONSOON | 61 | 9762 | 0.62 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-8 | 2026-08-10 – 2026-08-16 | MONSOON | 71 | 9695 | 0.73 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-8 | 2026-08-17 – 2026-08-23 | MONSOON | 60 | 10402 | 0.58 | 0.39 / 0.58 / 0.97 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| Old BAB-1 (sold Sep) | 2026-08-17 – 2026-08-23 | MONSOON | 47 | 8518 | 0.55 | 0.51 / 0.77 / 1.28 (learned, monsoon) | ok | 0.55 / 0.9 | amber |

18 flock-weeks cross amber or red under at least one rule. Under (A): 1 red, 4 amber. Under (B): 3 red, 15 amber.

## What this shows, in plain words

* **Seasons in the data:** MONSOON (Jul–Sep, 91 days) and COOL (Oct, 28 days). Nothing is known yet about HOT (Apr–Jun), COLD (Dec–Feb) or SPRING (Mar): those flocks will use the starting limits (and all-season HD ratios) until a year of records or imported paper registers exist.
* **Main group, monsoon:** weekly death rate usual 0.3–0.7 % depending on age (0.68 at 25–29 weeks, 0.39 at 30–34, about 0.3 from 35 weeks on). Many bands outside weeks 25–39 and 55–69 are single-flock, so they fall back to all seasons or the starting limits.
* **Main group, cool (October):** usual about 0.23 % at 35–39 weeks and 0.31 % at 70–74 weeks — close to the starting cool limits (0.35 / 0.6) and about half the monsoon level, as expected.
* **Young group (BAB-9/10/11):** not learned yet (24 healthy days in the youngest band, one flock in the next). They use the cool starting limits.
* **The bad July weeks:** BAB-7 (week of 6 Jul, 1.05 % that week) is red and BAB-8 (week of 13 Jul, 1.64 %, and 20 Jul, 0.91 %) is amber under the app's rules (red under the starting limits alone). Weeks of 0.55–0.9 % for BAB-6/7/8 in July are inside the learned monsoon band and are not flagged by the app, but the starting limits alone would call them amber — a judgement for the vet.
* **BAB-4 (week 115):** 0.37–0.44 % a week all four months. In October the starting cool limit (0.35) calls it amber; the learned all-season band for its age (0.48 usual) does not. Its age band has only two flocks of data, so it is the clearest case for the vet to decide.
* **Honest limits:** with 3 flocks and one season per band the learned "usual" is one season of weather. The guard rail keeps a bad month from silencing its own alert. More years (the paper-register import) make the season bands real.
