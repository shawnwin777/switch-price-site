# Switch 遊戲比價 — 補台港＋擴大目錄 摘要報告（2026-11-16）

> 一頁摘要。細節見 `DATA_NOTES.md` §10、各任務腳本開頭註解。

## 完成數字

| 任務 | 結果 |
|---|---|
| **A 補台港價格** | 32 款中 **24 款對到台港編號、23 款拿到台港價**（健身環有編號但台港皆無價，下載版已停售）。另找到 3 款原本缺 title ID 的遊戲：寶可夢傳說 Z-A、健身環、黑帝斯 II；絲之歌仍未找到 |
| **B 擴大目錄** | **10,051 款**（日本 XML 10,045 個 title ID 去重＋2 個 Switch 2 人工 ID＋4 款無 title ID 的種子遊戲）、**10,761 筆價格**、32 國有價；封面抽樣 20/20 通過 |
| **C 每日更新重設計** | 切片＋輪轉已實作並驗證（tsc＋build 通過）；`vercel.json` 不動，仍一支 cron |
| **合併（協調員）** | 台港價已合併進擴大目錄；舊種子價 890 筆補回目錄缺的國家；兩支合併腳本皆冪等、重跑驗證通過 |

## 台港覆蓋變化

| | 之前（舊種子檔） | 現在（合併後目錄） |
|---|---|---|
| 有 TW 價的遊戲 | 4 款 | **26 款** |
| 有 HK 價的遊戲 | 4 款 | **30 款** |
| TW 價範例 | — | 曠野之息 1599、王國之淚 1599、咚奇剛 1880、瑪利歐賽車世界 2080、寶可夢 Z-A 1449、黑帝斯 II 748、潛水員戴夫 350（全目錄最低） |

**星露谷物語沒有台灣價，也沒有香港價**：台灣、香港 eShop 皆無下載版
（全區間掃描＋清單＋118 篇文章皆無；對照檔 `stardew_tw_onsale: false`、
`stardew_hk_onsale: false`），只有實體卡。不是資料缺口，不用再追補，等上架再說。

## 擴大目錄缺價統計

- 有價國家：JP 9,821 款；TW 26、HK 30；其餘 29 國各 32 款（皆為舊 32 款的種子價）；SG／MY／TH 0 款。
- **完全無價：228 款**（日本 XML 遊戲：218 款下架、10 款查無）。
- 缺口：genre 缺失 99.4%、中文名覆蓋低（香港 JSON 只對到 52 款）、41.7% 標題無拉丁字母（slug 為 `game-<title_id>`）、DLC 無法區分、Switch 2 遊戲缺口（只有 mk-world、dk-bananza；絲之歌完全無價）。

## ⚠️ 最重要的發現：title ID（NSUID）是分區的

日本 NSUID 只在 JP 查得到價，查美國／阿根廷一律 `not_found`（已實測）。
舊文件寫「同款遊戲各國共用同一個 title ID」是錯的。後果：

1. 擴大目錄的新遊戲實際只有 JP 價——要多國比價，須另建**各區 NSUID 對照表**（各區 eShop 搜尋索引），是下一步的大工程，本次不在範圍內。
2. **現有的每日更新路由用日本 title ID 抓 35 國，實際只會更新 JP 價**，其他國家永遠停在種子價（舊價會保留，不會壞掉，但不會變新）。

## 每日更新改法（任務 C，已由「全自動更新」取代）

- 實測價格 API 約 1.6 毫秒／（款×國），全量一次跑不完 60 秒：1,000 款約 56 秒、3,000 款約 168 秒、10,045 款約 562 秒。
- 舊設計：每片 400 款＋按台北日期輪轉、一支每日 cron（10,051 款 26 天一輪）。
  **已由下節「全自動更新」取代**：工作量切片（每片約 12,000 對）＋每天 8 次
  價格更新（每 3 小時）＋每天 4 次目錄同步，30,000 款約 4 天一輪；
  `?slice_size=` 退役，改用 `?pair_budget=`。細節見 `DATA_NOTES.md` §12.5。

## 各區編號對照表（2026-11-16，架構與管線已就緒）

