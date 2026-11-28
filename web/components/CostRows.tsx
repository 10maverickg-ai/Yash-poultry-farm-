// V19 D1: the cost lines after Feed, with where each number came from: "(average)", "bill", "included in feed price",
// "not entered" — never a silent number and never ₹0 for something not entered. Used by the period Money block and
// the Purchases & costs months, so both say the same thing.
import type { CostSourceSummary, DayEconomics } from "@/lib/costs/engine";
import { anySource, onlySource, sourceWords } from "@/lib/costs/costWords";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const Badge = ({ children }: { children: React.ReactNode }) => <span className="badge badge-flagged">{children}</span>;
const Muted = ({ children }: { children: React.ReactNode }) => <span className="muted an-tiny"> ({children})</span>;

export function CostRows({ cost, sources, missing, packPer, chickPrice }: { cost: DayEconomics["cost"]; sources: CostSourceSummary; missing: string[]; packPer: number | null; chickPrice: number | null }) {
  const miss = (what: string) => missing.some((x) => x.startsWith(what));
  const amountOrMissing = (key: "electricity" | "diesel", value: number, label: string) => {
    if (onlySource(sources, key, "missing")) return <Badge>missing: not entered</Badge>;
    return <>{inr(value)}{anySource(sources, key, "average") && <> <span className="badge">average</span></>}{anySource(sources, key, "missing") && <> <Badge>{label} partly not entered</Badge></>}</>;
  };
  const opt = (key: "topDressing" | "interest" | "rent", value: number) => (onlySource(sources, key, "not_entered") ? <span className="badge">not entered</span> : inr(value));
  return (
    <>
      <tr><td>Labour<Muted>{sourceWords(sources, "labour") || "not entered"}</Muted></td><td className="num">{onlySource(sources, "labour", "missing") ? <Badge>missing: not entered</Badge> : inr(cost.labour)}</td></tr>
      <tr><td>Electricity<Muted>{sourceWords(sources, "electricity")}</Muted></td><td className="num">{amountOrMissing("electricity", cost.electricity, "electricity")}</td></tr>
      <tr><td>Diesel<Muted>{sourceWords(sources, "diesel")}</Muted></td><td className="num">{amountOrMissing("diesel", cost.diesel, "diesel")}</td></tr>
      <tr><td>Miscellaneous (average)<Muted>{onlySource(sources, "miscellaneous", "not_entered") ? "not entered" : `${sourceWords(sources, "miscellaneous").replace(/^average /, "")}: vaccines, repairs, transport, vet and anything else not listed`}</Muted></td><td className="num">{onlySource(sources, "miscellaneous", "not_entered") ? <span className="badge">not entered</span> : <>{inr(cost.miscellaneous)} <span className="badge">average</span></>}</td></tr>
      <tr><td>Packing<Muted>{packPer != null ? `₹${packPer} per tray sold; trays = eggs sold ÷ 30, big and small eggs` : "price per tray not entered"}</Muted></td><td className="num">{miss("packing price") ? <Badge>not entered</Badge> : inr(cost.packing)}</td></tr>
      <tr>
        <td>Medicines and vaccines<Muted>{sourceWords(sources, "medicine")}{cost.medicine > 0 ? ` · ${inr(cost.medicine)} bought separately and entered` : ""}</Muted></td>
        <td className="num">{onlySource(sources, "medicine", "in_feed") ? (cost.medicine > 0 ? inr(cost.medicine) : <span className="badge">included in feed price</span>) : miss("medicines") ? <Badge>not entered</Badge> : inr(cost.medicine)}</td>
      </tr>
      <tr><td>Other costs (entered purchases)</td><td className="num">{miss("other costs") ? <Badge>not entered</Badge> : cost.other === 0 && anySource(sources, "miscellaneous", "average") ? <span className="muted an-tiny">none entered (the average covers them)</span> : inr(cost.other)}</td></tr>
      <tr><td>Chick purchase<Muted>{`average ${chickPrice != null ? `₹${chickPrice}` : "price"} per chick × chicks that arrived; counted in the month they arrived`}</Muted></td><td className="num">{inr(cost.chicks)}</td></tr>
      <tr><td>Top dressing<Muted>only when given; medicines are otherwise inside the feed price</Muted></td><td className="num">{opt("topDressing", cost.topDressing)}</td></tr>
      <tr><td>Interest</td><td className="num">{opt("interest", cost.interest)}</td></tr>
      <tr><td>Rent</td><td className="num">{opt("rent", cost.rent)}</td></tr>
    </>
  );
}

/** "Profit before interest, rent and top dressing (not entered)" — said whenever one of them is not entered. */
export function notEnteredExtras(sources: CostSourceSummary): string[] {
  return (["interest", "rent", "topDressing"] as const).filter((k) => onlySource(sources, k, "not_entered")).map((k) => (k === "topDressing" ? "top dressing" : k));
}
