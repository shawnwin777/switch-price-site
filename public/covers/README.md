# public/covers/

本站封面圖目錄。2026-11-23 起，遊戲封面一律用官方 CDN 或 IGDB 的遠端網址
（寫在資料庫 `games.cover_url`），**不要再把圖片下載進這個目錄**。

- 唯一應留在這裡的檔案是 `placeholder.svg`（手把圖示佔位圖，尚無封面的
  遊戲用它；`lib/data.ts` 的 `PLACEHOLDER_COVER` 指向它）。
- 2026-11-23 之前這裡有 32 張種子遊戲的 `*.jpg`，經稽核確認是從任天堂
  官方來源下載、縮圖再重新編碼後重託管的官方 key art（見 `DATA_NOTES.md`
  §6 與 `scripts/lib/seed-cover-urls.mjs` 的驗證記錄），已改接官方 CDN
  網址（`scripts/fix-seed-covers.mjs --apply`），32 張舊圖待從 GitHub
  網頁刪除。自架官方圖比單純連官方 CDN 嚴重，不要再放回來。