- **表**：新增 `game_region_ids`（`game_id` FK cascade、`country`、`title_id`、`source`；`unique(game_id, country)`；索引 `game_id` 與 `(country, title_id)`；公開可讀、寫入只走 Service Role）。migration：`supabase/migrations/20261116_game_region_ids.sql`（可重複執行）。`games.title_id` 保持不動，仍是日本／預設編號、作 fallback；JP 不寫入對照表。
- **管線**（三支新腳本＋一支驗證腳本，皆 Node 18+ 內建 fetch、env-only、不寫 Secret）：
  - `scripts/seed-region-ids.mjs`：讀對照檔（新格式 `data/region-title-ids.json` 的 `games`＋`twTitleId`／`hkTitleId`／`regionIds`，與舊台港格式 `mapped`／`tw_only_games` 皆相容；解析器共用 `scripts/region-ids-input.mjs`）→ slug 優先、其次 jpTitleId 對遊戲 → upsert 對照表。預設已有值保留（衝突印出不覆蓋，`--force` 才覆蓋）、絕不以 null 覆蓋、對不到遊戲不新建、可重複執行。
  - `scripts/fetch-region-prices.mjs`：每國用該國編號、50 個一批打價格 API（429／5xx 指數退避、單批失敗只記不中斷；lang 規則同現況）→ 產 `data/region-prices-patch.json`（與目錄 prices 元素相容；`priceTwd` 用當日匯率換算，預設抓即時表、失敗讀 `data/.cache/fx.json`）。
  - `scripts/merge-region-prices.mjs`：只補目錄缺口（已有價不覆蓋、目錄無此遊戲不新建、有新增列才重算 cheapest／歷史低價）；合併前備份原檔到 `data/.backup/`；冪等。
  - `scripts/verify-region-ids.mjs`：mock 驗算（不連庫、不連網）。
- **每日更新路由改寫**（`app/api/refresh/route.ts`，`lib/refresh-slices.ts` 不動）：每國按對照編號查價，無編號用 `games.title_id` fallback、兩者皆無跳過列 pending；切片＋輪轉、45 秒軟預算、既有參數與回傳欄位不變，外加 `region_ids_used` 摘要（各國 region／fallback／skipped 數）；migration 未跑時自動退回舊行為（全部 fallback），部署不必等建表。寫庫量：對照表補齊後每片最多約 14,000 筆 upsert（200 筆一批、4 批並行，估算 6～11 秒），仍在 60 秒內；若 `duration_ms` 常接近 60 秒，先把 `slice_size` 調小到 300。
  - **註**：上述 fallback 與切片寫法已被「全自動更新」取代（見下節）：
    fallback 只留給 JP、其他國家沒編號直接跳過；切片改為工作量切片
    （每片約 12,000 對、`?pair_budget=`），`?slice_size=` 退役。
- **驗證**：`npx tsc --noEmit` 通過、`npm run build` 通過、5 支腳本 `node --check` 通過、`verify-region-ids.mjs` 29 項全通過；Supabase 連線未實測（無 service key）。**還缺的只是來源調查組的編號檔**——檔一到即可按 SETUP.md §8.9 的順序灌入。

## 全自動更新（2026-11-16，設計＋實作，工作區未推 GitHub）

目標（使用者原話）：「應該是由網頁自主更新、自己串聯」。流程、來源表、
分片數字、欄位缺口、仍需手動步驟見 `DATA_NOTES.md` §12；這裡只記結論。

- **目錄同步**（新增 `app/api/sync-catalog/route.ts`＋`lib/catalog-sync.ts`＋
  `lib/catalog-sources.ts`）：每天 4 次（台北 02/03/05/06），分頁游標
  （`sync_state` 表）推進 JP 搜尋 API（約 300 頁）、NA Algolia（38 頁）、
  EU Solr（21 頁）、AU Algolia（2 頁）、台港清單、韓國清單；約 1 天跑完
  一輪，新遊戲發現延遲約 1–2 天。比對鍵：分區 NSUID diff 為主力、
  標題正規化唯一命中為輔；碰撞／撞名／疑似 DLC 列 `needs_review`。
  冪等 upsert，重跑同一窗口＝0 寫入。
- **價格更新**（改寫 `app/api/refresh/route.ts`＋`lib/refresh-slices.ts` 追加
  工作量切片）：每天 8 次（每 3 小時），每片約 12,000 個（遊戲、國家）對；
  30,000 款情境（1 萬款 32 國＋2 萬款 JP-only，約 340,000 對）29 片、約 4 天
  一輪（舊 400 款設計會變 75 天）；現況 10,051 款 1 片、每天全量更新。
  只有 JP 可 fallback `games.title_id`，其他國家沒編號直接跳過。
  `games.price_countries` 欄位（migration＋回填）供切片用，由 sync 維護。
