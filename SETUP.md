# Switch 遊戲比價 — 設定與部署手冊（SETUP.md）

本文件是登入與排程組的設定手冊：Supabase 專案、Google / Discord 登入、
Vercel 環境變數、GitHub 部署、部署後回填回呼網址、每日更新排程。
前端與資料組的交接文件另見 `FRONTEND_NOTES.md`。

> **費用**：以下全部用免費方案即可。Supabase 免費版、Vercel Hobby 免費版、
> ExchangeRate-API 免 key 端點、任天堂價格 API 免 key。
> 短期不放廣告，Vercel Hobby 夠用；日後要放廣告再搬離 Hobby。

---

## 0. 架構總覽

```
GitHub repo ──▶ Vercel（Next.js 14，部署）
                     │
                     ├─ Supabase Auth（Google / Discord 登入）
                     ├─ Supabase Postgres（games / prices / fx_rates / 收藏 / 留言）
                     ├─ Vercel Cron 每天 4 次（UTC 18／19／21／22）
                     │       → GET /api/sync-catalog（帶 CRON_SECRET 標頭）
                     │         → 抓各區官方清單 → 新遊戲進目錄 → 新遊戲即時價
                     └─ Vercel Cron 每天 8 次（UTC 20／23／02／05／08／11／14／17）
                          → GET /api/refresh（帶 CRON_SECRET 標頭）
                            → 抓匯率 → 抓任天堂價格 API → 寫回 Supabase
```

---

## 1. 建立 Supabase 專案（免費版）

1. 到 https://supabase.com/dashboard 登入（沒有帳號先註冊），
   **New project** → 取名（例如 `switch-price-site`）→ 設一組資料庫密碼（妥善保管）→
   Region 選 **Northeast Asia (Tokyo)**（離台灣近）→ Create new project。
   免費版額度對這個站很夠用。
2. 等專案建立完成（約 1 分鐘），進 **Project Settings → API**，記下兩個值（第 4 節會用到）：
   - **Project URL**：`https://<你的專案>.supabase.co`
   - **anon public** key（瀏覽器用的公開 key）
   - **service_role** key（伺服器端專用，**絕對不要放進前端程式碼或公開倉庫**）
3. 進 **SQL Editor → New query**，把 `supabase/schema.sql` 整份貼上執行。
   執行成功會建立 `games / prices / fx_rates / collections / game_likes /
   comments / comment_likes / user_settings` 共 8 張表與 RLS 政策。
   可重複執行（CREATE 皆為 IF NOT EXISTS）。
   各區編號對照表 `game_region_ids` 是第 9 張表，另以 migration 執行
   （見 §8.9；不必與 schema.sql 同時跑）。

## 2. 匯入種子資料

```bash
cd ~/workspace/switch-price-site
cp .env.example .env.local   # 先填 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY
npm install
node scripts/seed.mjs        # 32 款遊戲、920 筆價格、匯率快照（僅 5 幣別）
```

> 種子腳本已修復，不會再洗掉 title ID：games upsert 不帶 `title_id` 欄位，
> 已有值的 title ID 一律保留（見 DATA_NOTES.md §3）。title ID 可隨時填寫，
> 不必等到最後一次跑種子之後。

## 3. 填任天堂 title ID（每日更新的關鍵）

種子檔沒有 title ID。先跑對照腳本（會重新抓任天堂公開清單比對）：

```bash
npm run map-title-ids   # 產出 data/title-ids.json
```

### 3.1 對照結果（2026-11-15 實測）

| 狀態 | 數量 | 說明 |
|---|---|---|
| 已對到 title ID | **28 / 32** | 來源：日本官網 XML 26 款、官方 eShop 商品頁 2 款 |
| 其中價格 API 驗證在售（onsale） | **25** | 每天可正常自動更新 |
| 已對到但價格 API 回 not_found | 3 | 瑪利歐賽車世界、咚奇剛 蕉力全開、雙人成行（見 3.3） |
| 未對到 | **4** | 健身環大冒險、寶可夢傳說 Z-A、黑帝斯 II、空洞騎士：絲之歌 |

**未對到的 4 款**：日本 XML 最新發售日約 2025-05-01（Switch 2 發售前），
香港 JSON 內容約停在 2022-06，兩份清單都沒有這些遊戲。
人工補法：打開該遊戲的官方 eShop 商品頁
`https://ec.nintendo.com/HK/zh/titles/<title_id>`，網址末段的數字就是 title ID，
補進 `scripts/map-title-ids.mjs` 的 `MANUAL_OVERRIDES` 再重跑腳本，
或直接用第 3.2 節的 SQL 寫入（並同步更新 `data/title-ids.json` 備查）。

### 3.2 把 title ID 寫進資料庫

在 Supabase **SQL Editor** 執行以下 SQL（由 `data/title-ids.json` 產生）：

```sql
update public.games set title_id = '70010000000026' where slug = 'botw';
update public.games set title_id = '70010000063713' where slug = 'totk';
update public.games set title_id = '70010000000186' where slug = 'mk8dx';
update public.games set title_id = '70010000012085' where slug = 'smash';
update public.games set title_id = '70010000027618' where slug = 'acnh';
update public.games set title_id = '70010000046394' where slug = 'splatoon3';
update public.games set title_id = '70010000053970' where slug = 'pokemon-sv';
update public.games set title_id = '70010000046404' where slug = 'kirby-fl';
update public.games set title_id = '70010000000828' where slug = 'mario-odyssey';
update public.games set title_id = '70010000068687' where slug = 'mario-wonder';
update public.games set title_id = '70010000001621' where slug = 'luigi3';
update public.games set title_id = '70010000007607' where slug = 'fire-emblem-3h';
update public.games set title_id = '70010000053335' where slug = 'xenoblade3';
update public.games set title_id = '70010000033130' where slug = 'hades';
update public.games set title_id = '70010000003209' where slug = 'hollow-knight';
update public.games set title_id = '70010000005423' where slug = 'stardew';
update public.games set title_id = '70010000010822' where slug = 'celeste';
update public.games set title_id = '70010000072053' where slug = 'balatro';
update public.games set title_id = '70010000060371' where slug = 'dave-diver';
update public.games set title_id = '70010000009922' where slug = 'undertale';
update public.games set title_id = '70010000013175' where slug = 'dead-cells';
update public.games set title_id = '70010000084607' where slug = 'mario-party-j';
update public.games set title_id = '70010000084617' where slug = 'zelda-eow';
update public.games set title_id = '70010000096812' where slug = 'dk-bananza';
update public.games set title_id = '70010000096808' where slug = 'mk-world';
update public.games set title_id = '70010000042356' where slug = 'persona5r';
update public.games set title_id = '70010000058127' where slug = 'octopath2';
update public.games set title_id = '70010000049280' where slug = 'it-takes-two';
```

