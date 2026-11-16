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

**星露谷物語沒有台灣價**：台灣 eShop 根本沒有上架（官方清單、新作文章、價格 API、第三方比價站四方驗證皆無），只有實體卡。不是資料缺口，不用再追補，等上架再說。

## 擴大目錄缺價統計

- 有價國家：JP 9,821 款；TW 26、HK 30；其餘 29 國各 32 款（皆為舊 32 款的種子價）；SG／MY／TH 0 款。
- **完全無價：228 款**（日本 XML 遊戲：218 款下架、10 款查無）。
- 缺口：genre 缺失 99.4%、中文名覆蓋低（香港 JSON 只對到 52 款）、41.7% 標題無拉丁字母（slug 為 `game-<title_id>`）、DLC 無法區分、Switch 2 遊戲缺口（只有 mk-world、dk-bananza；絲之歌完全無價）。

## ⚠️ 最重要的發現：title ID（NSUID）是分區的

日本 NSUID 只在 JP 查得到價，查美國／阿根廷一律 `not_found`（已實測）。
舊文件寫「同款遊戲各國共用同一個 title ID」是錯的。後果：

1. 擴大目錄的新遊戲實際只有 JP 價——要多國比價，須另建**各區 NSUID 對照表**（各區 eShop 搜尋索引），是下一步的大工程，本次不在範圍內。
2. **現有的每日更新路由用日本 title ID 抓 35 國，實際只會更新 JP 價**，其他國家永遠停在種子價（舊價會保留，不會壞掉，但不會變新）。

## 每日更新改法（任務 C）

- 實測價格 API 約 1.6 毫秒／（款×國），全量一次跑不完 60 秒：1,000 款約 56 秒、3,000 款約 168 秒、10,045 款約 562 秒。
- 改成**每片 400 款＋按台北日期輪轉**：一支每日 cron 在 n 天內跑完全部遊戲（32 款 1 天、3,000 款 8 天、10,045 款 26 天）；匯率每天都更新。新增 `?slice=`、`?offset=&limit=`、`?slice_size=` 參數，`?countries=` 保留；價格 API 加 429／5xx 指數退避重試。
- Hobby cron 限制（查官方文件）：每專案最多 100 支、每支每天最多跑一次、觸發 ±59 分鐘抖動。想加快一輪可用外部免費排程每天多打幾次明確切片。

## 還需要使用者做的事

1. **在你的電腦跑匯入**（本站無 service key，無法代跑）：
   ```bash
   cd switch-price-site
   set -a; source .env.local; set +a   # 需 NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
   node scripts/seed-expanded.mjs       # 首次約 5–10 分鐘；重複執行約 1–2 分鐘
   ```
   會新增 10,019 款遊戲與約 10,761 筆價格（upsert，不會刪除資料庫已有的舊價格列；舊 920 筆種子價不會被洗掉）。`title_id` 只在為空時回填，已有值保留。
2. **部署後驗一次每日更新**：`curl https://switch-price-site.vercel.app/api/refresh -H "Authorization: Bearer <CRON_SECRET>"`，對照回傳的 `slice`／`prices_updated`／`duration_ms`（32 款時是 1 片，行為與舊版相同）。
3. 什麼都不用多做：目錄擴大後輪轉自動生效；`git push` 後 Vercel 自動部署（本次沒有推）。

## 未解決的問題

1. **各區 NSUID 對照表**（見上）：多國比價要真正運作，必須先建；同時每日更新路由要改用各區 ID 查價（games 表目前只有 `title_id` 一欄，需加欄位或對照表）。
2. 絲之歌：無 title ID、無價格（台港皆未上架）；死亡細胞香港編號未找到；4 個台港在售編號身份未明（`70010000058126`／`49288`／`42364`／`20843`）。
3. 台灣 eShop 無完整目錄端點（官方清單僅 166 款精選）；完整目錄目前只能靠價格 API 掃描推測，建議每週重跑 `map-tw-hk-title-ids.mjs` 追蹤新上架（如星露谷、絲之歌）。
4. 任務 C 未實測連 Supabase（無 service key）；寫庫耗時（400 款×35 國最多約 14,000 筆 upsert）未實測，若上線後 `duration_ms` 常接近 60 秒，把 `slice_size` 調小到 300。

## 交付檔案清單

- `data/catalog-expanded.json`（12.8 MB：10,051 款、10,761 筆價格）
- `data/tw-hk-title-ids.json`（台港對照＋149 款台灣清單獨有遊戲）
- `scripts/build-expanded-catalog.mjs`、`scripts/map-tw-hk-title-ids.mjs`、`scripts/merge-tw-hk-into-catalog.mjs`、`scripts/restore-seed-prices.mjs`、`scripts/seed-expanded.mjs`、`scripts/verify-refresh-slices.mjs`
- `lib/refresh-slices.ts`、`app/api/refresh/route.ts`（改寫）、`lib/nintendo.ts`（重試）、`SETUP.md` §8 重寫、`DATA_NOTES.md` §10 新增

未推 GitHub、未碰 Supabase、未寫任何 Secret；程式碼驗證：`npx tsc --noEmit` 通過、`npm run build` 通過（任務 C 回報時）。
