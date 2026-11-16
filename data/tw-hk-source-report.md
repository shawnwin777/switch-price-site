# 台港 eShop 編號來源調查報告

> 調查日期：2026-11-16（台北時間）
> 調查方式：全部以 node fetch 直接請求官方端點實測（User-Agent、重試、節流；
> 未使用瀏覽器、未登入任何帳號、未複製任何第三方比價站的資料）。
> 產出腳本：`scripts/probe-tw-hk-storefront.mjs`（探測）、
> `scripts/scan-tw-hk-price-api.mjs`（全區間掃描）、
> `scripts/merge-scan-into-full-ids.mjs`（合併命名）、
> `scripts/harvest-weekly-articles.mjs`（每週新作文章採集）。
> 完整對照檔：`data/tw-hk-full-ids.json`（29,237 個商品，19.7 MB）。

## 0. 結論先行

1. **找到比 166 款更大的完整來源：官方價格 API 全區間掃描。**
   NSUID 是按發售順序編排的 14 位數字，台港在售商品必然落在
   `70010000000000–70010000150000`、`70050000000000–70050000100000`（DLC）、
   `70070000000000–70070000040000`（Switch 2 版）三個區間內。
   2026-11-16 實測掃完全部區間：**台灣在售 9,742 筆、香港在售 21,472 筆**
   （遊戲本體＋DLC＋Switch 2 版＋同捆包等全部在售 SKU；
   另有 TW 1,394 筆、HK 3,182 筆非在售狀態：停售／預購中）。
   這是「追到有價格為止」的終點：每筆都有官方價格 API 回傳的在售價。
2. **台灣 166 款清單不完整，香港 176 款亦然。** 兩張清單都只是
   「任天堂發行＋部分第三方」的精選清單。證據：潛水員戴夫、
   小丑牌、黑帝斯 II、歧路旅人 II、雙人成行都在台港 eShop 在售，
   卻不在 166／176 款清單內（它們的編號出自每週新作文章或價格掃描）。
   分頁已跑到底（TW 4 頁、HK 5 頁，之後零新編號），166／176 是清單本身的
   全部，不是抓漏。
3. **台港編號是獨立的編號空間，幾乎不等於日本／美洲／歐洲編號。**
   實測：3,924 個 TW 在售編號（主區間）只有 2 個等於日本編號；
   HK 10,008 個也只有 2 個。瑪利歐驚奇 TW＝HK＝`70010000068691`，
   日本是 `68687`；潛水員戴夫 TW＝HK＝`60370`，日本是 `60371`。
   台港之間多數共用同一編號，但 2017–2019 年舊遊戲台灣用 2025-09
   開店時重登記的 `70010000102xxx` 新號、香港沿用舊號，
   必須分開查（曠野之息 TW `70010000102734`／HK `70010000009367`，
   互查皆 `not_found`）。
4. **星露谷物語：台灣、香港 eShop 皆無下載版。先前結論維持，未被推翻。**
   全區間掃描＋清單＋118 篇文章皆無；JP 編號 `70010000005423` 查 TW／HK
   皆 `not_found`，前後 ±10 號亦全數 `not_found`。詳見 §8。
5. **命名缺口是結構性的，不是抓漏問題。** 掃描列舉的 29,237 個商品中，
   能從公開來源對上標題的只有 **2,347 個**，其餘 26,890 個只有編號＋價格。
   任天堂沒有公開台港版的 title↔nsuid 全表；公開的命名來源只有
   官方清單（166／176）、每週新作文章（118 篇／2,326 編號）、
   香港舊 JSON（53 編號）。舊遊戲與 DLC 的標題目前無公開來源可對。
6. **自動更新流程已經可以實作（使用者目標：網頁自主更新、自己串聯）。**
   每個來源能否進排程、規模與更新頻率見 §1 總表與 §11 流程設計。
   核心就是兩張表加兩支程式：`game_region_ids` 對照表
   （`data/tw-hk-full-ids.json`，台港編號已齊）＋抓價腳本
   （價格 API，按分區群組查價）。
   韓國已補掃：主區間在售 9,648 款（見 §13.2），掃描腳本現已支援
   任意 2 碼國家碼（`--country KR` 等）。
7. **App 各國數量是該 App 自己的覆蓋，不是真實目錄大小——但使用者
   「清單頁不是全部」的前提是對的。** 使用者截圖的 App 數字（JP 23,482、
   HK 14,822、GB 24,314、KR 2）與本調查實測對照：JP 搜尋索引在售
   28,336 件（App 介於遊戲本體 14,970 與遊戲＋DLC 24,624 之間）；
   HK 掃描在售 21,472（App 最接近遊戲＋S2 版 13,902）；
   GB 歐洲搜尋 23,932（與 App 差 1.6%）。**KR 是決定性反證：
   App 寫 KR 只有 2 款，價格 API 掃描實測 KR 主區間在售 9,648 款**——
   App 的 KR 覆蓋近乎於零，其數字不能當真實目錄大小。
   真實目錄大小（實測）：TW 9,742、HK 21,472、KR ≥9,648（主區間）、
   JP 28,336、EU 23,932。商店前端本身沒有列舉全部商品的端點
   （見第 7 點與 §13.1）：完整目錄的來源是價格 API 掃描
   （台港韓）與歐日搜尋端點，不是商店前端。
8. **台港商店前端的資料端點已找到且帶價格欄位，但不能一站解決目錄＋價格。**
   端點是 Savanna GraphQL（`wb.lp1.savanna.srv.nintendo.net/graphql`），
   價格查詢文件已完整抽出：原價／特價／特價結束時間／三通路銷售狀態
   （缺特價開始時間；幣別隨 country 變，一次一國）。
   但該端點**無列舉功能**（11 個操作全是單品查詢與帳號操作），
   且價格查詢目前未打通（伺服器擋在 `$nsUids` 變數上，見 §14.3），
   Country 查詢則已打通（shopId 3／4／5＋client-id header）。
   台港仍須價格 API 掃描列舉＋抓價；NA／JP 可一站解決，台港不行。
   詳見 §14（與 region-count-gaps.md §5 對照）。
9. **商店前端的內部 GraphQL 端點已找到，但沒有列舉操作。**
   `https://wb.lp1.savanna.srv.nintendo.net/graphql`（無登入可通，
   introspection 被擋）。商品頁 chunk 內的 11 個操作全是單品查詢
   （商品詳情、價格）與帳號操作（願望清單等），沒有搜尋／瀏覽／
   列出全部商品的操作；ec.nintendo.com 各區 `/search`、`/`
   皆 404，只有 `/titles/<id>` 存在。結論：商店前端是結帳流程，
   不是目錄瀏覽器——它沒有完整目錄端點可找。詳見 §13.1。

## 1. 來源總表（含排程可行性與規模／更新頻率）

