import type { PoolClient } from "pg";
import type { ResolvedEggLedgerSection } from "./eggLedgerResolve";
import type { ResolvedFeedBox } from "./feedBoxResolve";
import { syncSaleForEntry } from "../salesSync";

// Persistence for the egg ledger / feed box auto-extraction path (owner
// request, 2026-10-19) — parallels writeDailyProduction.ts's role: the
// correction/resolution logic (eggLedgerResolve.ts / feedBoxResolve.ts) is
// already fully decided by the time either function here runs; this file's
// only job is to write it, sync the variable-length deduction lines, sync
// which flocks this row covers, and run the SQL validation function that
// decides flagged/flag_reason (the SAME function the manual entry screens
// use — see migration 0020's header comment).
//
// Re-upload behavior matches daily_production: ON CONFLICT DO UPDATE,
// keeping the same row (never a duplicate, never a soft-delete-and-reinsert)
// — the partial unique index from migration 0020 is the conflict target.

function assertNoteConsistent(
  label: string,
  checks: [number | null, number | null, string][],
  note: string | null
): void {
  for (const [original, current, fieldName] of checks) {
    if (original === null) continue;
    const marker = `${original} corrected to ${current}`;
    if (!note || !note.includes(marker)) {
      throw new Error(
        `${fieldName} on ${label} has an original value (${original}) recorded but no note says "${marker}" — refusing to save.`
      );
    }
  }
}

