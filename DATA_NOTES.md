# DATA_NOTES.md — Switch 遊戲比價：資料說明

> 資料組交付文件。涵蓋種子資料來源、title ID 對照現況、封面來源、
> 匯率快照限制，以及 schema.sql / seed.mjs 的執行方式。
> 專案根目錄：`~/workspace/switch-price-site/`

## 1. 交付檔案一覽

| 檔案 | 內容 |
|---|---|
| `supabase/schema.sql` | 8 張表 + RLS policies（欄位名稱為跨組合約，勿改名） |
| `scripts/seed.mjs` | 讀種子 JSON → upsert 進 Supabase（Node 18+，不需套件） |
| `public/covers/*.jpg` | 32 款遊戲封面（見 §6），另有 `placeholder.svg` |
| `seed/catalog-2026-11-15.json` | 種子檔（原始輸入，非本次產出） |
| `data/title-ids.json` | 登入組產出：28/32 款 title ID 對照（見 §3） |

## 2. 種子資料：來源與日期

> ⚠️ 2026-11-16 更正：本文件 §3 寫的「同款遊戲各國共用同一個 title ID」
> 是錯的。實測證明 title ID（NSUID）是**分區**的：日本 NSUID 只在 JP
> 價格 API 回在售，查美國／阿根廷一律 `not_found`（例如星露谷日本 ID
> 查 JP＝¥1,480 在售，查 US／AR＝`not_found`；曠野之息美國 ID 查 US＝
> $59.99 在售，日本 ID 查 US＝`not_found`）。種子檔 920 筆多國價必定是
> 用各區 NSUID 抓的，但那份各區對照表沒有留下來（`data/title-ids.json`
> 只有日本 ID）。影響：每日更新路由用日本 title ID 抓 35 國，實際只會
> 更新 JP 價，其他國家永遠停在種子價；要多國自動更新，須另建各區 NSUID
> 對照表（見 §10）。另，香港 JSON `thumb_img` 的 14 位數字**就是**香港區
> NSUID（舊文件稱不是，是因為當時只拿它去查日本，當然查不到），但只有
> 59 筆是此格式。擴大目錄見 §10。

- **來源**：Muse fullstack 原型「Switch 遊戲比價完整版」的匯出快照。
  遊戲價格取自任天堂官方 eShop 價格 API
  （`api.ec.nintendo.com/v1/price`），32 國即時價；
  匯率取自 ExchangeRate-API。
- **快照日期**：2026-11-15。
  `data.status.lastPriceUpdate = 2026-11-15T11:29:59.043Z`
  （台北時間 19:29）；匯率快照 `fxAsOf = 2026-11-15T00:02:32.000Z`
  （台北時間 08:02，`fxDateKey = 2026-11-15`）。
- **規模**：32 款遊戲、920 筆價格、32 個國家（AR、AT、AU、BE、BR、CA、
  CH、CL、CO、CZ、DE、DK、ES、FI、FR、GB、HK、IE、IT、JP、KR、MX、NL、
  NO、NZ、PE、PL、PT、SE、TW、US、ZA）。
- **覆蓋缺口**：TW、HK 各只有 4 款遊戲有價
  （mario-wonder、mario-party-j、zelda-eow、pokemon-za），
  KR 只有 4 款（totk、acnh、mario-wonder、mario-party-j），
  其餘 28 款比價時沒有這三國價格——這是種子檔原樣，不是匯入遺失。
- **欄位取值**（以種子檔實測為準）：
  - `platform`：Switch 28 款、Switch 2 有 4 款
    （hades、dk-bananza、mk-world、hades2）。
  - `productType`：32 款皆為 `game`。
  - `hasDemo`：0 = 無試玩（26 款）、1 = 免費 Demo（5 款：
    kirby-fl、dave-diver、mario-party-j、dk-bananza、octopath2）、
    2 = 僅 it-takes-two 一款（好友通行證免費試玩），前端標為「免費試玩」，
    確切含義待前端組依原型站確認，seed 腳本原樣寫入、不轉換。
  - `youtubeId`：16 款為 null（pokemon-sv、mario-odyssey、mario-wonder、
    luigi3、fire-emblem-3h、xenoblade3、hades、hollow-knight、stardew、
    celeste、dave-diver、undertale、dead-cells、ring-fit、zelda-eow、
    dk-bananza），其餘 16 款有值；`games.youtube_id` 可為空。
  - `coverUrl`：種子檔的值是 Muse artifact 的 blob 網址
    （`./blobs/...`），匯不出來、不可用；seed 腳本一律改寫為
    本站路徑 `/covers/<slug>.jpg`。

## 3. 任天堂 title ID：種子檔沒有，已對照 28/32

- **種子檔沒有 title ID**。`games.title_id` 欄位已預留（nullable），
  更新價格的人須以 title ID 查任天堂價格 API
  （同款遊戲各國共用同一個 title ID）。
- **對照現況**（登入組，`data/title-ids.json`，2026-11-15 產出，
  產出腳本 `scripts/map-title-ids.mjs`）：**28/32 已對到**。
  主要來源是日本 eShop 清單
  `https://www.nintendo.co.jp/data/software/xml/switch.xml`
  （`<LinkURL>/titles/<id>` 的數字即 title ID），
  另有 2 款（dk-bananza、mk-world）以人工核對的官方 eShop 商品頁補上。
- **未對到的 4 款**：健身環大冒險（ring-fit）、寶可夢傳說 Z-A
  （pokemon-za）、黑帝斯 II（hades2）、空洞騎士：絲之歌（silksong）。
  原因：日本 XML 最新發售日約 2025-05-01，Switch 2 發售後的遊戲不在其中；
  香港清單則停在約 2022-06。需人工從官方 eShop 商品頁網址核對後補上。
  每日更新路由會跳過沒有 title ID 的遊戲、保留舊價格，不會因此失敗。
  - **2026-11-16 更新**：任務 A 從港台官方清單與每週新作文章找到其中
    3 款的日本／台港編號——pokemon-za `70010000094237`（TW 1449／HK 359）、
    ring-fit `70010000027272`（有編號但台港皆無價，下載版已停售）、
    hades2 `70010000103276`（TW 748／HK 199）；silksong 仍未找到。
    詳見 `data/tw-hk-title-ids.json` 與 §10。`data/title-ids.json` 本身
    未改（仍是 2026-11-15 的 28/32 版），新編號在台港對照檔裡。
- **seed 腳本不會洗掉 title ID**（2026-11-16 修復）：
  `scripts/seed.mjs` 的 games upsert **不帶 `title_id` 欄位**；
  未來若種子檔本身帶了 title_id，也只在該遊戲的 `title_id` 目前為空時
  才以 `PATCH ... ?slug=eq.<slug>&title_id=is.null` 回填，已有值一律保留。
  修復後已用本機 mock Supabase 驗證：原始種子檔執行時 games POST 不含
  `title_id`、零次 PATCH；含 titleId 的測試種子檔則正確回填空值、
  保留已有值。重跑 seed 不會洗掉已對照好的 title ID。
- **注意**：香港清單 `thumb_img` 檔名裡的數字與
  `store.nintendo.com.hk/<數字>` **不是**價格 API 的 title ID，
  以價格 API 驗證一律回 `not_found`，不可採用（登入組已實測）。

## 4. 日本原價不符的 5 款：第一次更新後修正

登入組以 title ID 對照官方原價後發現，以下 5 款的**種子檔日本原價
（regularRaw）與目前官方原價不同**（可能為 Switch 2 Edition 版定價，
或種子檔本身的誤差）；更新路由採用原版 title ID，**第一次每日更新後
價格會自動修正為官方原價**，上線前請留意這 5 款的日本價會變動：

| slug | 遊戲 | 種子檔 JP 原價 | 官方原價（JPY） |
|---|---|---|---|
| botw | 薩爾達傳說 曠野之息 | 8,678 | 7,678 |
| totk | 薩爾達傳說 王國之淚 | 8,900 | 7,900 |
| kirby-fl | 星之卡比 探索發現 | 8,500 | 6,500 |
| fire-emblem-3h | Fire Emblem 風花雪月 | 7,920 | 7,678 |
| mario-party-j | 超級瑪利歐派對 空前盛會 | 9,100 | 7,100 |

- 其餘 20 款已驗證原價相符；另有 3 款價格 API 回 `not_found`
  （dk-bananza、mk-world、it-takes-two），更新時保留舊價格、標示待確認，
  不會讓整個更新失敗；25 款價格已驗證（見 `data/title-ids.json`）。
- 另有 3 款在種子檔裡**沒有日本價格列**（mario-odyssey、hades、balatro
  的 `seed_jp_price` 為 null），第一次更新後才會有 JP 價。

## 5. 匯率快照：只有 5 個幣別有記錄

- 種子 JSON **沒有匯率表**，只有快照時間戳（見 §2）。
  當時有記錄下來的只有 5 個幣別，seed 腳本只寫入這 5 筆
  （`fx_rates`，`date_key=2026-11-15`，rate = 1 單位該幣別兌台幣）：
  USD 32.93、JPY 0.206、HKD 4.196、GBP 43.53、EUR 36.39，另加 TWD 1 為基準。
- 其餘幣別的匯率沒有保留在種子檔裡。**每日更新程式必須向
  ExchangeRate-API 抓完整匯率表**，不可只用這 5 筆去換算其他幣別。
  匯率基準為當日 08:00 台北時間（約定見原型站狀態列），請沿用。

## 6. 封面：32 張真實官方圖、0 張佔位

- **全部 32 款皆為真實封面，無佔位圖。**每張皆實際發請求確認回 HTTP 200
  且為圖片內容才採用；皆為任天堂官方 16:9 主視覺圖（key art，非直式盒裝圖），
  前端請用 16:9 框 + `object-fit: cover` 呈現。
  原圖 1920×1080（JP 來源）或 1240×698（美版商店來源），
  已統一縮為寬 1280 / 1240、JPEG q85，總計約 6.4 MB。
- **來源 A — 日本 eShop 清單（26 款）**：
  `https://www.nintendo.co.jp/data/software/xml/switch.xml`
  的 `ScreenshotImgURL`（`img-eshop.cdn.nintendo.net`）。
  注意該清單最新發售日約 2025-05-01，Switch 2 發售後的遊戲不在其中；
  其中 mario-party-j、zelda-eow 兩張回 `Content-Type: application/octet-stream`，
  已驗證內容確為 JPEG（檔頭 `FF D8`、1920×1080）後才採用。
- **來源 B — 美國任天堂商店商品頁（6 款）**：
  `nintendo.com/us/store/products/...` 頁面圖庫第 1 張
  （`assets.nintendo.com`）：mk-world、dk-bananza、ring-fit、pokemon-za、
  hades2、silksong。這 6 款是來源 A 清單沒有的
  （Switch 2 新作，或健身環未列入日本 XML）。
