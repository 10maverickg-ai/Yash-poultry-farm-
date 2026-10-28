# Realistic target: what the farm's own July–October records teach (K6, read-only)

Printed before anything is shown to the owner. Nothing here is invented: a band with too little healthy data says "not learned yet".
Method and thresholds: `REALISTIC_CONFIG` in `web/lib/analytics/realistic.ts` (70th percentile of 7-day rolling healthy-day ratios to the breeder's book, 5-week age bands, per group, needs ≥ 28 healthy flock-days from ≥ 2 flocks, never above the book).
"seen" = all flock-days in the band; "healthy" = those that passed every filter; "samples" = 7-day rolling values the percentile was taken over.

```
as of 2026-10-26; config {"percentile":70,"mortalityPercentile":30,"minHealthyDays":28,"minFlocks":2,"rampDays":14,"spikeMultiple":3,"spikeMedianFloor":1,"bandWeeks":5,"rollingDays":7,"minHealthyInWindow":4,"departedTrailingDays":7,"chickToLayingWeeks":18,"greenMinRatio":0.9,"amberMinRatio":0.8,"slipPoints":3}

== hd ==
group  band(weeks)  seen  healthy  flocks  samples  from..to              ratio   book@mid  realistic  note
main    20-24          34       18       2       12  2026-07-02..2026-07-16    –    90  not learned  only 18 healthy flock-days (needs 28)
main    25-29          98       84       3       72  2026-07-03..2026-08-22  75.5%  97  73.3  
main    30-34         105      104       3      104  2026-07-30..2026-09-26  74.8%  98  73.3  
main    35-39          95       90       3       90  2026-09-03..2026-10-26  85.9%  97.5  83.8  
main    40-44          34       32       2       29  2026-07-02..2026-10-26  88.6%  96.5  85.5  
main    45-49          35       35       1       35  2026-07-17..2026-08-20    –    95.4  not learned  only 1 flock (needs 2)
main    50-54          35       35       1       35  2026-08-21..2026-09-24    –    94.2  not learned  only 1 flock (needs 2)
main    55-59          83       81       4       72  2026-07-02..2026-10-26  91.7%  92.8  85.1  
main    60-64         105       93       3       93  2026-07-11..2026-08-26  92.2%  91.3  84.2  
main    65-69         105       74       3       71  2026-08-15..2026-09-30  86.0%  89.7  77.1  
main    70-74          87       81       3       81  2026-09-19..2026-10-26  90.9%  87.9  79.9  
main    75-79          32       32       2       29  2026-07-02..2026-10-26  86.3%  86.1  74.3  
main    80-84          35       28       1       28  2026-07-31..2026-08-27    –    84.1  not learned  only 1 flock (needs 2)
main    95-99           8        8       1        5  2026-07-02..2026-07-09    –    77  not learned  only 8 healthy flock-days (needs 28)
main    100-104        35        7       1        7  2026-07-10..2026-07-16    –    –  not learned  only 7 healthy flock-days (needs 28)
main    105-109        63        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    110-114        70        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    115-119        10        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
young   0-4            62       20       3       12  2026-10-18..2026-10-26    –    –  not learned  only 20 healthy flock-days (needs 28)
young   5-9             7        7       1        6  2026-10-20..2026-10-26    –    –  not learned  only 7 healthy flock-days (needs 28)

== feed ==
group  band(weeks)  seen  healthy  flocks  samples  from..to              ratio   book@mid  realistic  note
main    20-24          34       18       2       12  2026-07-02..2026-07-16    –    95  not learned  only 18 healthy flock-days (needs 28)
main    25-29          98       84       3       72  2026-07-03..2026-08-22  88.4%  108  95.4  
main    30-34         105      104       3      104  2026-07-30..2026-09-26  87.7%  110  96.5  
main    35-39          95       90       3       90  2026-09-03..2026-10-26  92.6%  110  101.8  
main    40-44          34       32       2       29  2026-07-02..2026-10-26  98.3%  111  109.1  
main    45-49          35       35       1       35  2026-07-17..2026-08-20    –    112  not learned  only 1 flock (needs 2)
main    50-54          35       35       1       35  2026-08-21..2026-09-24    –    112  not learned  only 1 flock (needs 2)
main    55-59          83       81       4       72  2026-07-02..2026-10-26  92.8%  112  104.0  
main    60-64         105       93       3       93  2026-07-11..2026-08-26  93.8%  113  106.0  
main    65-69         105       74       3       71  2026-08-15..2026-09-30  87.6%  114  99.8  
main    70-74          87       81       3       81  2026-09-19..2026-10-26  92.5%  114  105.4  
main    75-79          32       32       2       29  2026-07-02..2026-10-26  95.2%  114  108.5  
main    80-84          35       28       1       28  2026-07-31..2026-08-27    –    114  not learned  only 1 flock (needs 2)
main    95-99           8        8       1        5  2026-07-02..2026-07-09    –    114  not learned  only 8 healthy flock-days (needs 28)
main    100-104        35        7       1        7  2026-07-10..2026-07-16    –    –  not learned  only 7 healthy flock-days (needs 28)
main    105-109        63        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    110-114        70        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    115-119        10        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)

== mortality ==
group  band(weeks)  seen  healthy  flocks  samples  from..to              ratio   book@mid  realistic  note
main    20-24          34       34       2       26  2026-07-02..2026-07-18  3546.2%  –  not learned  
main    25-29          98       98       3       94  2026-07-02..2026-08-22  812.1%  –  not learned  
main    30-34         105      105       3      105  2026-07-30..2026-09-26  536.8%  –  not learned  
main    35-39          95       95       3       95  2026-09-03..2026-10-26  280.8%  –  not learned  
main    40-44          34       34       2       30  2026-07-02..2026-10-26  201.2%  –  not learned  
main    45-49          35       35       1       35  2026-07-17..2026-08-20    –    –  not learned  only 1 flock (needs 2)
main    50-54          35       35       1       35  2026-08-21..2026-09-24    –    –  not learned  only 1 flock (needs 2)
main    55-59          83       83       4       71  2026-07-02..2026-10-26  189.0%  –  not learned  
main    60-64         105       93       3       93  2026-07-11..2026-08-26  201.9%  –  not learned  
main    65-69         105       74       3       70  2026-08-15..2026-09-30  213.3%  –  not learned  
main    70-74          87       87       3       87  2026-09-19..2026-10-26  121.6%  –  not learned  
main    75-79          32       32       2       28  2026-07-02..2026-10-26  173.6%  –  not learned  
main    80-84          35       28       1       28  2026-07-31..2026-08-27    –    –  not learned  only 1 flock (needs 2)
main    95-99           8        8       1        4  2026-07-02..2026-07-09    –    –  not learned  only 8 healthy flock-days (needs 28)
main    100-104        35        7       1        7  2026-07-10..2026-07-16    –    –  not learned  only 7 healthy flock-days (needs 28)
main    105-109        63        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    110-114        70        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    115-119        10        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
young   0-4            62       20       3       10  2026-10-18..2026-10-26    –    –  not learned  only 20 healthy flock-days (needs 28)
young   5-9             7        7       1        5  2026-10-20..2026-10-26    –    –  not learned  only 7 healthy flock-days (needs 28)
```

## Where the bands are missing (plain words)

Only four months (2 Jul – 26 Oct 2026) of records exist, so many bands cannot be learned yet and the app will say "realistic target not learned yet for this age" for them rather than guess:

* **Main group, HD and feed:** learned for ages 25–44 weeks and 55–79 weeks. **Not learned:** 20–24 (only 18 healthy days), 45–49 and 50–54 and 80–84 (a single flock each), 95+ weeks (a few days only, and the book table ends around there).
* **Young group (BAB-9/10/11):** nothing is learned. They arrived in October (about 27 healthy days in the youngest band, one flock short of the minimum in the next), and the young group has no feed column.
* **Mortality:** the farm's deaths per week are several times the book's (book weekly depletion is 0.01–0.15 % at these ages; the farm sees roughly 0.3–0.5 %), so the learned ratios are 120 %–800 % and in the 20–24 band (book 0.01 %) 3500 %. They are real arithmetic on the data, but the ratio is not a useful target for such tiny book numbers; the screen shows the learned deaths per week in plain numbers as well and the owner can override. Most of these flocks have been through only one season, so one bad month shapes a band.
* One extra year of paper-register data (screen K5) would fill most gaps: every age 20–85 weeks would then be seen by ≥ 2 flocks in different seasons.
