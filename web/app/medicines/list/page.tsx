import Link from "next/link";
import { listCatalogue } from "@/lib/medicines/catalogueStore";
import { ITEM_KINDS, TO_CONFIRM_LINE, itemSummary, kindPlural, searchItems, type CatalogueItem } from "@/lib/medicines/catalogue";
import { CatalogueItemForm } from "@/components/CatalogueItemForm";
import { ActionForm } from "@/components/ActionForm";
import { addCatalogueItem, confirmCatalogueItem } from "./actions";

export const metadata = { title: "Medicines list" };
export const dynamic = "force-dynamic";

function Card({ i }: { i: CatalogueItem }) {
  return (
    <div className="card md-item" style={i.active ? undefined : { opacity: 0.7 }}>
      <div className="md-item-head">
        <b>{i.name}</b>
        {i.needsConfirmation && <span className="badge badge-confirm">to confirm</span>}
        {!i.active && <span className="badge badge-depleted">not in the pick list</span>}
      </div>
      {itemSummary(i) && <div className="an-tiny">{itemSummary(i)}</div>}
      {i.aliases.length > 0 && <div className="muted an-tiny">Also written: {i.aliases.map((a) => a.alias).join(", ")}</div>}
      {i.note && <div className="muted an-tiny">{i.note}</div>}
      <div className="muted an-tiny">{i.used === 0 ? "Not used yet." : `Used ${i.used} time${i.used === 1 ? "" : "s"}.`}</div>
      <div className="actions-bar" style={{ marginBottom: 0, marginTop: "0.4rem" }}>
        <Link href={`/medicines/list/${i.id}`} className="btn btn-secondary">Open and change</Link>
        {i.needsConfirmation && (
          <ActionForm action={confirmCatalogueItem.bind(null, i.id)} className="actions-bar" style={{ margin: 0 }}>
            <button type="submit">Mark as confirmed</button>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

export default async function MedicinesListPage({ searchParams }: { searchParams: Promise<{ q?: string; confirm?: string }> }) {
  const sp = await searchParams;
  const all = await listCatalogue();
  const q = (sp.q ?? "").slice(0, 60);
  const onlyConfirm = sp.confirm === "1";
  const shown = searchItems(all, q).filter((i) => !onlyConfirm || i.needsConfirmation);
  const toConfirm = all.filter((i) => i.needsConfirmation).length;
  return (
    <>
      <h1>Medicines list</h1>
      <p className="muted">Every medicine, vaccine and farm task used on the farm, once. The register screens pick from this list, so one medicine is never spelled three ways. <Link href="/medicines">← Medicines &amp; vaccines</Link></p>
      <p className="card">{TO_CONFIRM_LINE}</p>

      <form method="get" className="day-pick" style={{ marginBottom: "0.5rem" }} role="search">
        <label className="field" style={{ margin: 0, flex: 1 }}><span>Search the list</span><input type="search" name="q" defaultValue={q} placeholder="name, other spelling, disease or brand" /></label>
        {onlyConfirm && <input type="hidden" name="confirm" value="1" />}
        <button type="submit" className="btn-secondary">Search</button>
      </form>
      <p className="muted an-tiny" style={{ marginTop: 0 }}>
        {shown.length} of {all.length} shown. {toConfirm > 0 && (onlyConfirm ? <Link href={q ? `/medicines/list?q=${encodeURIComponent(q)}` : "/medicines/list"}>Show everything</Link> : <Link href={`/medicines/list?confirm=1${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Show only the {toConfirm} “to confirm”</Link>)}
      </p>

      <details className="card">
        <summary><b>Add a medicine, vaccine or farm task</b></summary>
        <div style={{ marginTop: "0.6rem" }}><CatalogueItemForm action={addCatalogueItem} /></div>
      </details>

      {ITEM_KINDS.map((k) => {
        const group = shown.filter((i) => i.kind === k.key);
        if (group.length === 0) return null;
        return (
          <section key={k.key} aria-label={kindPlural(k.key)}>
            <h2>{kindPlural(k.key)} <span className="badge">{group.length}</span></h2>
            {group.map((i) => (<Card key={i.id} i={i} />))}
          </section>
        );
      })}
      {shown.length === 0 && <p className="card muted">Nothing matches. Add it above if it is missing.</p>}
    </>
  );
}
