-- ============================================================================
-- games_with_price_stats 加 price_country_list：每款遊戲「有價格的國家」
-- 檔案：supabase/migrations/20261119_add_price_country_list.sql
-- 用途：首頁「國家」篩選——選了某個國家，只顯示在該國有價格的遊戲
--   （例如只看日本有賣的、只看台灣有賣的）。price_country_list =
--   prices 表裡該遊戲的 distinct country 陣列（text[]；沒有任何價格
--   時為空陣列 '[]'，不是 NULL）。
-- 套用方式：Supabase Dashboard → SQL Editor 貼上整個檔案執行；
--           可重複執行（DROP VIEW IF EXISTS + CREATE VIEW）。
-- 部署順序：程式碼可先部署——欄位還沒建時，國家篩選自動關閉（顯示
--   全部遊戲），首頁不會壞掉；套用此 migration 後篩選才生效。
-- 注意：不能用 CREATE OR REPLACE VIEW（見 20261118_add_release_date.sql
--   的 42P16 教訓），所以先 DROP 再 CREATE。檢視定義需與目前線上
--   的版本一致（g.*、cheapest_twd、max_discount_pct、has_sale、
--   min_sale_end），只多加 price_country_list。
-- 已知限制：特價統計（has_sale、min_sale_end）仍是全部國家的，不隨
--   國家篩選改變——選日本時，一款在美國特價、日本沒特價的遊戲仍可能
--   排在特價區前面；卡片上的最低價／特價徽章／特價至則只看選中的國家。
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
    where p.game_id = g.id) as price_country_list
from public.games g;
