# 台灣 eShop 商品與封面完整度 — 資料源稽核與修正路線

> 2026-11-23 台灣時間；**只讀研究文件，不是主站已部署的修正**。所有計數均來自 PR #1 GitHub Actions 與儲存庫 2026-11-16 歷史資料快照，**不代表今日即時在售商品數**。

## 最重要的結論

1. 官方台灣完整目錄需要 `https://www.nintendo.com/tw/api/software?sftab=all&spage=N`；沒有 `sftab=all` 的預設清單只回報 102 筆，這是過去嚴重低估名稱覆蓋率的關鍵。
2. 完整目錄 195 頁、4,668 列；4,664 列為 `7001`，4 列為 `7007`；硬體類別為 Switch 4,156、Switch 2 408、Switch 2 Edition 104。這是*目錄列*，不是獨立遊戲/在售數量。
3. 2026-11-16 歷史價格快照：TW 在售 SKU 9,643，依前綴為 `7001` 4,359、`7005` 4,170、`7007` 1,114；**7005／7007 包括非遊戲本體的商品，不能把 9,643 算成獨立遊戲數**。
4. 官方台灣目錄與歷史台灣有價商品精確 NSUID 對應 3,982，當中 2,384 原未具名；2 筆來源名稱衝突。尚未審核、未寫入生產 Supabase。
5. 官方目錄 4,668 列中 **4,667 列帶官方 `imageHero.url`**，映射到 **4,250 個不同 NSUID**；與台灣歷史有價 SKU 精確對應且帶圖片 URL 的候選 3,980，當中原未具名的 2,383。實測 8 張官方圖片全部 HTTP 200 且 `Content-Type: image/webp`。**這是有圖片 URL 的覆蓋，非全量逐張下載驗證，也不是已回填網站的圖片數**。
6. 圖片使用 `https://images.ctfassets.net/...`（任天堂官方商品 API `imageHero.url` 欄位，Contentful CDN）。之前因為白名單漏了這個網域造成統計 0，已在 PR 修正。
7. 香港官方清單 `/hk/api/software?sftab=all` 可以對**台灣價格已確認的相同 NSUID** 提供額外名稱／封面候選；香港資料不等於台灣上架，需人工複核。最新唯讀報告請見 GitHub Actions artifact `hk-supplement-for-tw.json`。

## 與使用者覺得「台灣應有更多遊戲」的差距在哪裡

- 「網站顯示的遊戲數」≠「已成功抓到台灣價格的 NSUID」≠「台灣官方目錄全部列數」。
- `lib/data.ts` 的 `buildFilteredGamesQuery()` 會用 `is_unnamed=false` 隱藏無名稱商品；這是合理的防錯顯示，但當官方名稱沒有同步到那些佔位商品，就形成可見數缺口。
- `scripts/merge-scan-into-full-ids.mjs` 的 `fetchSoftwareList` 仍走網站預設頁和正則擷取，沒有使用完整 `sftab=all` API；每週合併可能重複產生大量無名稱。
- `lib/catalog-sources.ts` 中 `fetchTwHkList` 是最高 12 頁且使用預設網頁清單的舊邏輯，需改成獨立可恢復的完整 `sftab=all` API 分頁來源。避免把 195 頁塞入 Vercel 60 秒 cron。
- `.github/workflows/weekly-tw-hk-kr-scan.yml` 定期主流程主要處理 `7001`，沒有完整新版 `7005`／`7007` 重掃；**不能把舊的 DLC/升級包價格視為當前最新價**。
- `scripts/seed-unnamed-games.mjs` 把 `7005`／`7007` 當疑似非遊戲，跳過導入本體列表，防止錯誤展示。需要另外建 addon／upgrade 類別及母遊戲關聯。
- **程式內有定義矛盾**：`lib/catalog-sources.ts` 中的 `kindFromNsuid` 把 `7005` 判斷為 upgrade、`7007` 為 DLC；`scripts/seed-unnamed-games.mjs` 的註解則是 `7005` DLC、`7007` Switch2 升級包。前綴不能當作最終類型；需使用官方 `productType`／`hardwareCategory`、名稱與母遊戲關聯證據，先修正資料字典與單元測試再正式分類。

## 圖片來源優先序與驗證方式

