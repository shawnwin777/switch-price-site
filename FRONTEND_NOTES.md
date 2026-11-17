# Switch 遊戲比價 — 前端組交接文件（FRONTEND_NOTES.md）

前端：Next.js 14 App Router + TypeScript，標準 Next.js，不用任何只有 Vercel 才有的功能。
風格：賽博龐克（深藍黑 + 電光青 + 霓虹粉），繁體中文介面。

## 檔案清單

| 檔案 | 說明 |
|---|---|
| `package.json` | next、react、react-dom、@supabase/supabase-js、@supabase/ssr |
| `tsconfig.json` / `next.config.js` / `.env.example` / `.gitignore` | 標準設定；`.env.example` 只列變數名，值留空 |
| `app/layout.tsx` | html lang zh-Hant、頁首、頁尾、metadata |
| `app/globals.css` | 全站樣式（賽博龐克） |
| `app/page.tsx` | 首頁（force-dynamic） |
| `app/games/[slug]/page.tsx` | 遊戲詳細頁（force-dynamic） |
| `app/ranking/page.tsx` | 收藏排行 TOP 10（force-dynamic，`?sale=all` 切全部） |
| `app/add/page.tsx` | 手動新增遊戲表單 |
| `app/login/page.tsx` + `components/LoginClient.tsx` | 登入頁（Suspense 包 useSearchParams） |
| `lib/supabase-client.ts` / `lib/supabase-server.ts` / `lib/supabase-env.ts` | 瀏覽器／伺服器端 Supabase client（拆開是因為 `next/headers` 不能被 client component 間接 import） |
| `lib/data.ts` | 讀遊戲、價格、匯率、留言、排行、收藏的函式 |
| `lib/types.ts` | 型別（欄位名與資料表合約一致） |
| `lib/countries.ts` | 35 國清單、eShop 首頁連結、試玩／商品類型標籤 |
| `lib/format.ts` | 台幣／當地幣別格式化、台北時間、剩餘天數 |
| `components/SiteHeader.tsx` | 導覽列（登入狀態、登出） |
| `components/HomeClient.tsx` | 首頁互動：搜尋、篩選、排序、國家設定、遊戲牆、分頁（篩選條件走 URL 參數，伺服器端分頁每頁 12 款）、只看我的收藏／只看已購買 |
| `components/GameCard.tsx` | 遊戲卡片 |
| `components/CountrySettings.tsx` | 35 國顯示／封鎖（localStorage） |
| `components/SaleBanner.tsx` | 進站特價提醒（已收藏且特價中） |
| `components/GameDetailClient.tsx` | 詳細頁互動：價格表、留言、讚、收藏、已購買、特價提醒 |
| `components/PurchaseButton.tsx` | 已購買切換（POST /api/purchases，與 CollectionButton 同模式） |
| `app/api/purchases/route.ts` | 已購買切換 API（POST `{ gameId }` → `{ purchased }`，寫 `user_purchases`） |
| `components/CommentsSection.tsx` | 留言區（讚數排序、預設 5 則＋顯示全部） |
| `components/CollectionButton.tsx` | 愛心收藏（POST /api/collections） |
| `components/LikeButton.tsx` | 遊戲讚（POST /api/likes） |
| `components/LoginClient.tsx` | Google / Discord 登入按鈕 |
| `public/covers/placeholder.svg` | 手把圖示佔位封面（手動新增遊戲用） |

**沒有寫的（登入組的）**：`app/auth/callback`、`app/api/refresh`、`app/api/collections`、
`app/api/purchases`、`app/api/likes`、`app/api/comments`、`middleware.ts`、`vercel.json`。
**沒有動的（資料組的）**：`supabase/`、`scripts/`、`public/covers/` 既有封面
（只新增了 `public/covers/placeholder.svg` 這一個佔位檔，任務要求手動新增遊戲用它）。

## 本地跑起來

```bash
cd ~/workspace/switch-price-site
cp .env.example .env.local   # 填入 Supabase URL / Anon Key（專案建立後）
npm install
npm run dev                  # http://localhost:3000
npm run build                # 正式建置檢查
npm start                    # 跑 production build
```

## 資料怎麼讀

- 全部讀取都走 `lib/data.ts`，直接用 Supabase client 讀公開資料（`games`、`prices`、
  `fx_rates`、`collections`、`game_likes`、`comments`、`comment_likes`）。
- 寫入只走 API 合約（見下節），只有「新增遊戲」例外：目前直接用瀏覽器端 Supabase
  client insert `games` + `prices`，因為任務沒有給新增遊戲的 API 合約。
- 資料頁面全部 `export const dynamic = "force-dynamic"`，建置時不呼叫 Supabase。
- Supabase 專案還不存在時，`lib/supabase-env.ts` 用 placeholder URL / key 建立 client，
  查詢失敗時 `lib/data.ts` 回傳空陣列、頁面顯示「尚無資料」，**`npm run build`
  在只有 placeholder 環境變數的情況下可以通過**（已驗證）。