- **例外**：pokemon-sv 用《寶可夢 紫》版主視覺（種子檔 `titleEn` 為
  Pokémon Violet，朱／紫在種子檔是合併的一款）。
- **佔位圖**：`public/covers/placeholder.svg` 為手把圖示 SVG
  （深色底＋青色手把線條，文字「封面尚未提供 · 手把佔位圖」），
  32 款皆有真實封面故**本次無任何遊戲使用佔位圖**；
  該檔已存在於工作目錄，本次僅檢查內容符合規格後保留。
  未來手動新增遊戲、尚無封面時，前端請用此 SVG（`cover_url` 寫
  `/covers/placeholder.svg`）。**絕對不要用文字當封面。**
- 香港清單（`nintendo.com.hk/data/json/switch_software.json`）內容停在
  約 2022-06，且其圖片路徑已無法直接取圖，本次未採用。
- **2026-11-23 稽核（中-侵權-2）確認：32 張皆為官方 key art 翻拷重託管。**
  驗證：來源 A 26 款逐張下載當日日本 eShop CDN 原圖（1920×1080）與本
  地檔做 dHash 比對，26/26 距離 0～1／256；來源 B 6 款與當日美版商店
  圖庫圖比對，mk-world、dk-bananza、silksong 距離 0～4，hades2、
  pokemon-za 為同一主視覺的舊版本（現行圖多了／少了獎項緞帶與
  Switch 2 Edition 標籤，目視確認同構圖），ring-fit 與舊版商品頁首圖
  距離 7；另目視抽查 botw、totk、stardew、hades、silksong、
  dk-bananza 皆為官方主視覺（含正確官方 logo 與商店緞帶疊加層）。
  32 張全數改接官方 CDN（對照表 `scripts/lib/seed-cover-urls.mjs`；
  DB 改寫腳本 `scripts/fix-seed-covers.mjs --apply`，冪等、乾跑預設，
  需 shawn 在家以 service role key 執行）。`scripts/seed.mjs` 與
  `scripts/build-expanded-catalog.mjs` 已改為寫入 CDN 網址，重跑不
  會把 `/covers/` 寫回來；但舊版 `data/catalog-expanded.json` 的 32
  筆 coverUrl 仍是 `/covers/`，用它重跑 `scripts/seed-expanded.mjs`
  會寫回，跑完須再跑一次 fix 腳本。32 張舊圖待 shawn 從 GitHub 網頁
  刪除（`public/covers/` 只留 `placeholder.svg`）；此後封面一律用遠
  端網址，不得再下載官方圖進 `public/covers/`。

## 7. 歷史低價標記：請審慎看待

- 種子檔 32 款遊戲的 `isHistoricalLow` **全部為 true**，
  但 920 筆價格中只有 33 筆標 `isHistoricalLow`——
  此標記看似僅以當次快照推算，不是長期追蹤的歷史低價。
- 另有明顯異常值：hollow-knight、stardew 的 `historicalLowTwd` 皆為 4，
  celeste 30、undertale 31、dead-cells 51，遠低於合理原價。
  seed 腳本原樣寫入，不自行修正；前端顯示「歷史低價」徽章前，
  建議等每日更新累積多日價格後再以實際極值重算。

## 8. 怎麼跑 schema.sql 和 seed 腳本

### 8.1 建表（只需做一次；可重複執行）

1. Supabase Dashboard → 專案 → SQL Editor，貼上
   `supabase/schema.sql` 全文執行；或用 Supabase CLI 納入 migration 後
   `supabase db push`。
2. 內容：8 張表（`games`、`prices`、`fx_rates`、`collections`、
   `game_likes`、`comments`、`comment_likes`、`user_settings`），
   欄位名稱為跨組合約，**不要改名**。
3. RLS 摘要：`games`、`prices`、`fx_rates`、`comments` 公開可讀；
   收藏／讚／留言只有登入使用者能寫，且只能改自己的資料
   （寫入時強制 `user_id = auth.uid()`）；
   `user_settings` 只有本人能讀寫；
   `games`／`prices`／`fx_rates` 不開放一般使用者寫入，
   寫入一律走 Service Role Key（繞過 RLS）。
   注意：`collections`／`game_likes`／`comment_likes` 的讀取限登入使用者；
   若前端需對未登入訪客顯示收藏／讚數，請另開 view 或 RPC，不要放寬 RLS。

### 8.2 灌種子資料（可重複執行，不會重複插入）

```bash
cd ~/workspace/switch-price-site

# 先設定連線（只讀環境變數，絕對不要把 key 寫進程式碼或 commit）：
export NEXT_PUBLIC_SUPABASE_URL='https://<你的專案>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<service_role key>'
# 或寫進 .env.local（已在 .gitignore 時才可用）再 source 它

node scripts/seed.mjs
# 指定其他種子檔：node scripts/seed.mjs seed/另一個檔名.json
```

- 流程：upsert `games`（以 `slug` 為準）→ upsert `prices`
  （以 `game_id + country` 為準，920 筆）→ upsert `fx_rates`
  （以 `date_key + currency` 為準，僅 §5 的 6 筆）。
- 預期輸出：`games：upsert 32 款`、`title_id：回填 0 款，已有值保留 0 款
  （種子檔無 title_id，未寫入）`、`prices：upsert 920 筆`、
  `fx_rates：upsert 6 筆`。缺環境變數時直接報錯退出，不會寫入。
- **Service Role Key 會繞過 RLS**，只在伺服器端／本機執行，
  不要放進前端程式碼或公開倉庫。Supabase 專案本身尚未建立——
  建好專案、執行 §8.1 後才能跑本腳本；腳本本身不建立帳號、不部署。

## 9. 已知缺口（待其他組或日後補）

1. 4 款遊戲尚無 title ID（ring-fit、pokemon-za、hades2、silksong），
   需人工核對官方 eShop 商品頁後補入 `data/title-ids.json` 與資料庫
   （見 §3）；在那之前每日更新會跳過它們。
2. 3 款遊戲價格 API 回 `not_found`（dk-bananza、mk-world、it-takes-two），
   更新時保留舊價格、標示待確認。
3. 5 款日本原價與官方不符，第一次更新後修正（見 §4）。
4. 匯率快照只有 5 個幣別，每日更新須抓完整匯率表（見 §5）。
5. 歷史低價標記可信度低，見 §7；建議累積多日價格後重算。
6. 封面為 16:9 主視覺圖而非直式盒裝圖；若日後要直式盒裝圖，
   需另尋來源置換檔案（`cover_url` 路徑不變即可）。
7. **NSUID 是分區的**（2026-11-16 實測，見 §2）：日本 title ID 只能更新
   JP 價；每日更新路由目前用日本 ID 抓 35 國，實際只會更新 JP，其他國家
   價格永遠停在種子／目錄快照值。要多國自動更新，須另建各區 NSUID 對照表。
8. 擴大目錄的 10,019 款新遊戲只有 JP 價（＋少數台港價），其餘 32 國無價；
   genre 缺失 99.4%、中文名覆蓋低、DLC 無法區分，見 §10。

## 10. 擴大目錄與台港補價（2026-11-16）

### 10.1 交付檔案

| 檔案 | 內容 |
|---|---|
| `data/catalog-expanded.json` | 擴大後目錄：10,051 款、10,761 筆價格、32 國有價（12.8 MB，種子檔相容格式） |
| `data/tw-hk-title-ids.json` | 台港編號對照：32 款中 24 款有台港編號、23 款有台港價；另附 149 款台灣清單獨有遊戲 |
| `scripts/build-expanded-catalog.mjs` | 重建擴大目錄的腳本（抓清單、去重、JP 篩選、34 國抓價、封面抽驗），可斷點續跑（`data/.cache/`） |
| `scripts/map-tw-hk-title-ids.mjs` | 重現台港對照的腳本（抓台港清單、比對、查價格 API） |
| `scripts/merge-tw-hk-into-catalog.mjs` | 把台港編號與價格合併進擴大目錄（可重複執行、冪等） |
| `scripts/restore-seed-prices.mjs` | 把舊種子檔價格補回目錄缺的國家（只補缺口、不覆蓋，可重複執行） |
| `scripts/seed-expanded.mjs` | 把擴大目錄寫進 Supabase（env-only、cover 保留遠端網址、title_id 只在為空時回填） |
| `scripts/verify-refresh-slices.mjs` | 每日更新切片數學驗算 |
| `data/tw-hk-source-report.md` | 台港編號來源調查報告（2026-11-16）：完整來源＝價格 API 全區間掃描，TW 在售 9,742／HK 21,472；166／176 清單不完整；NSUID 分區群組實測；第三方站與共同來源評估；自動更新流程設計；§13 補 App 數字對照（KR 實測 9,648 款，App 的 KR 2 款為誤）與商店前端 GraphQL 深挖（端點已找到但無列舉操作） |
| `data/.cache/scan-KR.json` | 韓國主區間掃描檢查點（2,600 批，10,228 筆非 not_found，在售 9,648；2026-11-16 晚補掃） |
| `data/tw-hk-full-ids.json` | 完整對照：29,237 個商品（TW 有價 9,643、HK 有價 21,367；具名 2,347、未具名 26,890），每筆含台港編號＋台港價 |
| `data/.cache/scan-{TW,HK}[-ext1,-ext2,-ext3].json` | 價格 API 掃描檢查點（四區間：主區間／新編號／S2 版／DLC） |
| `data/.cache/weekly-articles.json` | 118 篇每週新作文章、2,326 編號 |
| `scripts/scan-tw-hk-price-api.mjs` | 全區間掃描腳本（可斷點續跑） |
| `scripts/merge-scan-into-full-ids.mjs` | 掃描＋命名來源合併腳本 |
| `scripts/harvest-weekly-articles.mjs` | 每週新作文章採集腳本（可斷點續跑） |
| `scripts/probe-savanna-graphql.mjs` | Savanna GraphQL 探測腳本（執行時自商品頁現取 client-id，不寫死；Country 查詢已打通，價格查詢印出實測阻擋，見報告 §14） |
| `scripts/probe-tw-hk-storefront.mjs` | 來源探測腳本（商店前端／清單／JSON／密度抽樣） |
| `lib/refresh-slices.ts` | 切片與輪轉純函式（每日更新用） |

### 10.2 台港價格（任務 A）

- **新來源**：台灣官方遊戲清單 `https://www.nintendo.com/tw/software/switch/`
 （Next.js 頁，RSC payload 含 title＋nsuid，分頁 `?spage=N`，166 款）；
  香港同結構 `https://www.nintendo.com/hk/software/switch/`（176 款）。
  台灣**沒有** `data/json/switch_software.json` 端點（仿香港路徑回 404）。
  另有港台每週「Nintendo eShop 新作軟體資訊」文章共 **118 篇**
  （2026-11-16 重採：HK 78＋TW 40，去重 118；前團隊記錄 107 篇，
  期間新增 11 篇），內文含 title＋nsuid 共 2,326 個編號，
  是新遊戲台港編號的主要來源。