> 對照來源細節（已實測驗證）：
> - 日本 XML 的 `<LinkURL>/titles/<id>` 就是 title ID，26 款皆以日本價格 API
>   驗證過在售；其中 15 款的日本原價與種子檔完全一致。
> - 香港 JSON **不能**用來拿 title ID：它的 `thumb_img` 檔名數字與
>   `store.nintendo.com.hk/<數字>` 連結，經價格 API 驗證一律回 `not_found`，
>   且內容約停在 2022-06。腳本只拿它做存在性輔助確認。
> - 日本特價搜尋 API `https://ec.nintendo.com/api/JP/ja/search/sales`
>   截至 2026-11-15 回 HTTP 404（任天堂換新版 eShop 後舊搜尋 API 已下線），
>   腳本會嘗試、失敗時只警告、不中斷。

### 3.3 已對到但價格 API 查不到的 3 款（更新時保留舊價）

| 遊戲 | title ID | 狀況 |
|---|---|---|
| 瑪利歐賽車世界 | 70010000096808 | 官方 eShop 商品頁 ID，價格 API 在 JP / US / GB 都回 `not_found` |
| 咚奇剛 蕉力全開 | 70010000096812 | 同上 |
| 雙人成行 | 70010000049280 | 日本 XML 的 ID，但價格 API 各國都回 `not_found`（可能已下架或 API 未收錄） |

推測：舊版價格 API（v1）未收錄 Switch 2 專用遊戲。每日更新遇到這類遊戲會
**保留舊價格、列在回報的 `price_not_found`，不會讓整個更新失敗**。
等任天堂開放 Switch 2 遊戲的價格查詢（或找到新端點）再補。
這 3 款的種子價本身是正確的（例如瑪利歐賽車世界 JP 8980 / US 79.99），
站上先顯示種子價即可。

### 3.4 種子檔日本價與官方原價有出入的 5 款（已採用原版 title ID）

| 遊戲 | 種子檔 JP 原價 | 目前官方原價 | 可能原因 |
|---|---|---|---|
| 薩爾達傳說 曠野之息 | 8678 | 7678 | 種子價 = Switch 2 Edition 版定價 |
| 薩爾達傳說 王國之淚 | 8900 | 7900 | 種子價疑似誤差或他版定價 |
| 星之卡比 探索發現 | 8500 | 6500 | 同上 |
| Fire Emblem 風花雪月 | 7920 | 7678 | 種子價疑似誤植（7920 是大亂鬥的價錢） |
| 超級瑪利歐派對 空前盛會 | 9100 | 7100 | 種子價 = Switch 2 Edition 版定價 |

更新路由一律採用**原版** title ID（遊戲 platform 欄位是 Switch），
第一次更新後這 5 款的日本價會變成官方原價，屬於修正、不是錯誤。

## 4. 開 Supabase Auth 的 Google 與 Discord 登入

Supabase 後台 → **Authentication → Providers**，分別開啟 Google 與 Discord。
**Secret 絕對不要寫進程式碼**，只填在 Supabase 後台。

### 4.1 Google

- **Client ID**（已沿用現有 OAuth 應用程式）：
  `45382030579-k1lree73oo0aerjaso7qttogjmbr0d81.apps.googleusercontent.com`
- **Client Secret** 去哪拿：
  Google Cloud Console（https://console.cloud.google.com/）→
  專案 **switchgameinfo** → APIs & Services → Credentials →
  找到「Switch 遊戲比價」那組 OAuth 2.0 Client ID → 點開看 **Client secret**。
  若忘記當初的值，按 **新增用戶端密鑰** 產生一組新的（舊的之後再停用）。
  注意：Google 的新 Secret 在 2026-11-15 21:29 已重新產生過，
  請確認填的是最新、狀態為啟用的那組。
- 在 Supabase 的 Google provider 貼上 Client ID 與 Client Secret → 開啟（Enabled）。
- 權限範圍：Supabase 預設只要求 `openid email profile`，符合「登入只用來做收藏，
  不收集其他資料」的承諾。

### 4.2 Discord

- **Client ID**（已沿用現有 OAuth 應用程式）：`1571479619671031889`
- **Client Secret** 去哪拿：
  Discord Developer Portal（https://discord.com/developers/applications）→
  應用程式「Switch 遊戲比價」→ **OAuth2** → **Client Secret**。
  Secret 只會在產生當下顯示一次，關掉頁面就看不到；
  若遺失，按 **Reset Secret** 重新產生一組，立刻複製下來貼進 Supabase。
  注意：2026-11-15 23:24 已完成過一次 Discord OAuth 連接設定，
  若之後在 Supabase 填的 Secret 與 Discord 後台現有的不一致，
  登入時會出現 `invalid_client`，請直接從 Discord 後台複製現有的 Secret 重填。
- 在 Supabase 的 Discord provider 貼上 Client ID 與 Client Secret → 開啟。
- 權限範圍：Supabase 預設只要求 `identify email`，符合不收集其他資料的承諾。

### 4.3 登入流程（程式面已完成）

- 登入頁 `app/login/page.tsx` 的按鈕呼叫
  `supabase.auth.signInWithOAuth({ provider: 'google' | 'discord' })`，
  回跳網址是 `{網站 origin}/auth/callback`。
- `app/auth/callback/route.ts` 用授權碼交換 session，成功後導回首頁或 `?next=` 指定的站內頁。
- `middleware.ts` 每個請求都刷新 session；未登入也能看公開頁面，
  收藏／讚／留言的 API 會回 401，前端再導向 `/login`。
