# 台灣 eShop 自動補齊與快速查價 — 實作狀態（2026-11-23 台北時間）

本文件記錄 **PR #1 草稿分支**已加入的程式與待審項目。**目前沒有合併、部署或對正式 Supabase 做任何新寫入。** 本次新增的程式僅會寫入工作目錄 JSON 報告或 GitHub Actions artifacts。

## 加速架構

1. **官方台灣目錄快取**：`scripts/fetch-tw-official-index.mjs` 從 `https://www.nintendo.com/tw/api/software?sftab=all&spage=N` 建立 14 位台灣 NSUID → 名稱、發行商、軟體代碼、Switch/Switch 2 類型、官方圖片網址索引。每次最多 4 個同時讀取；確認頁數、總列數、NSUID 和重複衝突；失敗不輸出「完整」快照。可重用未過期快取，減少反覆讀取約 195 頁的負擔。
2. **差異比對、不寫庫**：`scripts/plan-tw-official-backfill.mjs` 用既有台灣有價歷史快照和有效官方索引，只生成「台灣 7001、在售、尚未具名、NSUID 完全一致」的名稱／圖片審核名單；不修改既有名稱，不合併不同國家 NSUID，也不把 7005/7007 寫入一般遊戲。
3. **已知 NSUID 快速查價**：`scripts/scan-tw-official-prices.mjs` 直接對官方索引的不同 NSUID 以每批 50 個查詢台灣價格；取代對**已知商品**每次暴力重掃全部空間。2026-11-22 官方索引約 4,250 不重複 NSUID，約需 85 批；舊 7001 主掃描需要約 2,600 批。遇 403 立即停止，不嘗試繞過；其他失敗有限重試；若 API 缺少批內商品則標記不完整。**這只覆蓋官方目錄，不取代完整區間掃描、DLC/升級包枚舉與停售追蹤。**
4. **安全測試與快取**：PR 的 `.github/workflows/validate-region-dlc-audit.yml` 新增離線純函式測試與官方索引快取、差異報告、50 ID 價格唯讀樣本。多次快速提交會取消舊的驗證工作，HK / TitleDB 大型掃描改保留手動觸發避免重複請求。
5. **後續自動化**：新增 `.github/workflows/tw-official-readonly-daily.yml`，設計為每天 11:30 台北時間自動唯讀產生完整官方商品索引、目錄內現價與補名補圖報告，沒有任何 Supabase 密鑰與 DB write。**GitHub 排程只在此工作流程合併到預設分支後才會啟用，目前尚未啟用**。
6. **每週掃描的前置審核**：`.github/workflows/weekly-tw-hk-kr-scan.yml` 的 PR 草稿加了快取官方目錄與產生回填審核 artifact 的步驟；不將待審名稱/圖片自動送往正式 seed。原本有生產庫寫入的舊步驟未被新增工具呼叫，也不會因為本次 PR 分支提交而執行。

## GitHub Actions 已驗證的數字

- [Run #45043970206](https://github.com/shawnwin777/switch-price-site/actions/runs/45043970206)：7 項離線測試成功；2026-11-16 TW 9,643 個歷史在售 SKU 分成 **7001 已具名 1,597、7001 可待審補名＋補圖 2,382、7001 尚未對到官方 380、7005/7007 獨立分類 5,284**。這四項相加為 9,643。**2,382 不是新增的 2,382 款獨立遊戲，不是已寫正式 DB**。
- [Run #45044177637](https://github.com/shawnwin777/switch-price-site/actions/runs/45044177637)：成功用官方已知 NSUID 向台灣價格 API 查詢 **50/50** 個樣本，回傳 46 onsale、3 not_found、1 sales_termination，無 API 錯誤。**只代表 50 個樣本，不代表全站已更新。**

## 下一階段：正式資料庫／前端（尚未動工或啟用）

- 由使用者核准後，先設計 `games.is_unnamed` → 正式名稱、`cover_url` 的**完全相同台灣 NSUID** 保護式更新，只能回填原空白或官方占位圖，不覆蓋既有資料，並提供 preview、日誌、回滾機制。
- 補齊名稱後要確認首頁是否通過 `is_unnamed=false` 過濾、`cover_url` 是否為正確且可打開的圖片；各種尺寸依比例呈現，不強行裁切盒繪。
- 商品分類需先修正 `7005/7007` 的跨檔案矛盾，加入 DLC 母遊戲關聯和版本檢查。價格史低不可從舊快照當成當日現價。
- 直到上述驗證及核准完成，保持 PR #1 草稿，**不合併、不部署、不寫入生產 Supabase**。

## 本機或 PR 指令（唯讀）

```bash
node scripts/fetch-tw-official-index.mjs data/.cache/tw-official-index.json --fresh-hours=20
node scripts/plan-tw-official-backfill.mjs data/tw-hk-full-ids.json data/.cache/tw-official-index.json reports/tw-official-backfill-plan.json
node scripts/scan-tw-official-prices.mjs data/.cache/tw-official-index.json reports/tw-official-prices-sample.json --limit=50
node --test tests/tw-official-backfill.test.mjs
```

這些指令只讀取公開 API 與本機 JSON，不使用生產資料庫密鑰。