「排程直抓」指：純 HTTP GET、不需瀏覽器跑 JS、不需登入、無反爬阻擋
（本次調查共發約 15,000 次請求，價格 API 零次 429；
唯一遇到的失敗是代理層偶發的 socket 中斷，重試即恢復，
腳本已加 `Connection: close` 規避）。

| # | 來源 | 排程直抓？ | 規模（2026-11-16 實測） | 更新頻率 | 在自動流程的角色 |
|---|---|---|---|---|---|
| 1 | 價格 API 全區間掃描（§2.1） | ✅ 可 | TW 在售 9,742／HK 21,472（全部 SKU）；全量約 11,600 批 | 新編號隨遊戲登記持續產生；台港新增在售約每月數十款（見註） | 列舉＋抓價（核心） |
| 2 | 台港官方軟體清單（§2.2） | ✅ 可 | TW 166／HK 176 | 不定期，隨任天堂上架精選，約每週數款 | 命名（精選遊戲） |
| 3 | 每週新作軟體資訊文章（§2.3） | ✅ 可 | 118 篇／2,326 編號 | 每週五更新，每篇約 10–30 款 | 新遊戲自動進目錄（命名） |
| 4 | 香港 JSON（§2.4） | ✅ 可 | 544 筆，53 個編號 | 2022-06 後凍結，零更新 | 歷史命名（舊遊戲） |
| 5 | ec.nintendo.com 商店前端（§2.5、§13.1、§14） | ⚠️ 部分可 | 無目錄；內部 Alps GraphQL 已找到（`wb.lp1.savanna.srv.nintendo.net/graphql`），Country 查詢已打通（shopId 3／4／5＋client-id header），價格查詢文件已抽出（含原價／特價／特價結束時間）但未打通（擋在 `$nsUids`）；11 個操作皆無列舉功能 | 即時（商店前端即時資料源） | Country 可排程；價格未打通前不可排程；列舉無此功能 |
| 6 | 歐洲搜尋端點（§5） | ✅ 可 | 23,932 GAME，11,813 款有 product code | 持續更新 | 歐洲區編號＋product code |
| 7 | 日本搜尋端點（§5、§13.2） | ✅ 可 | 29,995 件；在售 28,336（遊戲 14,970＋DLC 9,654＋S2 3,712） | 持續更新 | 日本區編號＋icode |
| 8 | 美洲 Algolia（§5） | ⚠️ 需 key | 美洲區全目錄（未實測筆數） | 持續更新 | 美洲區編號（需自備 key，不建議用函式庫內嵌的他人 key） |
| 9 | 第三方比價站（§6） | ❌ 無公開 API／資料庫 | — | — | 無（僅方法論佐證） |
| 10 | 價格 API 韓國掃描（§13.2） | ✅ 可 | KR 主區間在售 **9,648**（2,600 批，200 秒） | 新編號持續產生 | 韓國區編號（DLC／S2 區間尚未掃） |

註：新增速度估算——ext1 區間（`70010000130000–150000`，約 14 個月的編號
分配量）TW 新增在售 534 筆、HK 547 筆，即台港各約每月 40 款在售 SKU；
全球編號分配速度約每月 1,400 個（含各區＋DLC＋S2 版）。
每日自動更新只需掃「前沿」新號段（約 40 批、10 秒），不需每天全量重掃；
全量重掃每週一次即可（約 25 分鐘）。

## 2. 各來源詳情

### 2.1 價格 API 全區間掃描（完整來源，✅ 已驗證）

- **端點**：`https://api.ec.nintendo.com/v1/price?country={TW|HK}&ids={50 個 ID}&lang=zh`
  （與 nintendeals 函式庫用的同一端點，見 §5；一次最多 50 個 ID，
  回傳每個 ID 的 `sales_status`：`onsale`／`sales_termination`／
  `preorder`／`not_found`，以及原價、特價、幣別、特價結束時間）。
- **方法**：NSUID 按發售順序編排，台港在售商品必然落在三個區間內，
  把區間掃完就是完整列舉，不依賴任何清單。
- **掃描區間與結果**（2026-11-16，並行度 4，`Connection: close`、429 退避）：

| 區間 | 內容 | TW 在售 | HK 在售 | 耗時 |
|---|---|---|---|---|
| `70010000000000–129999` | 遊戲本體主區間 | 3,924 | 10,008 | TW 307s／HK 350s |
| `70010000130000–150000` | 2026-11 後新編號 | 534 | 547 | 各約 81s |
| `70070000000000–40000` | Switch 2 版／升級包 | 1,114 | 3,347 | 各約 157s |
| `70050000000000–100000` | DLC／追加內容 | 4,170 | 7,570 | 各約 263s |
| **合計** | | **9,742** | **21,472** | **約 11,600 批，零 429** |

- **密度抽樣**（先導測試，每窗 1,000 個 ID）：星露谷附近
  `70010000005000` 區 TW 在售 0；戴夫附近 `60000` 區 15；
  台灣重登記 `102000` 區 107；2026 新作 `120000` 區 71。
  密度不均是正常的（舊號段多為未在台港上架的遊戲）。
- **限制**（誠實揭露）：
  - 價格 API 只回編號＋價格，**不回標題**。命名需另對來源（§2.2–2.4），
    結果：29,237 個商品中 2,347 個具名、26,890 個未具名。
  - 列舉的是「全部在售 SKU」，含 DLC（11,740 筆，`7005` 空間）、
    Switch 2 版／升級包（4,460 筆，`7007` 空間）、同捆包等，
    不只是遊戲本體。`7005`／`7007` 空間的編號可直接以號段區分
    DLC／S2 版；`7001` 空間內的 DLC 仍無法只憑編號區分。
  - 掃描是快照：新遊戲登記後編號會超出本次上限（`70010000150000`），
    需定期掃前沿（見 §11）。
  - 「在售」以掃描當下為準；特價、停售會變動。

### 2.2 台港官方軟體清單（✅ 可排程，但不完整）

- **網址**：`https://www.nintendo.com/tw/software/switch/`（166 款）、
  `https://www.nintendo.com/hk/software/switch/`（176 款）。
  Next.js 頁，RSC payload 的 Contentful 項目含 title＋nsuid，
  另有發售日、支援語言、salesFormat（タイトル／バンドル）、分級等欄位；
  分頁 `?spage=N`。
- **分頁實測**（2026-11-16，兩次獨立重跑結果一致）：
  TW 每頁 raw 約 96、fresh 約 24（其餘為精選＋最新重複項），
  第 4 頁累計 166、第 5 頁 fresh 0；HK 第 5 頁累計 176、第 6 頁 fresh 0。
  166／176 是清單本身的全部。
