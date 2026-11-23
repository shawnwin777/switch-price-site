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
  封鎖的國家不參與卡片最低價、價格表與排行計算。設定改動時同時寫進 cookie
  `spc-visible-countries`（值是 `ALL` 或逗號串接的可見代碼，有效期 1 年），
  伺服器端在查首頁名單前讀 cookie——沒 cookie（或非法值）時用預設 TW/HK。
  頁面載入時也會把 localStorage 的設定同步寫進 cookie 一次，舊設定不用重選就生效。

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
  注意：最低價排序用的是「全部國家」的最低價（檢視的統計欄位是全球的），
  卡片顯示的最低價仍依可見國家計算。
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

## 已完成（2026-11-23：Steam＋Epic 輪播、首頁第一頁修正）

- **Steam 特價＋Epic 免費遊戲＋Xbox PC 特價獨立頁面 /deals**（2026-11-23 上午先上首頁輪播，當天中午依 shawn 決定改成獨立頁面，輪播下架；當天下午再改成分頁框）：
  `app/deals/page.tsx`＋`components/DealCard.tsx`＋`components/DealsTabs.tsx`＋`lib/deals-carousel.ts`＋`lib/xbox-deals.ts`（檔名未改，內容已是 /deals 用）。
  伺服器端抓取、每小時快取（`lib/cached-data.ts` 的 `getCachedDealsPage`，key `deals-page-v3`；`getCachedXboxPcDeals`，key `xbox-pc-deals-v2`，revalidate 3600 秒），不每次載入頁面都打 API。
  只做台灣區（Steam `cc=TW`、Epic `country=TW&locale=zh-Hant`、Xbox `market=TW`），不加跨區切換——跨區帳號可能被鎖。
  上方三個平台分頁框（Epic／Steam／Xbox PC，`DealsTabs` client component，預設 Steam），點了不跳頁、不換路由，當下切換；三個平台各自都能摺疊（標題旁「▾ 收合／▸ 展開」，預設展開，收起時連分頁控制一起收）。每平台取前 200 款，一次只顯示 24 款，在頁內翻頁（頁碼用 `lib/pagination.ts` 的 `pageWindow`）。
  Epic 只有免費遊戲（本週＋下週預告）；Epic 特價抓不到——免費遊戲那支公開 API 不含特價資料，特價要走的 Epic GraphQL 與商店瀏覽頁都被 403 擋下（2026-11-23 實測，連瀏覽器標頭也一樣），不要再試。
  Steam 取折扣最大的前 200 款：走特價搜尋 API（`search/results/?specials=1&cc=TW`，回 results_html 要解析；2026-11-23 實測台灣區特價中 15,020 款；`sort_by=Discount_DESC` 與 `_ASC` 順序相同、不支援折扣排序，所以抓前兩頁 200 列再在伺服器端按折扣大→小取前 200；搜尋結果沒有特價截止日）。舊的 `featuredcategories` specials 只回 10 款精選，搜尋失敗時才當備援。
  Xbox PC 取折扣最大的前 200 款（清單第 1、2 頁各 100 個 productId，Display Catalog 每批 50 個 id、最多 3 批並行補資料；總數約 500 款，頁面註明總數並連去微軟商店台灣區 PC 特價頁看完整清單）。
  Epic 取 `freeGamesPromotions`（TW，`discountSetting.discountPercentage === 0` 才是免費——實測回應沒有 `discountPrice` 欄位；進行中顯示「免費／領取截止日」，下週預告顯示「即將免費／開始日」，連去 Epic 商店）。
  單一來源失敗時只顯示其他來源；全部失敗時顯示空狀態、頁面不壞。
  首頁不再有輪播，改成入口卡片（跟「準備上市」「接近歷史低價」放一起）＋導覽列「Steam／Epic／Xbox 特價」連結。
  注意：2026-11-23 實測 TW 本週無進行中免費遊戲（Mark of the Deep 只在 US 回應有），當時只有 10 款 Steam＋1 款 Epic 下週預告（Bread and Fred，11/26 起免費），這是資料現況、不是 bug。
  舊輪播元件 `components/DealsCarousel.tsx` 與舊 Epic 區塊 `components/EpicDealsSection.tsx` 已無引用，留在 repo 裡（push-files 不支援刪檔，之後要刪請用網頁上傳）。
- **首頁第一頁修正**（`lib/data.ts` 的 `buildFilteredGamesQuery`，快取版與即時版共用的單一過濾點）：
  沒選國家時，查詢階段就只撈預設可見國家（TW、HK）有價的遊戲參與排序與分頁（`price_country_list` 包含 TW 或 HK）。
  舊版先照全球特價排序分頁、再由前端依可見國家過濾，導致預設首頁第一頁 18 款 TW/HK 價格 0/18、整頁「可見國家尚無價格」（2026-11-20 驗證、2026-11-23 上線前再驗證仍是 0/18）。
  `?country=XX` 單一國家篩選、排除已購買、特價優先排序都保留；「只看我的收藏」不套用預設篩選（自己的清單不該因沒台港價而消失）。
  伺服器端只知道預設值 TW/HK（使用者 localStorage 的可見國家設定伺服器端看不到），實作以預設 TW/HK 為準。
  快取 key 依慣例 bump：`games-page-v2` → `games-page-v3`（部署不會清 Data Cache，舊項目留到過期；換 key 立刻重算）。
  2026-11-23 改走 cookie：瀏覽器改設定時把可見國家同步寫進 cookie `spc-visible-countries`
 （`ALL` 或逗號代碼；非法值視為預設 TW/HK），`app/page.tsx` 在查詢前用
  `lib/countries.ts` 的 `parseVisibleCountriesCookie` 讀它，`lib/data.ts` 依此撈遊戲
  （`ALL` 不做國家過濾、代碼清單只撈那些國家有價的、沒 cookie 用預設 TW/HK；
  `?country=XX` 優先於 cookie、「只看我的收藏」不套用國家篩選）。
  頁面載入時 `HomeClient` 會把 localStorage 的設定同步寫進 cookie 一次，設定變了就
  `router.refresh()` 讓伺服器端重查（重整後伺服器端範圍與瀏覽器端一致，不會循環）。
  快取：可見範圍字串放進 `GamesPagePublicArgs`，是 `unstable_cache` key 的一部分，
  不同設定不會共用同一份快取；靜態 key 再 bump：`games-page-v3` → `games-page-v4`。
  預期驗證數字（上線後以 curl 帶 cookie 實測為準）：無 cookie → 4,891 款／第 1 / 272 頁；
  `ALL` cookie → 29,570 款／第 1 / 1643 頁；`?country=JP` 正常。
  限制：特價統計（has_sale、min_sale_end）仍是全部國家的（見 migration `20261119_add_price_country_list.sql` 的已知限制），卡片上的最低價／特價徽章／特價至只看可見國家。

## 未來規劃（目前不做，只記下來）
