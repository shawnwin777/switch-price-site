-- ============================================================================
-- Switch 遊戲比價 — Supabase 資料庫結構
-- 專案：switch-price-site（Vercel + Supabase 重建版）
-- 檔案：supabase/schema.sql
-- 用法：把整個檔案貼到 Supabase Dashboard → SQL Editor 執行；
--       或用 Supabase CLI：supabase db push（需先把本檔納入 migration）。
--       可重複執行：所有 CREATE 皆為 IF NOT EXISTS，
--       policies 以 DROP POLICY IF EXISTS + CREATE POLICY 重建。
-- 注意：欄位名稱是與前端組、登入組約定的合約，請勿改名。
--       寫入遊戲 / 價格 / 匯率請走 Service Role Key（見 scripts/seed.mjs），
--       Service Role 會繞過 RLS；一般登入使用者沒有這些表的寫入 policy。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- games：遊戲主檔
--   slug：前端路由與封面檔名共用（public/covers/<slug>.jpg）
--   has_demo：0 = 無試玩，1 = 免費 Demo，2 = 免費試玩（見 DATA_NOTES.md）
--   title_id：任天堂 title ID，種子檔沒有此欄位，一律 NULL，
--             待更新價格的人另外對照補上（見 DATA_NOTES.md）
--   is_manual：true = 使用者手動新增的遊戲（前端新增遊戲時寫 true）
--   cover_url：本站封面路徑，例如 /covers/botw.jpg；手動新增的遊戲用
--             /covers/placeholder.svg（手把圖示佔位圖）
-- ---------------------------------------------------------------------------
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title_zh text not null,
  title_en text not null,
  genre text,
  publisher text,
  platform text,
  product_type text,
  has_demo int not null default 0,
  cover_url text,
  youtube_id text,
  title_id text,
  historical_low_twd numeric,
  is_manual boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- prices：各國價格（一款遊戲 × 一國 = 一列）
--   price_twd：以當日 08:00 台北時間匯率快照換算的台幣價
--   sale_end：特價結束時間（NULL = 非特價）
--   唯一鍵 (game_id, country) 供每日更新 / seed 腳本 upsert 使用
-- ---------------------------------------------------------------------------
create table if not exists public.prices (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  country text not null,
  country_name text,
  currency text not null,
  regular_raw numeric,
  effective_raw numeric,
  discount_pct numeric,
  discount_raw numeric,
  sale_end timestamptz,
  price_twd numeric,
  is_historical_low boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (game_id, country)
);
create index if not exists prices_game_id_idx on public.prices (game_id);

-- ---------------------------------------------------------------------------
-- fx_rates：匯率快照（每日 08:00 台北時間一筆）
--   date_key：YYYY-MM-DD（台北日期），例如 2026-11-15
--   currency：USD / JPY / HKD / GBP / EUR …（TWD 為基準，rate = 1）
--   rate：1 單位該幣別 = 多少台幣
-- ---------------------------------------------------------------------------
create table if not exists public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  date_key text not null,
  currency text not null,
  rate numeric not null,
  as_of timestamptz,
  unique (date_key, currency)
);
create index if not exists fx_rates_date_key_idx on public.fx_rates (date_key);

-- ---------------------------------------------------------------------------
-- collections：使用者收藏（user_id + game_id 唯一）
-- ---------------------------------------------------------------------------
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  game_id uuid not null references public.games (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, game_id)
);
create index if not exists collections_game_id_idx on public.collections (game_id);
create index if not exists collections_user_id_idx on public.collections (user_id);

-- ---------------------------------------------------------------------------
-- user_purchases：使用者已購買（user_id + game_id 唯一）
--   詳細頁「已購買」按鈕用；已購買的遊戲不顯示在首頁遊戲牆／搜尋結果裡
--   （伺服器端排除，見 lib/data.ts getGamesPage），在首頁「只看已購買」
--   篩選（?purchased=1）裡看得到自己的清單。
--   注意：與 collections 不同，購買紀錄不公開——select 也只限本人，
--   不做公開計數顯示。
-- ---------------------------------------------------------------------------
create table if not exists public.user_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  game_id uuid not null references public.games (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, game_id)
);
create index if not exists user_purchases_game_id_idx on public.user_purchases (game_id);
create index if not exists user_purchases_user_id_idx on public.user_purchases (user_id);

-- ---------------------------------------------------------------------------
-- game_likes：遊戲讚（user_id + game_id 唯一）
-- ---------------------------------------------------------------------------
create table if not exists public.game_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  game_id uuid not null references public.games (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, game_id)
);
create index if not exists game_likes_game_id_idx on public.game_likes (game_id);

-- ---------------------------------------------------------------------------
-- comments：遊戲留言
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  game_id uuid not null references public.games (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists comments_game_id_idx on public.comments (game_id);
create index if not exists comments_user_id_idx on public.comments (user_id);

-- ---------------------------------------------------------------------------
-- comment_likes：留言讚（user_id + comment_id 唯一）
-- ---------------------------------------------------------------------------
create table if not exists public.comment_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  comment_id uuid not null references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, comment_id)
);
create index if not exists comment_likes_comment_id_idx on public.comment_likes (comment_id);