- **不完整的證據**：潛水員戴夫（TW `70010000060370`）、小丑牌
  （`70010000119174`）、黑帝斯 II（`70010000103276`）、
  歧路旅人 II（`70010000108551`）、雙人成行（`70010000121109`）
  皆在台港 eShop 在售（價格 API 驗證有價），但都不在 166／176 清單內。
  清單另有 `scheduled` 區段（含未發售新作，如靈渡之境
  `70010000140060`，2026-11-17 發售——這也是掃描上限需拉到 150000
  的原因之一）。
- **台灣沒有** `data/json/switch_software.json` 端點（仿香港路徑回 404）。
- **更新頻率**：清單隨任天堂上架精選而變，約每週數款；
  它不是 eShop 全目錄，不能當新遊戲發現來源（新遊戲多數不在此清單）。

### 2.3 每週「Nintendo eShop 新作軟體資訊」文章（✅ 可排程，新遊戲命名主力）

- **來源**：港台 topics 索引 `https://www.nintendo.com/{hk|tw}/topics/?p=N`
  （每頁 24 篇）→ 文章頁 `.../topics/article/<id>`，
  內文 Contentful 項目自帶 title＋nsuid。
- **實測**（`scripts/harvest-weekly-articles.mjs`，2026-11-16）：
  HK 索引 78 篇、TW 索引 40 篇，去重後 **118 篇**（前團隊 11-16 記錄為
  107 篇，期間新增 11 篇），共 **2,326 個不重複編號**。
  單篇範例：黑帝斯 II 文章（2025-09-26）含 26 組編號，
  含 Hades II `70010000103276` 與 S2 Edition `70010000105996`。
- **更新頻率**：每週五一篇（港台各一，內容多數相同、文章 id 共用），
  每篇約 10–30 款新遊戲。排程每週六抓一次即可覆蓋。
- **限制**：只含新作（2025-07 之後，TW 則 2026-01 之後），
  舊遊戲與 DLC 不在此。

### 2.4 香港 JSON（✅ 可排程，但已凍結）

- **網址**：`https://www.nintendo.com.hk/data/json/switch_software.json`
  （curl 抓回空是舊紀錄的誤判；node fetch 帶 User-Agent 實測 HTTP 200，
  505 KB）。
- **實測**：**544 筆**，發售日 2017.10.27～2022.6.24，**內容停在 2022-06，
  之後零更新**。`thumb_img` 為 14 位數字＋`.jpeg`／`.jpg` 者即香港 nsuid：
  59 列、**53 個不重複編號**（.jpeg 13 列＋.jpg 46 列；
  舊文件「59 筆是此格式」指的就是這 59 列，本調查補正為 53 個不重複編號，
  其餘 thumb 是舊式英文檔名）。
  另有 18 筆含台灣發售日。
- **角色**：僅能命名 53 個舊香港遊戲；其餘 544 個標題無編號可對
  （舊香港遊戲頁 `nintendo.com/hk/switch/<slug>/` 內無 nsuid 連結，已試過）。

### 2.5 ec.nintendo.com 商店前端（❌ 無法排程列舉）

- 任務所提的 `https://www.nintendo.com/zh-hant-tw/store/` 與
  `/zh-hant-hk/store/` **不存在**：皆導向 `/us/zh-hant-tw/store/` 回 404。
  `https://www.nintendo.com/tw/store/`、`/tw/eshop/` 亦 404；
  台灣首頁 `nintendo.com/tw/` 只有軟體清單連結，無商店連結。
- `ec.nintendo.com` 的 TW／HK 路由實測：
  `/TW/zh/`、`/titles`、`/search`、`/games`、`/store` 一律 404；
  只有 `/titles/<nsuid>` 商品頁本身回 200。
  舊搜尋 API `ec.nintendo.com/api/{TW|HK}/zh/search/sales` 已下線（404）。
- 商品頁 HTML 是 JS 殼：無標題、無價格、無 JSON-LD，
  og:title 只有「任天堂」；資料在客戶端經內部 **Alps GraphQL**
  （`usePricesQuery` 等 hook）載入，端點未寫在公開 JS 內，
  `/api/graphql` 與 `/graphql` GET 皆 404；
  `/api/client-config` 回 200 但只含 myNintendo／帳號／付款網址，
  無目錄端點。**結論：商店前端沒有可排程的公開列舉入口，
  只能人手在瀏覽器開單一商品頁核對。**

## 3. NSUID 分區群組實測（價格 API，2026-11-16）

nintendeals 稱 nsuid 是「分區群組」的，實測證實：

| nsuid（遊戲） | US | CA | MX | GB | DE | FR | ES | JP | TW | HK |
|---|---|---|---|---|---|---|---|---|---|---|
| NA 曠野之息 `70010000000025` | $59.99 ✓ | $84.99 ✓ | $1229 ✓ | ✗ | ✗ | — | — | ✗ | — | — |
| EU 曠野之息 `70010000000023` | ✗ | — | — | £59.99 ✓ | €69.99 ✓ | €69.99 ✓ | €69.99 ✓ | ✗ | — | — |
| JP 曠野之息 `70010000000026` | ✗ | — | — | ✗ | — | — | — | ¥7678 ✓ | ✗ | ✗ |
| TW 曠野之息 `70010000102734` | — | — | — | — | — | — | — | — | $1599 ✓ | ✗ |
| HK 曠野之息 `70010000009367` | — | — | — | — | — | — | — | — | ✗ | $399 ✓ |
| 瑪利歐驚奇 `70010000068691`（TW＝HK） | — | — | — | — | — | — | — | ✗ | $1339 ✓ | $329 ✓ |

- **美洲群組**：同一 NA nsuid 可查 US／CA／MX，不可查 GB／DE／JP。
- **歐洲群組**：同一 EU nsuid 可查 GB／DE／FR／ES，不可查 US／JP。
- **日本**：JP nsuid 只查 JP。
- **台港群組**：新遊戲 TW＝HK 共用；舊遊戲 TW 用 `102xxx` 重登記號、
  HK 用舊號，兩邊互查皆 `not_found`，必須分開查價。
- **對自動更新的意義**：抓價時一個遊戲只需「每群組一個 nsuid」：
  NA 1 個查 3 國、EU 1 個查歐洲各國、JP 1 個、TW／HK 各 1 個。
  32 國抓價不需要 32 個編號，只需要 4–5 個群組編號。

## 4. Product code：跨區串連的 join key（有，但台港尚無來源）

- nintendeals 的概念：product code（8／9 字元，如 `HACPAAAAA`）在各區
  是固定的；它取中段當 `unique_id`（JP 取 `[3:-1]`、其他區取 `[4:-1]`，
  如曠野之息 `AAAAA`），用來把同一遊戲在各區的 nsuid 串起來，
  比標題正規化可靠得多。