- 登入只向 Google / Discord 確認身分，不存信箱內容、好友名單或伺服器資料
  （登入頁已有此聲明）。

## 5. Vercel 環境變數

Vercel 後台 → Project → **Settings → Environment Variables**，全部填好再部署。
（`.env.example` 只有變數名、沒有真實值，可對照。）

| 變數 | 值 | 備註 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<你的專案>.supabase.co` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key | 同上（公開 key，可進瀏覽器） |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **伺服器端專用**，只給每日更新用；絕對不要放進前端 |
| `NEXT_PUBLIC_SITE_URL` | `https://<你的 Vercel 網域>` | 登入回呼網址由此組合；本機開發用 `http://localhost:3000` |
| `CRON_SECRET` | 自訂一串夠長的隨機字串 | 每日更新的共用密鑰（見第 7 節） |

## 6. 從 GitHub 部署

1. 在 GitHub 新建一個 repo（例如 `switch-price-site`），把專案推上去：
   ```bash
   git init && git add . && git commit -m "Switch 遊戲比價：Vercel + Supabase 重建版"
   git remote add origin https://github.com/<你的帳號>/switch-price-site.git
   git push -u origin main
   ```
   推之前先確認 `.gitignore` 有擋 `.env.local`（專案已有）。
2. Vercel 後台 → **Add New → Project** → Import 這個 GitHub repo →
   Framework Preset 選 **Next.js**（預設即可）→
   先在 Environment Variables 填好第 5 節的 5 個變數 → **Deploy**。
3. 部署完成會拿到公開網址，例如 `https://shawn-game-studio.vercel.app`（舊網域 `https://switch-price-site.vercel.app` 也還能用）。
   先打開首頁確認能顯示遊戲清單（Supabase 種子資料已匯入的話）。

## 7. 部署後：把回呼網址填回三個後台（缺一不可）

拿到 Vercel 公開網址後，把回呼網址
`https://<你的網址>/auth/callback`（把 `<你的網址>` 換成實際網域，不含結尾斜線）
填回以下三處。填錯或漏填會導致登入後跳轉失敗。

| 後台 | 位置 | 填什麼 |
|---|---|---|
| **Google Cloud Console** | 專案 switchgameinfo → APIs & Services → Credentials → 「Switch 遊戲比價」OAuth 用戶端 → **已授權的重新導向 URI** | 新增 `https://<你的網址>/auth/callback` |
| **Discord Developer Portal** | 應用程式「Switch 遊戲比價」→ **OAuth2 → Redirects** | 新增 `https://<你的網址>/auth/callback`，按 Save Changes |
| **Supabase 後台** | Authentication → **URL Configuration** → **Site URL** 與 **Redirect URLs** | Site URL 填 `https://<你的網址>`；Redirect URLs 加一筆 `https://<你的網址>/auth/callback`（本機開發時可另加 `http://localhost:3000/auth/callback`） |

> 注意：Supabase Auth 的回呼網址實際上是由 Supabase 轉發到 Google / Discord，
> 所以三邊都要是同一個網址，缺一邊就會在登入流程的某一步被擋下
> （例如 Google 報 `redirect_uri_mismatch`、Discord 報「無效的 OAuth2 redirect_uri」）。

## 8. 全自動更新排程（目錄同步＋價格更新）

> 2026-11-16 改版：舊「一支每日 cron＋400 款切片」已由工作量切片＋
> 多支 cron 取代（見 `DATA_NOTES.md` §12.5）。本節是新版說明。

### 8.1 Vercel Cron（預設，已設定好）

`vercel.json` 已設定 12 支 cron（Hobby 上限 100 支內）：

| 路徑 | 排程（UTC） | 台北時間 | 用途 |
|---|---|---|---|
| `/api/sync-catalog` | `0 18 * * *` | 02:00 | 目錄同步（推進分頁窗口） |
| `/api/sync-catalog` | `0 19 * * *` | 03:00 | 目錄同步 |
| `/api/refresh` | `0 20 * * *` | 04:00 | 價格更新（slot 1） |
| `/api/sync-catalog` | `0 21 * * *` | 05:00 | 目錄同步 |
| `/api/sync-catalog` | `0 22 * * *` | 06:00 | 目錄同步 |
| `/api/refresh` | `0 23 * * *` | 07:00 | 價格更新（slot 2） |
| `/api/refresh` | `0 2 * * *` | 10:00 | 價格更新（slot 3） |
| `/api/refresh` | `0 5 * * *` | 13:00 | 價格更新（slot 4） |
| `/api/refresh` | `0 8 * * *` | 16:00 | 價格更新（slot 5） |
| `/api/refresh` | `0 11 * * *` | 19:00 | 價格更新（slot 6） |
| `/api/refresh` | `0 14 * * *` | 22:00 | 價格更新（slot 7） |
| `/api/refresh` | `0 17 * * *` | 01:00 | 價格更新（slot 0） |

Vercel Cron 在環境變數有設定 `CRON_SECRET` 時，
會自動帶 `Authorization: Bearer <CRON_SECRET>` 來打路由，
路由收到後會驗證，不符回 401。

**Hobby 方案的 cron 限制（已查官方文件，2026-11-16）**：
來源：Vercel 官方文件〈Usage & Pricing for Cron Jobs〉
（https://vercel.com/docs/cron-jobs/usage-and-pricing，最後更新 2026-07-15）

|  | 每專案 cron 數量 | 最低頻率 | 時間精度 |
|---|---|---|---|
| **Hobby** | **100 支** | **每天一次** | 每小時內（±59 分鐘） |
| Pro / Enterprise | 100 支 | 每分鐘一次 | 每分鐘 |

- 每支 cron 每天最多跑一次；寫了每小時或更密的排程會在部署時直接失敗
  （`Hobby accounts are limited to daily cron jobs`）。
- 排 00:00 UTC 的 cron 實際會在 00:00–00:59 UTC 之間的任意時間觸發，
  也就是台北 08:00–08:59，**不是準點 08:00**；匯率快照仍以台北日期為
  `date_key`，不受這 ±59 分鐘影響。
