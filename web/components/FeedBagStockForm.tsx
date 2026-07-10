"use client";

import { useActionState, useMemo, useState } from "react";
import { saveFeedBagStock } from "@/app/feed-bag-stock/actions";
import type { ActiveFlockOption, FeedBagStockDay } from "@/lib/feedBagStock";

interface GroupCard {
  key: number; // stable React key, independent of array index
  groupName: string;
  opening: string;
  produced: string;
  total: string;
  consumed: string;
  mill: string;
  shed: string;
  closing: string;
  linkedFlockIds: string[];
}

let nextKey = 0;

function blankCard(): GroupCard {
  return {
    key: nextKey++,
    groupName: "",
    opening: "",
    produced: "",
    total: "",
    consumed: "",
    mill: "",
    shed: "",
    closing: "",
    linkedFlockIds: [],
  };
}

export function FeedBagStockForm({
  date,
  day,
}: {
  date: string;
  day: FeedBagStockDay;
}) {
  const [state, formAction, pending] = useActionState(
    saveFeedBagStock.bind(null, date),
    null
  );
  const v = state?.values;

  // On a failed submit, re-seed exactly what was typed (including checkbox
  // state); otherwise seed from the saved rows for this date.
  let initialCards: GroupCard[];
  if (v) {
    const n = Number(v.group_count ?? 0);
    initialCards = Array.from({ length: n }, (_, i) => {
      const linked = day.activeFlocks
        .map((f) => f.flock_internal_id)
        .filter((id) => v[`flock_${i}_${id}`] !== undefined);
      return {
        key: nextKey++,
        groupName: v[`group_${i}`] ?? "",
        opening: v[`opening_${i}`] ?? "",
        produced: v[`produced_${i}`] ?? "",
        total: v[`total_${i}`] ?? "",
        consumed: v[`consumed_${i}`] ?? "",
        mill: v[`mill_${i}`] ?? "",
        shed: v[`shed_${i}`] ?? "",
        closing: v[`closing_${i}`] ?? "",
        linkedFlockIds: linked,
      };
    });
  } else {
    initialCards = day.groups.map((g) => ({
      key: nextKey++,
      groupName: g.flock_group,
      opening: g.opening_balance_bags?.toString() ?? "",
      produced: g.produced_bags?.toString() ?? "",
      total: g.total_bags?.toString() ?? "",
      consumed: g.consumed_bags?.toString() ?? "",
      mill: g.mill_inventory_bags?.toString() ?? "",
      shed: g.shed_inventory_bags?.toString() ?? "",
      closing: g.closing_balance_bags?.toString() ?? "",
      linkedFlockIds: g.linked_flock_ids,
    }));
  }

  const [cards, setCards] = useState<GroupCard[]>(
    initialCards.length > 0 ? initialCards : [blankCard()]
  );

  const setCard = (key: number, patch: Partial<GroupCard>) =>
    setCards((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  return (
    <form action={formAction} className="stack">
      {state && <div className="error-banner">{state.error}</div>}
      <input type="hidden" name="group_count" value={cards.length} />
      {cards.map((card, i) => (
        <GroupCardFields
          key={card.key}
          index={i}
          card={card}
          activeFlocks={day.activeFlocks}
          knownGroupNames={day.knownGroupNames}
          savedFlagged={day.groups.find((g) => g.flock_group === card.groupName)?.flagged}
          savedFlagReason={
            day.groups.find((g) => g.flock_group === card.groupName)?.flag_reason
          }
          onChange={(patch) => setCard(card.key, patch)}
          onRemove={() => setCards((cs) => cs.filter((c) => c.key !== card.key))}
        />
      ))}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setCards((cs) => [...cs, blankCard()])}
      >
        + Add group
      </button>
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save day's feed bag stock"}
      </button>
    </form>
  );
}

function GroupCardFields({
  index,
  card,
  activeFlocks,
  knownGroupNames,
  savedFlagged,
  savedFlagReason,
  onChange,
  onRemove,
}: {
  index: number;
  card: GroupCard;
  activeFlocks: ActiveFlockOption[];
  knownGroupNames: string[];
  savedFlagged?: boolean;
  savedFlagReason?: string | null;
  onChange: (patch: Partial<GroupCard>) => void;
  onRemove: () => void;
}) {
  const datalistId = `feed-bag-groups-${index}`;

  const balance = useMemo(() => {
    const mill = Number(card.mill);
    const shed = Number(card.shed);
    const closing = Number(card.closing);
    const total = Number(card.total);
    const consumed = Number(card.consumed);
    const lines: { ok: boolean; text: string }[] = [];
    if (card.mill !== "" && card.shed !== "" && card.closing !== "") {
      const expected = mill + shed;
      lines.push({
        ok: expected === closing,
        text: `F ${mill} + S ${shed} = ${expected} vs closing ${closing}`,
      });
    }
    if (card.total !== "" && card.consumed !== "" && card.closing !== "") {
      const expected = total - consumed;
      lines.push({
        ok: expected === closing,
        text: `total ${total} − consumed ${consumed} = ${expected} vs closing ${closing}`,
      });
    }
    return lines;
  }, [card.mill, card.shed, card.closing, card.total, card.consumed]);

  const linkedSum = activeFlocks
    .filter((f) => card.linkedFlockIds.includes(f.flock_internal_id))
    .reduce<number | null>((sum, f) => {
      if (sum === null || f.feed_bags === null) return null;
      return sum + f.feed_bags;
    }, 0);

  return (
    <div className="card stack" style={{ marginBottom: 0 }}>
      <h2 style={{ margin: 0 }}>
        Group {index + 1}
        {savedFlagged && <span className="badge badge-flagged"> flagged</span>}
      </h2>
      {savedFlagged && savedFlagReason && (
        <div className="flag-banner">{savedFlagReason}</div>
      )}
      <label className="field">
        <span>Group name</span>
        <input
          name={`group_${index}`}
          list={datalistId}
          value={card.groupName}
          onChange={(e) => onChange({ groupName: e.target.value })}
          placeholder="e.g. Layer (BAB 1-7)"
        />
        <datalist id={datalistId}>
          {knownGroupNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </label>
      <div className="grid4">
        <label className="field">
          <span>Opening</span>
          <input
            type="number"
            min="0"
            name={`opening_${index}`}
            value={card.opening}
            onChange={(e) => onChange({ opening: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Produced</span>
          <input
            type="number"
            min="0"
            name={`produced_${index}`}
            value={card.produced}
            onChange={(e) => onChange({ produced: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Total</span>
          <input
            type="number"
            min="0"
            name={`total_${index}`}
            value={card.total}
            onChange={(e) => onChange({ total: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Consumed</span>
          <input
            type="number"
            min="0"
            name={`consumed_${index}`}
            value={card.consumed}
            onChange={(e) => onChange({ consumed: e.target.value })}
          />
        </label>
      </div>
      <div className="grid4">
        <label className="field">
          <span>Mill (F)</span>
          <input
            type="number"
            min="0"
            name={`mill_${index}`}
            value={card.mill}
            onChange={(e) => onChange({ mill: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Shed (S)</span>
          <input
            type="number"
            min="0"
            name={`shed_${index}`}
            value={card.shed}
            onChange={(e) => onChange({ shed: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Closing</span>
          <input
            type="number"
            min="0"
            name={`closing_${index}`}
            value={card.closing}
            onChange={(e) => onChange({ closing: e.target.value })}
          />
        </label>
      </div>
      {balance.map((line, i) => (
        <p key={i} className={line.ok ? "muted" : "balance-warn"} style={{ margin: 0 }}>
          {line.ok ? "✓ " : "✗ "}
          {line.text}
        </p>
      ))}

      <div className="field">
        <span>
          Flocks in this group{" "}
          <span className="hint">
            (drives the consumed-vs-Daily-Production cross-check
            {linkedSum !== null && card.linkedFlockIds.length > 0
              ? ` — linked total: ${linkedSum}`
              : ""}
            )
          </span>
        </span>
        <div className="flock-checklist">
          {activeFlocks.length === 0 && (
            <span className="muted">No flocks effective on this date.</span>
          )}
          {activeFlocks.map((f) => (
            <label key={f.flock_internal_id} className="flock-check">
              <input
                type="checkbox"
                name={`flock_${index}_${f.flock_internal_id}`}
                checked={card.linkedFlockIds.includes(f.flock_internal_id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...card.linkedFlockIds, f.flock_internal_id]
                    : card.linkedFlockIds.filter((id) => id !== f.flock_internal_id);
                  onChange({ linkedFlockIds: next });
                }}
              />
              {f.display_label}
              {f.feed_bags !== null ? ` (${f.feed_bags})` : ""}
            </label>
          ))}
        </div>
      </div>

      <button type="button" className="btn-secondary" onClick={onRemove}>
        Remove group
      </button>
    </div>
  );
}