-- ---------------------------------------------------------------------------
-- user_settings：使用者設定（每人一列）
--   blocked_countries：被使用者封鎖／隱藏的國家代碼，例如 {"US","JP"}
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  blocked_countries text[] not null default '{}'
);

-- ============================================================================
-- Row Level Security
-- 規則（與任務合約一致）：
--   公開可讀：games、prices、fx_rates、comments，以及
--   collections / game_likes / comment_likes 的計數（讚數與收藏數要
--   對未登入訪客顯示，見下方 SELECT 政策；寫入仍限本人）
--   收藏 / 讚 / 留言：只有登入使用者能寫，且只能改自己的資料
--   user_purchases（已購買）：只有本人能讀寫（購買紀錄不公開）
--   user_settings：只有本人能讀寫
--   games / prices / fx_rates：不開放一般使用者的寫入 policy，
--   寫入一律走 Service Role Key（繞過 RLS），見 scripts/seed.mjs；
--   例外：管理員帳號（shawnwin777@gmail.com）可在站上新增遊戲，
--   見 games_insert_admin / prices_insert_admin。
-- ============================================================================
alter table public.games enable row level security;
alter table public.prices enable row level security;
alter table public.fx_rates enable row level security;
alter table public.collections enable row level security;
alter table public.user_purchases enable row level security;
alter table public.game_likes enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.user_settings enable row level security;

-- games：所有人可讀
drop policy if exists "games_select_public" on public.games;
create policy "games_select_public" on public.games
  for select to anon, authenticated using (true);

-- prices：所有人可讀
drop policy if exists "prices_select_public" on public.prices;
create policy "prices_select_public" on public.prices
  for select to anon, authenticated using (true);

-- 新增遊戲：只有管理員帳號能從瀏覽器端寫入（/add 頁面用）。
-- 其他登入使用者沒有 INSERT 政策，會被 RLS 擋下。
drop policy if exists "games_insert_admin" on public.games;
create policy "games_insert_admin" on public.games
  for insert to authenticated
  with check ((auth.jwt() ->> 'email') = 'shawnwin777@gmail.com');

drop policy if exists "prices_insert_admin" on public.prices;
create policy "prices_insert_admin" on public.prices
  for insert to authenticated
  with check ((auth.jwt() ->> 'email') = 'shawnwin777@gmail.com');

-- fx_rates：所有人可讀
drop policy if exists "fx_rates_select_public" on public.fx_rates;
create policy "fx_rates_select_public" on public.fx_rates
  for select to anon, authenticated using (true);

-- comments：所有人可讀；登入者可新增自己的留言；只能改／刪自己的留言
drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public" on public.comments
  for select to anon, authenticated using (true);
drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own" on public.comments
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "comments_update_own" on public.comments;
create policy "comments_update_own" on public.comments
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own" on public.comments
  for delete to authenticated using (auth.uid() = user_id);

-- collections：登入者可讀（查自己的收藏與計數）；只能新增／刪除自己的收藏
drop policy if exists "collections_select_public" on public.collections;
create policy "collections_select_public" on public.collections
  for select to anon, authenticated using (true);
drop policy if exists "collections_insert_own" on public.collections;
create policy "collections_insert_own" on public.collections
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "collections_delete_own" on public.collections;
create policy "collections_delete_own" on public.collections
  for delete to authenticated using (auth.uid() = user_id);

-- user_purchases：只有本人能讀寫（select / insert / delete 皆限本人；購買紀錄不公開）
drop policy if exists "user_purchases_select_own" on public.user_purchases;
create policy "user_purchases_select_own" on public.user_purchases
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "user_purchases_insert_own" on public.user_purchases;
create policy "user_purchases_insert_own" on public.user_purchases
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "user_purchases_delete_own" on public.user_purchases;
create policy "user_purchases_delete_own" on public.user_purchases
  for delete to authenticated using (auth.uid() = user_id);

-- game_likes：登入者可讀；只能新增／刪除自己的讚
drop policy if exists "game_likes_select_public" on public.game_likes;
create policy "game_likes_select_public" on public.game_likes
  for select to anon, authenticated using (true);
drop policy if exists "game_likes_insert_own" on public.game_likes;
create policy "game_likes_insert_own" on public.game_likes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "game_likes_delete_own" on public.game_likes;
create policy "game_likes_delete_own" on public.game_likes
  for delete to authenticated using (auth.uid() = user_id);

-- comment_likes：登入者可讀；只能新增／刪除自己的讚
drop policy if exists "comment_likes_select_public" on public.comment_likes;
create policy "comment_likes_select_public" on public.comment_likes
  for select to anon, authenticated using (true);
drop policy if exists "comment_likes_insert_own" on public.comment_likes;
create policy "comment_likes_insert_own" on public.comment_likes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "comment_likes_delete_own" on public.comment_likes;
create policy "comment_likes_delete_own" on public.comment_likes
  for delete to authenticated using (auth.uid() = user_id);

-- user_settings：只有本人能讀寫（select / insert / update / delete 皆限本人）
drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_delete_own" on public.user_settings
  for delete to authenticated using (auth.uid() = user_id);
