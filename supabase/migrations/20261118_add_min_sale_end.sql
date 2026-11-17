-- ============================================================================
-- games_with_price_stats 加 min_sale_end：每款遊戲「最早的特價結束時間」
-- 檔案：supabase/migrations/20261118_add_min_sale_end.sql
-- 用途：首頁預設排序「特價優先：即將結束」——特價中的排前面，依結束
--   時間近 → 遠；長期特價（無結束日）接在有結束日的特價後面；
--   沒特價的排最後面，裡面再依最低價。
--   min_sale_end = 全部國家裡 discount_pct > 0 且結束日尚未過的價格中，
--   最早的那個 sale_end（timestamptz；NULL = 無特價、或只有長期特價）。
-- 套用方式：Supabase Dashboard → SQL Editor 貼上整個檔案執行；
--           可重複執行（DROP VIEW IF EXISTS + CREATE VIEW）。
-- 部署順序：程式碼可先部署——欄位還沒建時，「特價優先」排序自動退回
--   「折扣：大 → 小」，首頁不會壞掉；套用此 migration 後才完整正確。
-- 注意：不能用 CREATE OR REPLACE VIEW（見 20261118_add_release_date.sql
--   的 42P16 教訓），所以先 DROP 再 CREATE。
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
      and p.sale_end >= now()) as min_sale_end
from public.games g;