- Cron Jobs 是 Vercel 的 legacy 功能，日後會遷移到 Schedules；目前
  `vercel.json` 的寫法仍有效，遷移時再跟著官方指引改。
- 數量上限是 100 支，不是舊文件寫的 2 支（Vercel 在 2026-01-20
  已把各方案上限統一為每專案 100 支）。本專案用 12 支，遠低於上限。

### 8.2 為什麼是多支 cron＋時段輪轉，而不是一支 cron

舊設計是一支每日 cron＋依台北日期輪轉（10,051 款 26 天一輪），
放大到 30,000 款會變 75 天——太慢。改法（`DATA_NOTES.md` §12.5）：

1. **每天跑 8 次價格更新**（每 3 小時一支 cron）：每支仍受 60 秒上限，
   但一天 8 次執行機會，一輪從 75 天縮到約 4 天（30,000 款情境）。
2. **時段輪轉不會重複做白工**：輪轉鍵從「台北日期」改為
   「絕對日數 × 每天次數 ＋ 台北時段」，每次執行跑不同片；
   連續 `slices` 次執行恰好每片一次。抖動 ±59 分鐘不會跨時段
   （cron 時刻選在時段中間，見 8.1 的時刻與 8.4）。
3. **目錄同步獨立成 4 支 cron**：與價格更新分開跑，互不搶 60 秒預算；
   每次推進一個分頁窗口（`sync_state` 游標），4 支加起來約 1 天跑完一輪。
4. 匯率與價格分開跑仍沒幫助：匯率抓取約 1 秒，瓶頸全在價格 API。

### 8.3 實測耗時與切片大小（2026-11-16 實測）

實測方法：直接打任天堂官方價格 API
`api.ec.nintendo.com/v1/price`，每國 50 個 ID 一批、國家並行度 4、
20 秒逾時，與 `lib/nintendo.ts` 的邏輯一致；ID 來自 `data/title-ids.json`
的 28 個與日本 XML（`switch.xml`，10,045 筆）的前 300／500 個。

| 測試 | 規模 | 請求數 | 總耗時 | 單請求延遲 |
|---|---|---|---|---|
| A（現況目錄） | 28 款 × 35 國 | 35 | **4.3 秒** | p50 312ms、p90 542ms、max 919ms |
| B | 300 款 × 35 國 | 210 | **16.8 秒** | p50 261ms、p90 350ms、max 731ms |
| C | 500 款 × 10 國 | 100 | **9.8 秒** | p50 266ms、p90 404ms、max 541ms |

三組測試 0 錯誤、0 重試。換算壁鐘速率約 **1.6 毫秒／（款 × 國）**
（並行度 4 下），據此推算全量一次的耗時（只算抓價，不含寫庫）：

| 遊戲總數 | 全量 35 國抓價耗時 | 60 秒內跑得完？ |
|---|---|---|
| 1,000 款 | 約 56 秒 | 幾乎不可能（還沒算匯率與寫庫） |
| 2,000 款 | 約 112 秒 | 否 |
| 3,000 款 | 約 168 秒 | 否 |
| 5,000 款 | 約 280 秒 | 否 |
| 10,045 款（日本 XML 全數） | 約 562 秒（9.4 分鐘） | 否 |

**切片大小定為每片約 12,000 個（遊戲、國家）對**（預設值，見 8.5 如何調）：
12,000 對 ≈ 240 次價格 API 呼叫 ≈ 18–25 秒抓價，留約 35 秒給匯率（約 1 秒）、
寫庫與重試，在 60 秒上限內有餘裕。對數來源是 `games.price_countries`
（sync-catalog 維護、migration 回填；欄位未建時以 35 計＝舊行為）。
寫庫量也隨片固定（每片最多約 12,000 筆 prices upsert，分 200 筆一批、
4 批並行寫入，約 5–8 秒）。

完整跑完一輪的天數（每片 12,000 對、每天 8 次）：

| 情境 | 總對數 | 片數 | 完整一輪 |
|---|---|---|---|
| 現況 10,051 款（幾乎全 JP-only） | 約 10,900 | 1 片 | **1 天**（8 次都跑同一片＝每天全量更新） |
| 30,000 款：1 萬款 32 國＋2 萬款 JP-only | 約 340,000 | 29 片 | 約 **4 天** |
| 30,000 款：全部 32 國全覆蓋 | 960,000 | 80 片 | 10 天 |
| 30,000 款：對照表未建（全 JP-only） | 30,000 | 3 片 | 不到 1 天（但只有 JP 價） |

注意：每款遊戲的價格最久約「一輪天數」才更新一次（例如 30,000 款情境最久
約 4 天），特價結束時間與歷史低價也一樣。匯率不受影響，每次執行都更新。
新遊戲進目錄當天就有即時價（商店前端價＋價格 API，見 8.10），不用等輪轉。

### 8.4 切片與輪轉邏輯

- **切分**：全部遊戲按 `slug` 排序（決定性），依累積對數切成每片約
  `pair_budget` 對；`slices = 切出來的片數`。單款遊戲對數超過預算時
  自成一片（不會被拆開）。沒 title ID 的遊戲也佔片內位置
  （只跳過抓價、列在 `pending_no_title_id`，不影響切分穩定性）。
- **輪轉（預設，不帶切片參數時）**：當天跑第幾片由**台北時段**決定，
  `slot = floor(台北小時 / (24 / runsPerDay))`（預設 8 次／天＝每 3 小時），
  `slice = (絕對日數 × runsPerDay + slot) % slices`。
  連續 `slices` 次執行恰好每片跑一次，再回到起點。
  抖動 ±59 分鐘不會跨時段（cron 時刻選在時段中間，見 8.1）。
- **匯率**：每次執行都更新（便宜，約 1 秒），與切片無關。
- **歷史低價**：只針對本次切片的遊戲計算與更新，不做全表重算。
- **遊戲總數變動**：`slices` 每天重算，新增遊戲可能移動切片邊界；
  每款遊戲仍約每 `slices` 次執行被更新一次。不要在中途頻繁改 `pair_budget`，
  否則邊界會跟著亂跳。
