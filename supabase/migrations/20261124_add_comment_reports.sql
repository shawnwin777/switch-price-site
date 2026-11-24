-- ============================================================================
-- 留言檢舉表 comment_reports（2026-11-24）
--   留言區新增「檢舉」按鈕的後端表：POST /api/comments/[id]/report 寫入。
--   管理員查看檢舉列表這次不做（量小，先有檢舉入口就好）。
--
-- 表結構：
--   id          uuid 主鍵，預設 gen_random_uuid()
--   comment_id  uuid，FK 參照 comments(id) ON DELETE CASCADE
--               （留言被管理員刪除時，檢舉一併清掉）
--   reporter_id uuid，NOT NULL（檢舉者 Supabase Auth uuid）
--   reason      text，可空（檢舉理由，最多 200 字由 API 路由檢查）
--   created_at  timestamptz，預設 now()
--
-- RLS（風格同 20261123_add_social_rls.sql：寫入只限本人）：
--   - 公開 SELECT 不開：檢舉列表不對外公開。
--   - INSERT 只限本人：authenticated 且 auth.uid() = reporter_id。
--   - DELETE / UPDATE 不開 policy：檢舉不可由一般使用者改動或刪除。
--   - 管理員讀取不在 DB 層開 policy：管理員判斷在應用層用
--     lib/admin.ts 的 isAdminEmail，DB 層不要假設有管理員 role；
--     管理員要看列表時走 service role（繞過 RLS）或之後再補。
--   - 同一人同一留言重複檢舉：API 路由以「冪等成功」處理
--     （已檢舉過就回 { ok: true, already: true }，不重複寫入），
--     另外加 unique(comment_id, reporter_id) 當第二道防線。
-- service_role 不受影響（繞過 RLS）。
--
-- 套用方式：Supabase Dashboard → SQL Editor，貼上整個檔案執行。
--   可重複執行：建表用 IF NOT EXISTS；unique index 用 IF NOT EXISTS；
--   enable 本身可重跑；policy 用 DROP IF EXISTS + CREATE 重建
--   （與 20261117_user_purchases.sql、20261123_add_social_rls.sql
--   同一寫法）。
--   注意：跑之前檢舉按鈕點了會失敗（表不存在，API 回 500），
--   跑完才生效。
-- 執行後驗證（線上站 shawn-game-studio.vercel.app）：
--   1. 登入後在任一留言上點「檢舉」，確認後按鈕變成「已檢舉」
--      且 disabled。
--   2. 同一留言再點一次不會重複寫入（按鈕已 disabled；API 回
--      already: true）。
--   3. 未登入點檢舉應導向登入頁。
-- ============================================================================

create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  reporter_id uuid not null,
  reason text,
  created_at timestamptz not null default now()
);

-- 同一人同一留言只能有一筆檢舉（API 冪等處理的第二道防線；
-- 若兩個請求同時寫入，unique 擋下第二筆，API 視為 already）。
create unique index if not exists comment_reports_comment_reporter_unique
  on public.comment_reports (comment_id, reporter_id);

alter table public.comment_reports enable row level security;

drop policy if exists "comment_reports_insert_own" on public.comment_reports;
create policy "comment_reports_insert_own" on public.comment_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

-- 執行後可在 SQL Editor 跑以下查詢確認（只確認表與 policy 存在；
-- SQL Editor 會繞過 RLS，查得到的資料量不能當作驗證）：
-- select relname, relrowsecurity from pg_class
--  where relname = 'comment_reports';
-- select policyname, roles, cmd
--   from pg_policies
--  where schemaname = 'public' and tablename = 'comment_reports';
-- 應有 1 條 insert policy，且 relrowsecurity 為 true。
