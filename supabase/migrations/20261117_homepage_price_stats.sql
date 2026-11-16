-- ============================================================================
-- 首頁伺服器端分頁用：價格統計檢視 + 搜尋用 trigram 索引
-- 檔案：supabase/migrations/20261117_homepage_price_stats.sql
-- 套用方式：Supabase Dashboard → SQL Editor 貼上整個檔案執行；
--           可重複執行（CREATE OR REPLACE / IF NOT EXISTS）。
-- 部署順序：程式碼可先部署——檢視尚未建立時，首頁會自動退回 games 表
--           （最低價／折扣排序暫時退為名稱排序、只看特價改為當頁過濾），
--           不會壞掉；套用此 migration 後排序與只看特價才完整正確。
-- 注意：security_invoker = true 需要 PostgreSQL 15+（Supabase 目前是 15），
--       讓檢視遵守呼叫者的 RLS；games / prices 本來就是公開可讀，
--       不加這行也不會多洩漏資料。
-- ============================================================================

create extension if not exists pg_trgm;

-- games_with_price_stats：games 全欄位 + 每款遊戲的價格統計。
--   cheapest_twd：全部國家價格換算台幣後的最低價（NULL = 尚無價格）
--   max_discount_pct：全部國家最大的折扣 %（NULL = 尚無價格）
--   has_sale：任一國家正在特價
create or replace view public.games_with_price_stats
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

-- ilike '%關鍵字%' 前後都有萬用字元時，trigram 索引才能加速搜尋；
-- 沒有索引也能查（10,051 列全表掃描也很快），索引只是讓搜尋更快。
create index if not exists games_title_zh_trgm_idx
  on public.games using gin (title_zh gin_trgm_ops);
create index if not exists games_title_en_trgm_idx
  on public.games using gin (title_en gin_trgm_ops);
