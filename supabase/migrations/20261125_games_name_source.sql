-- ============================================================================
-- games.name_source：名稱來源標記（2026-11-25，TitleDB 免責小字擴到遊戲本體）。
--   'titledb' = 名稱是 TitleDB 候選名（非官方譯名），卡片／詳情頁／排行
--   顯示「名稱來源：TitleDB 候選名（非官方譯名）」；NULL = 官方或未標記。
--   2026-11-24 寫入的 789 款特價遊戲由 scripts/mark-titledb-name-source.mjs
--   標記（只標 title_zh 與 TitleDB 名一致的列，不覆蓋已改名的列）。
-- 檔案：supabase/migrations/20261125_games_name_source.sql
-- 套用方式：Supabase Dashboard → SQL Editor 貼上整個檔案執行；可重複執行。
-- 部署順序：先跑這個 migration，再推程式碼（lib/data.ts 的 GAME_COLUMNS
--   會選 name_source；view 還沒重建前選不到，首頁牆會查不到東西）。
--   標記腳本也要在欄位建好之後跑。
-- 注意：view 的欄位是建表時展開的，games 加欄位不會自動進
--   games_with_price_stats；下面 DROP + CREATE 重建一次，讓 g.* 重新
--   展開撿到 name_source。定義與 20261123_add_is_near_historical_low.sql
--   目前線上的版本完全一致，只重建、不改任何計算欄位。
--   （不能用 CREATE OR REPLACE VIEW，見 20261118_add_release_date.sql
--   的 42P16 教訓。）
-- 驗證（跑完後另開一個查詢執行，應各回 1 列）：
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='games' and column_name='name_source';
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='games_with_price_stats' and column_name='name_source';
-- ============================================================================

alter table public.games add column if not exists name_source text;

comment on column public.games.name_source is '名稱來源：titledb = TitleDB 候選名（非官方譯名），卡片／詳情頁／排行顯示免責小字；NULL = 官方或未標記';

drop view if exists public.games_with_price_stats;

create view public.games_with_price_stats
with (security_invoker = true) as
select
  g.*,
  (select min(p.price_twd)
     from public.prices p
    where p.game_id = g.id) as cheapest_twd,
  (select max(p.discount_pct)
     from public.prices p
    where p.game_id = g.id) as max_discount_pct,
  exists (select 1
            from public.prices p
           where p.game_id = g.id
             and p.discount_pct > 0) as has_sale,
  (select min(p.sale_end)
     from public.prices p
    where p.game_id = g.id
      and p.discount_pct > 0
      and p.sale_end >= now()) as min_sale_end,
  (select coalesce(array_agg(distinct p.country), '{}'::text[])
     from public.prices p
    where p.game_id = g.id) as price_country_list,
  (select p.country
     from public.prices p
    where p.game_id = g.id
      and p.price_twd is not null
    order by p.price_twd asc, p.country asc
    limit 1) as cheapest_country,
  -- 目前最低價 = 歷史低價（比值正好 = 1）。任一邊 NULL 時為 false，
  -- 這樣 .eq("is_at_historical_low", true) 只會抓到真正符合的列。
  (case
     when g.historical_low_twd is not null
       and (select min(p.price_twd)
              from public.prices p
             where p.game_id = g.id) = g.historical_low_twd
     then true
     else false
   end) as is_at_historical_low,
  -- 目前最低價接近歷史低價：比值 1 < 最低價／歷史低價 <= 1.1。
  -- 歷史低價為 0／NULL、或尚無價格時為 false。
  (case
     when g.historical_low_twd is not null
       and g.historical_low_twd > 0
       and (select min(p.price_twd)
              from public.prices p
             where p.game_id = g.id) is not null
       and (select min(p.price_twd)
              from public.prices p
             where p.game_id = g.id) > g.historical_low_twd
       and (select min(p.price_twd)
              from public.prices p
             where p.game_id = g.id)::numeric <= g.historical_low_twd * 1.1
     then true
     else false
   end) as is_near_historical_low,
  -- 比值本身（最低價 ÷ 歷史低價）：排序與「比歷史低貴 X%」顯示用。
  -- 歷史低價為 0／NULL、或尚無價格時為 NULL。
  (case
     when g.historical_low_twd is not null
       and g.historical_low_twd > 0
       and (select min(p.price_twd)
              from public.prices p
             where p.game_id = g.id) is not null
     then (select min(p.price_twd)
             from public.prices p
            where p.game_id = g.id)::numeric / g.historical_low_twd
     else null
   end) as near_low_ratio
from public.games g;
