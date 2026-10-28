// Tests the paper-history import parser and validator (K5).  npx tsx scripts/import-check.mts
import { parseCsv, readTable, validateRows, parseDate } from "../lib/import/paperHistory.ts";
let failed = 0;
const ok = (n: string, c: boolean, x = "") => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`); };
const flocks = [{ id: "f1", label: "BAB-1", big: true }, { id: "f9", label: "BAB-9", big: false }];
const csv = `Date,Flock label,Eggs,Birds,Mortality,Feed bags
2025-03-14,BAB-1,5760,6400,2,38
14/03/2025,bab-9,421,500,0,
2025-03-15,BAB-1,5761,6400,2,38
2025-03-16,BAB-7,300,500,1,3
2099-01-01,BAB-1,300,500,1,3
2025-03-17,BAB-1,abc,500,1,3
2025-03-18,BAB-1,6000,100,1,3
2025-03-14,BAB-1,5760,6400,2,38
2025-03-19,BAB-1,5700,6400,2,38
`;
const rep = validateRows(readTable(parseCsv(csv)), flocks, new Set(["f1|2025-03-19"]), "2026-10-28");
const st = rep.results.map((r) => r.state);
ok("good row is ok", st[0] === "ok");
ok("lower-case label, DD/MM/YYYY date and empty feed are accepted (feed gives a warning)", st[1] === "ok" && rep.results[1].warnings.some((w) => /feed/.test(w)));
ok("big-egg flock: eggs not a multiple of 30 is an error", st[2] === "error" && /multiple of 30/.test(rep.results[2].errors.join()));
ok("unknown flock is an error", st[3] === "error" && /not in the app/.test(rep.results[3].errors.join()));
ok("future date is an error", st[4] === "error" && /future/.test(rep.results[4].errors.join()));
ok("non-number is an error", st[5] === "error" && /whole number/.test(rep.results[5].errors.join()));
ok("eggs more than birds is an error", st[6] === "error");
ok("duplicate in file is an error", st[7] === "error" && /twice/.test(rep.results[7].errors.join()));
ok("existing day is marked exists, not overwritten", st[8] === "exists");
ok("counts add up", rep.counts.total === 9 && rep.counts.ok === 2 && rep.counts.exists === 1 && rep.counts.error === 6, JSON.stringify(rep.counts));
ok("missing columns reported", readTable(parseCsv("date,eggs\n2025-01-01,30")).columnProblems.length >= 2);
ok("semicolon CSV and Excel serial dates", parseCsv("a;b\n1;2")[1][1] === "2" && parseDate("45000") === "2023-03-15");
ok("impossible date rejected", parseDate("31/02/2025") === null);
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
