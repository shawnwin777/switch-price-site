-- 已購買（user_purchases）：詳細頁「已購買」按鈕用
-- （2026-11-17：分頁 12 款＋已購買功能一起上線時新增）
-- 執行方式：Supabase Dashboard → SQL Editor 貼上執行。
-- 可重複執行：CREATE 為 IF NOT EXISTS，policies 以 DROP + CREATE 重建。
-- 注意：user_purchases 表還沒建立時，首頁／詳細頁的已購買查詢會失敗
-- 回空（視為沒有已購買），頁面不會壞；但「已購買」按鈕寫入會失敗，
-- 跑完這個 migration 後才真正可用。

-- ---------------------------------------------------------------------------
-- user_purchases：使用者已購買（user_id + game_id 唯一）
--   已購買的遊戲不顯示在首頁遊戲牆／搜尋結果裡（伺服器端排除），
--   在首頁「只看已購買」篩選（?purchased=1）裡看得到自己的清單。
--   與 collections 不同，購買紀錄不公開——select 也只限本人。
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

alter table public.user_purchases enable row level security;

-- 只有本人能讀寫（select / insert / delete 皆限本人；購買紀錄不公開）
drop policy if exists "user_purchases_select_own" on public.user_purchases;
create policy "user_purchases_select_own" on public.user_purchases
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "user_purchases_insert_own" on public.user_purchases;
create policy "user_purchases_insert_own" on public.user_purchases
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "user_purchases_delete_own" on public.user_purchases;
create policy "user_purchases_delete_own" on public.user_purchases
  for delete to authenticated using (auth.uid() = user_id);