export async function writeEggLedgerSection(
  client: PoolClient,
  farmCode: string,
  date: string,
  photoUrl: string | null,
  resolved: ResolvedEggLedgerSection,
  linkedFlockIds: string[]
): Promise<{ id: number; flagged: boolean; flagReason: string | null }> {
  // Only the 4 summary-level fields are checked here — see
  // eggLedgerResolve.ts's doc comment on why a deduction's signed DB
  // storage (amount_eggs is negative; the note is written in natural,
  // positive terms) makes the exact same marker check awkward for
  // deductions specifically, and why that's an acceptable, deliberate
  // scope decision rather than an oversight.
  assertNoteConsistent(
    `the ${resolved.section} egg ledger (${date})`,
    [
      [resolved.openingBalanceEggsOriginal, resolved.openingBalanceEggs, "opening_balance_eggs"],
      [resolved.totalEggsProducedOriginal, resolved.totalEggsProduced, "total_eggs_produced"],
      [resolved.totalLineEggsOriginal, resolved.totalLineEggs, "total_line_eggs"],
      [resolved.closingBalanceEggsOriginal, resolved.closingBalanceEggs, "closing_balance_eggs"],
    ],
    resolved.autoCorrectionNote
  );

  const { rows } = await client.query(
    `INSERT INTO daily_egg_stock_summary
         (date, farm_code, section,
          opening_balance_eggs, opening_balance_eggs_original,
          total_eggs_produced, total_eggs_produced_original,
          total_line_eggs, total_line_eggs_original,
          closing_balance_eggs, closing_balance_eggs_original,
          auto_correction_note, source_photo_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (farm_code, date, section) WHERE deleted_at IS NULL DO UPDATE SET
         opening_balance_eggs = EXCLUDED.opening_balance_eggs,
         opening_balance_eggs_original = EXCLUDED.opening_balance_eggs_original,
         total_eggs_produced  = EXCLUDED.total_eggs_produced,
         total_eggs_produced_original = EXCLUDED.total_eggs_produced_original,
         total_line_eggs      = EXCLUDED.total_line_eggs,
         total_line_eggs_original = EXCLUDED.total_line_eggs_original,
         closing_balance_eggs = EXCLUDED.closing_balance_eggs,
         closing_balance_eggs_original = EXCLUDED.closing_balance_eggs_original,
         auto_correction_note = EXCLUDED.auto_correction_note,
         source_photo_url     = EXCLUDED.source_photo_url,
         reviewed_by_owner    = false
     RETURNING id`,
    [
      date, farmCode, resolved.section,
      resolved.openingBalanceEggs, resolved.openingBalanceEggsOriginal,
      resolved.totalEggsProduced, resolved.totalEggsProducedOriginal,
      resolved.totalLineEggs, resolved.totalLineEggsOriginal,
      resolved.closingBalanceEggs, resolved.closingBalanceEggsOriginal,
      resolved.autoCorrectionNote, photoUrl,
    ]
  );
  const summaryId: number = rows[0].id;

  const { rows: existingEntries } = await client.query(
    `SELECT id, sequence_order, linked_sale_id FROM daily_egg_stock_entries WHERE egg_stock_summary_id = $1 ORDER BY sequence_order`,
    [summaryId]
  );

  for (let i = 0; i < resolved.deductions.length; i++) {
    const seq = i + 1;
    const d = resolved.deductions[i];
    // Sign convention: amount_eggs is stored SIGNED (deductions negative) by
    // an existing, pre-this-PR convention — negate the positive magnitude
    // here, at the DB-write boundary, same as every deduction the manual
    // entry screen has always written.
    const amountSigned = -d.amountEggs;
    const amountOriginalSigned = d.amountEggsOriginal !== null ? -d.amountEggsOriginal : null;
    const old = existingEntries.find((e) => e.sequence_order === seq);
    let entryId: number;
    if (old) {
      entryId = old.id;
      await client.query(
        `UPDATE daily_egg_stock_entries
            SET label_as_written = $2, category = $3, amount_eggs = $4,
                amount_eggs_original = $5, auto_correction_note = $6
          WHERE id = $1`,
        [old.id, d.labelAsWritten, d.categoryGuess, amountSigned, amountOriginalSigned, d.amountEggsOriginal !== null ? resolved.autoCorrectionNote : null]
      );
    } else {
      const { rows: inserted } = await client.query(
        `INSERT INTO daily_egg_stock_entries
             (egg_stock_summary_id, sequence_order, label_as_written, category,
              amount_eggs, amount_eggs_original, auto_correction_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [summaryId, seq, d.labelAsWritten, d.categoryGuess, amountSigned, amountOriginalSigned, d.amountEggsOriginal !== null ? resolved.autoCorrectionNote : null]
      );
      entryId = inserted[0].id;
    }

    // Owner request, 2026-10-19: "keep new sales rows auto-created from
    // future ledger lines" — this is the real photo-upload path (what
    // every real upload actually uses), which never created a sales row
    // at all before this. See salesSync.ts's own header comment.
    await syncSaleForEntry(
      client,
      {
        id: entryId,
        category: d.categoryGuess,
        labelAsWritten: d.labelAsWritten,
        amountEggsSigned: amountSigned,
        linkedSaleId: old?.linked_sale_id ?? null,
      },
      date,
      resolved.section,
      farmCode
    );
  }
  const doomed = existingEntries.filter((e) => e.sequence_order > resolved.deductions.length);
  if (doomed.length > 0) {
    const doomedIds = doomed.map((e) => e.id);
    await client.query(`UPDATE daily_egg_stock_entries SET linked_sale_id = NULL WHERE id = ANY($1)`, [doomedIds]);
    await client.query(`DELETE FROM sales WHERE source_ledger_entry_id = ANY($1)`, [doomedIds]);
    await client.query(`DELETE FROM daily_egg_stock_entries WHERE id = ANY($1)`, [doomedIds]);
  }

  await client.query(`DELETE FROM daily_egg_stock_summary_flocks WHERE egg_stock_summary_id = $1`, [summaryId]);
  for (const flockId of linkedFlockIds) {
    await client.query(
      `INSERT INTO daily_egg_stock_summary_flocks (egg_stock_summary_id, flock_internal_id) VALUES ($1, $2)`,
      [summaryId, flockId]
    );
  }

  await client.query(`SELECT fn_recompute_egg_stock_running_balances($1)`, [summaryId]);
  const { rows: validated } = await client.query(
    `UPDATE daily_egg_stock_summary
        SET flagged = cardinality(v.reasons) > 0,
            flag_reason = nullif(array_to_string(v.reasons, '; '), '')
       FROM (SELECT fn_validate_egg_stock_summary($1) AS reasons) v
      WHERE id = $1
      RETURNING flagged, flag_reason`,
    [summaryId]
  );

  return { id: summaryId, flagged: validated[0].flagged, flagReason: validated[0].flag_reason };
}

export async function writeFeedBox(
  client: PoolClient,
  farmCode: string,
  date: string,
  photoUrl: string | null,
  resolved: ResolvedFeedBox,
  linkedFlockIds: string[]
): Promise<{ id: number; flagged: boolean; flagReason: string | null }> {
  assertNoteConsistent(
    `feed box "${resolved.flockGroup}" (${date})`,
    [
      [resolved.openingBalanceBagsOriginal, resolved.openingBalanceBags, "opening_balance_bags"],
      [resolved.producedBagsOriginal, resolved.producedBags, "produced_bags"],
      [resolved.totalBagsOriginal, resolved.totalBags, "total_bags"],
      [resolved.consumedBagsOriginal, resolved.consumedBags, "consumed_bags"],
      [resolved.millInventoryBagsOriginal, resolved.millInventoryBags, "mill_inventory_bags"],
      [resolved.shedInventoryBagsOriginal, resolved.shedInventoryBags, "shed_inventory_bags"],
      [resolved.closingBalanceBagsOriginal, resolved.closingBalanceBags, "closing_balance_bags"],
    ],
    resolved.autoCorrectionNote
  );

  const { rows } = await client.query(
    `INSERT INTO daily_feed_bag_stock
         (date, farm_code, flock_group,
          opening_balance_bags, opening_balance_bags_original,
          produced_bags, produced_bags_original,
          total_bags, total_bags_original,
          consumed_bags, consumed_bags_original,
          mill_inventory_bags, mill_inventory_bags_original,
          shed_inventory_bags, shed_inventory_bags_original,
          closing_balance_bags, closing_balance_bags_original,
          auto_correction_note, source_photo_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (farm_code, flock_group, date) WHERE deleted_at IS NULL DO UPDATE SET
         opening_balance_bags = EXCLUDED.opening_balance_bags,
         opening_balance_bags_original = EXCLUDED.opening_balance_bags_original,
         produced_bags        = EXCLUDED.produced_bags,
         produced_bags_original = EXCLUDED.produced_bags_original,
         total_bags           = EXCLUDED.total_bags,
         total_bags_original  = EXCLUDED.total_bags_original,
         consumed_bags        = EXCLUDED.consumed_bags,
         consumed_bags_original = EXCLUDED.consumed_bags_original,
         mill_inventory_bags  = EXCLUDED.mill_inventory_bags,
         mill_inventory_bags_original = EXCLUDED.mill_inventory_bags_original,
         shed_inventory_bags  = EXCLUDED.shed_inventory_bags,
         shed_inventory_bags_original = EXCLUDED.shed_inventory_bags_original,
         closing_balance_bags = EXCLUDED.closing_balance_bags,
         closing_balance_bags_original = EXCLUDED.closing_balance_bags_original,
         auto_correction_note = EXCLUDED.auto_correction_note,
         source_photo_url     = EXCLUDED.source_photo_url,
         reviewed_by_owner    = false
     RETURNING id`,
    [
      date, farmCode, resolved.flockGroup,
      resolved.openingBalanceBags, resolved.openingBalanceBagsOriginal,
      resolved.producedBags, resolved.producedBagsOriginal,
      resolved.totalBags, resolved.totalBagsOriginal,
      resolved.consumedBags, resolved.consumedBagsOriginal,
      resolved.millInventoryBags, resolved.millInventoryBagsOriginal,
      resolved.shedInventoryBags, resolved.shedInventoryBagsOriginal,
      resolved.closingBalanceBags, resolved.closingBalanceBagsOriginal,
      resolved.autoCorrectionNote, photoUrl,
    ]
  );
  const groupId: number = rows[0].id;

  await client.query(`DELETE FROM daily_feed_bag_stock_flocks WHERE feed_bag_stock_id = $1`, [groupId]);
  for (const flockId of linkedFlockIds) {
    await client.query(
      `INSERT INTO daily_feed_bag_stock_flocks (feed_bag_stock_id, flock_internal_id) VALUES ($1, $2)`,
      [groupId, flockId]
    );
  }

  const { rows: validated } = await client.query(
    `UPDATE daily_feed_bag_stock
        SET flagged = cardinality(v.reasons) > 0,
            flag_reason = nullif(array_to_string(v.reasons, '; '), '')
       FROM (SELECT fn_validate_feed_bag_stock($1) AS reasons) v
      WHERE id = $1
      RETURNING flagged, flag_reason`,
    [groupId]
  );

  return { id: groupId, flagged: validated[0].flagged, flagReason: validated[0].flag_reason };
}