- 封面 URL：種子檔的 `./blobs/<base64>` 會在 `lib/data.ts` 的 `resolveCoverUrl()`
  解成 `/covers/xxx.jpg`；讀不到封面時 fallback 到 `/covers/placeholder.svg`。
- 匯率：`getLatestFx()` 取 `fx_rates` 裡 `date_key` 最新的一批；頁面註明
  「匯率以當天 08:00 台北時間為準」，並顯示快照時間與遊戲價格最後更新時間。
- 國家封鎖：存在瀏覽器 `localStorage`（key `spc-blocked-countries`），至少保留一國可見；
  封鎖的國家不參與卡片最低價、價格表與排行計算。

## 頁面清單

- `/` 首頁：搜尋（中英文遊戲名，伺服器端 ilike）、篩選（Switch / Switch 2、商品類型、
  試玩類型：免費 Demo／免費試玩／NSO 限時試玩）、排序、只看特價、只看我的收藏
  （需登入）、只看已購買（需登入，`?purchased=1`）、35 國切換與封鎖、遊戲卡片
  （封面、標題、最低價、歷史低價徽章、特價標記）、進站上方「已收藏且特價中」提醒、
  匯率 08:00 註明＋價格最後更新時間。
  搜尋／篩選／排序都在伺服器端做（`lib/data.ts` 的 `getGamesPage`），
  總數用 count exact，每頁 12 款（`?page=` 分頁）；價格／折扣排序與只看特價
  依賴 `games_with_price_stats` 檢視（見 supabase/migrations/20261117_homepage_price_stats.sql），
  檢視未建立時自動退回名稱排序，首頁不會壞。
  登入後，已購買的遊戲不顯示在遊戲牆／搜尋結果裡（伺服器端以
  `user_purchases` 排除，見 `lib/data.ts`）；總數顯示維持全站總數。
  只看我的收藏／只看已購買是使用者自己的清單，不排除已購買。
  注意：最低價排序用的是「全部國家」的最低價（封鎖清單只存在瀏覽器 localStorage，
  伺服器不知道），卡片顯示的最低價仍依可見國家計算。
- `/games/[slug]` 詳細頁：價格表依台幣排序、最便宜高亮、比台版省多少、歷史低價徽章＋
  歷史低價金額、特價結束時間＋剩餘天數；留言區在價格上方（讚數排序、預設 5 則、
  其餘收在「顯示全部」）；遊戲讚；已購買切換（收藏按鈕旁，`user_purchases`，
  未登入導向登入頁；已購買的遊戲不顯示在首頁遊戲牆／搜尋結果裡）；點封面在新分頁開官方 YouTube 介紹影片
  （**沒有用 iframe 內嵌**，YouTube error 153 的教訓）；各區官方 eShop 首頁連結；
  已收藏且特價中時頁面有明顯提醒。
- `/ranking` 收藏排行 TOP 10，預設只顯示特價中，`?sale=all` 切全部。
- `/add` 新增遊戲：封面用 `/covers/placeholder.svg`，填的價格同時記為歷史低價。
- `/login` 登入頁：Google / Discord 按鈕（`supabase.auth.signInWithOAuth`），
  頁面明寫「登入只用來做收藏，不收集任何 Gmail 或 Discord 資料、不存其他資料」。

## 等登入組的 API（前端已照合約呼叫，未登入回 401 時導向登入頁）

| 前端呼叫 | 合約 | 用在哪裡 |
|---|---|---|
| `POST /api/collections` `{ gameId }` → `{ collected }` | 切換收藏 | `CollectionButton.tsx`（卡片、詳細頁） |
| `POST /api/purchases` `{ gameId }` → `{ purchased }` | 切換已購買 | `PurchaseButton.tsx`（詳細頁，收藏按鈕旁） |
| `POST /api/likes` `{ gameId }` → `{ liked, count }` | 遊戲按讚 | `LikeButton.tsx`（詳細頁） |
| `POST /api/comments` `{ gameId, body }` → 留言物件 | 新增留言 | `CommentsSection.tsx` |
| `POST /api/comments/[id]/like` → `{ liked, count }` | 留言按讚 | `CommentsSection.tsx` |
| `GET /auth/callback`（登入組實作） | OAuth 回跳，登入按鈕 redirectTo 指向這裡 | `LoginClient.tsx` |

另外等登入組／資料組確認的事：

1. `collections`、`game_likes`、`comments`、`comment_likes` 的 RLS 政策：
   前端讀取用 anon key 直接 select（排行、讚數、收藏數、留言都靠它），
   若 RLS 擋住匿名讀取，首頁卡片會顯示 0 讚／0 收藏、留言區空白。