- **實測有此欄位的公開端點**：
  - 歐洲搜尋端點：23,932 GAME 中 11,813 款有 `product_code_txt`
    （如曠野之息 `["HACPAAAAA","HACYAAAAD"]`），且可用
    `product_code_txt:"HACPAAAAA"` 反查。
  - 日本搜尋端點：每件商品有 `icode`（5 字元中段，如瑪利歐驚奇 `AQMXA`、
    曠野之息 `AAAAA`、戴夫 `A8XTA`）。
- **台港的缺口**：台港官方清單、每週文章、香港 JSON、價格 API
  皆無 product code 欄位，所以目前無法用 product code 串台港編號。
  若日後出現台港 product code 來源（例如 ec.nintendo.com 商品頁的
  GraphQL 回傳內含 productCode——nintendeals 的美洲爬蟲就是從
  `nintendo.com/store/products/<slug>` 的 `__NEXT_DATA__` 取
  `productCode`），跨區比對可從標題正規化升級為 product code join。
  目前先記錄，列為後續。

## 5. nintendeals 開源函式庫（端點做法的公開記錄）

來源：`https://github.com/fedecalendino/nintendeals`（main 分支，
最後更新 2024-09-28；PyPI 1.5）。它把 eShop 服務分成
Info／Listing／Searching／Pricing，每區（NA／EU／JP）各一套，
Pricing 共用。以下為原始碼讀出的端點＋2026-11-16 實測狀態：

| 區域 | Listing／Searching 端點（原始碼） | 2026-11-16 實測 | 備註 |
|---|---|---|---|
| NA | Algolia：APP_ID `U3B6GR4UA3`、index `store_game_en_us`；列舉法是以前綴 `7001`＋7 位流水號搜 nsuid（`hitsPerPage: 500`，連續 5 個空頁即停） | 未測試（key 為函式庫內嵌、回應中已遮蔽，本調查不採用、不重現） | 美國商店前端現用自己的 Algolia key；用他人內嵌 key 不是正規做法 |
| NA Info | 爬 `https://www.nintendo.com/store/products/{slug}/` 的 `__NEXT_DATA__`（`initialApolloState` 取 `nsuid`、`productCode`） | 未測試（Info 非列舉必需） | 證實美洲商品頁內含 productCode |
| EU | `https://search.nintendo-europe.com/en/select?q=*&fq=type:GAME&rows=200&start=…&wt=json`，可用 `nsuid_txt:"…"`、`product_code_txt:"…"` 篩選 | ✅ 200，`numFound: 23932` GAME；曠野之息 EU nsuid 查詢命中 1 筆 | 公開 Solr 端點，無 key 即可翻頁列舉；`related_nsuids_txt` 只列歐洲區編號，無跨區 join |
| JP | `https://search.nintendo.jp/nintendo_soft/search.json?q=&limit=150&page=…&opt_hard=1_HAC` | ✅ 200，空查詢 `total: 29995` 件；標題查詢（如ゼルダ）命中，欄位含 `id`／`nsuid`／`cnsuid`／`icode`／`pprice`／`ssitu` | `q` 是標題搜尋，nsuid 當 `q` 查不到（回 0 件）；空查詢可翻頁列舉。`cnsuid` 是關聯編號（DLC／S2 版，如戴夫的 `7005…`、曠野之息的 `70070000000024`），不是台港編號 |
| Pricing | `https://api.ec.nintendo.com/v1/price?country=…&lang=en&ids=…`（1–50 個） | ✅ 與本站用的同一端點，見 §2.1 | —— |

- **沒有 TW／HK 模組**：nintendeals 只有 NA／EU／JP 三區，
  這與本次調查一致——台港沒有等效的公開 Listing 端點，
  所以才需要價格 API 掃描法。
- **授權**：公開開源函式庫（MIT 類授權的一般開源專案，
  以 GitHub 頁面標示為準）；本調查只讀端點做法，未複製其資料、
  未使用其內嵌的 Algolia key。

## 6. 第三方比價站（只記錄來源說明與做法，未複製資料）

| 站 | 來源說明（公開頁面原話／摘要） | 推斷的做法 | 對台港編號的價值 |
|---|---|---|---|
| checkgreenpipe.com | 方法論頁： figures trace back to Nintendo eShop、Steam、HowLongToBeat；「Nintendo eShop prices are fetched once daily across 49 countries」；每款遊戲頁標註 `Source: JSON-LD Product.offers` | 每日向官方 eShop 抓價（價格 API 及／或商品頁結構化資料）＋自有編號表 | 無公開列舉端點；僅佐證「官方 eShop＋每日自動抓價」機制。前團隊曾用它交叉核對台港價（戴夫 TW $10.63 ≒ 350／HK $17.84 ≒ 140，與價格 API 一致） |
| GreenDock（greendock.app） | 首頁：「價格來自各地區任天堂 eShop」；TW eShop 歷史低價例：軌道雙子星 TWD 1,113（另有 45 國特價） | 每日自動向各區 eShop 抓價＋自有編號表 | 證實台灣價的完整來源存在，且是程式自動抓取；無公開 API／資料庫 |
| eshop-prices.com | FAQ 只有跨區購買、付款、圖示、最便宜國家、廣告說明，**未寫資料來源**；明說「The code is private」（程式碼不公開） | 未公開；只能確定不是公開 API／公開資料庫 | 無；不要假設它有公開來源 |
| DekuDeals（dekudeals.com） | 首頁：「tracks the prices of Nintendo Switch, PlayStation, Xbox, and Steam games at official stores」；每筆價格帶抓取時間戳（如「6 hours ago at Nintendo eShop」）；2018 年上線（Gamepur 2018-03-03 報導，AI 出現前數年） | 程式定時輪詢官方商店 | 證實「官方商店＋自動定時抓取」機制；以美國市場為主（美元＋美國零售商），不做多國 eShop 比價，對台港編號無直接價值 |
| switch-games.com（Switch價格王） | 無公開方法論頁面（本次搜尋未找到） | 未公開 | 已驗證該站確實有台灣價（如夏莉 DX TW NT$436、Trials of Mana TW NT$447），但列舉端點未公開；依任務限制未爬其資料 |
| 遊戲盒子（GameBox） | 無公開方法論；App 宣稱 8,000+ 遊戲 | 未公開 | 香港覆蓋完整是使用者舉證，但無公開來源可取用 |

## 7. 「共同彙整來源」評估：未發現共用的公開價格資料庫

- 檢查結果：**沒有任何一個公開的、共用的台港／全球價格資料庫或 API**
  可供本站直接串聯。各站的共同點只有兩項：
  （a）**機制相同**：各自向任天堂各區官方端點抓價（價格 API 為主），
  再自己維護各區編號對照表；
  （b）**公開的端點知識**：nintendeals 開源函式庫記錄了各區端點做法
  （它是方法文件，不是資料來源）。