- **166／176 款清單不完整（2026-11-16 定論）**：價格 API 全區間掃描
  證實台灣 eShop 在售 **9,742 筆**、香港 **21,472 筆**
  （遊戲本體＋DLC＋Switch 2 版＋同捆包等全部在售 SKU；
  見 `data/tw-hk-source-report.md` 與 `data/tw-hk-full-ids.json`）。
  清單只是精選：潛水員戴夫、小丑牌、黑帝斯 II、歧路旅人 II、
  雙人成行皆在售卻不在清單內。分頁已跑到底（TW 4 頁、HK 5 頁），
  166／176 是清單本身的全部，不是抓漏。
  掃描區間：`70010000000000–150000`、`70050000000000–100000`（DLC）、
  `70070000000000–40000`（Switch 2 版），腳本
  `scripts/scan-tw-hk-price-api.mjs`（可斷點續跑）。
  命名缺口：29,237 個商品中僅 2,347 個能對上標題
  （清單＋文章＋香港 JSON），其餘 26,890 個只有編號＋價格——
  任天堂沒有公開台港版 title↔nsuid 全表，這是結構性缺口。
- **編號體系**：台港多數遊戲共用同一組 nsuid（如瑪利歐驚奇 TW＝HK＝
  `70010000068691`，日本是 `68687`）；但 2017–2019 年舊遊戲台灣是 2025-09
  開店時重新登記的 `70010000102xxx` 新號，香港沿用舊號，必須分開查
  （如曠野之息 TW `70010000102734`／HK `70010000009367`）。
- **覆蓋**：32 款中 24 款對到台港編號、23 款拿到台港價（健身環有編號但
  台港皆無價，下載版已停售）。合併後全目錄有 TW 價 26 款、HK 價 30 款
  （原種子檔各 4 款）。新增台港價例如：曠野之息 TW 1599／HK 399、
  王國之淚 1599／399、咚奇剛 1880／449、瑪利歐賽車世界 2080／499、
  寶可夢傳說 Z-A 1449／359、黑帝斯 II 748／199、雙人成行 1199／319、
  潛水員戴夫 350／140（TW 價是全目錄最低）。
- **星露谷物語沒有台灣價的原因**：台灣 eShop 根本沒有上架（台灣官方清單
  166 款無、118 篇新作文章無、價格 API 全區間掃描無、第三方比價站亦無台港價），
  只有實體卡。**不是資料缺口，是未上架**，需等日後上架再追蹤；不要再列為待補。
  2026-11-16 全區間掃描最終確認：JP 編號 `70010000005423` 查 TW／HK 皆
  `not_found`，前後 ±10 號亦全數 `not_found`；香港亦無。
  同樣未上架台灣的還有黑帝斯、空洞騎士、蔚藍、Undertale、女神異聞錄5
  皇家版、絲之歌、雙人成行（台灣無，香港有 HKD 319）——見對照檔 unmapped。
- **4 款未對到的後續**：pokemon-za、ring-fit、hades2 已找到（見 §3），
  絲之歌仍未找到（發售當週香港新作文章無此遊戲，台港皆無在售）。
- **完整來源調查（2026-11-16）**：詳見 `data/tw-hk-source-report.md`。
  要點：(1) 台港編號是獨立編號空間，幾乎不等於 JP／NA／EU
  （主區間 TW 3,924 個在售編號僅 2 個等於日本編號）；
  (2) NSUID 分區群組已實測：NA 編號查 US／CA／MX、EU 編號查 GB／DE／FR／ES、
  JP 只查 JP、台港新遊戲共用、舊遊戲 TW／HK 分開查——抓價時每群組
  只需一個編號；(3) 商店前端無公開列舉入口
  （`nintendo.com/zh-hant-tw/store/` 不存在；ec.nintendo.com 只有商品頁；
  2026-11-16 晚已找到其內部 Alps GraphQL 端點
  `wb.lp1.savanna.srv.nintendo.net/graphql`，無登入可通，
  但 11 個操作皆無列舉功能，persisted query 未打通——商店前端
  是結帳流程不是目錄瀏覽器，完整目錄不在其中，見報告 §13.1、§14）；
  (4) 歐洲／日本搜尋端點仍可用
  （EU 23,932 GAME、JP 29,995 件，皆純 GET、無 key），可作歐日區編號來源；
  (5) 無共用的公開價格資料庫，各站皆是自抓官方端點＋自維編號表。
- **台港商店前端資料端點（2026-11-16 晚，報告 §14）**：
  唯一資料端點是 Savanna GraphQL（POST，`X-Nintendo-Savanna-Client-Id`
  header＋shopId 3／4／5；client-id 由商品頁 RSC payload 執行時現取，
  不寫死）。價格查詢文件已完整抽出，欄位齊全：
  原價 `regularPrice{rawValue, currency}`、特價
  `discountPrice{rawValue, endDatetime, currency}`、三通路銷售狀態
  `itemStatuses{hac, offdevice, bee}`、預購／限時／月費／兌換券欄位——
  但**無特價開始時間**（NA Algolia 有，見 `data/region-count-gaps.md` §5），
  且一次只給一國價。Country 查詢已打通（TW／HK 皆回資料）；
  **價格查詢未打通**（伺服器擋在 `$nsUids` 變數，10 餘種變體皆拒，
  需真實瀏覽器觀察實際請求取得正確 hash／文件）。
  **無列舉功能**：11 個操作全是單品查詢與帳號操作，ec.nintendo.com
  無搜尋／瀏覽路由——台港不能像 NA／JP 那樣目錄＋價格一站解決，
  列舉＋抓價仍須價格 API 全區間掃描。
- **App 各國數量對照（2026-11-16 晚，見報告 §13.2）**：
  使用者截圖的比價 App 數字（JP 23,482、HK 14,822、GB 24,314、KR 2）
  是該 App 自己的資料庫覆蓋，不是真實目錄大小——**KR 是決定性反證：
  App 寫 KR 只有 2 款，價格 API 掃描實測 KR 主區間在售 9,648 款**
  （2,600 批，200 秒；檢查點 `data/.cache/scan-KR.json`）。
  JP 搜尋索引全 200 頁逐項統計：在售 28,336（遊戲 14,970＋DLC 9,654＋
  S2 3,712），App 的 23,482 最接近「遊戲＋DLC」24,624；
  JP XML 10,045 僅為 7001 在售的 67%，確為子集；
  HK 掃描 21,472，App 的 14,822 最接近「遊戲＋S2 版」13,902；
  GB 歐洲搜尋 23,932，與 App 的 24,314 差 1.6%。
  真實目錄大小以本調查實測數為準：TW 9,742、HK 21,472、KR ≥9,648
  （主區間）、JP 28,336、EU 23,932。掃描腳本已放寬為任意 2 碼國家碼
  （`--country KR`，lang：TW／HK→zh、JP→ja、其餘→en）。
  自動更新流程設計見該報告 §11（新遊戲發現：每週文章＋前沿掃描；
  價格更新：按分區群組查價）。
- **未明編號**：2026-11-16 全區間掃描後，`70010000020843` 已確認是
  超級瑪利歐創作家 2 的香港編號（HK HKD 329 在售；台灣對應編號
  `70010000102685`，以標題合併確認）；其餘三個仍身份未明，
  但價格已知皆為台港在售：`70010000058126`（TW 1190／HK 298）、
  `70010000049288`（TW 1190／HK 315）、`70010000042364`（TW 600／HK 170）。
  死亡細胞的香港編號亦未找到（香港有賣 HKD 188，現 50% off 到 94；
  全掃描中有 28 個未具名 HK 條目原價同為 188，單憑價格無法認定是哪一個）。

### 10.3 擴大目錄（任務 B，2026-11-16 價格與匯率快照）

- **規模**：10,051 款（日本 XML 10,045 個 title ID 去重＋2 個 Switch 2
  人工 ID＋4 款無 title ID 的種子遊戲）、10,761 筆價格、32 國有價。
  匯率快照 `fxAsOf = 2026-11-16T00:02:31Z`（台北 08:02），與目錄同日。
- **價格來源**：先以 JP 全量篩選在售（約 9,818 個 ID），再抓其餘
  34 國——但因 NSUID 分區（見 §2），其餘 33 國全部 `not_found`，所以新遊戲
  實際只有 JP 價（＋任務 A 合併的台港價 46 筆、香港 thumb 補價 10 筆）。
  舊 32 款的 30 國價是 `scripts/restore-seed-prices.mjs` 從 2026-11-15
  種子檔補回的 890 筆（新抓的 JP／台港價優先保留）。
- **各國覆蓋**：JP 9,821 款（含 3 款無 title ID 的種子遊戲以種子價補回的
  JP 列）；TW 26 款、HK 30 款；其餘 29 國各 32 款
  （皆為舊 32 款的種子價）；SG／MY／TH 0 款。
- **無價遊戲**：228 款（任務 B 回報：218 款下架、10 款查無；皆為日本 XML
  遊戲，舊 32 款經種子價補回後皆有價）。
- **封面**：遠端任天堂 CDN 網址（日本 XML `ScreenshotImgURL`，
  `img-eshop.cdn.nintendo.net`），抽樣 20/20 驗證為真實圖片（6 張回
  `application/octet-stream`，驗檔頭 magic bytes 確認為 JPEG）；無圖者用
  `/covers/placeholder.svg`；舊 32 款保持本地 `/covers/<slug>.jpg`。
  沒有下載任何圖片進 `public/covers/`。
- **欄位缺口**：genre 缺失 99.4%（9,989／10,051 款無；日本 XML 無類型欄位，
  香港 JSON 只對到 52 款）；中文名覆蓋低（香港 JSON 只對到 52 款，其餘沿用
  日文原文標題）；4,188 款（41.7%）標題無拉丁字母，slug 為 `game-<title_id>`；
  DLC 無法區分（SoftType 只有 `dl`／`pkg_dl`，全部記 `product_type="game"`、
  `has_demo=0`）；原價 0 円的免費遊戲存在，`historicalLowTwd=0`；
  Switch 2 遊戲缺口（日本 XML 最新約 2025-05-01，只有 mk-world、dk-bananza；
  pokemon-za、hades2 靠台港價，silksong 完全無價）。
- **匯入**：`node scripts/seed-expanded.mjs <catalog-expanded.json>`，
  首次約 5–10 分鐘（games 51 批＋prices 22 批＋title_id 回填約 3 分鐘），
  重複執行約 1–2 分鐘。只讀 `process.env`，不讀 `.env.local`。
  upsert 不刪除資料庫已有列，所以舊 920 筆種子價不會被洗掉。

### 10.4 每日更新改成切片＋輪轉（任務 C）

- **原因**：實測價格 API 速率約 1.6 毫秒／（款×國）（並行度 4），
  全量一次只算抓價：1,000 款約 56 秒、3,000 款約 168 秒、10,045 款約
  562 秒，60 秒上限內跑不完。
