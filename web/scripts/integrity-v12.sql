-- V12 N7: read-only integrity sweep. Run:  psql -d <db> -f scripts/integrity-v12.sql   (nothing here writes)
\pset format aligned
\echo '== 1. rows pointing to a missing flock (should be 0; foreign keys enforce it)'
select 'daily_production' t, count(*) from daily_production d where not exists (select 1 from flocks f where f.flock_internal_id=d.flock_internal_id)
union all select 'movements', count(*) from flock_movements m where not exists (select 1 from flocks f where f.flock_internal_id=m.flock_internal_id)
union all select 'feed junction', count(*) from daily_feed_bag_stock_flocks j where not exists (select 1 from flocks f where f.flock_internal_id=j.flock_internal_id)
union all select 'ledger junction', count(*) from daily_egg_stock_summary_flocks j where not exists (select 1 from flocks f where f.flock_internal_id=j.flock_internal_id);
\echo '== 2. soft-deleted rows still referenced'
select count(*) from daily_egg_stock_summary_flocks j join daily_egg_stock_summary s on s.id=j.egg_stock_summary_id where s.deleted_at is not null;
select count(*) from daily_feed_bag_stock_flocks j join daily_feed_bag_stock s on s.id=j.feed_bag_stock_id where s.deleted_at is not null;
\echo '== 3. duplicate active days (flock+date) and duplicate sections/groups per date'
select flock_internal_id, date, count(*) from daily_production where deleted_at is null group by 1,2 having count(*)>1;
select date, section, count(*) from daily_egg_stock_summary where deleted_at is null group by 1,2 having count(*)>1;
select date, flock_group, count(*) from daily_feed_bag_stock where deleted_at is null group by 1,2 having count(*)>1;
\echo '== 4. rows dated in the future (any table)'
select 'production' t, count(*) from daily_production where date > current_date
union all select 'ledger', count(*) from daily_egg_stock_summary where date > current_date
union all select 'feedbox', count(*) from daily_feed_bag_stock where date > current_date
union all select 'sales', count(*) from sales where date > current_date
union all select 'rates', count(*) from daily_egg_rates where date > current_date
union all select 'movements', count(*) from flock_movements where date > current_date
union all select 'purchases', count(*) from purchases where date > current_date
union all select 'vaccination given', count(*) from vaccination_schedule where given_date > current_date;
\echo '== 5. days with data per table: missing days between 2026-07-02 and the last production day'
with d as (select generate_series('2026-07-02'::date, (select max(date) from daily_production where deleted_at is null), '1 day')::date dt)
select 'production' t, dt from d where not exists (select 1 from daily_production p where p.date=dt and p.deleted_at is null)
union all select 'big ledger', dt from d where not exists (select 1 from daily_egg_stock_summary s where s.date=dt and s.section='big' and s.deleted_at is null)
union all select 'small ledger', dt from d where not exists (select 1 from daily_egg_stock_summary s where s.date=dt and s.section='small' and s.deleted_at is null)
union all select 'feed box', dt from d where not exists (select 1 from daily_feed_bag_stock s where s.date=dt and s.deleted_at is null)
union all select 'rate', dt from d where not exists (select 1 from daily_egg_rates r where r.date=dt)
order by 1,2;
\echo '== 6. big/small egg ledger chain: closing of day D vs opening of the next day with a ledger'
with l as (select date, section, opening_balance_eggs o, closing_balance_eggs c, lead(date) over w nd, lead(opening_balance_eggs) over w no from daily_egg_stock_summary where deleted_at is null window w as (partition by section order by date))
select section, date, nd, c closing, no next_opening, (no-c) diff from l where no is not null and no <> c order by section, date;
\echo '== 7. feed box chain (per group)'
with l as (select date, flock_group g, closing_balance_bags c, lead(date) over w nd, lead(opening_balance_bags) over w no from daily_feed_bag_stock where deleted_at is null window w as (partition by flock_group order by date))
select g, date, nd, c closing, no next_opening, (no-c) diff from l where no is not null and no <> c order by g, date;
\echo '== 8. feed box arithmetic: opening + produced - consumed = closing (tolerance 0)'
select date, flock_group, opening_balance_bags o, produced_bags p, consumed_bags k, closing_balance_bags c, (opening_balance_bags+produced_bags-consumed_bags - closing_balance_bags) diff from daily_feed_bag_stock where deleted_at is null and opening_balance_bags is not null and produced_bags is not null and consumed_bags is not null and closing_balance_bags is not null and opening_balance_bags+produced_bags-consumed_bags <> closing_balance_bags order by date;
\echo '== 9. bird chain per flock: pop(D) = pop(D-1) - deaths(D) + movements(D)'
with p as (select flock_internal_id f, date, bird_population pop, mortality m, lag(bird_population) over w prev, lag(date) over w pd from daily_production where deleted_at is null window w as (partition by flock_internal_id order by date)),
mv as (select flock_internal_id f, date, sum(birds_change) ch from flock_movements group by 1,2)
select fl.display_label, p.date, p.prev, p.m deaths, coalesce(mv.ch,0) moves, p.pop, (p.pop - (p.prev - p.m + coalesce(mv.ch,0))) residual
from p join flocks fl on fl.flock_internal_id=p.f left join mv on mv.f=p.f and mv.date=p.date
where p.prev is not null and p.pd = p.date-1 and abs(p.pop - (p.prev - p.m + coalesce(mv.ch,0))) > 2 order by p.date, fl.display_label;
\echo '== 10. eggs in multiples of 30 on big-egg flocks (main group)'
select fl.display_label, d.date, d.eggs_total from daily_production d join flocks fl using(flock_internal_id) where d.deleted_at is null and fl.segment='main' and d.eggs_total % 30 <> 0 order by d.date;
\echo '== 11. day sums: ledger "produced" vs the production rows of the flocks linked to that ledger (daily_egg_stock_summary_flocks)'
select s.date, s.section, s.total_eggs_produced ledger, sum(d.eggs_total) prod, s.total_eggs_produced - sum(d.eggs_total) diff
from daily_egg_stock_summary s join daily_egg_stock_summary_flocks j on j.egg_stock_summary_id=s.id
join daily_production d on d.flock_internal_id=j.flock_internal_id and d.date=s.date and d.deleted_at is null
where s.deleted_at is null group by s.id, s.date, s.section, s.total_eggs_produced having s.total_eggs_produced <> sum(d.eggs_total) order by s.date, s.section;
\echo '== 11b. ledgers with no linked flocks'
select s.date, s.section from daily_egg_stock_summary s where s.deleted_at is null and not exists (select 1 from daily_egg_stock_summary_flocks j where j.egg_stock_summary_id=s.id) order by 1,2;
\echo '== 12. sales not linked to a ledger line, and ledger sale lines without a sales row'
select count(*) sales_without_ledger_link from sales where source_ledger_entry_id is null;
select count(*) ledger_sale_lines_without_sale from daily_egg_stock_entries e join daily_egg_stock_summary s on s.id=e.egg_stock_summary_id where s.deleted_at is null and e.category in ('sale','local_sale') and not exists (select 1 from sales x where x.source_ledger_entry_id=e.id);
\echo '== 13. sales quantity differs from the ledger line it points to'
select x.id, x.date, x.eggs_quantity, e.amount_eggs, e.label_as_written from sales x join daily_egg_stock_entries e on e.id=x.source_ledger_entry_id where abs(x.eggs_quantity) <> abs(e.amount_eggs) order by x.date;
\echo '== 14. sale price vs the day rate rule (Farmfresh: rate - 0.03; local: rate + 0.01) '
select x.id, x.date, x.transaction_type, x.buyer_or_recipient, x.eggs_quantity, x.price_per_unit, r.bafta_rate, round((r.bafta_rate - 0.03)::numeric,2) farmfresh_expected, round((r.bafta_rate+0.01)::numeric,2) local_expected from sales x left join daily_egg_rates r on r.date=x.date
where r.date is null or (x.transaction_type::text='farmfresh_sale' and abs(x.price_per_unit - (r.bafta_rate-0.03)) > 0.005) or (x.transaction_type::text='other' and abs(x.price_per_unit - (r.bafta_rate+0.01)) > 0.005 and abs(x.price_per_unit - (r.bafta_rate-0.03)) > 0.005) order by x.date;
\echo '== 15. sales amount = quantity x price'
select id, date, eggs_quantity, price_per_unit, amount, round(eggs_quantity*price_per_unit,2) expected from sales where abs(amount - eggs_quantity*price_per_unit) > 1 order by date;
\echo '== 16. flocks: status vs depletion date vs latest row'
select display_label, status, depletion_date, current_bird_count, (select max(date) from daily_production d where d.flock_internal_id=f.flock_internal_id and d.deleted_at is null) last_row, (select bird_population from daily_production d where d.flock_internal_id=f.flock_internal_id and d.deleted_at is null order by date desc limit 1) last_pop from flocks f order by display_label;
select display_label, 'status depleted but no depletion date' problem from flocks where status='depleted' and depletion_date is null
union all select display_label, 'active but depletion date set' from flocks where status='active' and depletion_date is not null
union all select display_label, 'active but current count differs from last row' from flocks f where status='active' and current_bird_count is distinct from (select bird_population from daily_production d where d.flock_internal_id=f.flock_internal_id and d.deleted_at is null order by date desc limit 1)
union all select display_label, 'rows after depletion date' from flocks f where depletion_date is not null and exists (select 1 from daily_production d where d.flock_internal_id=f.flock_internal_id and d.date > f.depletion_date and d.deleted_at is null);
\echo '== 17. unreviewed flagged rows by table'
select 'production' t, count(*) from daily_production where flagged and not reviewed_by_owner and deleted_at is null
union all select 'ledger', count(*) from daily_egg_stock_summary where flagged and not reviewed_by_owner and deleted_at is null
union all select 'ledger lines', count(*) from daily_egg_stock_entries where flagged and not reviewed_by_owner
union all select 'feed box', count(*) from daily_feed_bag_stock where flagged and not reviewed_by_owner and deleted_at is null
union all select 'movements needing review', count(*) from flock_movements where needs_review and not reviewed_by_owner;
\echo '== 18. null essentials in production'
select count(*) filter (where eggs_total is null) eggs_null, count(*) filter (where bird_population is null) birds_null, count(*) filter (where mortality is null) mort_null, count(*) filter (where feed_bags is null) feed_null_all, count(*) filter (where feed_bags is null and f.segment='main') feed_null_main from daily_production d join flocks f using(flock_internal_id) where d.deleted_at is null;
\echo '== 19. segment/flock label history sanity: labels used in rows that are not in label history or flock name'
select distinct d.display_label_as_written, f.display_label from daily_production d join flocks f using(flock_internal_id) where d.deleted_at is null and d.display_label_as_written is not null and d.display_label_as_written <> f.display_label and not exists (select 1 from flock_label_history h where h.flock_internal_id=d.flock_internal_id and h.display_label=d.display_label_as_written) order by 1 limit 20;