1. **台灣官方 API，同 NSUID `imageHero.url`**（最優先）：`images.ctfassets.net`，留存原 URL、NSUID、來源時間、實際 HTTP MIME；確認是否允許前端引用及快取。禁止組合猜測檔案網址。
2. **香港官方 API，同 NSUID**：只作台灣已確認價格的名稱與圖片次級候選；若同 NSUID 不同標題／版本、官方中台灣不存在，人工覆核。
3. **TitleDB `HK.zh.json`**（https://github.com/blawar/titledb）：NSUID 對應 `iconUrl`、`bannerUrl`、截圖等；資料檔大約 50MB，不能直接當成台灣在售清單。腳本應做定期唯讀匯入和準確的 NSUID exact join。
4. **美日圖像與其他索引**：https://github.com/Marxally/switchicons 可參考 Nintendo CDN 圖片 URL 與去重方法；它預設抓美區資料，需確認對應版本。https://github.com/YuHaoLiaoSideProject/Switch-eShopRadar/blob/main/docs/image-sources-analysis.md 已確認猜測 `store.nintendo.com.hk/media/catalog/product/{nsuid}.jpg` 常常回傳同一佔位圖，應避免採用。
5. **IGDB、GameTDB、Wikimedia 等**：只有前述精確來源都缺時，才依名稱、版本、平台、出版社等多證據建候選；需查授權與使用限制。現有 `scripts/fill-covers-igdb.mjs` 仍只有 dry-run 才安全，禁止 `--apply` 直接寫正式 Supabase。

### 前端顯示注意
- `components/GameCard.tsx` 和 `app/globals.css` 卡片圖目前採 16:9、`object-fit: cover`。若圖片為直式盒繪，會裁掉內容；建議按媒體類型選 `object-fit:contain` / 16:9 橫幅，不要全部強迫裁切。
- 所有圖片先在 staging 驗證回 HTTP 200、`Content-Type:image/*`、非共用 placeholder、NSUID 相同；圖片失效回退至已知封面或佔位圖，不把錯誤圖覆蓋成永久紀錄。
- `imageHero.url` 的擷取時間和可用性應另外保存，避免 CDN URL 變更後滿站空圖。尊重各圖片供應商與 Nintendo 的授權及網站條款。

## 除 GitHub 以外的公開來源評估

- **任天堂台灣官方 API** 是第一手且目前實測最完整的名稱＋圖片來源，優於二次鏡像。
- **GitLab、Codeberg**：可找開源爬蟲實作，但這輪尚未取得可重現、比台灣官方更完整的現行台灣 NSUID＋價格＋封面資料集；不能宣稱不存在。
- **Hugging Face / Kaggle**：通常偏向歷史遊戲 metadata、分類或影像 dataset，未驗證能提供台灣最新 NSUID 與價格；不應拿來當主要上架事實來源。
- **遊戲箱子／Deku Deals／其他比價站**：可研究功能、產品分類與 UI，但其未公開後端、資料庫和圖片授權不能猜測或自行盜用；來源需能確認。

## 推薦實作順序（先測再改正式網站）

1. 完成最新版官方 TW 分頁索引的快照驗證，產出 `TW NSUID → title, publisher, hardwareCategory, imageHero.url, source_at`；保留 2 筆衝突待審，避免 name collision。
2. 以 PR 的既有 `collect-tw-name-evidence.mjs` 當審核報告來源，先把「2,383 筆原未具名且有圖」製成批次 staging 替換計畫；確保只 update **與台灣價格 exact NSUID 對應**、仍是 placeholder 的紀錄。
3. 把官方完整目錄接進**每週 merge** 和**每日 catalog-sync** 的資料路徑（需要支援分頁斷點、差分），否則只是一次性報告，網站明天又會退化。
4. 獨立更新 `7005` DLC 和 `7007` 相關商品及遊戲母子關係；不要把它們混入主遊戲數或當本體特價。
5. 對所有來源與封面做去重、連結存活驗證、保留更新時間和來源記錄；製作缺圖／未具名／未分類／缺價／跨區不確定五個管理報表。
6. 審核測試通過與使用者核准後，才設計可回滾的 Supabase Upsert 與前端改動，最終再合併、部署。

## GitHub Actions 稽核紀錄
- [名稱與完整官方目錄 #45014529725](https://github.com/shawnwin777/switch-price-site/actions/runs/45014529725)
- [官方媒體欄位與樣本查詢 #45041727831](https://github.com/shawnwin777/switch-price-site/actions/runs/45041727831)
- [完整圖片覆蓋與 8/8 MIME 驗證 #45041910799](https://github.com/shawnwin777/switch-price-site/actions/runs/45041910799)
- 香港補充稽核與未來回填方案只有報告，**不會自行合併 PR 或寫入正式資料庫**。
