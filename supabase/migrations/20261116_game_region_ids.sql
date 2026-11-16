-- ============================================================================
-- Switch 遊戲比價 — Migration：各區編號對照表 game_region_ids
-- 檔案：supabase/migrations/20261116_game_region_ids.sql
-- 用法：Supabase Dashboard → SQL Editor，貼上全文執行；
--       或用 Supabase CLI：supabase db push（需先把本檔納入 migration）。
--       可重複執行：CREATE 皆為 IF NOT EXISTS，
--       policies 以 DROP POLICY IF EXISTS + CREATE POLICY 重建。
--       執行前須已跑過 supabase/schema.sql（games 表必須存在）。
--
-- 背景（見 DATA_NOTES.md §10／§11）：
--   title ID（NSUID）是分區的：日本編號只查得到 JP 價，查 US／TW／HK／GB
--   一律 not_found。games 表只有 title_id 一欄（日本／預設編號），放不下
--   35 國各自的編號，所以另建一張對照表：一款遊戲 × 一國 = 一列。
--   games.title_id 保持不動，仍是日本／預設編號，作為 fallback：
--   某國在對照表裡沒有編號時，每日更新就用 games.title_id 去查價
--   （即現況行為——JP 會中，其他國家通常 not_found、保留舊價）。
--   對照表本身不存價格，只存編號；價格仍在 prices 表。
--
-- 寫入規則（與 schema.sql 一致）：
--   公開可讀；一般登入使用者沒有寫入 policy，寫入一律走
--   Service Role Key（scripts/seed-region-ids.mjs），繞過 RLS。
--   匯入腳本預設「已有值保留」：已存在的列不覆蓋（見腳本 --force 說明）。
-- ============================================================================

create table if not exists public.game_region_ids (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  country text not null,
  title_id text not null,
  -- 來源標記（對照檔的 sources 條目或調查方法，例如 tw-list、
  -- hk-weekly-article、price-api-scan；僅供追溯，可為空）。
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, country)
);
create index if not exists game_region_ids_game_id_idx
  on public.game_region_ids (game_id);
create index if not exists game_region_ids_country_title_id_idx
  on public.game_region_ids (country, title_id);

alter table public.game_region_ids enable row level security;

-- 公開可讀（與 games／prices 相同：未登入訪客也要能看到各區編號來源，
-- 前端日後若要顯示「此價用哪個編號查到」才有資料可用）。
drop policy if exists "game_region_ids_select_public" on public.game_region_ids;
create policy "game_region_ids_select_public" on public.game_region_ids
  for select to anon, authenticated using (true);

-- 不開放一般使用者的任何寫入 policy（insert／update／delete 皆無）：
-- 寫入只走 Service Role Key（繞過 RLS），見 scripts/seed-region-ids.mjs。
