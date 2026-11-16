-- ============================================================================
-- Switch 遊戲比價 — Migration：games.price_countries（可查價國家數）
-- 檔案：supabase/migrations/20261117_game_price_countries.sql
-- 用法：Supabase Dashboard → SQL Editor，貼上全文執行（只需一次）；
--       可重複執行（IF NOT EXISTS＋回填 UPDATE 可重跑）。
--       執行前須已跑過 supabase/schema.sql 與
--       supabase/migrations/20261116_game_region_ids.sql。
--
-- 背景（見 DATA_NOTES.md §12.5）：
--   30,000 款規模下，每款遊戲的查價成本差 35 倍——JP-only 的遊戲
--   只有 1 個 (遊戲、國家) 對、35 國全覆蓋的遊戲有 32 個對。
--   /api/refresh 改按「對數」切片（每片約 12,000 對），需要每款遊戲
--   的對數，但每輪全讀 game_region_ids（10 萬列以上）太慢，
--   所以把數字存在 games.price_countries，由目錄同步維護。
--
-- 欄位語義：
--   price_countries = 可查價的國家數 =（有 games.title_id 時 JP 算 1 國）
--     ＋ game_region_ids 裡該遊戲的 distinct 國家數（JP 列不寫入對照表，
--     所以不重複計）。例如：只有 JP 編號＝1；JP＋TW＋HK＝3；
--     NA／EU／JP／TW／HK／KR 六組齊全＝32（SG／MY／TH 無編號）。
--   NULL＝未知（migration 前的舊列不應有——回填會一次算好；
--   若仍為 NULL，程式以 35 計＝舊行為，不會低估預算）。
--
-- 維護（程式端，見 lib/catalog-sync.ts）：
--   目錄同步每次寫入對照編號後，對受影響的遊戲重算此欄位；
--   新遊戲寫入時直接帶入（JP 條目＝1＋本次掛上的區編號數）。
--   價格更新路由只讀不寫。
-- ============================================================================

alter table public.games
  add column if not exists price_countries int;

-- 一次性回填（可重跑）：JP 有 title_id 算 1 國＋對照表 distinct 國家數。
update public.games g
set price_countries =
  (case when g.title_id is not null then 1 else 0 end) +
  (select count(distinct country)
     from public.game_region_ids r
    where r.game_id = g.id)
where g.price_countries is null
   or g.price_countries <> (case when g.title_id is not null then 1 else 0 end) +
  (select count(distinct country)
     from public.game_region_ids r
    where r.game_id = g.id);

create index if not exists games_price_countries_idx
  on public.games (price_countries);