- **做法**（`app/api/refresh/route.ts`＋新增 `lib/refresh-slices.ts`）：
  預設每片 400 款（抓價約 22 秒）；無參數時依台北日期自動輪轉
  （`slice = dayOfYear % slices`），一支每日 cron 在 n 天內跑完全部遊戲；
  匯率每天都更新，歷史低價只算本片。完整一輪：32 款 1 天、3,000 款 8 天、
  10,045 款 26 天。新增參數 `?slice=i&slices=n`、`?offset=&limit=`、
  `?slice_size=`（或環境變數 `REFRESH_SLICE_SIZE`），`?countries=` 保留。
  抓價 45 秒軟預算，超時收尾不爛尾；`fetchPricesForCountry` 加 429／5xx
  指數退避重試。`vercel.json` 未改（仍一支 cron `0 0 * * *`）。
- **Vercel Hobby cron 限制**（查官方文件 2026-11-16）：每專案最多 100 支
  cron、每支每天最多跑一次、觸發時間 ±59 分鐘抖動（00:00 UTC 的 cron
  實際在台北 08:00–08:59 之間觸發）。想加快一輪：用外部免費排程
  （cron-job.org、GitHub Actions）每天多打幾次明確切片（冪等 upsert，
  同一天重打同一片安全）。
- **驗證**：`npx tsc --noEmit` 通過、`npm run build` 通過、
  `node scripts/verify-refresh-slices.mjs` 全部通過；**未實測連 Supabase**
  （無 service key），上線後請先用 curl 帶 `CRON_SECRET` 打一次無參數更新，
  對照回傳的 `slice`／`prices_updated`／`duration_ms`。
- **已知限制**：遊戲總數變動時切片邊界會重排；Hobby cron 有抖動，
  「08:00 快照」應理解為「08:00 那個小時內」；Cron Jobs 已被 Vercel 標為
  legacy，日後遷移到 Schedules 時 `vercel.json` 寫法需跟官方指引改
  （路由本身不依賴 cron 專屬功能）。

## 11. 各國 NSUID 來源調查（2026-11-16）

> 全文見 `data/region-sources-report.md`；探測腳本
> `scripts/probe-region-lists.mjs`（可重跑）；對照表建置腳本
> `scripts/build-region-title-ids.mjs`；產出
> `data/region-title-ids-partial.json`（32 款種子遊戲）。

### 11.1 共享群組：每款遊戲最多 6 組編號，不必 35 個

價格 API 實測矩陣（12 個探測編號 × 35 國）：

- **NA**＝US、CA、MX、BR、CL、CO、AR、PE（8 國共用一組編號）
- **EU**＝GB、IE、DE、FR、ES、IT、NL、BE、AT、CH、PT、PL、CZ、DK、FI、SE、NO、AU、NZ、ZA（20 國共用一組編號；澳洲／紐西蘭／南非用 EU 編號）
- **JP**＝JP；**TW**＝TW；**HK**＝HK（多數與 TW 共用，舊遊戲除外）；**KR**＝KR（部分舊遊戲與 HK 共用，如曠野之息 `70010000009367`）
- **SG／MY／TH**：12 個編號全部 `not_found`，無官方清單來源（見 §11.3）
- 例證（王國之淚）：JP `...63713`、US `...63714`、EU `...63715`、KR `...63716`、TW／HK `...63717`

### 11.2 各群組清單來源（皆可排程直抓，純 HTTP，無登入／JS／反爬）

| 群組 | 來源 | 規模／更新頻率 |
|---|---|---|
| NA | nintendo.com 官網 Algolia `store_all_products_<locale>`（`en_us`、`en_ca`、`fr_ca`、`es_mx`、`pt_br`、`es_ar`、`es_cl`、`es_co`、`es_pe`；公開 search key；`store_all_products_en_us` 遊戲 36,745 款，全部商品 37,632 筆） | 索引即時更新；新作估 30–50 款／週；`releaseDate` 為字串不可日期篩選，須全量分頁（37 頁）＋nsuid diff |
| EU | 任天堂歐洲 Solr `search.nintendo-europe.com/<locale>/select`（`fq=type:GAME`＋`nsuid_txt:*`） | 20,217 筆；實測近 7 天 32 款新發售、近 30 天 241 款、近 7 天 155 筆異動；可全量或 `change_date` 範圍增量 |
| AU | nintendo.com/au 官網 Algolia `prod_games_and_products`（公開 key；`prod_games` 無 nsuid，不可用） | 1,707 筆（精選子集）；實測近 7 天 8 款、近 30 天 40 款新發售；編號與 EU 相同 |
| JP | 日本搜尋 API `search.nintendo.jp/nintendo_soft/search.json`（回 nsuid＋icode＋售價狀態；total 約 29,995 筆）＋XML `nintendo.co.jp/data/software/xml/switch.xml`（10,045 筆，**已停更**約 2025-05-01，只當 product code 來源） | 搜尋 API 即時更新；先加 `opt_hard=1_HAC` 查原版，查不到再不加（Switch 2 遊戲 hard=`05_BEE`） |
| TW／HK | `nintendo.com/{tw,hk}/software/switch/?spage=N`（166／176 款）＋每週新作文章 107 篇 | 隨每週文章更新，約每週數款 |
| KR | `nintendo.com/kr/software/switch/` 清單頁，僅 **13 筆**精選＋新作，無分頁——**不是完整目錄** | 隨精選輪播更換；完整 KR 清單來源仍缺 |

陷阱（已實測）：(1) 美洲 Algolia `productType` 值是各地語言（en=Games、es=Juegos），用 `Games` 篩非英語 locale 會回 0 筆，改客戶端篩 nsuid；(2) 有兩個 key，`c4da8be7…` 只准查舊索引 `ncom_game_*`（無 nsuid），新索引要用 `a29c6927…`，否則 403；(3) 標題正規化須先去掉 `™®©℠` 再 NFKD，否則 `™` 展開成 `TM` 導致第一方標題比對失敗（首版 NA 僅 13/32，修正後 31/32）。

### 11.3 找不到的國家：SG／MY／TH

試過：nintendo.com `en-sg`／`en-my` 商店（404）、eShop 網站 `ec.nintendo.com/SG/en/`（404；title 頁只回顯網址 ID 不驗證）、各區搜尋 API（已下線）、價格 API 五組曠野之息編號（全 `not_found`）、曠野之息 JP／US／EU 編號 ±60 掃描（零個 onsale）。SG／MY／TH 的 eShop 存在但編號體系不明，對照表目前不含這三國。

### 11.4 開源函式庫 nintendeals 與 product code

- nintendeals（https://github.com/fedecalendino/nintendeals，MIT，2020 年）文件與原始碼實讀：NOA Algolia 舊索引 `store_game_en_us` 已下線，現代等效為 `store_all_products_en_us`（同一 app `U3B6GR4UA3`）；NOE Solr 與 NOJ 日本搜尋 API **原樣仍通**；Pricing 即價格 API（≤50 個 ID）。NOA game_info 抓商品頁 `__NEXT_DATA__` Apollo `productCode` 的做法仍通（曠野之息 `HACPAAAAA` 已驗證）。
- product code（跨區 join key，中間 4 碼固定，如 Splatoon 2 `AAB6`）供應狀況：EU Solr `product_code_txt` 部分有（Switch 2 新作多無）；JP XML `<InitialCode>` 全部有；JP 搜尋 API `icode` 全部有；NA Algolia 無（只有商店 sku），須逐款抓商品頁；AU 無；TW／HK／KR 的 `softCode` 是 5 碼頁面 slug（如 `aqmxa`），**不是** product code。

### 11.5 比價站自述與共同來源評估

- GreenDock 首頁自述「價格來自各地區任天堂 eShop」（例：TW 歷史低價 TWD 1,113、另有 45 國特價）；eshop-prices.com FAQ 未公開資料來源且明說「The code is private」；DekuDeals 首頁自述官方商店來源，每筆價格帶「X hours ago at Nintendo eShop」時間戳，2018 年上線。以上只記錄自述，未複製任何價格資料。
- **未發現共用的公開彙整來源**：調查中沒有遇到任何文件記載的公開價格資料庫或公開彙整 API；共同點是機制（各站各自向官方端點抓價＋自維編號對照）＋公開的 nintendeals 函式庫（方法文件，不是資料來源）。本站做法就是重現此流程：各區官方編號清單＋價格接口，程式對編號、程式抓價格。

### 11.6 對照表覆蓋與修正

- `data/region-title-ids-partial.json`（32 款，價格 API 逐國驗證）：NA 31/32、EU 31/32、AU 32/32、JP 31/32、TW 24/32、HK 24/32、KR 3/32。缺口多半是該區未上架／已停售：星露谷等 7 款台港未上架；健身環下載版已停售（JP nsuid=null、TW not_found、HK sales_termination）；KR 只對到 3 款（清單僅 13 筆）；雙人成行 EU／TW／HK 編號是 Switch 2 Edition，原版 EU 編號不在 Solr 前列。
- **修正 1**：`data/title-ids.json` 的咚奇剛（`70010000096812`）與瑪利歐賽車世界（`70010000096808`）所謂「JP 編號」實為台港編號（查 JP 為 not_found）；正確 JP 編號為咚奇剛 `70010000096306`、瑪利歐賽車世界 `70010000092842`（日本搜尋 API，皆 onsale）。`title-ids.json` 本身未改，修正值在對照表 notes 欄位。
- **修正 2**：日本搜尋 API 補上絲之歌 JP `70010000020841`、寶可夢傳說 Z-A JP `70010000094233`、黑帝斯 II JP `70010000103275`（皆 onsale）。
- **自動更新流程**（見報告 §10）：每日排程抓六組清單做 nsuid diff，新遊戲自動進目錄；價格 API 按群組抓價（每款最多 6 個編號覆蓋 32 國），沿用既有切片輪轉；KR 半自動、SG／MY／TH 待來源。


## 11. 各區編號對照表 game_region_ids（2026-11-16）

### 11.1 設計

| 項目 | 決定 |
|---|---|
| 表 | `game_region_ids`（migration：`supabase/migrations/20261116_game_region_ids.sql`，可重複執行） |
| 欄位 | `id`（uuid PK）、`game_id`（uuid FK `games` on delete cascade）、`country`（text，如 `TW`）、`title_id`（text，該國專屬 NSUID）、`source`（text，可空：對照來源）、`created_at`／`updated_at` |
| 唯一鍵 | `unique (game_id, country)`——一款遊戲一國只有一個編號 |
| 索引 | `game_region_ids_game_id_idx`（game_id）、`game_region_ids_country_title_id_idx`（country, title_id，反查「某編號是哪款遊戲」用） |
| RLS | 公開可讀（anon／authenticated SELECT）；**無任何寫入 policy**，寫入只走 Service Role Key（與 games／prices 相同） |
| games.title_id | **保持不動**，仍是日本／預設編號，作為 fallback（見 11.2） |
| JP 列 | **不寫入對照表**：日本編號就是 games.title_id，查價時走 fallback，不需要再存一份 |