- **時間預算**：抓價階段有 45 秒軟預算，超過就不再開新國家、記進
  `errors` 後收尾（已抓到的價格照常寫入，下次輪到本片時再補）。
  價格 API 單一 chunk 失敗會在 `lib/nintendo.ts` 內重試
  （429／5xx／逾時，指數退避 500ms→1000ms，最多 3 次嘗試，429 的
  `Retry-After` 優先但上限 5 秒）；重試後仍失敗的國家只記進 `errors`，
  不中斷其他國家。
- **查價編號**：每國用 `game_region_ids` 編號；**只有 JP** 沒有對照編號時
  用 `games.title_id` 當 fallback，其他國家沒編號直接跳過（不發註定
  `not_found` 的請求）。對照表未建時 JP 照常、其他國家跳過。

### 8.5 參數

| 參數 | 說明 | 範例 |
|---|---|---|
| （無參數） | 輪轉模式：依台北時段自動選片，匯率每次都更新 | `/api/refresh` |
| `?slice=i&slices=n` | 明確指定第 `i` 片（0-based，共 `n` 片）；`slices` 只用來驗證 `slice` 範圍，實際片數一律以當下對數與 `pair_budget` 推算，省略亦可 | `/api/refresh?slice=2&slices=8` |
| `?offset=&limit=` | 明確指定範圍（按 slug 排序後的位置） | `/api/refresh?offset=800&limit=400` |
| `?pair_budget=` | 每片（遊戲、國家）對數上限，夾在 1000～50000，預設 12000；也可改環境變數 `REFRESH_PAIR_BUDGET`（query 優先） | `/api/refresh?pair_budget=8000` |
| `?runs_per_day=` | 每天跑幾次（輪轉用），預設 8；也可改環境變數 `REFRESH_RUNS_PER_DAY` | `/api/refresh?runs_per_day=4` |
| `?countries=` | 只更新指定國家，可與切片參數併用 | `/api/refresh?slice=0&countries=JP,US,TW` |

參數錯誤回 400（例如 `slice` 超出 `0～slices-1`、`offset < 0`、
`limit < 1`）。無參數且遊戲總數 ≤ 一片時，行為與舊版全量更新一致。
`?slice_size=` 已退役（款數切片改為對數切片；explicit-offset 模式仍可用
它當 `limit` 省略時的預設值）。

**調切片大小**：先看回傳的 `duration_ms`。若長期低於 30 秒，可把
`pair_budget` 調大（例如 16000，完整一輪天數跟著減少）；若常接近
60 秒或出現 `countries_skipped_for_budget`，調小（例如 8000）。
改法：Vercel 後台加環境變數 `REFRESH_PAIR_BUDGET` 後重新部署，
或每次呼叫帶 `?pair_budget=`。改大後 `slices` 變少、完整一輪變短；
改小反之。**不要在輪轉中途頻繁改動**，改完後的第一輪邊界會重排一次。

### 8.6 手動測試與加快完整一輪的方法

```bash
# 未帶密鑰 → 401
curl https://<你的網址>/api/refresh
# 帶密鑰 → 輪轉模式（依今天台北時段選片），回傳含 slice 資訊的摘要
curl https://<你的網址>/api/refresh -H "Authorization: Bearer <CRON_SECRET>"
# 明確跑第 2 片（共 8 片）
curl "https://<你的網址>/api/refresh?slice=2&slices=8" -H "Authorization: Bearer <CRON_SECRET>"
# 明確跑 offset 範圍
curl "https://<你的網址>/api/refresh?offset=800&limit=400" -H "Authorization: Bearer <CRON_SECRET>"
# 只更新指定國家（可與切片併用）
curl "https://<你的網址>/api/refresh?countries=JP,US,TW" -H "Authorization: Bearer <CRON_SECRET>"
# 目錄同步試算（只比對、不寫庫）
curl "https://<你的網址>/api/sync-catalog?dry_run=1" -H "Authorization: Bearer <CRON_SECRET>"
```

**想加快完整一輪**：排程已是每天 8 次（8.1），30,000 款情境約 4 天一輪；
若還想更快，用外部免費排程（cron-job.org、GitHub Actions schedule、NAS 的 cron）
在兩支 cron 之間多打幾次明確的切片，例如 09:00 打 `?slice=0`、15:00 打 `?slice=1`，
每次都要帶 `Authorization: Bearer <CRON_SECRET>`。
同一天打同一片是安全的（冪等 upsert），只是浪費一次執行。
也可以在 `vercel.json` 再加一支每日 cron（Hobby 數量上限 100 支，見 8.1），
但 path 必須寫死明確切片（例如 `"/api/refresh?slice=1&slices=8"`），
且遊戲總數變動導致 `slices` 改變時要記得同步改，否則會漏片或重複；
一般情況建議用外部排程，不要動 `vercel.json`。

**切片數學驗算**（不連庫、不連網）：

```bash
node scripts/verify-refresh-slices.mjs
```

驗算內容：多種總數 × 多種片大小下切片覆蓋全部遊戲、無重疊無遺漏；
連續 `slices` 天輪轉每片恰一次、隔天回到起點；
`cycle_complete_date` 那天是本輪最後一片、隔天回第 0 片；
`nextSlice`／`clampSliceSize` 邊界。

### 8.7 更新流程與回報

1. 抓 ExchangeRate-API 匯率（免 key 端點 `open.er-api.com`，備援 `api.exchangerate-api.com`），
   換算成「1 外幣 = 多少台幣」，以**台北日期**為 `date_key` 寫進 `fx_rates`。
   匯率抓不到 → 回 503，價格完全不動（沒有匯率無法正確換算台幣價）。
2. 用官方價格 API（`api.ec.nintendo.com/v1/price`）逐國更新**本次切片**
   的價格與特價結束時間，寫進 `prices`（`updated_at` 為本次執行時間），
   並更新本次切片遊戲的 `games.historical_low_twd`
   （只會往下降，不會往上調）。