- **cron**：`vercel.json` 改為 12 支（sync 4 支＋refresh 8 支），Hobby 上限 100 支內。
- **商店前端價格分工（已驗證，`data/region-count-gaps.md` §5）**：
  NA Algolia `eshopDetails`（MKW $79.99＝價格 API）與 JP 搜尋 API
  （BOTW 7,678＝價格 API）可當新遊戲即時價——先寫入，價格 API 查到同一國價時
  覆蓋（價格 API 為準）；EU Solr 只有每 locale 一個參考價（星露谷 en 10.99／
  de 13.99＝價格 API），且 BOTW de 三欄皆 89.98（與價格 API €69.99 不符），
  只做交叉驗證、永不寫入（差異記 `reference_price_mismatches`）。
  台港 Savanna GraphQL 價格查詢未打通（`$nsUids`、INVALID_PARAM 1802）、
  11 個操作全是單品查詢無列舉，**不能當台港目錄來源**；台港列舉＋抓價仍走
  價格 API 掃描。
- **台港完整來源已找到**：價格 API 全區間掃描（TW 在售 9,742、HK 21,472，
  全部 SKU）；對照檔 `data/tw-hk-full-ids.json`（29,237 筆：具名 2,347、
  未具名 26,890）是台港對照表的種子來源，`seed-region-ids.mjs` 已支援此檔。
  掃描節奏：全量每週一次（約 11,600 批、25 分鐘，本機腳本）、每日前沿約 40 批
  （10 秒）、上限 `70010000150000` 每季檢查上調；KR 主區間 9,648 已掃，
  DLC／S2 區間尚未掃。
- **規模前提修正**：App 各國數字是「該 App 的覆蓋」，不是真實目錄大小
  （決定性反證：App 寫 KR 2 款，掃描實測 KR 主區間在售 9,648 款）。
  設計改以實測掃描數字為準（TW 9,742／HK 21,472／KR ≥9,648／JP 28,336／
  EU 23,932／NA 37,632）；目錄聯集約 30,000–40,000 款。
- **驗證**：`verify-catalog-sync.mjs` 43 項全通過（含 NA／JP／EU 價格解析與
  規劃器分流）、`npx tsc --noEmit` 通過、`npm run build` 通過。
  Supabase 連線未實測（無 service key）。

## 還需要使用者做的事

1. **在 Supabase SQL Editor 執行 3 個 migration（各只需一次）**：
   `supabase/migrations/20261116_game_region_ids.sql`（對照表）、
   `supabase/migrations/20261117_catalog_sync_state.sql`（游標表）、
   `supabase/migrations/20261117_game_price_countries.sql`（`price_countries`
   ＋一次性回填）。程式不能自己建表（工作區無 service key；DDL 是一次性建表）。
2. **在你的電腦跑台港對照種子**（本站無 service key，無法代跑）：
   ```bash
   cd switch-price-site
   set -a; source .env.local; set +a   # 需 NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
   node scripts/seed-region-ids.mjs data/tw-hk-full-ids.json  # 具名 2,347 筆寫入對照表
   ```
   未具名 26,890 筆目前無 join key、不寫入（見「未解決的問題」第 5 項）。
   舊的擴大目錄匯入（`seed-expanded.mjs`，10,019 款）若尚未跑，仍按原順序先跑。
3. **部署後驗一次**：`curl "https://shawn-game-studio.vercel.app/api/sync-catalog?dry_run=1" -H "Authorization: Bearer <CRON_SECRET>"`（只比對、不寫庫），
   再驗 `curl https://shawn-game-studio.vercel.app/api/refresh -H "Authorization: Bearer <CRON_SECRET>"`，對照回傳的 `slice`／`pairs_in_slice`／`prices_updated`／`duration_ms`。
4. **兩個決定**（見「未解決的問題」第 5、6 項）：未具名 26,890 筆是否先建檔進目錄；
   Algolia key 歸屬確認（現有 key 是官網前端 key 還是第三方函式庫 key）。
5. 什麼都不用多做：`git push` 後 Vercel 自動部署（本次沒有推）；排程上線後自動跑。

## 未解決的問題

1. **各區 NSUID 對照表**：台港部分已解決（`data/tw-hk-full-ids.json`＋
   `seed-region-ids.mjs`，見上節第 2 項）；NA／EU／JP 編號由目錄同步自動抓取
   （Algolia／Solr／JP 搜尋 API），不再等人工編號檔。KR DLC／S2 區間尚未掃；
   SG／MY／TH 無來源（不要以 US／EU 編號硬填）。
