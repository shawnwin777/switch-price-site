-- ============================================================================
-- 留言封鎖名單 comment_blocks（2026-11-25）：
--   管理員在 /admin/reports 對檢舉的留言者按「封鎖此人」後寫入。
--   user_id 是 Supabase Auth 的 UUID（Google／Discord 登入的帳號識別碼），
--   不是 email、不是自填名字——名字可改、email 我們不收，只有 UUID 穩定，
--   封鎖就靠它（BAN 的就是這個亂碼）。
--   封鎖效果：POST /api/comments 直接回 403（不能再留言，也不能再檢舉）；
--   該使用者舊留言在詳情頁不再顯示（getComments 過濾）。
--   封鎖不刪留言：解封後舊留言恢復顯示，避免誤封無法挽回。
--   只有 service-role client 讀寫（RLS 開啟、無任何 policy）；
--   管理員操作走 POST／DELETE /api/admin/blocks（isAdminEmail 檢查）。
-- 檔案：supabase/migrations/20261125_comment_blocks.sql
-- 套用方式：Supabase Dashboard → SQL Editor 貼上執行；可重複執行。
-- 驗證：select count(*) from public.comment_blocks; 應回 0（空表）。
-- ============================================================================

create table if not exists public.comment_blocks (
  user_id uuid primary key,
  reason text,
  blocked_by text,
  created_at timestamptz not null default now()
);

alter table public.comment_blocks enable row level security;

comment on table public.comment_blocks is '留言封鎖名單：user_id 為 Supabase Auth UUID；封鎖後不能留言／檢舉，舊留言隱藏；解封恢復。僅 service-role 可讀寫。';