3. 回傳 JSON 摘要：`mode`（`rotation`／`explicit-slice`／`explicit-offset`）、
   `slice`、`slices`、`pair_budget`、`pairs_total`、`pairs_in_slice`、
   `runs_per_day`、`slot`、`cycle_days`、`total_games`、`games_in_slice`、
   `next_slice`、`cycle_complete_date`（本輪完整跑完的台北日期）、
   `prices_updated`、`games_with_new_low`、
   `pending_no_title_id`（本片沒 title ID 的遊戲，保留舊價）、
   `price_not_found`（價格 API 查不到的遊戲／國家，保留舊價）、
   `countries_skipped_for_budget`、`errors`、`duration_ms`。
   單一國家失敗不會中斷整個更新。

### 8.8 執行時間

`maxDuration = 60`（Vercel Hobby 上限）。現況 28 款有 title ID 的遊戲 ×
35 國實測抓價 4.3 秒；目錄擴大後靠工作量切片＋輪轉控制在 60 秒內，
每片約 12,000 對抓價約 18–25 秒、寫庫約 5–8 秒。若日後超時，先調小
`pair_budget`（見 8.5），或升級 Vercel 方案調高上限。

### 8.9 各區編號對照表：建表與灌入（來源調查組編號到貨後依序執行）

對照表解決「NSUID 是分區的」問題（見 DATA_NOTES.md §11）：`games.title_id`
只有日本編號，各國專屬編號存在新表 `game_region_ids`（一款遊戲 × 一國 =
一列）。每日更新路由已改為按國家用對照編號查價（只有 JP 沒有對照編號時
用 `games.title_id` fallback，其他國家沒編號直接跳過）；部署新路由不必等
建表——migration 未跑時 JP 照常、其他國家跳過，不會失敗。

```bash
cd ~/workspace/switch-price-site
set -a; source .env.local; set +a   # 需 NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
```

**步驟 1——建表（只需一次；可重複執行）：**
Supabase Dashboard → SQL Editor，依序貼上以下三個 migration 全文執行：

1. `supabase/migrations/20261116_game_region_ids.sql`：
   `game_region_ids` 表（`game_id` FK `games` on delete cascade、
   `country`、`title_id`、`source`；`unique(game_id, country)`；
   索引 `game_id` 與 `(country, title_id)`）＋ RLS（公開可讀、無寫入 policy，
   寫入只走 Service Role Key）。
2. `supabase/migrations/20261117_catalog_sync_state.sql`：`sync_state` 表
   （目錄同步的分頁游標，見 8.10）。
3. `supabase/migrations/20261117_game_price_countries.sql`：
   `games.price_countries` 欄位＋一次性回填（供價格更新工作量切片用）。

**步驟 2——灌對照表（可重複執行；新編號檔到貨後重跑即可）：**

```bash
node scripts/seed-region-ids.mjs
# 指定其他對照檔：node scripts/seed-region-ids.mjs data/tw-hk-title-ids.json
# 來源修正了錯誤編號、要以新檔覆蓋舊值時：node scripts/seed-region-ids.mjs --force
```

- 預設讀 `data/region-title-ids.json`；無此檔時依序改讀
  `data/tw-hk-full-ids.json`、`data/tw-hk-title-ids.json`（舊台港格式也吃）。
  **台港對照檔已產出**（`data/tw-hk-full-ids.json`，29,237 筆：具名 2,347、
  未具名 26,890；見 DATA_NOTES.md §12.7）：具名筆按標題對進既有遊戲寫入；
  未具名筆無 join key、不寫入（建檔規則待主代理決定，見 REPORT.md）。
- 預期輸出：`寫入 N 列，已有相同值跳過 M 列，值衝突保留現有 K 列，
  對不到遊戲跳過 X 款`。重跑一次應為寫入 0 列。
- 注意：預設「已有值保留」——新檔與現有值不同時會印出衝突、保留現有值，
  不會靜默覆蓋；對不到 `games` 的條目（多半是台灣清單獨有、目錄還沒有的
  遊戲）不會新建遊戲，請先跑 `seed-expanded.mjs` 匯入目錄再重跑本腳本。

**步驟 3——抓各區價、合併進目錄（可選；不等每日更新、想先看到多國價時）：**

```bash
node scripts/fetch-region-prices.mjs [--countries=US,GB,DE,FR,AU,CA]
# 產出 data/region-prices-patch.json（不寫庫、不改目錄）
node scripts/merge-region-prices.mjs
# 只補目錄缺口（已有價不覆蓋）；合併前備份原檔到 data/.backup/
node scripts/seed-expanded.mjs
# 把合併後的目錄灌進 Supabase（既有流程；見 DATA_NOTES.md §10.3）
```

- 若不跑步驟 3 也沒關係：對照編號進庫後，每日更新會在輪轉到該片時
  自動用對照編號刷新各國價（完整一輪 30,000 款情境約 4 天，見 8.3）。
- 寫庫量注意：對照表補齊後，每片實際寫入最多約 12,000 筆 prices upsert
  （200 筆一批、4 批並行，估算 5～8 秒）；部署後先看回傳的 `duration_ms`
  與 `region_ids_used`（各國用了幾個對照編號、幾個 fallback），若常接近
  60 秒，先把 `pair_budget` 調小到 8000（見 8.5）。

**驗證（不連庫、不連網）：**

```bash
node scripts/verify-region-ids.mjs
# 驗算：編號選取（region／fallback／none、撞號先勝）、兩種對照檔格式解析、
# merge 邏輯（只補缺口、冪等、備份、cheapest 重算）；2026-11-16 為 29 項全通過
```

**部署後驗一次**：帶 `CRON_SECRET` 打一次 `/api/refresh`，對照回傳的
`region_ids_used.table`（應為 `"ok"`）、`region_ids_used.by_country`
（有編號的國家 `region` 數應 > 0）、`prices_updated`（應比只有 JP 時明顯
變多）、`duration_ms`。若 `table` 是 `"missing"`，表示 migration 還沒跑
（路由會 JP 照常、其他國家跳過，不會失敗）；若某國 `region` 為 0 而
`skipped` 很多，表示該國編號還沒灌進對照表。

### 8.10 目錄同步（`/api/sync-catalog`，每天 4 次）

新遊戲自動進目錄，不用手動跑種子。流程見 `DATA_NOTES.md` §12.1，
程式見 `lib/catalog-sync.ts`／`lib/catalog-sources.ts`。