2. 絲之歌：無 title ID、無價格（台港皆未上架）；死亡細胞香港編號未找到；4 個台港在售編號身份未明（`70010000058126`／`49288`／`42364`／`20843`）。
3. 台灣 eShop 完整目錄已找到（價格 API 全區間掃描，見上節）；舊「只能靠掃描推測、
   每週重跑 `map-tw-hk-title-ids.mjs`」的說法已更新為掃描節奏（全量每週一次、
   每日前沿 40 批、上限每季檢查）。
4. 全自動更新未實測連 Supabase（無 service key）；寫庫耗時（每片最多約 12,000 筆
   upsert）未實測，若上線後 `duration_ms` 常接近 60 秒，把 `pair_budget` 調小到 8000。
5. **未具名 26,890 筆的建檔規則（需主代理決定）**：是否以 `tw-<nsuid>`／`hk-<nsuid>`
   slug 先建未具名遊戲進目錄（編號＋價格先行、之後補名合併），或只寫對照表、
   等命名後再建遊戲？目前設計不自動建未具名遊戲（無標題無法顯示），只把具名筆
   寫進對照表。命名可能方向：Savanna GraphQL 詳情查詢（若打通，需登入 idToken）、
   等任天堂公開更多清單；以價格反推不建議當主鍵。
6. **Algolia key 歸屬（需主代理確認）**：程式預設 NA／AU key 在美歐報告中記為
   「任天堂官網前端內嵌的公開 search key」，台港報告則指出美洲區列舉需自備 key、
   不要用函式庫內嵌的他人 key。確認前不要把來源寫死；若是第三方函式庫的 key，
   請從任天堂美國商店前端自行取得並改用環境變數 `NA_ALGOLIA_API_KEY`。
7. **Savanna GraphQL 價格查詢打通（需 live browser）**：需觀察商品頁實際請求取得
   正確 persisted-query hash，本團隊無此工具；詳情查詢另需登入 idToken。
   打通前台港仍走價格 API 掃描；打通後也只能當單品價格／命名備援，不能列舉。

## 交付檔案清單

- `data/catalog-expanded.json`（12.8 MB：10,051 款、10,761 筆價格）
- `data/tw-hk-title-ids.json`（台港對照＋149 款台灣清單獨有遊戲）
- `scripts/build-expanded-catalog.mjs`、`scripts/map-tw-hk-title-ids.mjs`、`scripts/merge-tw-hk-into-catalog.mjs`、`scripts/restore-seed-prices.mjs`、`scripts/seed-expanded.mjs`、`scripts/verify-refresh-slices.mjs`
- `lib/refresh-slices.ts`、`app/api/refresh/route.ts`（改寫）、`lib/nintendo.ts`（重試）、`SETUP.md` §8 重寫、`DATA_NOTES.md` §10 新增
- 各區編號對照表（2026-11-16）：`supabase/migrations/20261116_game_region_ids.sql`、`lib/region-ids.ts`、`scripts/region-ids-input.mjs`、`scripts/seed-region-ids.mjs`、`scripts/fetch-region-prices.mjs`、`scripts/merge-region-prices.mjs`、`scripts/verify-region-ids.mjs`；`app/api/refresh/route.ts` 再改寫（按國家用對照編號查價）；`DATA_NOTES.md` §11、`REPORT.md` 對照表一節、`SETUP.md` §8.9 新增
- 全自動更新（2026-11-16）：`lib/catalog-sources.ts`、`lib/catalog-sync.ts`、`app/api/sync-catalog/route.ts`、`supabase/migrations/20261117_catalog_sync_state.sql`、`supabase/migrations/20261117_game_price_countries.sql`、`scripts/verify-catalog-sync.mjs`、`scripts/probe-storefront-prices.mjs`、`vercel.json`（12 支 cron）；`app/api/refresh/route.ts`、`lib/refresh-slices.ts`、`lib/region-ids.ts` 改寫（工作量切片、僅 JP fallback）；`DATA_NOTES.md` §12、`REPORT.md` 全自動更新一節、`SETUP.md` §8 更新；台港對照檔 `data/tw-hk-full-ids.json`（29,237 筆）

未推 GitHub、未碰 Supabase、未寫任何 Secret；程式碼驗證：`npx tsc --noEmit` 通過、`npm run build` 通過（任務 C 回報時）。