2. `comments` 表欄位：前端讀 `id / game_id / user_id / body / created_at`，
   作者名優先讀 `author_name`，其次 `nickname`，都沒有就顯示「玩家」。
   若登入組的 `POST /api/comments` 回傳欄位不同，請對照 `CommentsSection.tsx` 調整。
3. `has_demo` 對照：0 無試玩、1 免費 Demo、2 免費試玩（好友通行證等）、3 NSO 限時試玩
   （種子檔只有 0／1／2）。2 已確認為「免費試玩」（唯一一款是雙人成行，好友通行證免費試玩）。
4. 新增遊戲目前直接 insert（見「資料怎麼讀」），若登入組希望改走 `POST /api/games`，
   只改 `app/add/page.tsx` 的 `submitGame()` 即可。
5. 35 國清單（`lib/countries.ts`）含 SG / MY / TH 三國，種子檔 32 國價格沒有它們；
   資料組補上價格後自動出現，不需改前端。

## 已知缺口 / 注意事項

- Supabase 專案不存在、種子資料未匯入時，所有頁面顯示「尚無資料」空狀態（建置可通過，
  但站上是空的）。接上真實專案＋匯入種子後即有內容。
- 收藏／留言／按讚的寫入完全依賴登入組的 `/api/*`；在 API 上線前，點收藏／讚／留言
  會失敗並提示「需先登入」（或 404）。
- 登入按鈕的 `redirectTo` 是 `{origin}/auth/callback?next=...`，callback 由登入組實作；
  在它完成前，OAuth 登入無法走完流程。
- 價格與匯率的每日 08:00 更新由資料組的 cron 負責，前端只顯示 `updated_at`／`as_of`。
- 封面圖由資料組提供（`public/covers/`）；種子檔的 blob 路徑已做相容轉換，
  但若資料庫 `cover_url` 存的是其他格式，請對照 `resolveCoverUrl()` 調整。
- `user_purchases` 表尚未建立時（migration 未跑），已購買查詢回空、
  「已購買」按鈕寫入會失敗；跑完 `supabase/migrations/20261117_user_purchases.sql`
  後才真正可用。

## 已完成（2026-11-17 快取版）

- **首頁上方「準備上市」與「接近歷史低價」入口卡片**：首頁最上方兩個卡片，
  分別連到獨立列表頁 `/upcoming`、`/near-low`（排行頁風格、每頁 12 款、
  與首頁同樣的 1 小時快取）。
  - 「準備上市」：`release_date` > 今天（台北日期），最近的先排；今天
    發售的不算（已上市，首頁牆上找得到）。資料來源：`games.release_date`
    （migration `supabase/migrations/20261118_add_release_date.sql`），
    目錄同步從各區來源（JP 搜尋 API sdate、EU Solr dates_released_dts、
    JP XML SalesDate、AU Algolia date_timestamp）順手寫入，舊遊戲用
    `scripts/backfill-release-dates.mjs` 從 EU Solr 批次回填。欄位還沒建
    或還沒有任何上市日資料時，頁面顯示「上市日期資料補充中」；有資料但
    沒有即將上市的遊戲時顯示「目前沒有即將上市的遊戲」。
  - 「接近歷史低價」：目前最低價（各區換算台幣的最小值）高於歷史低價
    且 ≤ 歷史低價 × 1.10（等於歷史低價的不算，那是已破底），依
    （最低價 ÷ 歷史低價）由小到大排，卡片顯示「比歷史低貴 X%」。
    未具名遊戲（`games.is_unnamed`）不列入——每日更新會幫它們寫歷史低價，
    特價結束漲價後比值會落進區間，若不排除就會以「未命名商品」出現在此頁。
- **未具名遊戲不上首頁／搜尋**：台港韓掃描掃出的無標題商品以
  `tw-<nsuid>`／`hk-<nsuid>`／`kr-<nsuid>` 佔位遊戲建檔（見
  `scripts/seed-unnamed-games.mjs`、DATA_NOTES.md §12.8），但
  `lib/data.ts` 的首頁查詢（`buildFilteredGamesQuery`，快取版與即時版共用
  的單一過濾點）會排除 `games.is_unnamed = true` 的遊戲；`POST
  /api/collections` 也擋下收藏未具名遊戲，所以不會透過收藏排行曝光。
  「準備上市」則因佔位遊戲的 `release_date` 為 NULL，本來就不列入。
  migration（`supabase/migrations/20261118_unnamed_games.sql`）還沒跑時，
  查詢會因欄位不存在而自動退回不過濾（此時尚無未具名遊戲，是安全的）；
  詳細頁直接輸入網址仍可打開（方便檢查）。
  - **首頁排序「上市日期：新 → 舊」**：資料庫端 `ORDER BY release_date
    DESC NULLS LAST`，沒有上市日的遊戲排在最後面、不被排除；欄位還沒建
    時自動退回名稱排序（快取 1 小時內恢復）。

## 未來規劃（目前不做，只記下來）