| 項目 | 說明 |
|---|---|
| 觸發 | `vercel.json` 4 支 cron：UTC 18、19、21、22（台北 02、03、05、06） |
| 來源 | JP 搜尋 API、NA Algolia、EU Solr、AU Algolia、TW／HK 清單、KR 清單（並行；單一來源失敗只記、不中斷） |
| 游標 | `sync_state` 表（migration `20261117_catalog_sync_state.sql`）：分頁來源從上次停的單位繼續抓（NA／AU 的單位是切片／標題批次，不是頁）；跑完一輪歸零、記 `last_full_pass_date`。表未建時每次從第 0 單位重抓（新遊戲仍會被發現，只是完整一輪跑不完） |
| 一輪 | NA 人氣帶 18 切片＋逐款標題查詢、EU 21 頁、JP 約 300 頁、AU 年份 14 切片；每天 4 輪，EU／JP／AU 約 1 天跑完（JP 是瓶頸），NA 逐款完整一輪約 25–37 天 |
| 寫入 | 冪等 upsert：games（by slug）、title_id／封面只在為空時回填、game_region_ids（by game_id,country）；重跑同一窗口＝0 寫入 |
| 新遊戲即時價 | 商店前端價（JP 搜尋 API／NA Algolia，已驗證）先寫入，價格 API 查到同一國價時覆蓋（價格 API 為準）；EU Solr 參考價只做交叉驗證、永不寫入；上限 100 款／次；全程 50 秒軟預算，超過跳過價格階段（目錄已寫入，下次輪轉補價） |
| 參數 | `?sources=jp-search,tw-list`（只跑指定來源）、`?pages=20`（分頁來源每支本次最多抓幾頁）、`?dry_run=1`（只比對、不寫庫）、`?skip_prices=1`（只寫目錄、不同步查價） |
| 回報 | `games_inserted`、`title_id_filled`、`cover_filled`、`region_ids_upserted`、`price_countries_updated`、`new_game_prices`、`storefront_prices`（商店前端價清單）、`storefront_prices_written`、`reference_price_mismatches`（Solr 與價格 API 不一致時記錄）、`sync_cursors`（各分頁來源本次窗口）、`needs_review`、`conflicts`、`errors`、`duration_ms` |

**台港韓掃描（GitHub Actions，每週一次，不是 Vercel cron）**：台港韓沒有
遊戲清單公開來源，只能用價格 API 全區間掃描編號；全量重掃約 11,600 批、
25 分鐘，Vercel 免費版單次函式跑不完（60 秒上限、12 支 cron 已用滿），
所以搬到 GitHub Actions（repo 公開、Actions 免費）：
`.github/workflows/weekly-tw-hk-kr-scan.yml`，每週日 02:00 UTC 自動跑
（也可到 Actions 頁手動觸發）。流程：收割每週新作文章（命名來源，失敗
不中斷）→ 掃描 TW／HK／KR 主區間＋台港 ext1 新號段 → 合併成
`data/tw-hk-full-ids.json` → `seed-region-ids.mjs`（具名筆補對照表）→
`seed-unnamed-games.mjs`（未具名筆建佔位遊戲、具名筆建檔／改名／合併）。
每次執行獨立、無跨次快取，從頭全掃約 40–60 分鐘。ext2（7007，Switch 2
版／升級包）與 ext3（7005，DLC）區間不列入每週排程（未具名筆會被匯入
腳本跳過，見 DATA_NOTES.md §12.8）；有需要時本機手動跑。
每日前沿掃描約 40 批（10 秒）；掃描上限（目前 `70010000150000`）
每季檢查上調。見 `DATA_NOTES.md` §12.7。

**GitHub Secrets 設定（只需一次）**：repo → Settings → Secrets and
variables → Actions → New repository secret，新增兩個：
`SUPABASE_SERVICE_ROLE_KEY`（從**家裡電腦**的 `.env.local` 複製整串貼上；
**絕對不要在學校／共用電腦上貼這把 key**，它繞過 RLS、權限最高）與
`NEXT_PUBLIC_SUPABASE_URL`（`https://gplklnhsplydxmyepbzx.supabase.co`）。
工作流程絕不會把這兩個值印到 log 裡。失敗時 GitHub 會寄信通知 repo 擁有者，
到 Actions 頁看是哪一步失敗（掃描被任天堂限流時重跑一次即可，見工作流程
檔頭的風險說明）。

**手動跑（本機，與 Actions 流程相同）**：

```bash
node scripts/scan-tw-hk-price-api.mjs --country TW
node scripts/scan-tw-hk-price-api.mjs --country HK
node scripts/scan-tw-hk-price-api.mjs --country KR
node scripts/merge-scan-into-full-ids.mjs
$env:NEXT_PUBLIC_SUPABASE_URL="https://gplklnhsplydxmyepbzx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="(整串從 .env.local 複製)"
node scripts/seed-region-ids.mjs data/tw-hk-full-ids.json
node scripts/seed-unnamed-games.mjs
# 只看計畫不寫庫：node scripts/seed-unnamed-games.mjs --dry-run
```

**未具名商品匯入前置**：先在 Supabase SQL Editor 跑一次
`supabase/migrations/20261118_unnamed_games.sql`（`games.is_unnamed` 欄位＋
檢視重建；沒跑時匯入腳本寫入會報 42703 失敗）。未具名商品以
`tw-<nsuid>`／`hk-<nsuid>`／`kr-<nsuid>` 建檔、但不出現在首頁遊戲牆／
搜尋結果與接近歷史低價；命名來源找到標題時，匯入腳本會把佔位遊戲改名
或併入具名遊戲。規則見 `DATA_NOTES.md` §12.8。

**驗算（不連庫、不連網）：**

```bash
node scripts/verify-catalog-sync.mjs
# 驗算：標題正規化、JP XML／台港 RSC 解析、四來源解析器（NA／EU／JP／AU）、
# 規劃器（新遊戲／回填／碰撞守衛／DLC 跳過／冪等）、商店前端價格
# （NA eshopDetails／JP dprice／sprice／EU 參考價）；2026-11-16 為 43 項全通過
```

