-- ============================================================================
-- 詳情頁畫廊截圖：games.screenshots（2026-11-24）
--   詳情頁點封面開左右滑動的影片／截圖 viewer；影片走 youtube_id，
--   截圖存在這裡（IGDB t_screenshot_big，最多 6 張；NULL = 尚未回填或無截圖）。
--   來源只有 IGDB：日本官方目錄 XML 的 ScreenshotImgURL 每款只有 1 張，
--   且與 cover_url 完全相同（2026-11-24 實測 3 款全數相同），對畫廊
--   沒有新增價值；TW／HK 清單沒有截圖欄位。IGDB 也只有截圖／美術圖
--   兩種圖，沒有更多官方截圖來源。
--   回填腳本：scripts/fill-screenshots-igdb.mjs（乾跑預設，--apply 才寫入；
--   沒有 IGDB 截圖的遊戲記進 data/igdb-no-screenshots.json，下次跳過）。
--
-- 套用方式：Supabase Dashboard → SQL Editor，貼上整個檔案執行。
--   可重複執行：欄位用 IF NOT EXISTS。
--   注意：欄位未建時，詳情頁 select("*") 不會回傳它，程式視為無截圖，
--   畫廊只顯示影片頁（或不開 viewer），不 500。
-- ============================================================================

alter table public.games
  add column if not exists screenshots text[];

comment on column public.games.screenshots is
  '詳情頁畫廊用截圖（IGDB t_screenshot_big，最多 6 張；NULL = 尚未回填或無截圖）';
