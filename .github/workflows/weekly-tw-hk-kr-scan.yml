-- ============================================================================
-- games.is_unnamed：未具名商品標記（2026-11-17 決定，見 DATA_NOTES.md §12.8）
-- 檔案：supabase/migrations/20261118_unnamed_games.sql
-- 套用方式：Supabase Dashboard → SQL Editor 貼上整個檔案執行；
--           可重複執行（ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--           / DROP VIEW IF EXISTS + CREATE VIEW）。
-- 部署順序：程式碼可先部署——欄位還沒建時：
--   - 首頁查詢會因 is_unnamed 欄位不存在而自動退回「不過濾」模式
--     （見 lib/data.ts isUnnamedColumnError；此時未具名遊戲根本還不存在，
--     因為匯入腳本也需要此欄位才能寫入，所以退回是安全的），
--   - 接近歷史低價同理（見 lib/data.ts fetchNearLowCandidates），
--   - 收藏未具名遊戲的擋下檢查同理跳過（見 app/api/collections/route.ts）。
--   套用此 migration 後，未具名遊戲才會被匯入、且自動排除在首頁遊戲牆／
--   搜尋結果與接近歷史低價之外。匯入腳本 scripts/seed-unnamed-games.mjs
--   必須在此 migration 之後才能跑（否則寫入 is_unnamed 會報 42703 失敗）。
--
-- 背景：台港韓價格 API 全區間掃描會掃出大量「只有編號＋價格、沒有標題」
--   的在售商品（2026-11-16 對照檔：29,237 筆中 26,890 筆未具名）。主代理
--   2026-11-17 決定：編號＋價格先行建檔進目錄（slug tw-<nsuid>／
--   hk-<nsuid>／kr-<nsuid>），之後命名來源找到標題時再合併改名。
--   但未具名前不得出現在首頁遊戲牆／搜尋結果（否則 2 萬多個「未命名商品」
--   會淹沒首頁），所以用此欄位標記、程式端過濾。
-- 注意：games_with_price_stats 是 select g.*：Postgres 檢視建立時就把
--   欄位展開，games 加欄位不會自動出現在檢視裡，所以這裡重建一次檢視
--   （定義不變），讓 is_unnamed 能在檢視上篩選。不能用 CREATE OR REPLACE
--   VIEW（見 20261118_add_release_date.sql 的 42P16 說明），所以先 DROP
--   再 CREATE。
-- ============================================================================

alter table public.games
  add column if not exists is_unnamed boolean not null default false;

-- 只有未具名列才進索引（具名遊戲是絕大多數，不需要索引它們）。
create index if not exists games_is_unnamed_idx
  on public.games (is_unnamed) where is_unnamed;

-- 注意：不能用 CREATE OR REPLACE VIEW——games 表在檢視建立之後又加了
-- 欄位（price_countries、release_date），g.* 展開後欄位順序對不上，
-- Postgres 會報 42P16 cannot change name of view column。先 DROP 再 CREATE
-- （同一段 SQL 裡，檢視不會有空窗期被查到）。
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
