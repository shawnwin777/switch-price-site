-- ============================================================================
-- games_with_price_stats 加 is_at_historical_low：每款遊戲「目前最低價
-- 是不是等於歷史低價」（比值正好 = 1）。
-- 檔案：supabase/migrations/20261123_add_is_at_historical_low.sql
-- 用途：歷史低價頁（/historical-low）——那頁只收比值 = 1 的遊戲，
--   /near-low 只收 1 < 比值 <= 1.1，兩頁互補。PostgREST 不能直接比較
--   兩個欄位（cheapest_twd = historical_low_twd 寫不進查詢），所以把
--   比較結果先算成 view 欄位，頁面用 .eq("is_at_historical_low", true)
--   做 DB 層單一查詢＋分頁，不再全掃 12,175 列。
--   2026-11-23 實測：cheapest = historical_low 的具名遊戲 8,329 款。
--   注意：還沒特價過的遊戲也在內（原價就是歷史最低價），頁面排序用
--   折扣大優先把它們排在後面。
-- 套用方式：Supabase Dashboard → SQL Editor 貼上整個檔案執行；
--           可重複執行（DROP VIEW IF EXISTS + CREATE VIEW）。
-- 部署順序：程式碼可先部署——欄位還沒建時，歷史低價頁自動改走
--   prices.is_historical_low 旗標備援（總數約多 11%，見 lib/data.ts），
--   頁面不會壞掉；套用此 migration 後切回精確的單一查詢。
-- 注意：不能用 CREATE OR REPLACE VIEW（見 20261118_add_release_date.sql
--   的 42P16 教訓），所以先 DROP 再 CREATE。檢視定義需與目前線上
--   的版本一致（g.*、cheapest_twd、max_discount_pct、has_sale、
--   min_sale_end、price_country_list、cheapest_country），只多加
--   is_at_historical_low。
-- ============================================================================

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
   end) as is_at_historical_low
from public.games g;