- eshop-prices.com 明說程式碼不公開；checkgreenpipe、GreenDock、
  DekuDeals 皆未公開其編號表或 API；switch-games.com、遊戲盒子亦然。
- GitHub 上的公開 NSUID 相關資料集皆非 eShop NSUID：
  `blawar/titledb` 等是主機端 program ID（`0100…` 16 進位），
  與 eShop NSUID（`70010000…`）是不同編號體系，不能對接；
  `fedecalendino/nintendeals` 是端點函式庫而非資料集；
  `cutecore/Nintendo-Switch-eShop-API` 是官方 API 包裝，
  亦無台港編號表。GitHub code search 未登入已達 rate limit，
  但 repo 搜尋（64 筆）已足夠判斷：無可用的公開台港 NSUID 資料集。
- **結論**：本站必須自建對照表（本次交付的 `tw-hk-full-ids.json`
  就是這張表）＋自跑抓價程式——這正是各家比價站的做法，
  沒有捷徑可抄。

## 8. 星露谷物語專節（先前結論維持）

- 檢查清單：台灣官方清單 166 款無；香港清單 176 款無；
  118 篇港台每週新作文章無；香港 JSON 544 筆無；
  checkgreenpipe 無台港價；**全區間價格掃描無**。
- 價格 API 直接驗證：JP 編號 `70010000005423` 查 TW／HK 皆 `not_found`；
  前後 ±10 號（`5413–5433`）TW／HK 亦全數 `not_found`；
  抽樣窗 `70010000005000–05999` TW／HK 在售皆 0。
- **結論：台灣、香港 eShop 皆無星露谷物語下載版，只有實體卡。
  不是資料缺口，是未上架。** 若日後上架，前沿掃描會自動發現
  （新編號落在 150000 之後的新區段，見 §11）。
- 同樣確認台港皆無（全區間掃描＋文章＋清單皆無）：
  黑帝斯、空洞騎士、蔚藍、Undertale、女神異聞錄5 皇家版、絲之歌。
  死亡細胞香港有（HKD 188）、台灣無；其香港編號在掃描結果中
  以未具名形式存在（價格已知，標題未對上——見 §10 的未具名說明）。

## 9. 掃描法評估（成本、限制、重跑）

- **成本**：全量 TW＋HK 四個區間約 11,600 批請求、每區約 13 分鐘
  （兩區並行約 14 分鐘；並行度 4、每批間隔 100ms）；本次調查累計
  約 12,000 次請求，**零次 429**。唯一故障是代理層偶發 socket 中斷（重試＋
  `Connection: close` 後排除）。以官方公開 API 的常規查詢計，
  此量級不是暴力請求；但請勿把並行度調高。
- **覆蓋**：列舉完整性只取決於區間上限；本次上限
  `70010000150000`／`70050000100000`／`70070000040000`
  已含台灣清單內最大編號（`70010000140060`、2026-11-17 發售）
  與 S2 版最大編號（`70070000030643`）。上限需隨時間上調。
- **斷點續跑**：檢查點 `data/.cache/scan-<CC>[-extN].json`
  記錄已完成批號，重跑自動續掃。
- **限制**：不回標題（命名缺口，見 §0.5）；快照性質（需重掃更新）；
  價格 API 的 `sales_termination`／`preorder` 只記狀態，
  不代表可購。

## 10. 交付物

| 檔案 | 內容 |
|---|---|
| `data/tw-hk-source-report.md` | 本報告 |
| `data/tw-hk-full-ids.json` | 完整對照：29,237 個商品（TW 有價 9,643、HK 有價 21,367、兩區皆有 1,773；具名 2,347、未具名 26,890；DLC 11,740、S2 版 4,460），每筆含 `titleZh`／`titleEn`／`jpTitleId`／`twTitleId`／`hkTitleId`／`source`／`twPrice`／`hkPrice`（原價、特價、幣別、折扣、特價結束時間、銷售狀態）。格式較任務指定多 `twPrice`／`hkPrice` 兩欄（否則「追到有價格為止」無處放價格） |
| `data/.cache/scan-{TW,HK}[-ext1,-ext2,-ext3].json` | 掃描檢查點（四區間，含價格快照） |
| `data/.cache/scan-KR.json` | 韓國主區間掃描檢查點（2,600 批，10,228 筆非 not_found，在售 9,648；2026-11-16 晚補掃，見 §13.2） |
| `data/.cache/weekly-articles.json` | 118 篇新作文章、2,326 編號 |
| `scripts/probe-savanna-graphql.mjs` | Savanna GraphQL 探測腳本（執行時自商品頁現取 client-id，不寫死；Country 查詢已打通，價格查詢印出實測阻擋，見 §14） |
| `scripts/probe-tw-hk-storefront.mjs` | 探測腳本（已跑通，見輸出摘要於 §2 各節） |
| `scripts/scan-tw-hk-price-api.mjs` | 全區間掃描腳本（可斷點續跑，`--tag` 分區間；2026-11-16 晚已放寬為任意 2 碼國家碼，KR 已實測可用） |
| `scripts/merge-scan-into-full-ids.mjs` | 合併命名腳本（讀掃描＋清單＋文章＋HK JSON） |
| `scripts/harvest-weekly-articles.mjs` | 每週新作文章採集腳本（可斷點續跑） |

- **附帶修正**：合併腳本曾因 `import` 具頂層 `main()` 的
  `map-tw-hk-title-ids.mjs` 而意外重跑該腳本並改寫
  `data/tw-hk-title-ids.json` 的 `generated_at`（內容不變，
  摘要仍為 24／32 款、23 價、149 款獨有）；已改為內聯
  `normalizeTitle`，不再 import。另補正香港 JSON thumb 計數：
  舊文件「59 筆」是 59 列，實為 53 個不重複編號
  （.jpeg 13 列＋.jpg 46 列）；合併腳本原只認 .jpeg（9 個），已修正為兩種副檔名。
- **未具名的 26,890 筆**：只有編號＋價格。主因是舊遊戲與 DLC
  無公開標題來源；其次是 `7005`／`7007` 空間的 DLC／S2 版
  在文章與清單內覆蓋低。這是誠實的現狀，不是抓漏失誤。

## 11. 自動更新流程設計（呼應「網頁自主更新、自己串聯」）

目標：每日更新自己抓各區官方清單、新遊戲自動進目錄、自己抓各國價格
寫進資料庫，不用手動跑種子。本次調查證實以下流程全部可用純 HTTP
排程程式實作（Vercel Cron＋外部免費排程皆可；腳本皆為 Node 18+ 零依賴）：

1. **新遊戲發現（每週六）**：跑 `harvest-weekly-articles.mjs`
   （118 篇 → 每週新增約 1 篇，10–30 款）＋掃描「前沿」號段
   （`70010000150000` 起約 2,000 個編號、40 批、10 秒，
   以及 `7007`／`7005` 前沿）。新編號對上文章標題即具名進目錄；
   對不上者先以編號＋價格進目錄（未具名），待清單或文章補名。
