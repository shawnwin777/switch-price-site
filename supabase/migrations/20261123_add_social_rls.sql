-- ============================================================================
-- 社群四表 RLS（2026-11-23 全站稽核「中-7」）
--   collections / game_likes / comments / comment_likes
--   四張表在 repo 內既無 enable row level security 也無任何 policy。
--   RLS 未開時，任何人拿網站公開內嵌的 anon key 就能繞過 API，
--   直接以任意 user_id 寫入／刪除他人的讚、收藏與留言。
--   此 migration 只補 RLS 與 policy，不改任何程式碼、不改表結構。
--
-- 為什麼 SELECT 是公開的（而不是只限本人）：
--   站上公開數字全部走 anon key 讀取，開 RLS 後若沒有公開 SELECT
--   policy，這些地方會直接歸零／空白：
--   - collections：排行頁 /ranking（lib/data.ts getRanking，public client
--     全表掃 game_id 計數）、牆／詳情頁收藏數（fetchExtrasForIds、
--     fetchGamePublicCore，public client）。
--   - game_likes：同上，牆／詳情頁讚數與排行批次讚數（public client）。
--   - comments：詳情頁留言（app/games/[slug]/page.tsx getComments，
--     server client；未登入訪客是 anon 身份，必須能讀）。
--   - comment_likes：同一支 getComments 裡的留言讚數計數（anon 讀）。
--   因此四表各開一條「anon + authenticated 都可 SELECT（using true）」
--   的公開讀取 policy；公開 SELECT 已涵蓋「本人讀自己列」的查詢
--   （overlayMyGameFlags、getUserCollectionGameIds、GameDetailClient
--   瀏覽器端查自己收藏），不需另開 own-select policy（policy 是 OR
--   關係，多開一條等價的 own-select 沒有額外效果）。
--   代價：公開 SELECT 會讓 user_id ↔ game_id / comment_id 的對應關係
--   可被 anon key 列舉（本來 RLS 未開時也是全表可讀，狀態沒有變差；
--   計數要能被 anon 算出來，這是目前架構下必要的取捨）。
--   之後若要收緊，可改走「只回計數的 view / RPC」再撤掉公開 SELECT，
--   那是另一項工作，不在本次範圍。
-- 寫入一律只限本人：
--   INSERT / DELETE 只開給 authenticated，且限定 auth.uid() = user_id。
--   API 路由本身也先 getCurrentUser、寫入用 session 的 user.id，
--   RLS 是第二道防線（直接打 PostgREST 也寫不了別人的列）。
--   四表沒有任何 UPDATE 路徑（只有 insert / delete），所以不開
--   UPDATE policy——預設就是擋下。
-- service_role 不受影響：
--   排程／同步（/api/refresh、/api/sync-catalog）用的 service_role key
--   繞過 RLS；且 grep 確認這兩支路由與 scripts 完全沒碰這四張表，
--   所以開 RLS 不會影響任何 cron 或匯入。
--
-- user_purchases 不在這支檔案裡：
--   稽核懷疑 20261117_user_purchases.sql 缺 enable，實查已有
--   （alter table … enable row level security＋三條 own policy 都在），
--   且 user_purchases 沒有任何公開讀取（只限本人），所以不用補。
--   舊檔不動。
--
-- 欄位型別注意事項：
--   這四張表不是由 repo 內 migration 建立的（repo 內只有
--   game_region_ids、sync_state、user_purchases 有 CREATE TABLE），
--   user_id 欄位型別無法從 repo 驗證。程式碼全部以
--   .eq("user_id", user.id)／insert { user_id: user.id } 使用，
--   user.id 是 Supabase Auth 的 uuid；同模式的 user_purchases 也定義
--   為 user_id uuid——因此假定四表 user_id 皆為 uuid。
--   若執行時 CREATE POLICY 報「operator does not exist: uuid = …」
--   之類的型別錯誤，表示該表 user_id 不是 uuid：先停手、不要只跑
--   一半，用 SQL Editor 查 information_schema.columns 確認型別再處理。
--   （policy 建立時就會做型別檢查，建得起來＝型別對得上。）
-- 留言 user_id 曝光（稽核低-11）：
--   公開 SELECT 會讓留言者的 user_id UUID 隨詳情頁送給所有訪客；
--   這是低風險項、不在本次範圍，不順手改（要改需另開 view 遮欄位）。
--
-- 套用方式：Supabase Dashboard → SQL Editor，貼上整個檔案執行。
--   可重複執行：enable 本身可重跑；policy 用 DROP IF EXISTS + CREATE
--   重建（與 20261117_user_purchases.sql 同一寫法）。
--   注意：SQL Editor 是以 postgres 身份執行，會繞過 RLS——在 Editor
--   裡 SELECT 看得到不代表 RLS 沒生效，驗證一律用線上網站（見下方）。
-- 執行後驗證（線上站 shawn-game-studio.vercel.app）：
--   1. 未登入開任一遊戲詳情頁：留言列表正常顯示、留言讚數正常。
--   2. 未登入開 /ranking：排行正常（不是空的）、收藏數正常。
--   3. 首頁牆／詳情頁讚數、收藏數正常（不是全 0）。
--   4. 登入後按讚／取消讚、收藏／取消收藏、留言、留言按讚都成功，
--      數字即時變化。
--   5. 若第 1–3 項空白或全 0，表示公開 SELECT policy 沒生效——
--      先檢查 SQL Editor 執行結果有無錯誤，再回報。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- collections：使用者收藏（user_id + game_id）
--   公開讀：排行彙總、牆／詳情頁收藏數（anon public client）。
--   寫入：只限本人（POST /api/collections，server client + session）。
-- ---------------------------------------------------------------------------
alter table public.collections enable row level security;