### 11.2 查價編號的優先順序（lib/region-ids.ts，純函式）

每款遊戲、每國按以下順序決定查價用的編號：

1. **region**：`game_region_ids` 有該國編號 → 用它（正確的多國價來源）。
2. **fallback**：沒有對照編號 → 用 `games.title_id`（現況行為：JP 會中，
   其他國家通常 `not_found`、保留舊價）。
3. **none**：兩者都沒有 → 該遊戲該國跳過、列 pending、保留舊價。

兩個不同遊戲在同一國共用同一個 title_id 時（例如朱／紫兩個版本被誤寫成
同一編號），先登記者勝出，後者列入回報的 `errors`（不靜默覆蓋）。

### 11.3 對照檔格式約定（來源調查組的產出格式）

新格式 `data/region-title-ids.json`（或 `tw-hk-full-ids.json`）：

```json
{
  "generated_at": "...",
  "sources": [{ "name": "...", "url": "..." }],
  "games": {
    "<key>": {
      "titleZh": "...", "titleEn": "...",
      "jpTitleId": "70010000000026",
      "twTitleId": "70010000102734",
      "hkTitleId": "70010000009367",
      "regionIds": { "US": "...", "GB": "...", "DE": "..." }
    }
  }
}
```

- `key` 是 slug 或 jpTitleId（純數字即視為 jpTitleId）。
- `twTitleId`／`hkTitleId` 與 `regionIds` 兩種寫法都要相容：TW、HK 優先取
  `twTitleId`／`hkTitleId`，若 `regionIds` 也有同國且值不一致，以前者為準
  並記警告（不中斷）。
- 舊格式 `data/tw-hk-title-ids.json` 也吃：`mapped`（`title_id`／
  `tw_title_id`／`hk_title_id`）與 `tw_only_games`（只有台灣編號）。
  `unmapped` 無編號，不產生任何列。
- 解析器是 `scripts/region-ids-input.mjs`（seed 與 fetch 兩支腳本共用），
  格式不符時直接拋錯、不靜默當空檔。

### 11.4 管線與用法（依序執行）

| 步驟 | 指令 | 說明 |
|---|---|---|
| 1. 建表 | Supabase SQL Editor 執行 `supabase/migrations/20261116_game_region_ids.sql` | 只需一次；可重複執行 |
| 2. 灌對照表 | `node scripts/seed-region-ids.mjs [對照檔]`（需 `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`） | 預設讀 `data/region-title-ids.json`，無則依序試 `tw-hk-full-ids.json`、`tw-hk-title-ids.json` |
| 3. 抓各區價 | `node scripts/fetch-region-prices.mjs [--countries=US,GB]` | 產 `data/region-prices-patch.json`，不寫庫、不改目錄 |
| 4. 合併進目錄 | `node scripts/merge-region-prices.mjs` | 只補缺口；合併前備份原檔到 `data/.backup/` |
| 5. 灌目錄進庫 | `node scripts/seed-expanded.mjs` | 既有流程（見 §10.3）；或等每日更新路由自動刷新 |

- **seed-region-ids.mjs**：slug 優先對 `games.slug`，其次 jpTitleId 對
  `games.title_id`；對不到遊戲的條目記為 skipped，**絕不新建遊戲**
  （新遊戲由目錄匯入負責；多半是 `tw_only_games` 裡目錄還沒有的遊戲）。
  預設「已有值保留」：同值跳過、不同值保留現有值並印出衝突；要覆蓋請加
  `--force`。絕不以 null 覆蓋。可重複執行（重跑應為寫入 0 列）。
- **fetch-region-prices.mjs**：每國用該國編號、50 個一批打價格 API，
  重試邏輯與 `lib/nintendo.ts` 一致（429／5xx 指數退避、最多 3 次嘗試、
  單批失敗只記不中斷）；lang 規則相同（JP ja、TW／HK zh、其餘 en）。
  `priceTwd` 用匯率換算：預設抓 ExchangeRate-API 即時表、失敗改讀
  `data/.cache/fx.json`（`--use-cache` 只讀快取；快取日期非當日時印警告）。
  只收在售且有原價的列；`not_found`／下架／無價只記進 patch 的
  `summary.notFound`。patch 的 prices 元素與目錄格式相容（多一個 `titleId`
  僅供追溯，合併時去掉）。
- **merge-region-prices.mjs**：只補（遊戲、國家）缺口，已有價不覆蓋；
  目錄無此 slug 不新建；只有「有新增列」的遊戲才重算 `cheapest`、
  `historicalLowTwd`、`isHistoricalLow`；寫入前備份原檔到
  `data/.backup/catalog-expanded-<台北時間>.json`，寫入採暫存檔＋rename
  （中途失敗不留半份檔案）。可重複執行（重跑新增 0 筆）。

### 11.5 每日更新路由改法（app/api/refresh/route.ts）

- 讀本次切片遊戲的 `game_region_ids`（`.in("game_id", 切片 ids)`），
  每國用 `lib/region-ids.ts` 的 `planCountryIds` 建查價計畫（region →
  fallback → none），不再共用一份 `titleIds`。
- `pending_no_title_id` 改為「完全無編號」的遊戲（`games.title_id` 沒有、
  對照表裡也沒有任何一國編號）；`games_with_title_id` 維持舊語義。
- 回傳新增 `region_ids_used`：`{ table: "ok"｜"missing"｜"empty",
  total_region, total_fallback, by_country: { US: { region, fallback,
  skipped }, … } }`（`skipped`＝該國完全無編號的遊戲數）。
- `price_not_found` 每項新增 `by_country: { 國: { title_id, source } }`
  （本次實際查價用的編號與來源）；舊欄位 `slug`／`title_id`（games.title_id）
  ／`countries` 保持不變。
- 對照表還沒建（migration 未跑）時，讀表失敗不讓更新失敗：自動退回舊行為
  （全部 fallback），並在 `errors` 記一筆、回報 `region_ids_used.table =
  "missing"`——部署新路由不必等 migration。
- 切片＋輪轉、45 秒軟預算、`?countries=`／`?slice=`／`?slice_size=` 參數、
  其餘回傳欄位皆不變（`lib/refresh-slices.ts` 未動）。

### 11.6 設計取捨（有爭議處，寫明理由）

1. **保留 fallback，而不是「無對照編號就完全不查」**。對照表是逐步補齊的
   （先台港、後美歐澳加），還沒對照到的國家若整個不查，JP 價也會停擺
   （JP 本來就靠 `games.title_id`）；且查不到時只是 `not_found`、保留舊價，
   不會寫錯價格。代價是：舊 32 款在未對照國家仍會發出註定 `not_found` 的
   請求（每片每國最多 8 個 chunk），換來的是路由行為連續、部署不必等
   對照表齊全。
2. **seed 預設「已有值保留」，覆蓋要加 `--force`**。對照編號可能被人工
   修正過（例如排除過的誤判編號，見 §10.2），重跑新檔不應靜默洗掉人工
   修正；衝突一律印出，由人決定。代價是：來源調查組修正了錯誤編號時，
   必須明確加 `--force` 才會生效（或先刪該列）。
3. **merge 只補缺口、不取代舊價**。patch 的價是某次抓價快照，舊價可能是
   更新的每日更新結果；合併腳本無法判斷新舊，保守做法是只補沒有的列。
   要以新價取代舊價，請走每日更新路由（對照編號進庫後自動刷新）或手動刪
   該國舊列再合併。
4. **對照表不存 JP 列**。JP 編號就是 `games.title_id`，再存一份只會製造
   兩個真相來源（哪邊改了另一邊沒改就會打架）；查價邏輯以 fallback 統一處理。
5. **寫庫量**：對照表補齊後，實際寫入的價格列會從「只有 JP 約 400 筆」
   變多（每片約 12,000 對，見 §12.5 的工作量切片；舊「每片 400 款」的
   說法已由 §12.5 取代）。現有寫入機制（200 筆一批、4 批並行）已可承受，
   估算約 5～8 秒；抓價請求數不變（每國編號數相同），總耗時仍在 60 秒內，
   但餘裕變小。若上線後 `duration_ms` 常接近 60 秒，先把 `pair_budget`
   調小到 8000（見 SETUP.md §8.5），不要先動 `maxDuration`。

### 11.7 驗證（2026-11-16，本機，無 service key）

- `npx tsc --noEmit` 通過、`npm run build` 通過。
- `node --check` 通過：`seed-region-ids.mjs`、`fetch-region-prices.mjs`、
  `merge-region-prices.mjs`、`region-ids-input.mjs`、`verify-region-ids.mjs`。
- `node scripts/verify-region-ids.mjs`：**29 項全通過**（mock 資料，不連庫、
  不連網）：編號選取（region／fallback／none、撞號先勝）、兩種對照檔格式
  解析（含真實 `tw-hk-title-ids.json`：24 款 mapped＋149 款 tw_only、
  botw 台港編號正確）、merge 邏輯（只補缺口、已有價不覆蓋、目錄無此遊戲
  不新建、重跑冪等、備份產生、cheapest 重算）。
- 負向測試：未知參數／缺對照檔／缺環境變數皆乾淨報錯退出（exit 1），
  不寫檔、不留殘留。
- **未實測**：Supabase 連線（無 service key）——migration 執行、
  seed-region-ids 寫入、refresh 路由連庫行為，上線後請先以小範圍驗證
  （見 SETUP.md §8.9）。

## 12. 全自動更新（2026-11-16，設計＋實作）

> 目標（使用者原話）：「應該是由網頁自主更新、自己串聯」——不要再手動跑
> 種子、不要再找人更新。每日更新自己抓各區官方清單、新遊戲自動進目錄、
> 自己抓各國價格寫庫。
>
> 狀態：程式碼已在工作區完成（未推 GitHub、未碰 Supabase），見 §12.11 驗證。
> 上線前仍需使用者執行 3 個 migration（§12.9），其餘由排程自動跑。

### 12.1 流程（每天自動跑，不用人）

