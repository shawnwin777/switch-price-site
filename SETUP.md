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
                     └─ Vercel Cron 每天 00:00 UTC（= 台北 08:00）
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
3. 部署完成會拿到公開網址，例如 `https://switch-price-site.vercel.app`。
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

## 8. 每日更新排程（台北時間 08:00）

### 8.1 Vercel Cron（預設，已設定好）

`vercel.json` 已設定：

```json
{ "crons": [{ "path": "/api/refresh", "schedule": "0 0 * * *" }] }
```

`0 0 * * *` 是每天 00:00 UTC = 台北時間 08:00。
Vercel Cron 在環境變數有設定 `CRON_SECRET` 時，
會自動帶 `Authorization: Bearer <CRON_SECRET>` 來打 `/api/refresh`，
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
  已把各方案上限統一為每專案 100 支）。所以**加第二支每日 cron 在
  數量上是允許的**，但本專案刻意只留一支，原因見 8.2。

### 8.2 為什麼是一支 cron＋輪轉，而不是多支 cron

遊戲目錄擴大到幾千款後，`幾千款 × 35 國`一次跑不完 60 秒上限
（實測見 8.3）。加第二支每日 cron 並不能解決核心限制：

1. 每支 cron 觸發的仍是同一個 60 秒上限的 serverless 執行，單次能跑的
   遊戲量不變；只是每天多一次執行機會。
2. 兩支 cron 若都打不帶參數的 `/api/refresh`，會因輪轉鍵是「台北日期」
   而在同一天跑到**同一片**，等於重複做白工；要分片就得在 `vercel.json`
   的 path 寫死 `?slice=1&slices=8` 這類參數，但 `slices` 會隨遊戲總數
   變動，寫死的值很快就過期，還會跟輪轉打架。
3. 匯率與價格分開跑也沒幫助：匯率抓取約 1 秒，瓶頸全在價格 API，
   分開並不會讓價格跑得更快。

所以設計是**一支每日 cron＋依台北日期自動輪轉**（8.4）。想加快完整
一輪的速度，正確做法是從外部再打明確的切片（見 8.6），而不是在
`vercel.json` 加 cron。

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

**切片大小定為每片 400 款**（預設值，見 8.5 如何調）：
400 款 × 35 國抓價約 22 秒，留約 35 秒給匯率（約 1 秒）、寫庫與重試，
在 60 秒上限內有餘裕。保守估算（抓價只給 40 秒）上限約 700 款，
400 款是留了近一倍餘裕的選擇；寫庫量也隨片縮小
（400 款 × 35 國最多約 14,000 筆 prices upsert，分 200 筆一批、4 批並行寫入）。

完整跑完一輪的天數（每片 400 款、每天一片）：

| 遊戲總數 | 片數 | 完整一輪 |
|---|---|---|
| 32 款（現況） | 1 片 | **1 天**（與舊版全量更新相同） |
| 1,000 款 | 3 片 | 3 天 |
| 3,000 款 | 8 片 | **8 天** |
| 5,000 款 | 13 片 | 13 天 |
| 10,045 款 | 26 片 | 26 天 |

注意：每款遊戲的價格最久約 `片數` 天才更新一次（例如 3,000 款時最久
8 天），特價結束時間與歷史低價也一樣。匯率不受影響，每天都更新。

### 8.4 切片與輪轉邏輯

- **切分**：全部遊戲按 `slug` 排序（決定性），依序切成每片 `slice_size`
  款；`slices = ceil(遊戲總數 / slice_size)`。沒 title ID 的遊戲也佔片內
  位置（只跳過抓價、列在 `pending_no_title_id`，不影響切分穩定性）。
- **輪轉（預設，不帶切片參數時）**：當天跑第幾片由**台北日期**決定，
  `slice = dayOfYear(台北) % slices`。同一天不論何時打都選同一片；
  連續 `slices` 天恰好每片跑一次，再回到起點。
- **匯率**：每次執行都更新（便宜，約 1 秒），與切片無關。
- **歷史低價**：只針對本次切片的遊戲計算與更新，不做全表重算。
- **遊戲總數變動**：`slices` 每天重算，新增遊戲可能移動切片邊界；
  每款遊戲仍約每 `slices` 天被更新一次。不要在中途頻繁改 `slice_size`，
  否則邊界會跟著亂跳。
- **時間預算**：抓價階段有 45 秒軟預算，超過就不再開新國家、記進
  `errors` 後收尾（已抓到的價格照常寫入，下次輪到本片時再補）。
  價格 API 單一 chunk 失敗會在 `lib/nintendo.ts` 內重試
  （429／5xx／逾時，指數退避 500ms→1000ms，最多 3 次嘗試，429 的
  `Retry-After` 優先但上限 5 秒）；重試後仍失敗的國家只記進 `errors`，
  不中斷其他國家。

