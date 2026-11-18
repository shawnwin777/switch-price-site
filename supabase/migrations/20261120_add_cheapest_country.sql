-- ============================================================================
-- games_with_price_stats 加 cheapest_country：每款遊戲「目前最低價的國家」
-- 檔案：supabase/migrations/20261120_add_cheapest_country.sql
-- 用途：接近歷史低價頁「國家」篩選——選了某個國家，只顯示目前最低價
--   在該國的遊戲（例如只看台灣最便宜的接近歷史低價遊戲）。
--   cheapest_country = prices 表裡該遊戲最低 price_twd 那筆的 country；
--   同價時取國家代碼較小者（確定性排序）。沒有任何價格時為 NULL。
-- 套用方式：Supabase Dashboard → SQL Editor 貼上整個檔案執行；
--           可重複執行（DROP VIEW IF EXISTS + CREATE VIEW）。
-- 部署順序：程式碼可先部署——欄位還沒建時，國家篩選自動關閉（顯示
--   全部遊戲），頁面不會壞掉；套用此 migration 後篩選才生效。
-- 注意：不能用 CREATE OR REPLACE VIEW（見 20261118_add_release_date.sql
--   的 42P16 教訓），所以先 DROP 再 CREATE。檢視定義需與目前線上
--   的版本一致（g.*、cheapest_twd、max_discount_pct、has_sale、
--   min_sale_end、price_country_list），只多加 cheapest_country。
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
    limit 1) as cheapest_country
from public.games g;
