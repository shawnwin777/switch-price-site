-- ============================================================================
-- games.release_date：遊戲上市日期（date，如 2025-05-01）
-- 檔案：supabase/migrations/20261118_add_release_date.sql
-- 套用方式：Supabase Dashboard → SQL Editor 貼上整個檔案執行；
--           可重複執行（ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--           / DROP VIEW IF EXISTS + CREATE VIEW）。
-- 部署順序：程式碼可先部署——欄位還沒建時：
--   - 目錄同步（/api/sync-catalog）會自動跳過上市日寫入（不報錯、不中斷），
--   - 「準備上市」頁顯示「上市日期資料補充中」，不會壞掉或空白一片，
--   - 首頁「上市日期」排序自動退回名稱排序；
--   套用此 migration 後，同步與回填腳本（scripts/backfill-release-dates.mjs）
--   才會寫入上市日，「準備上市」與「上市日期」排序才完整正確。
-- 資料來源：各區官方目錄本來就有發售日（JP 搜尋 API sdate、EU Solr
--   dates_released_dts、JP XML SalesDate、AU Algolia date_timestamp），
--   同步時順手寫進來；舊遊戲用回填腳本從 EU Solr 批次補。
-- 注意：games_with_price_stats 是 select g.*：Postgres 檢視建立時就把
--   欄位展開，games 加欄位不會自動出現在檢視裡，所以這裡重建一次檢視
--   （定義不變），讓 release_date 能在檢視上排序／篩選。
-- ============================================================================

alter table public.games
  add column if not exists release_date date;

create index if not exists games_release_date_idx
  on public.games (release_date);

-- 注意：不能用 CREATE OR REPLACE VIEW——games 表在檢視建立之後又加了
-- price_countries 欄位，g.* 展開後欄位順序對不上，Postgres 會報
-- 42P16 cannot change name of view column "cheapest_twd" to "price_countries"。
-- 所以先 DROP 再 CREATE（同一段 SQL 裡，檢視不會有空窗期被查到）。
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
             and p.discount_pct > 0) as has_sale
from public.games g;
