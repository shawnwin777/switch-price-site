# 台灣 Nintendo eShop：正式站自動補齊說明

> 本文件記錄 2026-11-23 首次安全上線流程。此處「遊戲數」與「SKU 商品列數」不同；官方目錄不等於整個 eShop。

## 已上線的頁面及來源

- **`/taiwan`**：台灣任天堂官方 `/tw/api/software?sftab=all&spage=N` 全部商品目錄，約 4,668 列／4,251 個不同 NSUID（2026-11-23 驗證數），逐商品提供官方中文名稱、封面與近期在地價格；目錄快取 6 小時、目前查閱頁面價格快取 10 分鐘。無 Supabase 寫入。
- **`/taiwan/addons`**：台灣已知歷史編號中仍在售的 `7005` DLC 候選和 `7007` Bundle 等候選商品。每日 GitHub Actions `.github/workflows/tw-addons-public-daily.yml` 先重新確認全批官方 TW 價格，然後用 `blawar/titledb` HK 中文版的**相同 NSUID** 取得補充名稱與 Nintendo CDN 圖像，產出 `public/data/tw-addons.json`，完成後自動提交到 GitHub／部署到 Vercel。這份第三方 metadata 只是候選，不是台灣官方的遊戲名稱證明、也**不是 DLC 母遊戲連結證明**。
- 「即將上市」及「接近歷史低價」原有功能不由這兩條新增目錄流程改動。

## 正式 Supabase 已有遊戲的名稱與圖片自動補全

`.github/workflows/tw-official-guarded-backfill.yml`：
1. 以台灣官方完整目錄和最新 TW 價格 API 取得完整驗證資料；來源不完整／逾期時不得寫庫。
2. 用現有 Supabase `games` + `game_region_ids` **唯讀** 建立精確 TW NSUID 候選名單，而非僅用舊的 2026-11-16 快照。
3. 只處理 TW 當前在售、`7001`、單一遊戲對應、`product_type=game` 的商品：系統自動佔位名稱才可由官方同 NSUID 名稱替換，缺圖但已有名稱時只補官方圖片。不覆蓋非佔位名稱、既有自訂封面、NSUID 衝突，亦不改跨區對照。
4. 審核腳本 `scripts/verify-tw-backfill-preview.mjs` 校驗來源、時間、唯一性、保護欄位、數量和上次快照；且依 SHA256 完全一致的候選執行。
5. 單次上限 **3000 筆**，未完成的候選於下一次排程依最新正式資料重新產生；每筆寫入使用舊值條件保護（若其他管理者修改該筆則會拒絕，不強制覆寫）。回寫前備份 `beforeSnapshots` 至 Actions artifact 30 天。出錯應核對已寫入筆數／rollback snapshots，**不可盲目重跑手動補丁**。
6. 目前 `games.title_en` 在 schema 中是 NOT NULL，未具名商品補完後填入與官方中文名稱相同的非空值；遊戲卡片會隱藏相同中英文的重複顯示。

日常自動排程設計：補名／圖片 12:20 台灣時間；DLC 清單重新整理 13:00 台灣時間。GitHub 排程可能延後。每次是否真的成功，請以該次 Actions 結果及 Vercel 部署狀態為準。部署成功 ≠ 一定全部圖片可正常載入。

## 仍未完成，不可亂宣稱

- 官方未收錄的約 380 個當時已在售 `7001` NSUID 尚需可靠名稱與圖片來源，不能因為沒有元資料就忽略其價格。
- 已發現的 DLC／Bundle 當前查價流程不會自行發現**新增加的 7005／7007 NSUID**；要靠另一條完整編號區間掃描擴充 discovery，並避免高頻 API 請求。
- DLC 的商品版本、母遊戲以及 Switch 2 升級包配對仍需官方商品頁或其他相符代碼確認，不能單憑 `7007` 前綴分類。
- 研究 PR #1 仍是草稿，包含實驗／舊同步修改，**不要直接整包合併**。安全可上線功能已拆分 PR #2、#3、#4 分段驗證和合併。
- Supabase 既有跨區查價與史低計算不能因為額外的台灣 metadata 回填而被覆蓋或重置。

## 原始碼
- `scripts/guarded-tw-backfill.mjs`
- `scripts/lib/tw-official-db-patch.mjs`
- `scripts/verify-tw-backfill-preview.mjs`
- `.github/workflows/tw-official-guarded-backfill.yml`
- `scripts/scan-tw-known-addons.mjs`
- `scripts/enrich-tw-addons-titledb.mjs`
- `scripts/build-public-tw-addons.mjs`
- `.github/workflows/tw-addons-public-daily.yml`
