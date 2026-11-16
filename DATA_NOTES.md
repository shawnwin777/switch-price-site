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
| `lib/refresh-slices.ts` | 切片與輪轉純函式（每日更新用） |

### 10.2 台港價格（任務 A）

- **新來源**：台灣官方遊戲清單 `https://www.nintendo.com/tw/software/switch/`
 （Next.js 頁，RSC payload 含 title＋nsuid，分頁 `?spage=N`，166 款）；
  香港同結構 `https://www.nintendo.com/hk/software/switch/`（176 款）。
  台灣**沒有** `data/json/switch_software.json` 端點（仿香港路徑回 404）。
  另有港台每週「Nintendo eShop 新作軟體資訊」文章共 107 篇（內文含 title＋nsuid），
  是新遊戲台港編號的主要來源。
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
  166 款無、107 篇新作文章無、價格 API 掃不到、第三方比價站亦無台港價），
  只有實體卡。**不是資料缺口，是未上架**，需等日後上架再追蹤；不要再列為待補。
  同樣未上架台灣的還有黑帝斯、空洞騎士、蔚藍、Undertale、女神異聞錄5
  皇家版、絲之歌、雙人成行（台灣無，香港有 HKD 319）——見對照檔 unmapped。
- **4 款未對到的後續**：pokemon-za、ring-fit、hades2 已找到（見 §3），
  絲之歌仍未找到（發售當週香港新作文章無此遊戲，台港皆無在售）。
- **未明編號**：`70010000058126`／`49288`／`42364`／`20843` 四個台港在售
  編號身份未明（價格 API 掃描發現的真實商品），擴目錄時若撞上需另外查身份；
  死亡細胞的香港編號亦未找到（香港有賣 HKD 188，現 50% off 到 94）。

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