```
每天 4 次 /api/sync-catalog（目錄同步，台北 02/03/05/06 時）
  1. 讀 sync_state 游標 → 各分頁來源從上次停的頁繼續抓 PAGE_CAP 頁
     （JP 搜尋 API、NA Algolia、EU Solr、AU Algolia、台港清單、韓國清單並行；
      單一來源失敗只記、不中斷其他來源）
  2. 分頁讀出現有 games＋game_region_ids（PostgREST 單次 1000 列上限）
  3. planCatalogSync 比對（§12.4）：分區 NSUID diff 為主力、標題正規化
     唯一命中為輔；跨區編號碰撞、標題撞名、疑似 DLC 列 needs_review
  4. 冪等寫入：games upsert（by slug）、title_id／封面只在為空時回填、
     game_region_ids upsert（by game_id,country）；寫入成功後推進游標
     （跑完一輪歸零、記 last_full_pass_date）；維護 games.price_countries
  5. 新遊戲即時價（§12.6）：商店前端價（JP／NA，已驗證）先寫入，
     價格 API 查到同一國價時覆蓋（價格 API 為準）；EU Solr 參考價只做
     交叉驗證、永不寫入（上限 100 款／次）

每天 8 次 /api/refresh（價格更新，台北 04/07/10/13/16/19/22/01 時）
  1. 抓 ExchangeRate-API 匯率（每次都更新，寫 fx_rates）
  2. 按 games.price_countries 算工作量切片（每片約 12,000 對），
     依台北時段輪轉取一片（§12.5）
  3. 每國一份查價計畫（game_region_ids 編號；只有 JP 可 fallback
     games.title_id，其他國家沒編號直接跳過）
  4. 價格 API 逐國抓價（50 個 ID／次、並行度 4、45 秒軟預算），
     upsert prices、更新本片遊戲的 historical_low_twd

每週一次（本機腳本，不是 Vercel cron；§12.7）
  - 台港韓價格 API 全區間掃描重跑 → 更新 data/tw-hk-full-ids.json
    → 跑 seed-region-ids.mjs 補對照表（具名 2,347 筆可對；未具名
    26,890 筆目前無 join key，見 §12.8）
  - 每日只需掃「前沿」號段（上限以上約 40 批、10 秒）
```

### 12.2 完整來源表（每區一個抓取器，`lib/catalog-sources.ts` 的 `CATALOG_SOURCES`）

| 來源 | 端點 | 一次多少款／分頁 | 總量（2026-11-16 實測） | 抓取頻率／限制 |
|---|---|---|---|---|
| JP 搜尋 API（主來源） | `GET https://search.nintendo.jp/nintendo_soft/search.json?q=&limit=100&page=N` | limit=100、page 1-based；每輪 100 頁 | 約 29,995 件；在售 28,336（遊戲 14,970＋DLC 9,654＋S2 3,712） | 每天 4 輪、約 1 天跑完 300 頁；無反爬記錄 |
| NA Algolia | `POST https://U3B6GR4UA3-dsn.algolia.net/1/indexes/store_all_products_en_us/query`（hitsPerPage=1000） | 每輪 40 頁、並行度 2、每頁前停 200ms | 37,632 筆（遊戲 36,745） | 每天 1 輪即跑完（38 頁）；key 問題見 §12.10 |
| EU Solr | `GET https://search.nintendo-europe.com/en/select?q=*&fq=type:GAME&fq=nsuid_txt:*&rows=1000&start=M&wt=json` | rows=1000；每輪 25 頁 | GAME 有 nsuid 20,217 筆（EU 搜尋 23,932） | 每天 1 輪即跑完（21 頁）；只抓 /en/（≈GB） |
| AU Algolia | `POST https://FMW57F6ERV-dsn.algolia.net/1/indexes/prod_games_and_products/query`（hitsPerPage=1000） | 每輪 5 頁 | 1,707 筆精選子集（唯一帶 genre 的來源） | 每天 1 輪即跑完（2 頁） |
| JP XML（product-code 輔助） | `https://www.nintendo.co.jp/data/software/xml/switch.xml` | 全量一次 10,045 個 title ID | 已停更（最新發售日約 2025-05-01） | 只取 `InitialCode`（完整 product code）補欄位，不當目錄來源 |
| TW／HK 清單 | `https://www.nintendo.com/{tw,hk}/software/switch/?spage=N`（RSC payload） | 分頁，每輪全抓 | TW 166／HK 176（精選，非完整） | 每週；命名（精選遊戲） |
| KR 清單 | `https://www.nintendo.com/kr/software/switch/` | 單頁 | 約 13 個 nsuid（精選） | 每週；命名 |
| 每週新作文章（pending） | 台港「Nintendo eShop 新作軟體資訊」文章 | 每週五 1 篇、10–30 款 | 118 篇／2,326 編號 | 每週；新遊戲命名主力 |
| 香港 JSON（pending） | `https://www.nintendo.com.hk/data/json/switch_software.json` | 全量一次 544 筆 | 53 個編號；2022-06 後凍結 | 歷史命名（舊遊戲） |
| 價格 API 全區間掃描（台港韓列舉，**本機腳本**） | `https://api.ec.nintendo.com/v1/price?country={TW,HK,KR}&ids={50 個}&lang=zh` | 50 個 ID／批；全量約 11,600 批（約 25 分鐘） | TW 在售 9,742／HK 21,472／KR 主區間 9,648（全部 SKU） | 全量每週一次；每日前沿約 40 批（10 秒） |
| Savanna GraphQL（台港，**待打通**） | `https://wb.lp1.savanna.srv.nintendo.net/graphql` | 單品查詢、無列舉、無分頁 | 11 個操作全是單品／帳號操作 | 見 §12.6：價格查詢未打通，不當來源 |

### 12.3 規模修正：App 的各國數字是「該 App 的覆蓋」，不是真實目錄大小

使用者截圖的某比價 App 數字（JP 23,482、HK 14,822、GB 24,314、KR 2 等）
**不能當設計依據**。決定性反證（`data/tw-hk-source-report.md` §0.7、§13.2）：
App 寫韓國只有 2 款，價格 API 掃描實測 KR 主區間在售 **9,648 款**——
App 的 KR 覆蓋近乎於零。其他對照亦然：JP App 23,482 介於搜尋索引遊戲本體
14,970 與遊戲＋DLC 24,624 之間；HK App 14,822 最接近遊戲＋S2 版 13,902；
GB App 24,314 與 EU 搜尋 23,932 差 1.6%。

**設計改以實測掃描數字為準**（2026-11-16）：

| 區 | 實測數字 | 備註 |
|---|---|---|
| TW | 在售 9,742 筆（全部 SKU） | 另 1,394 筆非在售（停售／預購） |
| HK | 在售 21,472 筆（全部 SKU） | 另 3,182 筆非在售 |
| KR | 主區間在售 9,648 款 | DLC／S2 區間尚未掃 |
| JP | 搜尋索引在售 28,336 件（遊戲 14,970＋DLC 9,654＋S2 3,712） | JP XML 10,045 已停更，只是子集 |
| EU | 搜尋 GAME 23,932（有 nsuid 20,217） | 11,813 款有 product code |
| NA | Algolia 37,632 筆（遊戲 36,745） | 最大單一區目錄 |

目錄真實規模（去重後的遊戲本體）：NA 36,745 款是最大單一區數字，
三區高度重疊，聯集約 **30,000–40,000 款**。§12.5 的分片重算仍按
30,000 款規劃情境（不變），但依據改為掃描數字，不是 App 數字。

### 12.4 比對鍵重估（大規模）

1. **分區 NSUID diff 為主力**：每區清單用自己的 NSUID 對自己的索引，
   絕大多數條目不需要標題比對（新遊戲＝清單有、庫裡沒有該區編號）。
2. **title_id**：JP 條目直接比 `games.title_id`（JP 編號即 title_id）。
3. **跨區編號碰撞守衛**：JP 編號已在他區對照表出現但標題對不上時，
   不建新遊戲、列入 `needs_review`（例：瑪利歐賽車世界片假名標題對不上
   中文／英文，且 JP 編號 `70010000096808` 已是其 TW 編號）。
4. **標題正規化唯一命中**：僅同文有效（片假名 vs 中文／英文會失敗）；
   撞名（兩款既有遊戲標題相同）→ needs_review、不自動合併。
   正規化：先去 `™®©℠` 再 NFKD（NFKD 會把 `™` 展開成 `TM` 導致比對失敗）。
5. **product code unique_id 只記錄、不自動合併**：推導規則（完整碼第 4–7
   字元＝icode 前 4 碼）尚未以實例驗證，phase 2（見 §12.10）。
6. **台港編號是獨立編號空間**：3,924 個 TW 在售編號只有 2 個等於日本編號；
   HK 10,008 個也只有 2 個。台港之間多數共用，但 2017–2019 舊遊戲台灣用
   2025-09 開店時重登記的 `70010000102xxx` 新號、香港沿用舊號，
   必須分開查（曠野之息 TW `70010000102734`／HK `70010000009367`，
   互查皆 `not_found`）。**所以台港編號絕不能用 JP 編號 fallback 帶過**，
   只能靠對照表（§12.7）。

### 12.5 分片、輪轉與每日處理量（30,000 款重算）

**問題**：舊設計每片 400 款、1 支每日 cron，10,051 款 26 天一輪；
放大到 30,000 款變 75 天——太慢。而且每款成本差 35 倍
（JP-only 1 個對、35 國全覆蓋 32 個對），按款數切片會讓 JP-only
片 1 秒跑完（預算浪費）、全覆蓋片 22 秒。

**改法**（已實作）：
- 按「(遊戲、國家) 對數」切片：每片固定約 **12,000 對**
  （`?pair_budget=` 可調 1000～50000，預設 12,000；環境變數
  `REFRESH_PAIR_BUDGET`）。對數來源 `games.price_countries`
  （sync 維護、migration 回填；為 null 時以 35 計＝舊行為）。
- 每天 **8 次**價格更新（每 3 小時），以台北小時算 slot
  （`slot = floor(台北小時/3)`，`slice = (絕對日數×8 + slot) % slices`，
  抖動 ±59 分鐘不跨時段）。
- 取消非 JP 的 fallback 查價（無對照編號的國家不發請求；舊 fallback
  查 JP 編號只會回 `not_found`、純浪費）。

**數字**（實測速率約 1.6 毫秒／（款×國），並行度 4）：

| 情境 | 總對數 | 片數（12,000 對／片） | 一輪天數（8 次／天） |
|---|---|---|---|
| 現況 10,051 款（幾乎全 JP-only） | 約 10,900 | 1 | 1 天（8 次都跑同一片＝每天全量更新） |
| 30,000 款：1 萬款 32 國＋2 萬款 JP-only | 約 340,000 | 29 | 約 4 天 |
| 30,000 款：全部 32 國全覆蓋 | 960,000 | 80 | 10 天 |
| 30,000 款：對照表未建（全 JP-only） | 30,000 | 3 | 不到 1 天（但只有 JP 價） |

每輪預算：12,000 對 ≈ 240 次價格 API 呼叫 ≈ 18–25 秒抓價
＋ ≤12,000 列寫庫 ≈ 5–8 秒 ＋ 匯率 1 秒 ＋ 讀 games 約 3–5 秒
≈ 30 秒，60 秒上限內有餘裕；`duration_ms` 常近 60 秒時先把
`pair_budget` 調小到 8000（見 SETUP.md §8.5）。