### 8.5 參數

| 參數 | 說明 | 範例 |
|---|---|---|
| （無參數） | 輪轉模式：依台北日期自動選片，匯率每天更新 | `/api/refresh` |
| `?slice=i&slices=n` | 明確指定第 `i` 片（0-based，共 `n` 片）；`slices` 只用來驗證 `slice` 範圍，實際片數一律以當下總數與 `slice_size` 推算，省略亦可 | `/api/refresh?slice=2&slices=8` |
| `?offset=&limit=` | 明確指定範圍（按 slug 排序後的位置） | `/api/refresh?offset=800&limit=400` |
| `?slice_size=` | 每片款數，夾在 50～1000；也可改環境變數 `REFRESH_SLICE_SIZE`（query 優先） | `/api/refresh?slice_size=500` |
| `?countries=` | 只更新指定國家，可與切片參數併用 | `/api/refresh?slice=0&countries=JP,US,TW` |

參數錯誤回 400（例如 `slice` 超出 `0～slices-1`、`offset < 0`、
`limit < 1`）。無參數且遊戲總數 ≤ 一片時，行為與舊版全量更新一致。

**調切片大小**：先看回傳的 `duration_ms`。若長期低於 30 秒，可把
`slice_size` 調大（例如 500，完整一輪天數跟著減少）；若常接近
60 秒或出現 `countries_skipped_for_budget`，調小（例如 300）。
改法：Vercel 後台加環境變數 `REFRESH_SLICE_SIZE` 後重新部署，
或每次呼叫帶 `?slice_size=`。改大後 `slices` 變少、完整一輪變短；
改小反之。**不要在輪轉中途頻繁改動**，改完後的第一輪邊界會重排一次。

### 8.6 手動測試與加快完整一輪的方法

```bash
# 未帶密鑰 → 401
curl https://<你的網址>/api/refresh
# 帶密鑰 → 輪轉模式（依今天台北日期選片），回傳含 slice 資訊的摘要
curl https://<你的網址>/api/refresh -H "Authorization: Bearer <CRON_SECRET>"
# 明確跑第 2 片（共 8 片）
curl "https://<你的網址>/api/refresh?slice=2&slices=8" -H "Authorization: Bearer <CRON_SECRET>"
# 明確跑 offset 範圍
curl "https://<你的網址>/api/refresh?offset=800&limit=400" -H "Authorization: Bearer <CRON_SECRET>"
# 只更新指定國家（可與切片併用）
curl "https://<你的網址>/api/refresh?countries=JP,US,TW" -H "Authorization: Bearer <CRON_SECRET>"
```

**想加快完整一輪**（例如 3,000 款想 4 天跑完而不是 8 天）：
用外部免費排程（cron-job.org、GitHub Actions schedule、NAS 的 cron）
每天多打幾次明確的切片，例如 08:00 打 `?slice=0`、12:00 打 `?slice=1`、
16:00 打 `?slice=2`，每次都要帶 `Authorization: Bearer <CRON_SECRET>`。
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
   `slice`、`slices`、`slice_size`、`total_games`、`games_in_slice`、
   `next_slice`、`cycle_complete_date`（本輪完整跑完的台北日期）、
   `prices_updated`、`games_with_new_low`、
   `pending_no_title_id`（本片沒 title ID 的遊戲，保留舊價）、
   `price_not_found`（價格 API 查不到的遊戲／國家，保留舊價）、
   `countries_skipped_for_budget`、`errors`、`duration_ms`。
   單一國家失敗不會中斷整個更新。

### 8.8 執行時間

`maxDuration = 60`（Vercel Hobby 上限）。現況 28 款有 title ID 的遊戲 ×
35 國實測抓價 4.3 秒；目錄擴大後靠切片＋輪轉控制在 60 秒內，
每片 400 款抓價約 22 秒。若日後超時，先調小 `slice_size`（見 8.5），
或升級 Vercel 方案調高上限。

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
| `app/api/refresh/route.ts` | 每日 08:00 台北時間更新（匯率＋切片價格＋切片歷史低價） |
| `scripts/verify-refresh-slices.mjs` | 切片數學單元驗算（不連庫、不連網） |
| `vercel.json` | 每天 00:00 UTC 打 `/api/refresh` 的 cron |
| `scripts/map-title-ids.mjs` | title ID 對照腳本（`npm run map-title-ids`） |
| `data/title-ids.json` | 對照結果（28/32 款，25 款價格驗證通過） |
| `SETUP.md` | 本文件 |
| `package.json`（僅補 scripts） | 新增 `map-title-ids`、`seed` 兩個 script，未改依賴 |

未動的檔案：`supabase/`、`scripts/seed.mjs`、`public/covers/`（資料組）、
`app/page.tsx`、`app/games/`、`app/ranking/`、`app/login/`、`components/`（前端組）。
