// friendlyReaderError: raw provider messages never reach the screen
import { friendlyReaderError } from "../lib/reader/friendlyError.ts";
let bad = 0;
const t = (name: string, err: unknown, want: boolean, mustNot?: RegExp) => {
  const r = friendlyReaderError(err);
  const ok = (r !== null) === want && (!mustNot || !r || !mustNot.test(r.friendly));
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${r ? "  → " + r.friendly.slice(0, 70) : ""}`);
};
t("credit balance too low", new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'), true, /credit balance|Anthropic|invalid_request/);
t("401 invalid key", Object.assign(new Error("invalid x-api-key"), { status: 401 }), true, /x-api-key/);
t("429 rate limit", Object.assign(new Error("rate_limit_error"), { status: 429 }), true);
t("529 overloaded", Object.assign(new Error("Overloaded"), { status: 529 }), true);
t("network reset", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }), true);
t("an ordinary bug is NOT disguised", new Error("x is not iterable"), false);
process.exit(bad ? 1 : 0);
