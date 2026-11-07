import Link from "next/link";
import { notFound } from "next/navigation";
import { getItem } from "@/lib/medicines/catalogueStore";
import { TO_CONFIRM_LINE, itemSummary, kindLabel } from "@/lib/medicines/catalogue";
import { CatalogueItemForm } from "@/components/CatalogueItemForm";
import { CatalogueDelete } from "@/components/CatalogueDelete";
import { ActionForm } from "@/components/ActionForm";
import { addAliasAction, confirmCatalogueItem, deleteCatalogueItem, removeAliasAction, saveBoosterRules, saveCatalogueItem, setCatalogueActive } from "../actions";
import { itemRuleIds, listRules } from "@/lib/medicines/boosterStore";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const item = await getItem(Number((await params).id)).catch(() => null);
  return { title: item ? item.name : "Medicines list" };
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const n = Number((await params).id);
  if (!Number.isInteger(n)) notFound();
  const item = await getItem(n);
  if (!item) notFound();
  const [rules, mine] = item.kind === "vaccine" ? await Promise.all([listRules(), itemRuleIds(item.id)]) : [[], [] as number[]];
  return (
    <>
      <h1>{item.name}</h1>
      <p className="muted"><Link href="/medicines/list">← Medicines list</Link> · {kindLabel(item.kind)}{itemSummary(item) ? ` · ${itemSummary(item)}` : ""}</p>
      {item.needsConfirmation && (
        <div className="flag-banner">
          <b>To confirm.</b> {TO_CONFIRM_LINE}
          <ActionForm action={confirmCatalogueItem.bind(null, item.id)} className="actions-bar" style={{ marginTop: "0.4rem", marginBottom: 0 }}><button type="submit">Mark as confirmed</button></ActionForm>
        </div>
      )}
      <div className="card"><CatalogueItemForm action={saveCatalogueItem.bind(null, item.id)} item={item} usedLock={item.used > 0} /></div>

      <h2>Other spellings</h2>
      <section className="card stack">
        <p className="muted" style={{ margin: 0 }}>A register that writes “Coryza” where the list says “Croyza” still means the same item: add the other spelling here. One spelling can only mean one item.</p>
        {item.aliases.length === 0 && <p className="muted" style={{ margin: 0 }}>No other spellings yet.</p>}
        {item.aliases.map((a) => (
          <ActionForm key={a.id} action={removeAliasAction.bind(null, a.id)} className="actions-bar" style={{ margin: 0 }}>
            <span style={{ alignSelf: "center", flex: 1 }}>{a.alias}</span>
            <button type="submit" className="btn-secondary">Remove</button>
          </ActionForm>
        ))}
        <ActionForm action={addAliasAction.bind(null, item.id)} className="actions-bar" style={{ margin: 0 }}>
          <label className="field" style={{ flex: 1, margin: 0 }}><span>Add another spelling</span><input type="text" name="alias" maxLength={80} autoComplete="off" /></label>
          <button type="submit">Add</button>
        </ActionForm>
      </section>

      {item.kind === "vaccine" && rules.length > 0 && (
        <>
          <h2>Counts as a booster</h2>
          <ActionForm action={saveBoosterRules.bind(null, item.id)} className="card stack">
            <p className="muted" style={{ margin: 0 }}>Some vaccines are repeated every 6 months in laying flocks. Tick the booster this item counts for: when it is given to a flock, that flock&apos;s next due date moves on.</p>
            {rules.map((r) => (
              <label key={r.id} className="check-line">
                <input type="checkbox" name="rule" value={r.id} defaultChecked={mine.includes(r.id)} disabled={r.mainItemId === item.id} />
                <span>{r.label} <span className="hint">(every {r.repeatMonths} months{r.mainItemId === item.id ? "; this is its own item" : ""})</span></span>
              </label>
            ))}
            <button type="submit">Save</button>
          </ActionForm>
        </>
      )}

      <h2>In the pick list</h2>
      <section className="card stack">
        <p style={{ margin: 0 }}>{item.active ? "It shows in the pick list on the register screens." : "It is out of the pick list. Old lines keep their name."}</p>
        <ActionForm action={setCatalogueActive.bind(null, item.id, !item.active)} className="actions-bar" style={{ margin: 0 }}>
          <button type="submit" className="btn-secondary">{item.active ? "Take it out of the pick list" : "Put it back in the pick list"}</button>
        </ActionForm>
        <p className="muted an-tiny" style={{ margin: 0 }}>{item.used === 0 ? "Not used yet." : `Used ${item.used} time${item.used === 1 ? "" : "s"}.`}</p>
      </section>
      <CatalogueDelete action={deleteCatalogueItem.bind(null, item.id)} />
    </>
  );
}
