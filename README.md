# Switch 遊戲比價

可公開部署的 Switch 遊戲比價網站：搜尋遊戲、比 35 國 eShop 價格、看特價與歷史低價、收藏、留言、收藏排行。賽博龐克風、繁體中文。

技術棧：Next.js 14 App Router + TypeScript + Supabase（Postgres + Auth），部署到 Vercel。全部免費方案。程式碼是標準 Next.js，保持可攜；目前短期沒有廣告，所以用 Vercel Hobby，日後要加廣告再搬離 Hobby。

## 檔案結構

```
app/                  Next.js 頁面與 API 路由
  page.tsx            首頁：搜尋、篩選、35 國切換、國家封鎖、收藏特價提醒
  games/[slug]/       遊戲詳細頁：台幣排序價格表、歷史低價、留言區（在價格上方）
  ranking/            收藏排行 TOP 10（預設只看特價中）
  add/                手動新增遊戲
  login/              登入頁（Google / Discord）
  auth/callback/      OAuth 回呼
  api/collections     切換收藏
  api/likes           切換遊戲讚
  api/comments        新增留言、切換留言讚
  api/refresh         每日更新（匯率＋價格，需 CRON_SECRET）
components/           首頁、卡片、留言區、收藏／讚按鈕等元件
lib/                  Supabase client、資料讀取、國家清單、任天堂 API
middleware.ts         Supabase session 刷新
public/covers/        32 款遊戲真實封面（官方圖）＋ placeholder.svg
supabase/schema.sql   8 張表＋RLS（可重複執行）
scripts/seed.mjs      匯入種子資料（32 款遊戲、920 筆價格、匯率快照）
scripts/map-title-ids.mjs  任天堂 title ID 對照
data/title-ids.json   title ID 對照結果（28/32 款）
seed/catalog-2026-11-15.json  種子資料（2026-11-15 快照）
vercel.json           每天 00:00 UTC（= 台北 08:00）打 /api/refresh 的 cron
SETUP.md              詳細設定手冊（Supabase、登入、Vercel、回呼網址）
DATA_NOTES.md         資料說明（種子來源、title ID、封面、已知缺口）
FRONTEND_NOTES.md     前端說明（頁面清單、本地跑法）
```

## 本機開發

```bash
cd ~/workspace/switch-price-site
npm install
cp .env.example .env.local   # 填入以下環境變數
npm run dev                  # http://localhost:3000
```

沒有 Supabase 專案時，頁面會顯示「尚無資料」空狀態，建置仍可通過。

## 環境變數

| 變數 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon public key（可進瀏覽器） |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key，伺服器端專用，絕對不要放進前端或公開倉庫 |
| `NEXT_PUBLIC_SITE_URL` | 網站公開網址（本機用 `http://localhost:3000`）；登入回呼網址由此組合 |
| `CRON_SECRET` | 每日更新的共用密鑰，自訂一串夠長的隨機字串 |

## 設定步驟（概要，細節見 SETUP.md）

### 1. 建立 Supabase 專案（免費版）

到 Supabase Dashboard 建專案（Region 建議 Northeast Asia (Tokyo)），
進 Project Settings → API 記下 Project URL、anon key、service_role key。
進 SQL Editor，把 `supabase/schema.sql` 整份貼上執行，建立 8 張表與 RLS。

### 2. 匯入種子資料

```bash
export NEXT_PUBLIC_SUPABASE_URL='https://<你的專案>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<service_role key>'
node scripts/seed.mjs   # 預期：games 32 款、prices 920 筆、fx_rates 6 筆
```

可重複執行，不會重複插入，也不會洗掉已填好的 title ID。

### 3. 填任天堂 title ID

```bash
npm run map-title-ids   # 產出 data/title-ids.json
```

2026-11-15 實測已對到 28/32 款。把對照結果用 SQL 寫進資料庫
（完整 SQL 在 SETUP.md 第 3.2 節）。未對到的 4 款
（健身環大冒險、寶可夢傳說 Z-A、黑帝斯 II、空洞騎士：絲之歌）
要人工從官方 eShop 商品頁核對後補上；沒 title ID 的遊戲更新時會跳過、保留舊價。

### 4. 開 Google 與 Discord 登入

Supabase 後台 → Authentication → Providers，分別開啟 Google 與 Discord，
貼上沿用的 OAuth 應用程式 Client ID 與 Secret（Secret 只填在 Supabase 後台，
絕對不要寫進程式碼）：

- Google Client ID：`45382030579-k1lree73oo0aerjaso7qttogjmbr0d81.apps.googleusercontent.com`
  （Secret 在 Google Cloud 專案 switchgameinfo 的 Credentials 頁）
- Discord Client ID：`1571479619671031889`
  （Secret 在 Discord Developer Portal 應用程式「Switch 遊戲比價」的 OAuth2 頁，
  只顯示一次，遺失就按 Reset Secret 重產）

權限範圍只有 openid / email / profile（Google）與 identify / email（Discord）。
登入頁已寫明：登入只用來做收藏，不收集任何 Gmail 或 Discord 資料、不存其他資料。

### 5. 從 GitHub 部署到 Vercel