2. **價格更新（每日 08:00 台北）**：對 `tw-hk-full-ids.json`
   的每個遊戲，用其**分區群組編號**查價格 API——TW／HK 各 1 個、
   EU 1 個（查 GB／DE／FR／ES…）、NA 1 個（查 US／CA／MX）、JP 1 個。
   EU／JP／NA 編號來源：擴大目錄（JP）、歐洲／日本搜尋端點（§5，
   可排程列舉）、美洲 Algolia（需自備 key）。
   全量重掃（列舉用）每週一次即可，不需每天重掃 8,400 批。
3. **台灣／香港官方清單（每週）**：跑 `fetchSoftwareList`
   （166／176 款），補精選遊戲的標題與新上架精選。
4. **寫庫**：沿用現有 `seed-expanded.mjs` 的 upsert 模式
   （`game_region_ids` 對照表＋`prices`），新遊戲以
   `slug`（具名）或 `tw-<nsuid>`（未具名）建檔，之後補名時合併。
5. **上限維護**：每季檢查台灣清單最大編號，若接近掃描上限
   （目前 `70010000150000`），上調 `--to` 並重掃前沿。

## 13. 補充調查（2026-11-16 晚）：App 各國數量對照與商店前端 GraphQL 深挖

使用者傳來某比價 App「設定顯示國家」截圖，各國遊戲數量：
日本 23,482、香港 14,822、英國 24,314、加拿大 23,627、
南非 21,665、紐西蘭 20,528、歐洲多國約 11,064
（匈牙利 11,105、瑞士 11,067、捷克 21,710、丹麥 11,110）、
韓國只有 2 款。使用者據此指出：日本 23,482 遠大於 JP XML 的
10,045，香港 14,822 亦遠大於 176 款清單／544 筆 JSON，
JP XML 與港台清單頁都只是子集，真正的完整清單應該在各區
eShop 商店前端本身。本節實測回應此前提。

### 13.1 商店前端 GraphQL：端點找到了，但沒有列舉操作

- **端點**：台灣商品頁 HTML 內含
  `https://wb.lp1.savanna.srv.nintendo.net/graphql`
  （Savanna 是任天堂內部平台名；環境 `lp1` 見 `/api/client-config`）。
  該端點**無登入可通**：POST `{ __typename }` 回 200
  `{"data":{"__typename":"Query"}}`。
  Introspection 被擋（`__schema` 查詢回 400 INVALID_PARAM，
  errorCode 1802）。`/api/graphql`、`/graphql`（ec.nintendo.com 上）
  皆 404，不是端點。
- **客戶端實作**：商品頁 chunk 用 urql＋persisted query（APQ，
  `extensions.persistedQuery: {version: 1, sha256Hash}`）。
  從商品頁載入的 chunk 內共抽出 **11 個 GraphQL 操作**，
  全部是單品或帳號操作，沒有任何搜尋／瀏覽／列舉操作：
  `ItemUserPrices`（價格）、`ApplicationDetailClientRootClient`
  （商品詳情）、`Country`、`AccountRights`、`DemosDownload`、
  `MyLinkedDevice`、`MyDownloadableDevices`、`UseCompatibilityInfo`、
  `AddToWishlist`、`RemoveWishlist`（＋1 個匿名操作）。
- **ItemUserPrices 完整文件已抽出**（見 `/tmp/twhk/item-user-prices.graphql`）：
  ```graphql
  query ItemUserPrices($shopId: Int!, $country: CountryCode!,
    $language: LanguageCode!, $idToken: String, $nsUids: [NsUid!]!)
    @inContext(shopId: $shopId, country: $country, language: $language) {
    prices(nsUids: $nsUids, idToken: $idToken) {
      nsUid
      right { isSelfOwned ownedItems { isSelfOwned isScheduledOrdered } }
      regularPrice { id formattedValue rawValue currency }
      preOrderInfoV2 { isDownloadReady }
      discountPrice { __typename id formattedValue rawValue endDatetime currency }
      itemStatuses { hac { salesStatus } offdevice { salesStatus } bee { salesStatus } }
      purchaseTimeLimitV2 { ... }
    }
  }
  ```
  `shopId` 是客戶端常數（模組 501347 匯出 `SHOP_ID`；
  minified 程式碼 `e.s(["SHOP_ID",0,3])` 未能直接讀出數值）。
- **Persisted query 未打通**：以 graphql-js `print` 印出上述文件、
  SHA-256 得 `96bb08b2850892f4d14427008714811612d0ce4b3e4519ea7c7fc0b079543dd6`，
  以 shopId 1／2／3 送出皆回 `PersistedQueryNotFound`
  （errorCode 1807）。可能原因：chunk 版本與伺服器登記的版本
  不同步，或雜湊輸入不是印出的 AST（例如原始查詢文字）。
  直接送全文查詢亦被拒（400 INVALID_PARAM，位置在變數定義／
  `@inContext` 處——伺服器只接受已登記的 persisted query）。
- **路由再確認**：`ec.nintendo.com/US/en/`、`/US/en/search?q=mario`
  皆 404；只有 `/US/en/titles/<nsuid>` 回 200，且美國商品頁是
  伺服器渲染（`<title>` 即遊戲全名，HTML 約 1 MB），與台灣商品頁
  是 JS 殼（og:title 只有「任天堂」）不同。
  但美國商品頁經代理抓取極不穩定（同 URL 先回 200，後續 7 次嘗試
  全數 socket 中斷；台灣商品頁同期仍可通），未再深究。
- **結論**：商店前端（ec.nintendo.com）是**結帳流程，不是目錄瀏覽器**。
  它的 GraphQL 只有單品詳情＋價格，沒有列出全部商品的操作；
  也沒有任何瀏覽／搜尋路由。**完整目錄不在商店前端裡**，
  找遍前端也列不出全部上架商品。完整來源仍是價格 API 掃描
  （台港韓）與歐日搜尋端點（§5、§13.2）。
  GraphQL 的完整深挖（端點、價格欄位表、Country 已打通、價格查詢
  卡在 `$nsUids`、一站解決與否）見 **§14**。

### 13.2 App 各國數量對照：App 的數字是其自有覆蓋，不是真實目錄