## 9. API 一覽（登入組實作）

| 路由 | 方法 | 說明 |
|---|---|---|
| `/auth/callback` | GET | OAuth 回呼：授權碼交換 session，成功導回首頁或 `?next=` |
| `/api/collections` | POST `{ gameId }` | 切換收藏 → `{ collected: boolean }` |
| `/api/likes` | POST `{ gameId }` | 切換遊戲讚 → `{ liked: boolean, count: number }` |
| `/api/comments` | POST `{ gameId, body }` | 新增留言（最多 1000 字）→ 留言物件 |
| `/api/comments/[id]/like` | POST | 切換留言讚 → `{ liked: boolean, count: number }` |
| `/api/refresh` | GET / POST | 每日更新（需 `Authorization: Bearer $CRON_SECRET`） |

- 前四支都要登入：未登入回 **401**，前端會導向 `/login`。
- `gameId` 接受 `games.id`（uuid 字串）或 `slug`。前端型別已統一為字串，
  種子檔的數字 id（1..32）沒有寫進資料庫，傳數字會回 404。
- 寫入走登入使用者的 session（anon key + RLS），只有自己的收藏／讚／留言能寫；
  每日更新走 Service Role Key（繞過 RLS）。

## 10. 已知缺口與限制

1. **title ID 缺 4 款**（健身環大冒險、寶可夢傳說 Z-A、黑帝斯 II、空洞騎士：絲之歌），
   見 3.1。補法已寫在 3.1，補完後重跑對照腳本並用 SQL 寫入。
2. **Switch 2 遊戲價格 API 查不到**（瑪利歐賽車世界、咚奇剛 蕉力全開），
   加上雙人成行共 3 款只能顯示種子價、無法自動更新，見 3.3。
3. **種子檔日本價 5 款與官方原價不同**（疑似 Switch 2 Edition 版定價或誤植），
   第一次更新後會修正為官方原價，見 3.4。
4. **日本特價搜尋 API 已下線**（回 404），對照腳本已改以日本 XML 為主要來源，
   不影響每日更新（更新用的是價格 API，不是搜尋 API）。
5. **香港 JSON 內容停在約 2022-06**，且其編號不是 title ID，不可採用（已實測驗證）。
6. **Vercel Hobby 限制**：每專案最多 100 支 cron、每支每天最多跑一次、
   時間精度為每小時內（±59 分鐘）、serverless 執行 60 秒上限。
   本專案只用一支每日 cron＋輪轉（見 §8.1–8.2），目前規模夠用；
   日後遊戲大增時靠切片輪轉，不用加 cron。
7. **匯率來源**：ExchangeRate-API 免 key 端點；若該服務故障，
   更新會回 503 且價格不動，隔天重試即可（不會寫錯價格）。
8. **Supabase 免費版限制**：專案閒置 7 天會暫停，需手動恢復；
   若日後流量變大再考慮升級。
9. **登入 Secret 不在程式碼裡**：Google / Discord 的 Secret 只存在各家後台與
   Supabase 後台；若遺失請依第 4 節從原後台重新產生或複製，不要在對話或程式碼裡貼上。

## 11. 登入組交付檔案清單

| 檔案 | 說明 |
|---|---|
| `middleware.ts` | Supabase session 刷新中介層（標準 @supabase/ssr 寫法） |
| `lib/auth.ts` | 取目前使用者、解析 gameId（uuid / slug）的 helper |
| `lib/supabase-admin.ts` | Service Role client（每日更新專用，伺服器端限定） |
| `lib/nintendo.ts` | 任天堂價格 API（429／5xx 指數退避重試）、匯率、台北日期 helper |
| `lib/refresh-slices.ts` | 切片與輪轉純函式（slice／slices／dayOfYear／完整輪日期） |
| `app/auth/callback/route.ts` | OAuth 回呼：授權碼交換 session，導回首頁 |
| `app/api/collections/route.ts` | 切換收藏 |
| `app/api/likes/route.ts` | 切換遊戲讚 |
| `app/api/comments/route.ts` | 新增留言 |
| `app/api/comments/[id]/like/route.ts` | 切換留言讚 |
| `app/api/refresh/route.ts` | 每天 8 次價格更新（工作量切片＋時段輪轉，見 SETUP.md §8） |
| `scripts/verify-refresh-slices.mjs` | 切片數學單元驗算（不連庫、不連網） |
| `app/api/sync-catalog/route.ts` | 每天 4 次目錄同步（分頁游標＋新遊戲即時價，見 SETUP.md §8.10） |
| `lib/catalog-sources.ts`、`lib/catalog-sync.ts` | 目錄同步的來源抓取器＋DB 編排 |
| `vercel.json` | 12 支 cron：sync-catalog 4 支＋refresh 8 支 |
| `scripts/map-title-ids.mjs` | title ID 對照腳本（`npm run map-title-ids`） |
| `data/title-ids.json` | 對照結果（28/32 款，25 款價格驗證通過） |
| `supabase/migrations/20261116_game_region_ids.sql` | 各區編號對照表 migration（第 9 張表，見 §8.9） |
| `lib/region-ids.ts` | 對照編號選取純函式（region → fallback → none） |
| `scripts/region-ids-input.mjs` | 對照檔共用解析器（新／舊格式皆吃） |
| `scripts/seed-region-ids.mjs` | 對照表匯入（`npm run seed-region-ids`） |
| `scripts/fetch-region-prices.mjs` | 各區價格抓取 → patch 檔（`npm run fetch-region-prices`） |
| `scripts/merge-region-prices.mjs` | patch 合併進目錄，只補缺口（`npm run merge-region-prices`） |
| `scripts/verify-region-ids.mjs` | 對照表管線 mock 驗算（`npm run verify-region-ids`） |
| `SETUP.md` | 本文件 |
| `package.json`（僅補 scripts） | 新增 `map-title-ids`、`seed` 兩個 script，未改依賴 |

未動的檔案：`supabase/`、`scripts/seed.mjs`、`public/covers/`（資料組）、
`app/page.tsx`、`app/games/`、`app/ranking/`、`app/login/`、`components/`（前端組）。
