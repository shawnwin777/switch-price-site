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
