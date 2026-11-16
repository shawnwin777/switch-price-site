-- 新增遊戲：只有管理員帳號（shawnwin777@gmail.com）能從瀏覽器端寫入
-- （/add 頁面用）。其他登入使用者沒有 INSERT 政策，會被 RLS 擋下。
-- Service Role（種子、每日更新）繞過 RLS，不受影響。
-- 執行方式：Supabase Dashboard → SQL Editor 貼上執行。
drop policy if exists "games_insert_admin" on public.games;
create policy "games_insert_admin" on public.games
  for insert to authenticated
  with check ((auth.jwt() ->> 'email') = 'shawnwin777@gmail.com');

drop policy if exists "prices_insert_admin" on public.prices;
create policy "prices_insert_admin" on public.prices
  for insert to authenticated
  with check ((auth.jwt() ->> 'email') = 'shawnwin777@gmail.com');