**目錄同步一輪**：NA 38 頁（每輪 40 頁，1 輪跑完）、EU 21 頁（每輪
25 頁，1 輪）、JP 約 300 頁（每輪 100 頁，3 輪）、AU 2 頁（每輪 5 頁，
1 輪）→ 每天 4 輪約 **1 天跑完一輪**（JP 是瓶頸）；新遊戲發現延遲約 1–2 天。
新遊戲進目錄當天就有即時價（§12.6），不用等價格輪轉。

**cron 配置**（共 12 支，Hobby 上限 100 支內；見 `vercel.json`）：

| 用途 | UTC | 台北 | slot（refresh） |
|---|---|---|---|
| sync-catalog | 18:00 | 02:00 | — |
| sync-catalog | 19:00 | 03:00 | — |
| refresh | 20:00 | 04:00 | 1 |
| sync-catalog | 21:00 | 05:00 | — |
| sync-catalog | 22:00 | 06:00 | — |
| refresh | 23:00 | 07:00 | 2 |
| refresh | 02:00 | 10:00 | 3 |
| refresh | 05:00 | 13:00 | 4 |
| refresh | 08:00 | 16:00 | 5 |
| refresh | 11:00 | 19:00 | 6 |
| refresh | 14:00 | 22:00 | 7 |
| refresh | 17:00 | 01:00 | 0 |

### 12.6 商店前端價格分工（已驗證，見 `data/region-count-gaps.md` §5）

三個商店前端端點都自帶價格欄位，目錄＋價格可以一次解決，但各有限制。
分工（已實作於 `lib/catalog-sources.ts` 解析器＋`lib/catalog-sync.ts` 第 5 步）：

| 端點 | 價格欄位 | 驗證實例 | 角色 |
|---|---|---|---|
| NA Algolia | `eshopDetails`（regularPrice、discountPrice、discountPriceStart／End、discountPriceEndTimestamp、currency、isPurchasable、productType: TITLE／ADD_ON_CONTENT）＋頂層 `price`（finalPrice／regPrice／salePrice／percentOff） | 瑪利歐賽車世界 regularPrice $79.99，與價格 API 一致 | **新遊戲即時價（US）**：先寫入，價格 API 查到 US 價時覆蓋。8 個 locale 各一幣別（目前只抓 en_us＝USD；其他 locale 價為 phase 2）。`productType: ADD_ON_CONTENT` 可區分 DLC（曠野之息查詢首筆即 ADD_ON_CONTENT $9.99，nsuid 前綴未必能分） |
| JP 搜尋 API | pprice（套裝定價；純 DLC 為 null）、dprice（下載版定價）、sprice（特價）、current_price（現價）、sale_flg、ssitu，皆日圓整數 | 曠野之息 7,678 與價格 API 一致；特價例 pprice 4,290 → current_price／sprice 2,574、sale_flg=1；純 DLC pprice null、dprice／current_price 199 | **新遊戲即時價（JP）**：先寫入，價格 API 查到 JP 價時覆蓋。無特價結束日欄位（saleEnd 永為 null，特價剩餘天數以價格 API 為準） |
| EU Solr | price_regular_f、price_lowest_f／price_sorting_f、price_has_discount_b、price_discount_percentage_f | 星露谷 en 10.99（＝GB £10.99）、de 13.99（＝DE €13.99），與價格 API 一致；特價例 I am Setsuna regular 29.99／lowest 8.99／-70%；en 目前特價 GAME 1,993 款 | **只當參考價、永不寫入**：每 locale 只有一個價（en≈GB、de≈DE），無法給 EU 20 國逐國價；且有一例異常——曠野之息 de 三欄皆 89.98（＝69.99＋19.99），與價格 API 的 DE €69.99 不符；en regular 77.98（＝59.99＋17.99，本體＋擴充票合計）。新遊戲同步時以價格 API 的 GB 價交叉驗證，差異（>1% 且 >0.5 幣別單位）記進回報的 `reference_price_mismatches`，**價格 API 勝出** |
| 台港 Savanna GraphQL | ItemUserPrices：原價／特價／特價結束時間／三通路銷售狀態（缺特價開始時間；幣別隨 country 變，一次一國） | Country 查詢已打通（shopId 3／4／5＋client-id header）；**價格查詢未打通**（伺服器擋在 `$nsUids` 變數上，INVALID_PARAM 1802，見 `scripts/probe-savanna-graphql.mjs`） | **待打通的單品價格／命名備援**：11 個操作全是單品查詢、無列舉功能，**不能當台港目錄同步的來源**；列舉＋抓價仍須價格 API 掃描（§12.7）。打通需 live browser 觀察商品頁實際請求取得正確 hash（本團隊無此工具，見 §12.9） |

**多國比價仍需價格 API**：Solr 一個 locale 只給一個價，無法覆蓋 EU 20 國
逐國價；且 Solr 有 BOTW／de 異常樣本。原則：目錄與新遊戲即時價走前端端點，
逐國現價走價格 API（每款最多 6 個群組編號覆蓋 32 國），兩者互為交叉驗證
（新遊戲：商店前端價先寫、價格 API 覆蓋；EU：參考價與 GB 價比對、異常記錄）。

### 12.7 台港完整來源與掃描節奏（2026-11-16，`data/tw-hk-source-report.md`）

- **完整來源是價格 API 全區間掃描**（不是清單頁）：NSUID 按發售順序編排，
  台港在售商品必然落在 `70010000000000–70010000150000`、
  `70070000000000–70070000040000`（Switch 2 版）、
  `70050000000000–70050000100000`（DLC）三個區間內。掃描腳本
  `scripts/scan-tw-hk-price-api.mjs`（支援任意 2 碼國家碼，`--country KR` 等）。
- **對照檔已產出**：`data/tw-hk-full-ids.json`（29,237 個商品：TW 有價 9,643、
  HK 有價 21,367、具名 2,347、未具名 26,890；每筆含台港編號＋台港價，
  形狀為 `{titleZh, titleEn, jpTitleId, twTitleId, hkTitleId, twPrice, hkPrice}`，
  價格含 `sales_status／regularRaw／effectiveRaw／currency／discountPct／saleEnd`）。
  **它是台港對照表的種子來源**：`scripts/seed-region-ids.mjs` 已支援此檔
  （具名筆按標題對進既有遊戲寫 `game_region_ids`；未具名筆無 join key，
  見 §12.8）。掃描亦證實：台灣 166／香港 176 清單只是精選
  （潛水員戴夫、小丑牌、黑帝斯 II、歧路旅人 II、雙人成行都在售卻不在清單內）。
- **掃描節奏**（已納入排程設計，2026-11-17 起改走 GitHub Actions）：
  - 全量重掃**每週一次**即可（約 11,600 批、約 25 分鐘；調查期間 15,000 次請求、
    價格 API 零次 429）。**這是 GitHub Actions，不是 Vercel cron**
    （60 秒跑不完；且它寫 JSON 檔、不是直接寫庫）：工作流程
    `.github/workflows/weekly-tw-hk-kr-scan.yml`，每週日 02:00 UTC 自動跑
    （掃描 TW／HK／KR 主區間＋台港 ext1 新號段 → 合併 → seed-region-ids →
    seed-unnamed-games）。ext2（7007）與 ext3（7005）不列入每週排程
    （未具名筆會被匯入腳本跳過，見 §12.8）；有需要時本機手動跑。
    首次執行風險：GitHub runner 的共用 IP 可能被任天堂限流（429），
    掃描腳本有指數退避重試；失敗時 GitHub 寄信通知、手動重跑即可。
  - 每日前沿掃描約 **40 批（10 秒）**：掃上限以上的新號段（全球編號分配速度
    約每月 1,400 個；台港新增在售各約每月 40 款）。
  - 掃描上限（目前 `70010000150000`）需隨新遊戲登記**定期上調**
    （每季檢查台灣清單最大編號，接近上限時上調 `--to` 並重掃前沿）。
  - 韓國：主區間在售 9,648 款已掃（2,600 批、200 秒）；**DLC／S2 區間尚未掃**。
- **星露谷維持原結論**：台灣、香港 eShop 皆無下載版（全區間掃描＋清單＋
  118 篇文章皆無；對照檔 `stardew_tw_onsale: false`、`stardew_hk_onsale: false`）。
  它的 TW 價缺失不是資料缺口，不要再追。

### 12.8 新遊戲欄位缺口重估（大規模＋台港未具名）

| 欄位 | 能自動填 | 填不了／缺口 |
|---|---|---|
| slug、title_en（拉丁部分） | 來源標題正規化＋`extractLatin` | — |
| title_zh | TW/HK 中文優先（清單 166／176、每週文章、對照檔具名 2,347 筆） | 覆蓋約 1%＋具名筆；**26,890 筆未具名商品無標題**，目前無公開來源可補（見下）；未具名筆先以佔位遊戲建檔（`games.is_unnamed=true`，標題暫放編號），命名後合併改名 |
| title_id | 僅 JP 條目；NA／EU 條目掛 `game_region_ids` | — |
| publisher | 僅 JP XML MakerName | 除 JP XML 外無來源 |
| cover | 僅 JP XML ScreenshotImgURL | 新遊戲多半佔位圖 |
| genre | 僅 AU Algolia（1,707 筆精選子集） | 其餘缺失（現況 99.4% 缺失） |
| youtube_id | — | 無來源 |
| DLC 區分 | 編號前綴（7005 升級包、7007 DLC／組合包）、NA `productType: ADD_ON_CONTENT`、JP `id` 含 `_` | `7001` 空間內的 DLC 仍無法只憑編號區分，需標題或商品頁資訊；JP XML 的 SoftType 只有 `dl`／`pkg_dl`，標題含 DLC 關鍵字者列 needs_review |

**台港未具名 26,890 筆是結構性缺口，不是抓漏問題**：任天堂沒有公開台港版
title↔nsuid 全表；公開命名來源只有官方清單（166／176）、每週新作文章
（118 篇／2,326 編號）、香港舊 JSON（53 編號）。舊遊戲與 DLC 的標題目前
無公開來源。可能方向：以價格比對 JP／EU 價反推（弱證據，不建議當主鍵）、
等任天堂公開更多清單、或 Savanna GraphQL 詳情查詢（若打通可當單品命名來源，
含標題＋productCode，但需登入 idToken，見 §12.9）。調查報告的建議流程：
新編號對上文章標題即具名進目錄；對不上者先以編號＋價格進目錄（未具名，
slug 如 `tw-<nsuid>`），待清單或文章補名時合併——**2026-11-17 主代理決定
採用此流程**（見 §12.10 已決議），實作於 `scripts/seed-unnamed-games.mjs`：

- 未具名筆以 nsuid 去重後建佔位遊戲（同一編號台港兩區都出現時只建一款，
  slug 優先 `tw-<nsuid>`，兩區編號＋價格都掛上去；韓國筆同理 `kr-<nsuid>`，
  先看 nsuid 是否等於某遊戲的 title_id 或已有 tw-／hk- 佔位遊戲）。
  2026-11-16 對照檔 dry-run：26,890 筆 → 去重後 8,346 款佔位遊戲
  （tw- 2,570、hk- 5,776，價格 10,694 筆）＋ KR 9,430 款。
