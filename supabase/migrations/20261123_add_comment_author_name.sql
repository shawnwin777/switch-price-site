-- 留言自訂名字（2026-11-23）
--   comments 表加 author_name 欄位，讓留言者自己打名字（最多 10 個字，
--   可不填；不填時前端顯示「玩家」）。
--   長度上限由 API 路由檢查（>10 字回 400），DB 層不加 CHECK。
--   注意：此 migration 跑之前，/api/comments POST 已有容錯重試——
--   帶 author_name 的 insert 若因欄位尚不存在而失敗（PGRST204／42703），
--   會自動重試一次不帶 author_name 的 insert，留言功能不會在空窗期 500。
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS author_name text;