| 國家 | App 數字（使用者截圖） | 本調查實測（2026-11-16） | 對照結果 |
|---|---|---|---|
| 日本 | 23,482 | JP 搜尋索引**全 200 頁逐項統計**：在售 28,336＝遊戲本體 `7001` 14,970＋DLC `7005` 9,654＋S2 版 `7007` 3,712；另 preorder 59、未發售 82、停售 678、not_found 837。JP XML 10,045 | App 介於「遊戲本體 14,970」與「遊戲＋DLC 24,624」之間，最接近後者（差 1,142，4.6%）；**JP XML 僅為 7001 在售的 67%，確為子集**，使用者前提成立 |
| 香港 | 14,822 | 價格掃描在售 **21,472**（7001 10,555＋7007 3,347＋7005 7,570）；遊戲＋S2 版＝13,902 | App 最接近遊戲＋S2 版（差 920，6.6%）；App 未含全部 DLC |
| 英國 | 24,314 | EU 搜尋 GAME **23,932**（eshop_removed 僅 87；digital 20,385） | 差 382（1.6%），基本一致 |
| 韓國 | **2** | 價格掃描主區間（`70010000000000–129999`，2,600 批，200 秒）：**在售 9,648**（非 not_found 10,228：停售 500、其他 80；例：`70010000008801` KRW 36,400） | **App 的 KR 數字完全錯誤**：韓國不是 2 款，是 9,648+ 款（DLC／S2 區間尚未掃，實際更多）。App 的 KR 覆蓋近乎於零 |
| 加拿大／南非／紐西蘭／捷克／匈牙利／瑞士／丹麥 | 23,627／21,665／20,528／21,710／11,105／11,067／11,110 | 本次未獨立驗證（NA Algolia 需 key；EU 國家別可用性未測） | 歐洲內部落差極大（11k vs 21k）已暗示 App 數字反映其自有覆蓋／各國上架差異，非單一目錄；KR 的反證更說明其數字不可當真實目錄大小 |

**結論**：
- 使用者「JP XML 與港台清單頁都不是完整目錄，只是子集」**成立**：
  JP XML 10,045 ＜ JP 搜尋索引 7001 在售 14,970 ＜ 在售全部 28,336；
  TW 清單 166 ＜ TW 掃描在售 9,742；HK 清單 176 ＜ HK 掃描在售 21,472。
- 但「真正的完整清單應該在商店前端本身」**不成立**（見 §13.1）：
  商店前端無列舉端點。完整目錄的實際來源是價格 API 全區間掃描
  （TW 9,742／HK 21,472／KR ≥9,648）與歐日搜尋端點
  （JP 28,336 在售／EU 23,932 GAME）。
- App 的各國數字是**該 App 自己資料庫的覆蓋量**（含其收錄規則：
  例如 HK 接近「遊戲＋S2 版」、JP 接近「遊戲＋DLC」），
  不是各區 eShop 的真實商品總數；KR 的 2 vs 9,648 是決定性證據。
  以 App 數字反推「還缺多少」會失真，應以本報告的實測數為準。
- **韓國補充**：KR eShop 並非幾乎沒東西；種子檔「KR 只有 4 款有價」
  只是種子檔的覆蓋，不是 KR 目錄。掃描腳本已放寬為任意 2 碼國家碼
  （`--country KR`，lang：TW／HK→zh、JP→ja、其餘→en），
  檢查點 `data/.cache/scan-KR.json`；KR 的 DLC（`7005`）與 S2 版
  （`7007`）區間尚未掃，若要 KR 全量可再跑兩區間。

## 14. 商店前端資料端點深挖（2026-11-16 晚，使用者指定方向）

使用者指定方向：大多數比價站是定期抓各區官網前端公開的 JSON／API，
不一定用價格 API；台港商店前端渲染商品頁／列表時呼叫的端點就是正規來源。
本節實測回答：台港商店前端的資料端點是什麼、一次能拿多少款、
是否分頁、有無價格欄位、多久更新、限制。另與數量差距驗證員的
`data/region-count-gaps.md` §5（NA／EU／JP 前端端點價格欄位）對照。

### 14.1 端點：Savanna GraphQL（台港商店前端唯一的資料端點）

- **URL**：`https://wb.lp1.savanna.srv.nintendo.net/graphql`（POST，JSON）。
- **來源**：台灣商品頁 HTML（RSC payload）內嵌的 UrqlProvider props；
  商品頁本身是 JS 殼（HTML 內無標題、無價格、無 JSON-LD；
  實測 `1339`／`Wonder`／`formattedValue` 皆不在 HTML 內），
  全部資料在客戶端經此端點載入。RSC payload 另含
  `locale: {region: "TWN", country: "TW", language: "zh"}` 與 `nsUids: []`。
- **呼叫條件**：需帶 header `X-Nintendo-Savanna-Client-Id`
  （64 字元 hex，商品頁 RSC payload 內嵌；每次執行時現取，不寫死——
  見 `scripts/probe-savanna-graphql.mjs`）。
  無此 header 時，shopId 3／4／5 的請求會被 Diddy 閘道以
  5202「No API key found in request」擋下。
  另需 `shopId`（Int）＋ `@inContext`（country／language）。
- **shopId**：3、4、5 皆可查 TW／HK（Country 查詢實測回傳資料）；
  1、2、6–12 回 INVALID_PARAM。shopId 不分區
  （shopId 3 查 HK 亦回 HK 資料），應是商店後端分片而非地區碼。
  真實 `SHOP_ID` 常數值未從 minified bundle 解出
  （`e.s(["SHOP_ID",0,3])`），但 3 可用。
- **客戶端實作**：urql＋persisted query（APQ，sha256Hash）；
  `preferGetForPersistedQueries: true`。伺服器只認已登記的
  persisted query；全文查詢須帶
  `extensions.persistedQuery {version: 1, sha256Hash, miss: true}`
  才會執行（miss:true 是客戶端重試格式）。
  Introspection 被擋；`{ __typename }` 可通。
- **操作清單**（商品頁 bundle 內共 11 個）：`ItemUserPrices`（價格）、
  `ApplicationDetailClientRootClient`（商品詳情）、`Country`、
  `AccountRights`、`DemosDownload`、`MyLinkedDevice`、
  `MyDownloadableDevices`、`UseCompatibilityInfo`、`AddToWishlist`、
  `RemoveWishlist`（＋1 個匿名操作）。**無搜尋／瀏覽／列舉操作**。

### 14.2 價格欄位（自 ItemUserPrices 查詢文件，全文已抽出）

| 欄位 | 內容 | 備註 |
|---|---|---|
| `regularPrice {id, formattedValue, rawValue, currency}` | 原價（數值＋格式化字串＋幣別） | rawValue 是整數（如 TWD 1339） |
| `discountPrice {id, formattedValue, rawValue, endDatetime, currency}` | 特價＋特價結束時間 | 只有結束時間，**無特價開始時間**（NA Algolia 有 discountPriceStart，見 region-count-gaps.md §5） |
| `itemStatuses {hac, offdevice, bee} {salesStatus}` | 三種販售通路的銷售狀態 | hac＝主機 eShop、offdevice＝網頁商店、bee＝未確認 |
| `preOrderInfoV2 {isDownloadReady}` | 預購下載狀態 | |
| `purchaseTimeLimitV2 {limitCount, remainingCount, endDatetime}` | 限時購買額度 | |
| `monthlyPrice {formattedValue}` | 月費顯示（NSO 相關） | |
| `tradeDiscountRates {id, ticketItemGroupId, unitMinutes, value}` | 兌換券折扣率 | |
| `right {isSelfOwned, ownedItems {isSelfOwned, isScheduledOrdered}}` | 持有狀態（需登入） | 未登入時此段應為空／錯誤 |