- 疑似 DLC／升級包／組合包跳過不建：編號前綴 7005（DLC／追加內容空間）與
  7007（Switch 2 Edition／升級包空間）——2026-11-16 對照檔共跳過 16,196 筆
  （60% 的未具名筆！）。注意 7001 空間內的 DLC 仍無法只憑編號區分，
  這批先建檔、待命名後再由人工／合併流程處理。
- 具名筆：已有遊戲就不建；對不到時建一款具名遊戲（slug＝對照檔 key）。
  2026-11-16 對照檔 dry-run：2,347 筆具名中約 2,340 筆要新建。
- 命名合併：具名筆對到的編號若已有佔位遊戲，佔位遊戲改名（標題、slug、
  title_id、`is_unnamed=false`）或併入既有具名遊戲（編號＋價格搬過去、
  佔位列刪除）；slug 已是具名遊戲時絕不覆蓋。具名遊戲不會因此被洗掉。
- 未具名期間不出現在首頁遊戲牆／搜尋結果與接近歷史低價
  （`games.is_unnamed`，`lib/data.ts` 單一過濾點＋migration 未跑時的退回；
  收藏未具名遊戲也被 `POST /api/collections` 擋下，所以不會透過收藏排行曝光；
  準備上市則因佔位遊戲的 `release_date` 為 NULL，本來就不列入）。
  詳細頁直接輸入網址仍可打開（方便檢查），沒有 sitemap，不會被搜尋引擎收錄。

### 12.9 仍需手動的步驟（誠實清單）

1. **Supabase migrations（各只需一次，在 SQL Editor 執行）**：
   `supabase/migrations/20261116_game_region_ids.sql`（對照表）、
   `supabase/migrations/20261117_catalog_sync_state.sql`（游標表）、
   `supabase/migrations/20261117_game_price_countries.sql`（`games.price_countries`
   ＋一次性回填）、`supabase/migrations/20261118_unnamed_games.sql`
   （`games.is_unnamed`＋檢視重建，未具名商品匯入前必須先跑）。程式不能自己建表：
   工作區沒有 service key；且 DDL 是一次性建表，不應由每次執行的排程代做。
   表未建時程式仍可跑（游標預設 0、JP 照常、其他國家跳過、對數以 35 計），
   只是完整一輪跑不完、覆蓋不全。
2. **GitHub Actions Secrets（只需一次，在 GitHub repo 設定）**：
   `SUPABASE_SERVICE_ROLE_KEY`（從家裡電腦的 `.env.local` 複製，絕對不要在
   學校／共用電腦上貼）與 `NEXT_PUBLIC_SUPABASE_URL`（見 SETUP.md §8.10）。
   沒設定時每週台港韓掃描工作流程會在寫庫步驟失敗（掃描與合併本身不需要 key）。
3. **對照表初始資料（見 §12.7）**：台港對照檔已產出
   （`data/tw-hk-full-ids.json`），跑 `seed-region-ids.mjs` 寫入具名筆、
   `seed-unnamed-games.mjs` 寫入未具名筆；每週全量重掃改走 GitHub Actions。
   KR DLC／S2 區間尚未掃；掃描上限需每季檢查上調。
4. **中文名／genre 補齊**：無自動來源（§12.8）；26,890 筆未具名商品的標題
   無公開來源，佔位遊戲等命名來源補名後由匯入腳本合併改名。
4. **價格 API 查不到的遊戲**：Switch 2 新作（舊 API v1 查不到，如瑪利歐賽車
   世界 JP／US／GB 皆 not_found）保留商店前端價（JP／NA 即時價）；已下架遊戲
   保留舊價。
5. **標題撞名、跨區編號碰撞、疑似 DLC**：列入 `needs_review`，須人工確認。
6. **Algolia 公開 search key 若被任天堂輪換**：NA／AU 抓取會失敗（其他來源照常），
   須從官網前端重新取得並更新程式或環境變數（`NA_ALGOLIA_API_KEY`／
   `AU_ALGOLIA_API_KEY`）。
7. **Savanna GraphQL 價格查詢打通（需主代理決定／派人）**：需以 live browser
   觀察商品頁實際請求取得正確 persisted-query hash（本團隊無此工具）；
   詳情查詢另需登入 idToken。打通前台港列舉＋抓價仍走價格 API 掃描。
8. **美洲區列舉的 Algolia key（需主代理決定）**：台港報告指出需自備 key，
   不要用函式庫內嵌的他人 key（見 §12.10）。

### 12.10 開放問題（等來源調查結果／主代理決定後補）

- **Algolia key 歸屬**：程式目前預設的 NA key（`a29c6927638bfd8cee23993e51e721c9`）
  與 AU key（`c8e4e9f60190ef785d167da77ba0b4fe`）在美歐調查報告中記為「任天堂
  官網前端內嵌的公開 search key」；台港報告 §12.3 則指出美洲區列舉需自備 key、
  「本次未採用函式庫內嵌 key」。兩份報告的說法需主代理確認——若現有 key
  是第三方函式庫（nintendeals）的 key，請從任天堂美國商店前端自行取得
  key 並改用環境變數 `NA_ALGOLIA_API_KEY`（程式已支援覆寫）；若是官網前端
  key，則維持現狀。**在確認前，不要把 key 的來源寫死成任一說法。**
- **未具名 26,890 筆的建檔規則**：~~是否以 `tw-<nsuid>`／`hk-<nsuid>` slug
  先建未具名遊戲進目錄（編號＋價格先行、之後補名合併），或只寫對照表、
  等命名後再建遊戲？待主代理決定。~~ **已決議（2026-11-17）**：先建未具名
  遊戲進目錄（編號＋價格先行、之後補名合併），實作見 §12.8 與
  `scripts/seed-unnamed-games.mjs`；未具名期間不出現在首頁／搜尋／接近歷史低價。
- **台港 GraphQL 打通後**：單品價格是否當第二來源（與價格 API 交叉驗證）、
  詳情查詢是否當單品命名來源（需登入 idToken，登入流程待定）。
- **JP 搜尋 API `limit` 上限**是否超過 100（未實測超過 150），影響 JP 全輪頁數。
- **Product-code unique_id 推導規則驗證**（完整碼第 4–7 字元＝icode 前 4 碼），
  驗證通過後才能當跨區合併鍵；EU `product_code_txt` 覆蓋率、NA product code
  逐款抓頁成本。
- **KR DLC／S2 區間掃描**（目前只有主區間 9,648）；**SG／MY／TH 來源**
  （nintendo.com 無商店前端、價格 API 掃描零個 onsale，不要以 US／EU 編號硬填）。
- **價格優先級**（熱門／特價遊戲每日更新、長尾慢輪轉）是否列為 phase 2。
- **NA 其他 7 個 locale 的 Algolia 價格**（目前只抓 en_us＝USD）：是否納入
  新遊戲即時價（CA／MX／BR 等），或維持價格 API 覆蓋。
- **EU Solr 其他 locale**（de／fr／es／it／nl）：是否納入參考價交叉驗證。

### 12.11 驗證（2026-11-16，工作區）

- `node scripts/verify-catalog-sync.mjs`：**43 項全通過、0 失敗**
  （mock 資料，不連庫、不連網）：含 §12.6 的 NA eshopDetails（MKW $79.99、
  特價結束日 Unix 秒→ISO、ADD_ON_CONTENT→DLC）、JP dprice／sprice
  （BOTW 7,678、特價 4,290→2,574、純 DLC pprice null→dprice 199）、
  EU 參考價（29.99／8.99／-70%、GBP、無 storePrice）、規劃器分流
  （JP／NA 進 storefrontPrices、EU 進 referencePrices）。
- `node scripts/verify-refresh-slices.mjs`：**79 項全通過**（含舊款數切片／
  輪轉，及新增的工作量切片：30,000 款→29 片、邊界連續、單款超預算自成一片、
  多輪次輪轉 29 次每片恰一次、slot 抖動穩定、workCycleDays＝4 天）。
- `node scripts/verify-region-ids.mjs`：**29 項全通過**（編號選取 allowFallback
  預設 true，舊行為不變）。
- `npx tsc --noEmit` 通過、`npm run build` 通過。
- **未實測**：Supabase 連線（無 service key）——migration 執行、sync_state／
  price_countries 回填、sync-catalog／refresh 路由連庫行為，上線後請先以
  `?dry_run=1` 與小範圍 `?slice=` 驗證（見 SETUP.md §8.9）。

## 13. 台灣遊戲命名匯入：samsonjaw 來源已被週末官方目錄 backfill 覆蓋（2026-11-23）

- 2026-11-20 規劃：按 NSUID 對應 samsonjaw 公開 `data/tw-eshop.json`（4,251 款）＋台灣官網 JSON，把名字寫進未命名遊戲；預期可命名 2,368 款（其中 2,364 款已有台幣價）、另 270 個 NSUID 是掃描檔裡沒有的新遊戲。
- 2026-11-21–22 週末（shawn＋ChatGPT）：上線 guarded TW official backfill（`scripts/guarded-tw-backfill.mjs`＋`.github/workflows/tw-official-guarded-backfill.yml`，每日 12:20 台北時間，exact-NSUID、佔位名稱才可替換、官方圖片 only、單次上限 3000 筆、SHA256 驗證），並已在 11/22 兩次 `[tw-autofill-approved]` 提交觸發 auto-apply。
- 2026-11-23 早上比對（離線、無寫庫）：samsonjaw `tw-eshop.json`（2026-11-23 00:57Z 快照）與當天現抓的台灣官方目錄（`/tw/api/software`，4,668 列／4,251 個 NSUID）**NSUID 集合完全相同（only-in-either 皆 0）**；標題 4,169/4,251 完全相同，其餘 82 筆只是 samsonjaw 標題前後空白差異。samsonjaw 就是官方目錄的快照，兩者是同一來源。
- 結論：**11/20 規劃的 samsonjaw 命名匯入不再另做**——同批 NSUID、同名、同來源，週末 backfill 已在跑（每日 12:20 繼續消化 3000 筆上限外的剩餘候選），重做只會重複寫入。270 款「新」NSUID 也都在官方目錄內；是否已是 DB 遊戲列，取決於週日每週掃描的建檔結果（不在本次執行環境可查範圍——service role key 只在 GitHub Actions secrets 與 shawn 家裡電腦）。
- 剩餘缺口（週末文件 `docs/tw-production-autofill.md` 亦有記載）：官方目錄未收錄的約 380 個當時已在售 `7001` NSUID，samsonjaw 也沒有，暫無可靠名稱來源——不要用第三方圖片、不要發明名字，等可靠來源再補。
