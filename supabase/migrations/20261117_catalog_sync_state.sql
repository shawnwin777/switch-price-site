-- ============================================================================
-- Switch 遊戲比價 — Migration：目錄同步游標表 sync_state
-- 檔案：supabase/migrations/20261117_catalog_sync_state.sql
-- 用法：Supabase Dashboard → SQL Editor，貼上全文執行（只需一次）；
--       可重複執行：CREATE 皆為 IF NOT EXISTS。
--       執行前須已跑過 supabase/schema.sql（games 表必須存在）。
--
-- 背景（見 DATA_NOTES.md §12.3）：
--   完整清單太大，單次 60 秒執行裝不下全量：
--   NA Algolia 約 38 頁、EU Solr 21 頁、JP 搜尋 API 約 300 頁、
--   AU Algolia 2 頁。同步改為「游標分片」：每次只抓一個頁數窗口，
--   游標存在這張表，下次從上次停的地方繼續；跑完一輪游標歸零。
--   沒有這張表時程式仍可跑（游標預設 0、跑完不記錄），只是每次都從
--   第 0 頁重抓——新遊戲仍會被發現，但完整一輪永遠跑不完。
--
-- 寫入規則（與 games／prices 相同）：
--   不開放一般使用者的任何寫入 policy，寫入只走 Service Role Key
--   （/api/sync-catalog），繞過 RLS。公開不可讀（內部排程狀態）。
-- ============================================================================

create table if not exists public.sync_state (
  id uuid primary key default gen_random_uuid(),
  -- 來源 id（na-algolia／eu-solr／jp-search／au-algolia）
  source text not null unique,
  -- 下次從第幾頁繼續（0-based；null 表示剛跑完一輪，下次從 0 開始）
  next_page int not null default 0,
  -- 該來源總共幾頁（第一次抓到 total 後寫入；未知時為 null）
  total_pages int,
  -- 最近一次完整跑完一輪的台北日期（YYYY-MM-DD）
  last_full_pass_date text,
  -- 最近一次成功推進游標的時間
  updated_at timestamptz not null default now()
);

alter table public.sync_state enable row level security;

-- 不開放任何公開讀取與一般使用者寫入 policy：
-- 讀寫只走 Service Role Key（/api/sync-catalog 排程），繞過 RLS。