```bash
git init && git add . && git commit -m "Switch 遊戲比價：Vercel + Supabase 重建版"
git remote add origin https://github.com/<你的帳號>/switch-price-site.git
git push -u origin main
```

Vercel 後台 → Add New → Project → Import 這個 repo → Framework 選 Next.js →
先填好第 5 節表格的 5 個環境變數 → Deploy。部署完成拿到公開網址。

### 6. 部署後：把回呼網址填回三個後台（缺一不可）

回呼網址是 `https://<你的網址>/auth/callback`：

| 後台 | 位置 |
|---|---|
| Google Cloud Console | 專案 switchgameinfo → Credentials → 「Switch 遊戲比價」→ 已授權的重新導向 URI |
| Discord Developer Portal | 應用程式「Switch 遊戲比價」→ OAuth2 → Redirects，按 Save Changes |
| Supabase 後台 | Authentication → URL Configuration → Site URL 與 Redirect URLs |

### 7. 每日更新（台北時間 08:00）

`vercel.json` 已設定每天 00:00 UTC（= 台北 08:00）打 `/api/refresh`。
流程：抓 ExchangeRate-API 匯率（以當天 08:00 台北時間為準，寫進 `fx_rates`），
再用任天堂官方價格 API 更新各國價格與特價結束時間。手動測試：

```bash
curl https://<你的網址>/api/refresh -H "Authorization: Bearer <CRON_SECRET>"
```

沒有密鑰回 401。也可以用任何外部 cron 打同一支路由。

## 功能清單（與原本完整版對照）

- 搜尋（中英文名、類型、發行商）、篩選（Switch / Switch 2、商品類型、試玩類型、排序、只看特價）✅
- 35 國切換、每國可封鎖隱藏（至少留一國可見，存在 localStorage）✅
- 遊戲詳細頁：台幣排序價格表、最便宜高亮、比台版省多少、歷史低價徽章加歷史低價、特價結束加剩餘天數 ✅
- 點封面在新分頁開官方 YouTube 介紹影片（不內嵌）、各區官方 eShop 首頁連結 ✅
- 收藏（要登入）、我的收藏篩選、進站上方收藏特價提醒、詳細頁特價提醒 ✅
- 收藏排行 TOP 10，預設只看特價中、可切全部 ✅
- 留言區在價格上方，遊戲讚加留言讚（要登入），依讚數排序、預設五則、其餘收在顯示全部 ✅
- 新增遊戲表單（手把圖示佔位封面、目前價格即歷史低價）✅
- 登入只做收藏、不收集 Gmail / Discord 資料（登入頁已寫明）✅
- 每天台北時間 08:00 更新匯率與價格、顯示價格最後更新時間 ✅

## 已知缺口（上線前留意）

- 4 款遊戲沒有 title ID（健身環大冒險、寶可夢傳說 Z-A、黑帝斯 II、空洞騎士：絲之歌），每日更新會跳過它們，見 SETUP.md 第 3 節。
- 3 款遊戲價格 API 查不到（瑪利歐賽車世界、咚奇剛 蕉力全開、雙人成行），更新時保留種子價，見 SETUP.md 第 3.3 節。
- 5 款遊戲種子檔日本原價與官方原價不同，第一次更新後會修正為官方原價，見 SETUP.md 第 3.4 節。
- TW、HK 各只有 4 款有價，KR 只有 4 款，其餘 28 款比價時沒有這三國價格（種子檔原樣）。
- 歷史低價標記可信度低：種子檔 32 款全標歷史低價，且空洞騎士、星露谷的歷史低價僅 4 元；建議累積多日價格後重算，見 DATA_NOTES.md 第 7 節。
- 匯率快照種子只有 5 個幣別（USD、JPY、HKD、GBP、EUR＋TWD），每日更新會抓完整匯率表。
- `has_demo = 2` 只有雙人成行一款，依好友通行證免費試玩標為「免費試玩」；原始編碼的確切含義未經原型站確認。
- 16 款遊戲沒有 YouTube 介紹影片（pokemon-sv、mario-odyssey、mario-wonder 等），詳細頁只顯示封面。
- Supabase 免費版專案閒置 7 天會暫停，需手動恢復；每天的更新排程會去動資料庫，正常運作時不會閒置。
- Vercel Hobby 每天一支 cron、serverless 執行 60 秒上限；目前規模夠用，日後遊戲或國家大增時用 `?countries=` 拆打。

## 還需要使用者做的事

1. 建 Supabase 專案、跑 schema.sql、匯入種子、填 title ID（上面第 1–3 步）。
2. 在 Supabase 後台開 Google / Discord provider、填 Secret（第 4 步）。
3. 開 GitHub 儲存庫、把程式碼推上去（第 5 步）。
4. 接 Vercel 帳號、設環境變數、部署（第 5 步）。
5. 部署後把回呼網址填回 Google、Discord、Supabase 三個後台（第 6 步）。
6. 部署後實測：Google / Discord 登入、收藏有存住、每天 08:00 更新有跑。

沒有任何 Secret 或金鑰寫在程式碼裡；設定用的金鑰只存在 Supabase、Vercel 與各家後台。