- **幣別**：由 `@inContext` 的 country 決定（TW→TWD、HK→HKD），
  一次呼叫只給一個國家的價；多國要分開查（與 EU Solr 相同限制）。
- **對照其他區**（region-count-gaps.md §5）：NA Algolia 有
  regularPrice／discountPrice／discountPriceStart／End／currency／
  isPurchasable；JP 搜尋 API 有 pprice／dprice／sprice／current_price／
  sale_flg；EU Solr 有 price_regular_f／price_lowest_f／
  price_has_discount_b。台港 GraphQL 的價格欄位完整度與 NA／JP 相當
  （缺特價開始時間）。
- 商品詳情查詢 `ApplicationDetailClientRootClient` 另含標題、
  productCode、DLC／組合包清單、升級資訊，但需 `$idToken: String!`
  （即需登入，見 §14.3）。

### 14.3 實測：Country 通、Prices 不通（卡在 `$nsUids`）

- **Country 查詢（國家／商店資訊）：已打通。** shopId 3＋header，
  TW 回 `iso=TW region=TWN paypal=false cc=true`；
  HK 回 `iso=HK region=TWN paypal=false cc=true`；
  shopId 4、5 亦通。回傳含付款方式、價格格式、餘額上限、儲值面額、
  金幣兌換率、商店開店狀態（`shopStatuses.offdevice.shopOpenStatus`）。
  探測腳本 `scripts/probe-savanna-graphql.mjs` 每次執行皆重現此結果。
- **ItemUserPrices 價格查詢：未打通。** 伺服器以 INVALID_PARAM
  （errorCode 1802）擋在 line 1 column 105，即 `$nsUids` 變數定義處
  （精確量測：col 105＝`$nsUids` 的 `$`；line 2 col 18＝
  `prices(nsUids: $nsUids, …)` 的 `$`）。
  已試：hash 四種算法（print／去 `@inContext`／stripIgnoredCharacters
  兩種）、idToken 有無／String／String!／空字串／假 JWT、
  nsUids 四種型別（`[NsUid!]!`／`[String!]!`／`[NsUid]`／`[String]`）、
  變數改名（`$ids`）、變數調序（idToken 移最後）、shopId 1–12、
  有無 client-id header、miss:true／hash-only——**全部在同一位置被拒**。
  對照實驗：Country 查詢加一個 `$nsUids` 變數也會在同一位置被拒；
  Country 原文則通過。結論：伺服器對照已登記的 persisted query
  文件驗證，`$nsUids` 相關定義與登記版本不符
  （可能原因：伺服器登記的版本與 CDN bundle 的版本不同步；
  或 prices 欄位需登入 session 才能驗證）。
- **打通的唯一已知途徑**：以真實瀏覽器開商品頁，觀察實際發出的
  GraphQL 請求，取得正確的 sha256Hash 與完整文件
  （本 subagent 無 live browser 工具，無法執行；
  需 parent 另派可操作瀏覽器的 agent）。
- **批量／分頁／更新頻率**（未能實測，據文件推斷）：
  prices 查詢接受 nsUid 清單（`nsUids: [NsUid!]!`），批量上限未知
  （未打通故無法測；價格 API 為 50／次，可作參考）；
  **無分頁機制**（傳 ID 清單即回價格，無 cursor）；
  更新頻率為即時（商店前端的即時資料源，Country 回傳即時商店狀態佐證）。

### 14.4 一站解決？台港不行（與 NA／JP 不同）

- NA Algolia、JP 搜尋 API：目錄＋價格一站解決（region-count-gaps.md §5 已驗證）。
- 台港 GraphQL：**有價格欄位，但無列舉功能**。商品頁 bundle 內的
  11 個操作全是單品查詢（商品詳情、價格）與帳號操作（願望清單等），
  無搜尋／瀏覽／列出全部商品的操作；ec.nintendo.com 各區
  `/search`、`/store`、`/games` 皆 404，只有 `/titles/<id>` 存在。
  **商店前端沒有目錄清單端點**——它只賣單品，不瀏覽目錄。
- **結論**：台港「完整目錄＋價格」目前仍須兩條路並行：
  列舉用價格 API 全區間掃描（TW 9,742／HK 21,472，見 §2.1）；
  價格欄位用同一價格 API（每筆掃描已含原價／特價／幣別／特價結束時間）。
  GraphQL 若日後打通，可作為台港價的第二來源與單品命名來源
  （詳情查詢含標題＋productCode），但永遠不能當列舉來源。
- **排程註記**：Country 查詢可排程（純 POST＋header，shopId 3）；
  ItemUserPrices 目前不可排程（未打通）；列舉不可排程（無此功能）。

## 12. 未解與後續

1. **未具名 26,890 筆的標題**：目前無公開來源。可能的方向：
   以價格比對 JP／EU 價反推（弱證據，不建議當主鍵）、
   等任天堂公開更多清單、或以 `ec.nintendo.com` 商品頁的
   Alps GraphQL 為突破口。2026-11-16 晚已找到 GraphQL 端點
   （`wb.lp1.savanna.srv.nintendo.net/graphql`，無登入可通，
   但 introspection 被擋；11 個操作皆無列舉功能，見 §13.1、§14）：
   Country 查詢已打通（shopId 3／4／5＋client-id header），
   但 ItemUserPrices 價格查詢卡在 `$nsUids` 變數（10 餘種變體皆拒），
   商品詳情查詢需 `$idToken: String!`（登入）。
   需以真實瀏覽器觀察實際請求取得正確 hash／文件（本 subagent
   無 live browser 工具）。即使打通，它也只能當單品命名／價格來源，
   不能列舉。
2. **Product code join**：待台港 product code 來源出現後，
   可把跨區比對從標題正規化升級（見 §4）。
3. **美洲區列舉**：需自備 Algolia key（或改用美國商店前端自己的
   搜尋端點研究）；本次未採用函式庫內嵌 key。
4. **DLC 與遊戲本體的區分**：`7005`／`7007` 空間可直接以號段區分；
   `7001` 空間內的 DLC 仍無法只憑編號區分，需標題或商品頁資訊。
5. **台灣清單的 `scheduled` 區段**：含未發售新作（預購狀態），
   掃描的 `preorder` 狀態與之對應；發售後轉 `onsale`，由每日
   前沿掃描自動捕捉。
