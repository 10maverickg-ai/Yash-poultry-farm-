"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FlaggedItem, UnresolvedExtraction } from "@/lib/records";
import type { Flock } from "@/lib/flocks";
import { markReviewed, resolveExtraction, deleteFlaggedRecords } from "@/app/flagged/actions";

// Client component: only the parts that need interactivity — checkboxes for
// multi-select bulk delete, and a confirm() gate on every delete (naming the
// flock and date, per the owner's requirement) before anything is removed
// from view. "Mark reviewed" and "resolve to a flock" stay exactly the
// plain server-action forms they were — Server Actions work the same way
// inside a Client Component, nothing about them needed to change.
export function FlaggedProductionSection({
  productionItems,
  unresolvedItems,
  activeFlocks,
}: {
  productionItems: FlaggedItem[];
  unresolvedItems: UnresolvedExtraction[];
  activeFlocks: Flock[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const key = (kind: "production" | "unresolved", id: number) => `${kind}:${id}`;

  function toggle(k: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function idsOf(kind: "production" | "unresolved"): number[] {
    const prefix = `${kind}:`;
    return [...selected]
      .filter((k) => k.startsWith(prefix))
      .map((k) => Number(k.slice(prefix.length)));
  }

  function runDelete(input: { productionIds?: number[]; unresolvedIds?: number[] }) {
    startTransition(async () => {
      await deleteFlaggedRecords(input);
      setSelected(new Set());
      router.refresh();
    });
  }

  function deleteOne(kind: "production" | "unresolved", id: number, label: string, date: string) {
    if (!confirm(`Delete "${label}" — ${date}? This cannot be undone.`)) return;
    runDelete(kind === "production" ? { productionIds: [id] } : { unresolvedIds: [id] });
  }

  function deleteSelected() {
    const productionIds = idsOf("production");
    const unresolvedIds = idsOf("unresolved");
    const count = productionIds.length + unresolvedIds.length;
    if (count === 0) return;
    if (!confirm(`Delete ${count} selected record${count === 1 ? "" : "s"}? This cannot be undone.`)) return;
    runDelete({ productionIds, unresolvedIds });
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="card selection-bar">
          <span>{selected.size} selected</span>
          <button
            type="button"
            className="btn-danger"
            disabled={isPending}
            onClick={deleteSelected}
          >
            {isPending ? "Deleting…" : `Delete ${selected.size} selected`}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {unresolvedItems.length > 0 && (
        <>
          <h2>Unmatched flock labels</h2>
          <p className="muted">
            Read from a photo, but the label didn&apos;t match any active
            flock — not even after allowing for spacing, case, or minor
            punctuation differences. Nothing here is lost: pick the flock it
            actually belongs to below and the numbers save normally.
          </p>
          {unresolvedItems.map((item) => {
            const k = key("unresolved", item.id);
            return (
              <div key={k} className="card stack">
                <div className="flagged-card-header">
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(k)}
                      onChange={() => toggle(k)}
                    />
                    <h3>
                      &ldquo;{item.display_label_as_written}&rdquo;{" "}
                      <span className="muted">· {item.date}</span>
                    </h3>
                  </label>
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={isPending}
                    onClick={() =>
                      deleteOne("unresolved", item.id, item.display_label_as_written, item.date)
                    }
                  >
                    Delete
                  </button>
                </div>
                <div className="flag-banner">
                  Could not match this label to a known flock — please confirm.
                </div>
                {item.sections_found !== null && (
                  <p className="muted" style={{ margin: 0 }}>
                    Model reported {item.sections_found} flock table section
                    {item.sections_found === 1 ? "" : "s"} found in this photo.
                  </p>
                )}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Mort</th>
                        <th>Feed</th>
                        <th>Total eggs</th>
                        <th>Bal bird</th>
                        <th>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>{item.mortality ?? "—"}</td>
                        <td>{item.feed_bags ?? "—"}</td>
                        <td>{item.eggs_total ?? "—"}</td>
                        <td>{item.bird_population ?? "—"}</td>
                        <td>{item.hd_percent_written ?? "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {item.source_photo_url && (
                  <a href={item.source_photo_url} target="_blank" rel="noreferrer">
                    {
                      // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, no next/image loader configured for it
                      <img
                        src={item.source_photo_url}
                        alt={`Source register photo for "${item.display_label_as_written}"`}
                        className="flagged-photo-thumb"
                      />
                    }
                  </a>
                )}
                <form action={resolveExtraction.bind(null, item.id)} className="actions-bar" style={{ marginBottom: 0 }}>
                  <label className="field" style={{ flex: 1, minWidth: 200 }}>
                    <span>This is actually…</span>
                    <select name="flockInternalId" required defaultValue="">
                      <option value="" disabled>
                        Choose a flock
                      </option>
                      {activeFlocks.map((f) => (
                        <option key={f.flock_internal_id} value={f.flock_internal_id}>
                          {f.display_label}
                          {f.current_shed ? ` — ${f.current_shed}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="btn">
                    Save to this flock
                  </button>
                </form>
              </div>
            );
          })}
          <h2>Flagged records</h2>
        </>
      )}

      {productionItems.map((item) => {
          const k = key("production", item.id);
          return (
            <div key={k} className="card stack">
              <div className="flagged-card-header">
                <label>
                  <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} />
                  <h2>
                    {item.title} <span className="muted">· {item.date}</span>
                  </h2>
                </label>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={isPending}
                  onClick={() => deleteOne("production", item.id, item.title, item.date)}
                >
                  Delete
                </button>
              </div>
              <div className="flag-banner">{item.flag_reason ?? "flagged"}</div>
              {item.sections_found !== null && (
                <p className="muted" style={{ margin: 0 }}>
                  Model reported {item.sections_found} flock table section
                  {item.sections_found === 1 ? "" : "s"} found in this photo.
                </p>
              )}
              {item.source_photo_url && (
                <a href={item.source_photo_url} target="_blank" rel="noreferrer">
                  {
                    // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, no next/image loader configured for it
                    <img
                      src={item.source_photo_url}
                      alt={`Source register photo for ${item.title}`}
                      className="flagged-photo-thumb"
                    />
                  }
                </a>
              )}
              <div className="actions-bar" style={{ marginBottom: 0 }}>
                <Link href={item.entry_href} className="btn">
                  Open entry screen
                </Link>
                <form action={markReviewed.bind(null, item.source, item.id)}>
                  <button type="submit" className="btn-secondary">
                    Mark reviewed
                  </button>
                </form>
              </div>
            </div>
          );
        })}
    </>
  );
}