drop policy if exists "collections_select_public" on public.collections;
create policy "collections_select_public" on public.collections
  for select to anon, authenticated using (true);
drop policy if exists "collections_insert_own" on public.collections;
create policy "collections_insert_own" on public.collections
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "collections_delete_own" on public.collections;
create policy "collections_delete_own" on public.collections
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- game_likes：遊戲讚（user_id + game_id）
--   公開讀：牆／詳情頁讚數、排行批次讚數（anon public client）。
--   寫入：只限本人（POST /api/likes，server client + session）。
-- ---------------------------------------------------------------------------
alter table public.game_likes enable row level security;

drop policy if exists "game_likes_select_public" on public.game_likes;
create policy "game_likes_select_public" on public.game_likes
  for select to anon, authenticated using (true);
drop policy if exists "game_likes_insert_own" on public.game_likes;
create policy "game_likes_insert_own" on public.game_likes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "game_likes_delete_own" on public.game_likes;
create policy "game_likes_delete_own" on public.game_likes
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- comments：遊戲留言（user_id + game_id + body）
--   公開讀：詳情頁留言列表（server client；未登入訪客是 anon 身份）。
--   寫入：只限本人新增（POST /api/comments）；刪除也只限本人
--   （目前沒有刪除留言的 API，先開著、供未來管理功能用）。
-- ---------------------------------------------------------------------------
alter table public.comments enable row level security;

drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public" on public.comments
  for select to anon, authenticated using (true);
drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own" on public.comments
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own" on public.comments
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- comment_likes：留言讚（user_id + comment_id）
--   公開讀：詳情頁留言讚數計數（getComments 內 anon 讀 comment_id）。
--   寫入：只限本人（POST /api/comments/[id]/like）。
-- ---------------------------------------------------------------------------
alter table public.comment_likes enable row level security;

drop policy if exists "comment_likes_select_public" on public.comment_likes;
create policy "comment_likes_select_public" on public.comment_likes
  for select to anon, authenticated using (true);
drop policy if exists "comment_likes_insert_own" on public.comment_likes;
create policy "comment_likes_insert_own" on public.comment_likes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "comment_likes_delete_own" on public.comment_likes;
create policy "comment_likes_delete_own" on public.comment_likes
  for delete to authenticated using (auth.uid() = user_id);

-- 執行後可在 SQL Editor 跑以下查詢確認（只確認 policy 存在；
-- SQL Editor 會繞過 RLS，查得到的資料量不能當作驗證）：
-- select tablename, policyname, roles, cmd
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('collections', 'game_likes', 'comments', 'comment_likes')
--  order by tablename, cmd;
-- 應有 12 條（每表 select / insert / delete 各 1 條），
-- 且四表 pg_class.relrowsecurity 皆為 true：
-- select relname, relrowsecurity from pg_class
--  where relname in ('collections', 'game_likes', 'comments', 'comment_likes');
