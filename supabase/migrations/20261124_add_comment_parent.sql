-- ============================================================================
-- 留言回覆（一層）：comments.parent_comment_id（2026-11-24）
--   每則上層留言下可以回覆；只做一層（回覆不接回覆）。
--   parent_comment_id 指向上層留言的 id；上層留言為 NULL。
--
-- 套用方式：Supabase Dashboard → SQL Editor，貼上整個檔案執行。
--   可重複執行：欄位用 IF NOT EXISTS；index 用 IF NOT EXISTS。
--   注意：部署與跑 SQL 之間有空窗——空窗期 POST 帶 parent_comment_id
--   會回 503「回覆功能尚未啟用，請稍後再試」（不是 500）；GET 在欄位
--   未建時照常回上層留言（回覆暫時不顯示，不 500）。
-- ============================================================================

alter table public.comments
  add column if not exists parent_comment_id uuid
  references public.comments (id) on delete cascade;

create index if not exists comments_parent_comment_id_idx
  on public.comments (parent_comment_id);
