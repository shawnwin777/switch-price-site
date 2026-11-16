# 各區 NSUID 來源調查報告（2026-11-16）

> 調查員：美歐澳加編號來源調查。範圍：美國、英國、德國、法國、澳洲、加拿大
> 優先，其次西班牙、義大利、荷蘭、墨西哥、巴西、韓國、南非、紐西蘭；
> 日本、台灣、香港已有來源，只做存活抽查與補缺。
> 方法：只用任天堂官方端點與公開資料（官網前端、官方搜尋後端、官方
> 價格 API、公開開源函式庫的文件），以 node fetch 實測；
> 未爬任何比價站的遊戲／價格資料庫（GreenDock、eshop-prices、
> DekuDeals、switch-games.com、遊戲盒子等只記錄其自述來源，見 §9）。
> 探測腳本：`scripts/probe-region-lists.mjs`（可重跑）；
> 對照表建置腳本：`scripts/build-region-title-ids.mjs`；
> 產出對照表：`data/region-title-ids-partial.json`（32 款種子遊戲）。

## 摘要

- **每款遊戲最多只需 6 組編號，不必 35 個。** 價格 API 實測矩陣
  （12 個探測編號 × 35 國，見 §0）證明 nsuid 是「分區群組」共用的：
  NA 一組覆蓋美洲 8 國，EU 一組覆蓋歐洲＋澳洲＋紐西蘭＋南非 20 國，
  其餘為 JP、TW、HK、KR 各一組。
- **找到完整清單來源的群組：NA、EU、JP、AU（=EU 編號）、TW、HK。**
  韓國只有精選清單頁（13 筆），不是完整目錄；新加坡／馬來西亞／泰國
  找不到任何官方清單來源，價格 API 亦查無（見 §7）。
- **全部六組完整來源都能排程直抓**（純 HTTP GET／POST，不需瀏覽器跑 JS、
  不需登入、實測無反爬阻擋），每日更新可全自動：抓清單 diff → 新編號進
  目錄 → 價格 API 按群組抓價寫庫（見 §10）。
- 對照表覆蓋（32 款種子遊戲，價格 API 逐國驗證）：
  NA 31/32、EU 31/32、AU 32/32、JP 31/32、TW 24/32、HK 24/32、KR 3/32。
  未對到的多半是「該區根本沒上架／已停售」，不是來源缺失（見 §11）。

## §0 共享群組：價格 API 實測矩陣（決定對照表要幾個編號）

探測編號（12 個，NA／EU／JP／TW／HK／KR 各 2–3 個）：
NA 曠野之息 `70010000000025`、王國之淚 `70010000063714`、瑪利歐賽車世界
`70010000095431`；EU 曠野之息 `70010000000023`、王國之淚 `70010000063715`、
瑪利歐賽車世界 `70010000096802`；JP 曠野之息 `70010000000026`、王國之淚
`70010000063713`；TW 曠野之息 `70010000102734`、王國之淚 `70010000063717`；
HK 曠野之息 `70010000009367`；KR 王國之淚 `70010000063716`。
12 個編號一次查 35 國（每國 1 次價格 API 呼叫，50 個 ID 上限內），結果：

| 群組 | 成員國（該組編號查得到 onsale） | 備註 |
|---|---|---|
| NA | US、CA、MX、BR、CL、CO、AR、PE（8 國） | 與開源函式庫 nintendeals 文件一致（見 §8） |
| EU | GB、IE、DE、FR、ES、IT、NL、BE、AT、CH、PT、PL、CZ、DK、FI、SE、NO、AU、NZ、ZA（20 國） | 澳洲／紐西蘭／南非用 EU 編號，不是美國編號 |
| JP | JP | 只有日本 |
| TW | TW | 只有台灣；多數遊戲與 HK 共用同一編號，但 2017–2019 舊遊戲台灣是 2025-09 重新登記的新號，須分開查 |
| HK | HK | 多數與 TW 共用；舊遊戲沿用舊號 |
| KR | KR | 部分舊遊戲與 HK 共用編號（曠野之息 KR = HK `70010000009367`，實測 KR onsale；TW 號在 KR 是 not_found） |
| — | SG、MY、TH | 12 個編號全部 not_found（見 §7） |

例證（王國之淚同一款五組編號連號）：JP `...63713`、US `...63714`、
EU `...63715`、KR `...63716`、TW／HK `...63717`。曠野之息：
JP `...00026`、US `...00025`、EU `...00023`、HK `...09367`、TW `...102734`。
**結論：對照表每款遊戲存 NA／EU／JP／TW／HK／KR 六組編號即覆蓋
35 國中的 32 國；SG／MY／TH 目前無解。**

## 各國一覽（來源、範例編號、價格驗證）

| 國家 | 群組／來源 | 範例編號（已驗證 onsale） | 價格驗證 |
|---|---|---|---|
| US | NA／美洲 Algolia `store_all_products_en_us` | 曠野之息 `70010000000025` $59.99；瑪利歐賽車世界 `70010000095431` $79.99 | ✓ onsale |
| CA | NA／`store_all_products_en_ca`（與 US 同編號） | 曠野之息 `70010000000025` CAD 84.99；王國之淚 `70010000063714` CAD 99.99 | ✓ onsale |
| MX | NA／`store_all_products_es_mx`（與 US 同編號） | 瑪利歐賽車世界 `70010000095431` MX$1,649.00 | ✓ onsale |
| BR | NA／`store_all_products_pt_br`（與 US 同編號） | 瑪利歐賽車世界 `70010000095431` R$ 439,90 | ✓ onsale |
| CL／CO／AR／PE | NA／各 locale 索引（與 US 同編號；價格矩陣驗證） | 同 NA 編號 | ✓ onsale（矩陣） |
| GB | EU／歐洲 Solr `search.nintendo-europe.com` | 曠野之息 `70010000000023` £59.99；王國之淚 `70010000063715` £59.99；瑪利歐賽車世界 `70010000096802` £66.99 | ✓ onsale |
| DE | EU／Solr（與 GB 同編號） | 曠野之息 `70010000000023` 69,99 €；王國之淚 `70010000063715` 69,99 € | ✓ onsale |
| FR | EU／Solr（與 GB 同編號） | 曠野之息 `70010000000023` 69,99 €；瑪利歐賽車世界 `70010000096802` 79,99 € | ✓ onsale |
| ES／IT／NL | EU／Solr（與 GB 同編號） | 曠野之息 `70010000000023` 69,99 €（ES／NL）；瑪利歐賽車世界 `70010000096802` 79,99 €（IT） | ✓ onsale |
| AU | AU Algolia `prod_games_and_products`（編號 = EU） | 時之笛 `70010000130793` $94.95 AUD；曠野之息 `70010000000023` $89.95 AUD | ✓ onsale |
| NZ | AU 編號共用（價格矩陣驗證） | 時之笛 `70010000130793` $104.95 NZD | ✓ onsale |
| ZA | EU 編號共用（價格矩陣驗證） | 曠野之息 `70010000000023` R1,329.00 ZAR | ✓ onsale |
| KR | 韓國清單頁（僅精選＋新作，見 §6） | 王國之淚 `70010000063716`；曠野之息 `70010000009367`（與 HK 共用）；瑪利歐驚奇 `70010000068690` | ✓ onsale（KR） |
| JP | 日本 XML／日本搜尋 API（見 §4） | 曠野之息 `70010000000026` ¥7,678；絲之歌 `70010000020841` ¥2,300 | ✓ onsale |
| TW／HK | 台港官方清單（見 §5） | 曠野之息 TW `70010000102734` TWD 1,599／HK `70010000009367` HKD 399 | ✓ onsale |
| SG／MY／TH | 無來源（見 §7） | — | ✗ 全部 not_found |

## §1 美洲 NA：US、CA、MX、BR、CL、CO、AR、PE

- **來源**：`https://U3B6GR4UA3-dsn.algolia.net/1/indexes/store_all_products_<locale>/query`
  （POST，JSON body `{"params": "query=...&hitsPerPage=N&page=P"}`，
  headers `X-Algolia-Application-Id: U3B6GR4UA3`、
  `X-Algolia-API-Key: a29c6927638bfd8cee23993e51e721c9`）。
  這是 nintendo.com 官網商店前端自己的搜尋後端，key 是官網前端內嵌的
  公開 search key（不是使用者憑證）。已驗證的 locale：
  `en_us`、`en_ca`、`fr_ca`、`es_mx`、`pt_br`、`es_ar`、`es_cl`、`es_co`、`es_pe`。
  歐洲／澳洲沒有 `store_all_products_*` 索引（404 "Index … does not exist"）。
- **方法**：空查詢＋分頁瀏覽全部 hits；命中含 `title`、`nsuid`、`platform`、
  `eshopDetails`（售價、特價、幣別）、`productType` 等欄位。
  遊戲篩選在客戶端做（取 `nsuid` 以 `7001` 開頭者；另有 `7005` 升級包、
  `7007` DLC／組合包，須排除）。
- **實測筆數**（2026-11-16，空查詢 nbHits，含硬體／周邊等全部商品）：
  en_us 37,632；en_ca 34,253；fr_ca 32,229；es_mx 34,949；pt_br 29,776；
  es_ar 27,315；es_cl 27,768；es_co 27,799；es_pe 27,841。
  其中 en_us 以 `productType:Games` 篩選為 36,745 款遊戲。
  （nbHits 在數小時內有數百筆浮動，屬索引即時更新，非誤差。）
- **範例編號**：曠野之息 US `70010000000025`（onsale $59.99）；
  王國之淚 US `70010000063714`（onsale，CA CAD 99.99）；
  瑪利歐賽車世界 US／CA／MX／BR 共用 `70010000095431`
  （US $79.99、CA CAD 109.99、MX MX$1,649.00、BR R$ 439,90，皆 onsale）。
- **陷阱兩則**（已實測，後人勿踩）：
  1. `productType` 值是各地語言：en 是 `Games`、es 是 `Juegos`。
     用 `filters=productType:Games` 查 es_mx／pt_br 等會回 0 筆。
     改不加 filter、客戶端篩 nsuid。
  2. 有兩個 key：`c4da8be7…` 只准查舊索引 `ncom_game_*`（無 nsuid 欄位，
     8,941 筆舊資料），查 `store_all_products_*` 會回 403
     "Index not allowed with this API key"；新索引要用 `a29c6927…`。
- **限制**：命中**沒有 product code 欄位**（只有商店 sku，如 `7500057001`，
  不是 product code）。product code 要逐款抓美國商品頁
  `nintendo.com/us/store/products/<slug>/` 的 `__NEXT_DATA__` Apollo state
  才有（曠野之息 `HACPAAAAA`，已驗證，見 §8）。索引含 Switch 2 遊戲、
  DLC、組合包、硬體與周邊，需客戶端分類。
- **自動化**：(1) ✅ 可排程直抓。純 HTTPS POST，不需瀏覽器跑 JS、
  不需登入、實測無反爬阻擋（數百次請求、250–400ms 節流下無 429／封鎖；
  429 時 Algolia 回標準重試語義）。(2) 清單約 37,632 筆
  （遊戲 36,745）；更新頻率：索引即時更新（數小時內 nbHits 有浮動；
  新作進量直接測不到——`releaseDate` 是 ISO 字串，`filters` 比較查詢
  回 400 "expected numeric"，不能按日期增量抓；歐洲實測新作約
  32 款／週、澳洲約 8 款／週，美洲量級相近，估 30–50 款／週）。
  **新遊戲自動進目錄的做法是全量分頁瀏覽（每頁 1,000 筆、約 37 頁）
  後對 nsuid 做 diff**，不是日期增量。每日一次全量約數分鐘。

## §2 歐洲 EU：GB、DE、FR、ES、IT、NL 等 17 國＋AU、NZ、ZA

- **來源**：`https://search.nintendo-europe.com/<locale>/select?q=…&fq=type:GAME&rows=N&start=M&wt=json`
  （GET，Solr）。`/en/`、`de`、`fr`、`es`、`it`、`nl` 各 locale 皆通，
  回同一 nsuid 體系（價格 API 證實共用，見 §0）。
  這是任天堂歐洲官網自己的搜尋後端，也是 2020 年開源函式庫 nintendeals
  的 noe 模組用的端點（見 §8），2026-11-16 實測仍通。
- **方法**：`fq=type:GAME`＋`fq=nsuid_txt:*` 列舉；分頁用 `rows`（≤1,000
  實測可用）＋`start`。命中欄位含 `title`、`nsuid_txt`（陣列，常含
  7001 本體＋7007 DLC 或 7005 升級包兩個值，取 7001 者）、
  `product_code_txt`（部分遊戲）、`system_names_txt`
  （Nintendo Switch／Nintendo Switch 2／Wii U／3DS／Smart device 等，
  客戶端過濾）、`dates_released_dts`、`change_date`、`price_lowest_f`、
  `eshop_removed_b`。
- **實測筆數**（2026-11-16）：`/en/` GAME 且有 nsuid 共 **20,217 筆**；
  各 locale GAME 總數約 23,872–24,054 筆（含無 nsuid 的舊主機／手機遊戲）。
- **範例編號**：曠野之息 EU `70010000000023`（GB £59.99、DE／FR 69,99 €，
  皆 onsale）；王國之淚 EU `70010000063715`；瑪利歐賽車世界 EU
  `70010000096802`（GB £66.99、DE／FR 79,99 €，皆 onsale）；
  時之笛 Switch 2 版 EU `70010000130793`（與 AU 同號）。
- **新鮮度**（2026-11-16 實測）：最新 `change_date` 為當天
  2026-11-16T10:39:45Z（Fire Emblem: Fortune's Weave）；
  Kirby Air Riders 在列。索引當日仍在更新。
- **限制**：`product_code_txt` 只部分遊戲有（Switch 2 新作多無：
  瑪利歐賽車世界、曠野之息 Switch 2 Edition 皆無；Switch 原版多有，
  如曠野之息 `HACPAAAAA`）。含多主機遊戲與手機遊戲，需以
  `system_names_txt` 過濾 Switch／Switch 2。DLC／組合包以 7007／7005
  開頭，需排除。個別遊戲在 Solr 前列可能只出現 Switch 2 Edition
  （如雙人成行：原版 Switch 文件只有 7007 DLC 編號，S2E 才是
  `70010000121107`），原版 EU 編號缺失時須另尋（見 §11）。
- **自動化**：(1) ✅ 可排程直抓。純 HTTPS GET，不需登入／JS／反爬處理，
  實測數十次請求無阻擋。(2) 清單 20,217 筆（有 nsuid 的 GAME）；
  **實測更新頻率：近 7 天有 32 款新發售、近 30 天 241 款；
  近 7 天有 155 筆 change_date 異動**（含價格／詮釋資料更新）。
  每日一次全量（21 頁 × 1,000 筆）＋nsuid diff 即可自動發現新遊戲；
  也可用 `change_date`／`dates_released_dts` 範圍查詢做增量。

## §3 澳洲 AU、紐西蘭 NZ

- **來源**：`https://FMW57F6ERV-dsn.algolia.net/1/indexes/prod_games_and_products/query`
  （POST，公開 search key `c8e4e9f60190ef785d167da77ba0b4fe`，
  取自 nintendo.com/au 首頁 RSC payload 內嵌的 `algoliaApiKey`／
  `algoliaAppId`／`algoliaIndexes`）。
  注意：`prod_games`（1,443 筆）**沒有 nsuid 欄位**；有 nsuid 的是
  `prod_games_and_products`。
- **方法**：空查詢＋分頁瀏覽；命中含 `title`、`nsuid`、`objectType`
  （`game` 為遊戲本體）、`console`、`slug`、`fullURL`、`genre`、
  `date_timestamp`（Unix 發售日，可數值篩選）。
- **實測筆數**：空查詢 nbHits **1,707 筆**（含遊戲、amiibo、App 等；
  純遊戲筆數需分頁後按 `objectType=game`＋nsuid 計數，未在此次全量）。
- **範例編號**：時之笛 `70010000130793`（AU $94.95、NZ $104.95，皆 onsale；
  與 EU 同號，美國是 `...30792`，差 1）；曠野之息 AU `70010000000023`
  （= EU 號，AU $89.95 onsale）；瑪利歐賽車世界 AU `70010000096802`
  （= EU 號）；Kirby and the World Beyond `70010000135066`
  （未發售，價格 API 回 unreleased——編號正確，遊戲未出）。
- **限制**：索引是精選子集（1,707 筆，遠小於 EU 的 20,217），
  澳洲 eShop 實際在售遊戲可能多於此數；命中無 product code 欄位；
  澳洲官網遊戲內頁（`/games/…/`）HTML 內無 nsuid，不能以內頁補。
- **自動化**：(1) ✅ 可排程直抓。純 HTTPS POST，公開 key，無登入／JS。
  (2) 清單 1,707 筆；**實測更新頻率：以 `date_timestamp` 計，
  近 7 天 8 款、近 30 天 40 款新發售**（數值篩選可用，可做日期增量）。
  但因是精選子集，AU 新遊戲發現建議以 EU 清單為主、AU 索引驗證為輔。

## §4 日本 JP

- **來源 A（沿用）**：`https://www.nintendo.co.jp/data/software/xml/switch.xml`，
  10,045 個 title ID（`<LinkURL>/titles/<id>`），另有
  `<InitialCode>`（即 product code，如 `HACA6EVA`）、標題、發售日、封面。
- **來源 B（新增，比 XML 新）**：日本官網搜尋 API
  `https://search.nintendo.jp/nintendo_soft/search.json?q={q}&limit=N&page=P&opt_hard=1_HAC`
  （GET）。這是 nintendeals noj 模組用的端點，2026-11-16 實測仍通。
  命中含 `nsuid`、`icode`（product code 核心 5 碼，如智慧的再現 `BDGEA`）、
  `title`、`ssitu`（onsale／not_found 等）、`pprice`／`current_price`、
  `sdate`（發售日）、`hard`（`1_HAC`=Switch 1、`05_BEE`=Switch 2）。
  空查詢 total 約 **29,995 筆** Switch 軟體（含 Switch 2 與 DLC 項目，
  與 XML 的 10,045 基準不同，見限制）。
- **實測**：絲之歌 JP `70010000020841`（onsale ¥2,300，icode `AUSUA`）即
  出自來源 B——XML（最新約 2025-05-01）沒有它；寶可夢傳說 Z-A JP
  `70010000094233`（onsale）、黑帝斯 II JP `70010000103275`（onsale）、
  瑪利歐賽車世界 JP `70010000092842`（onsale ¥8,980）、咚奇剛 JP
  `70010000096306`（onsale ¥7,980）亦出自來源 B。
  查詢技巧：先加 `opt_hard=1_HAC`（結果少而準，原版優先），查不到再不加
  （Switch 2 遊戲 hard=`05_BEE`，加 1_HAC 會回 0 筆）。
- **限制**：XML 停在約 2025-05-01，Switch 2 發售後的遊戲不在其中；
  搜尋 API total 29,995 的口徑與 XML 不同（含重複／DLC／組合包項目，
  以 `id`／`nsuid` 去重後才能當目錄數；`limit` 上限未實測超過 150）。
  健身環 JP 下載版已停售（搜尋 API 回 `nsuid=null`／not_found）。
- **自動化**：(1) ✅ 兩者皆可排程直抓。純 HTTPS GET，無登入／JS。
  (2) XML 10,045 筆但已停更（最後發售日 2025-05-01）；搜尋 API 約
  29,995 筆且即時更新（2026-11-16 當日查詢正常）。**新遊戲自動進目錄
  應以搜尋 API 為主、XML 為輔**（XML 仍是 product code 全量來源）。

## §5 台灣 TW、香港 HK（沿用既有來源，只記要點）

- **來源**：`https://www.nintendo.com/{tw,hk}/software/switch/?spage=N`
  （Next.js 頁，RSC payload 的 Contentful 項目含 `title`＋`nsuid`），
  台灣 166 款、香港 176 款；另有港台每週「Nintendo eShop 新作軟體資訊」
  文章共 107 篇（內文 Contentful 項目自帶 title＋nsuid），是新遊戲
  台港編號的主要來源。詳見 DATA_NOTES.md §10.2 與
  `data/tw-hk-title-ids.json`。
- **限制**：清單只含任天堂發行＋部分第三方，不是台港 eShop 全部目錄；
  台灣沒有 `data/json/switch_software.json` 端點（404）；
  香港 JSON 停在約 2022-06。星露谷等遊戲台港根本未上架（不是缺口）。
- **自動化**：(1) ✅ 可排程直抓。純 HTTPS GET＋`?spage=` 分頁，
  無登入／JS。(2) 清單 166／176 筆；更新頻率：隨每週新作文章更新，
  約每週數款。**新遊戲以每週文章為主、清單頁為輔**追蹤。

## §6 韓國 KR（只找到部分）

- **來源**：`https://www.nintendo.com/kr/software/switch/`（Next.js 清單頁，
  Contentful 項目含 `title`＋`nsuid`＋`softCode`）。
  `softCode` 是 5 碼小寫頁面 slug（如 `aqmxa`），**不是 product code**。
- **實測筆數**：頁面內僅 **13 個** nsuid 項目（單頁精選＋新作輪播，
  無 `?spage=` 分頁——TW／HK 的分頁參數在此頁不存在）。
  範例：瑪利歐派對空前盛會 `70010000084610`、咚奇剛歸來 HD
  `70010000084605`、瑪利歐驚奇 `70010000068690`。
  另以價格 API 驗證補 2 款：王國之淚 KR `70010000063716`（onsale）、
  曠野之息 KR = HK `70010000009367`（onsale）。
- **試過但不通的路**：`https://store.nintendo.co.kr/` 回 HTTP 202 空白
  （疑似 bot 檢查／空殼）；仿 TW／HK 的 `?spage=` 分頁無效；
  仿香港的 `data/json/switch_software.json` 路徑無對應韓國版；
  韓國每週新作文章未找到對應入口。
- **限制**：不是完整目錄——13 筆只是當期精選＋新作；32 款種子遊戲
  只對到 3 款 KR 編號。韓國完整清單來源仍缺。
- **自動化**：(1) ⚠️ 頁面本身可排程直抓（純 GET），但**只能拿到 13 筆
  精選，無法自動發現全部韓國新遊戲**。(2) 清單 13 筆；
  更新頻率：隨官網精選輪播更換，無固定週期。KR 若要自動更新，
  需另尋完整來源（或以價格 API 掃描＋韓國新作文章追蹤，尚未驗證）。

## §7 新加坡 SG、馬來西亞 MY、泰國 TH（真的找不到）

- **試過的路**：
  1. `https://www.nintendo.com/en-sg/store/`、`en-sg/`、`en-my/store/`——
     皆 404（導向 `/us/en-sg/store/` 後仍 404）；SG／MY／TH 在
     nintendo.com 上沒有商店前端。
  2. eShop 網站 `https://ec.nintendo.com/SG/en/`——404；
     `https://ec.nintendo.com/SG/en/titles/70010000000025` 雖回 200，
     但只是把網址裡的 ID 原樣回顯，不驗證存在與否，不能當來源。
  3. 各區搜尋 API `https://ec.nintendo.com/api/{SG,MY,TH}/en/search/sales`
     ——與 US／GB 相同，已下線（回 HTML 404 頁）。
  4. 價格 API：US／EU／JP／TW／HK 五組曠野之息編號查 SG／MY／TH
     全部 `not_found`。
  5. 價格 API 掃描：曠野之息 JP／US／EU 編號 ±60 範圍（各 124 個 ID）
     查 SG／MY／TH，**零個 onsale**。
- **結論**：SG／MY／TH 的 eShop 存在（價格 API 支援這三國幣別，
  GreenDock 首頁也顯示 TH／MY 歷史低價），但編號體系不明、無官方
  清單入口。對照表目前不含這三國；日後若找到 SG 清單或掃描到
  在售編號再補。不要以 US／EU 編號硬填——實測皆 not_found。

## §8 開源函式庫 nintendeals：端點對照與現代等效端點

來源：https://github.com/fedecalendino/nintendeals（MIT，公開存檔，
最後釋出 1.5／2020-04-29；PyPI 同名）。文件把服務分成 Info、
Listing、Searching、Pricing，每區（NA／EU／JP）各有一套
Info／Listing／Searching，Pricing 共用（只要國家＋nsuid）。
以下為原始碼實讀結果（`nintendeals/noa|noe|noj/api/*.py`、
`noa/scrapers/nintendo.py`、`api/prices.py`）與 2026-11-16 實測狀態：

| 函式庫端點（2020） | 用途 | 2026-11-16 狀態／現代等效端點 |
|---|---|---|
| NOA Algolia：app `U3B6GR4UA3`，索引 `store_game_en_us`，key `c4da8be7…`，以 nsuid 前綴 `7001`＋序號掃描列舉 | NA Listing | **舊索引已下線**（查無此索引）。現代等效：同一 app，索引 `store_all_products_en_us`，key 改為 `a29c6927…`（見 §1）。列舉方式改為空查詢＋分頁瀏覽，不再用前綴掃描 |
| NOA game_info：`https://www.nintendo.com/store/products/{slug}/`，解析 `__NEXT_DATA__` 的 Apollo `StoreProduct`（`nsuid`、`productCode`） | NA Info／product code | **仍通**。實測曠野之息商品頁回 `productCode: HACPAAAAA`、nsuid 出現 172 次。逐款抓頁可補 NA product code |
| NOE：`https://search.nintendo-europe.com/en/select`（Solr，`fq=type:GAME`） | EU Listing／Searching／Info | **仍通，原樣可用**（見 §2）。原始碼還把 `product_code_txt` 去掉 `-`、只留 `HAC` 開頭者，與本調查做法一致 |
| NOJ：`https://search.nintendo.jp/nintendo_soft/search.json`（`opt_hard=1_HAC`） | JP Listing／Searching／Info | **仍通**（見 §4）。原始碼用 `id` 含 `_` 者過濾掉非本體項目 |
| Pricing：`https://api.ec.nintendo.com/v1/price?country=&lang=en&ids=`（≤50 個） | Pricing（共用） | **仍通，原樣可用**；本調查另確認 lang 規則 JP=ja、TW／HK=zh、其餘 en |

文件概念驗證：
- (a) **nsuid 分區群組**：文件明說 NA nsuid 只能查 US／CA／MX，
  不能查 JP 或西班牙——本調查價格矩陣（§0）證實且擴大為
  NA 8 國、EU 20 國（文件只列 NoE 為歐盟＋AU＋NZ＋ZA；
  實測 EU 編號在 IE／CH／NO 等非歐盟歐洲國家亦 onsale）。
- (b) **product code 當跨區 join key**：文件稱 product code
  8／9 字元，各區前後綴不同、中間 4 碼固定（例：Splatoon 2
  NA `HACPAAB6B`／EU `HACPAAB6C`／JP `HACAAB6A`，共用 `AAB6`，
  稱為 `unique_id`）。各來源 product code 供應狀況實測如下：

| 來源 | product code | 備註 |
|---|---|---|
| EU Solr `product_code_txt` | 部分有 | Switch 原版多有（如曠野之息 `HACPAAAAA`）；Switch 2 新作多無（瑪利歐賽車世界、曠野之息 S2E 皆無） |
| JP XML `<InitialCode>` | 全部有 | 如 `HACA6EVA`；即 product code 全量來源 |
| JP 搜尋 API `icode` | 全部有 | 5 碼核心（如智慧的再現 `BDGEA`）；`unique_id` 約為 icode 前 4 碼（Splatoon 2 例：icode `AAB6A`→`AAB6`） |
| NA Algolia 命中 | 無 | 只有商店 sku（如 `7500057001`），不是 product code |
| NA 商品頁 `__NEXT_DATA__` | 逐款有 | 曠野之息 `HACPAAAAA` 已驗證；全量需逐款抓頁 |
| AU Algolia 命中 | 無 | 無相關欄位 |
| TW／HK／KR 清單 `softCode` | 不是 product code | 5 碼小寫頁面 slug（如 `aqmxa`、`bgw5a`），勿當 product code 用 |

## §9 比價站自述來源（只記錄來源名稱與做法，不複製其資料庫）

- **GreenDock**（https://greendock.app/）：首頁自述「價格來自各地區
  任天堂 eShop」，並顯示多國歷史低價與特價數（例：TW 歷史低價
  TWD 1,113、另有 45 國特價）。只記錄這句來源說明。
  證實「價格是程式每天自動向各區 eShop 抓的」的機制。
- **eshop-prices.com**（https://eshop-prices.com/faq?currency=TWD）：
  FAQ 只有跨區購買、付款方式、圖示意思、最便宜國家、廣告說明，
  **沒有寫資料來源**，且明說「The code is private」（程式碼不公開）。
  記錄這點；不假設它有公開 API 或公開資料庫，不複製其價格資料。
- **DekuDeals**（https://www.dekudeals.com/）：首頁自述
  「tracks the prices of Nintendo Switch, PlayStation, Xbox, and Steam
  games at official stores」（官方商店，含 Nintendo eShop）；
  每筆價格帶抓取時間戳（如「3 hours ago at Nintendo eShop」、
  「6 hours ago at Nintendo eShop」），證明是程式定時輪詢、不是人工對價；
  該站 2018 年就上線（AI 出現前好幾年），印證自動化抓取早已存在。
  注意：DekuDeals 以美國市場為主（美元＋美國零售商），不做多國 eShop
  比價；對本調查的價值是證實「官方商店＋自動定時抓取」的機制，
  不是各區編號來源。
- **共同彙整來源評估**：**未發現共用的公開彙整來源。**
  調查中沒有遇到任何文件記載的公開價格資料庫或公開彙整 API。
  證據指向的共同點是**機制**，不是資料庫：各站各自向任天堂各區官方
  端點抓價＋自己維護各區編號對照（GreenDock、DekuDeals 自述皆為
  官方商店來源；eshop-prices 不公開來源與程式碼），以及公開的
  nintendeals 開源函式庫（它記錄各區端點做法，是方法文件，
  不是資料來源）。因此本站正確做法就是重現這個流程（見 §10），
  而不是找一個現成的共用資料庫來接。

## §10 自動更新流程：每來源能否排程、清單多大、多久更新

使用者最終目標：網頁自主更新、自己串聯——每日更新自己抓各區官方
清單、新遊戲自動進目錄、自己抓各國價格寫進資料庫，不用手動跑種子。
以下逐來源評估（(1) 能否被排程程式直接抓；(2) 完整清單大小與更新頻率）：

| 來源 | (1) 排程直抓？ | (2) 清單大小／更新頻率 | 能否進自動更新流程 |
|---|---|---|---|
| NA 美洲 Algolia | ✅ 純 HTTPS POST，公開 key，無登入、無 JS、無反爬（實測數百次請求無 429／封鎖） | 約 37,632 筆（遊戲 36,745）；索引即時更新，新作估 30–50 款／週（歐洲實測值的量級推估；`releaseDate` 為字串、比較篩選回 400，故只能全量瀏覽＋diff，不能日期增量） | ✅ 每日全量分頁（37 頁 × 1,000 筆）＋nsuid diff，數分鐘 |
| EU 歐洲 Solr | ✅ 純 HTTPS GET，無登入、無 JS、無反爬 | 20,217 筆（有 nsuid 的 GAME）；**實測：近 7 天 32 款新發售、近 30 天 241 款、近 7 天 155 筆異動**；索引當日更新 | ✅ 每日全量（21 頁）＋diff，或 `change_date`／`dates_released_dts` 範圍增量 |
| AU 澳洲 Algolia | ✅ 純 HTTPS POST，公開 key，無登入、無 JS | 1,707 筆（精選子集）；**實測：近 7 天 8 款、近 30 天 40 款新發售**（`date_timestamp` 數值篩選可用，可日期增量） | ✅ 每日抓取；但因子集性質，新遊戲發現以 EU 為主、AU 為驗證 |
| JP 日本搜尋 API | ✅ 純 HTTPS GET，無登入、無 JS | 約 29,995 筆 Switch 軟體，即時更新 | ✅ 每日分頁（`limit`＋`page`）＋diff；另 XML 10,045 筆已停更（2025-05-01），只當 product code 輔助 |
| JP 日本 XML | ✅ 純 HTTPS GET | 10,045 筆，**已停更**（最新發售日約 2025-05-01） | ⚠️ 只當靜態 product code 來源，不當新遊戲來源 |
| TW／HK 清單頁 | ✅ 純 HTTPS GET＋`?spage=` 分頁 | 166／176 筆；隨每週新作文章更新，約每週數款 | ✅ 每週抓清單＋新作文章；台港新遊戲量小 |
| KR 清單頁 | ⚠️ 頁面可直抓，但只有 13 筆精選 | 13 筆；隨官網精選輪播更換，無固定週期 | ⚠️ 只能補精選新作，不能自動發現全部 KR 新遊戲（缺完整來源） |
| SG／MY／TH | ❌ 無來源 | — | ❌ 無法自動更新，待找到 SG 清單再補 |
| 價格 API | ✅ 純 HTTPS GET，無登入 | 每次 ≤50 個 ID；沿用既有切片輪轉（400 款／片） | ✅ 每款最多 6 個編號（NA／EU／JP／TW／HK／KR）即可覆蓋 32 國 |

**流程實作對照**（重現比價站的自動化流程——各區官方編號清單＋價格
接口，程式對編號、程式抓價格）：
1. 每日排程抓六組清單（NA／EU／JP／AU／TW／HK），對 nsuid 做 diff，
   新編號自動進目錄（`game_region_ids` 對照表即此流程的實作，
   見 `data/region-title-ids-partial.json`）。
2. 新遊戲以標題正規化＋product code（有時）跨區串連；
   標題正規化注意 ™ 會被 NFKD 展開成 "TM"（見 §11 教訓）。
3. 價格 API 按群組抓價（每款最多 6 個編號覆蓋 32 國），寫進資料庫；
   抓價切片沿用既有 `lib/refresh-slices.ts` 輪轉設計。
4. KR 目前只能半自動（清單頁 13 筆＋價格 API 驗證）；SG／MY／TH 待來源。
   Vercel Hobby cron 每天最多跑一次、函式 60 秒上限：全量清單抓取
   （NA 37 頁／EU 21 頁／JP 約 30 頁）宜拆片或放外部排程，與既有
   價格切片同一思路。

## §11 對照表產出與未對到的原因

產出：`data/region-title-ids-partial.json`
（建置腳本 `scripts/build-region-title-ids.mjs`，可重跑），
格式：`{"generated_at","sources":[...],"sharingGroups":{...},"games":{"<jpTitleId或slug>":{"titleZh","titleEn","slug","jpTitleId","regionIds":{"US","CA","MX","BR","GB","DE","FR","AU","JP","TW","HK","KR"},"groups":{...},"productCodes":{"EU":...},"priceVerified":{...},"notes":[...]}}}`，
key 優先用 jpTitleId（與現有目錄對接），無 JP 編號者用 slug
（ring-fit；其 JP 下載版已停售）。

覆蓋（32 款，價格 API 逐國驗證）：NA 31/32、EU 31/32、AU 32/32、
JP 31/32、TW 24/32、HK 24/32、KR 3/32。
（EU 31/32 的缺口是健身環——下載版已停售；NA 31/32 同。）
逐款範例（完整表見 JSON）：
曠野之息 JP `...00026`／NA `...00025`／EU `...00023`／TW `...102734`／
HK `...09367`／KR `...09367`；王國之淚 JP `...63713`／NA `...63714`／
EU `...63715`／KR `...63716`／TW／HK `...63717`；瑪利歐賽車世界
JP `...92842`／NA `...95431`／EU `...96802`／TW／HK `...96808`；
絲之歌 JP `...20841`／NA `...20840`／EU `...20839`（台港未上架）。

未對到的原因（皆為「該區沒上架／已停售」，不是來源缺失）：
- 台港未上架（TW／HK 皆無）：星露谷、黑帝斯、空洞騎士、蔚藍、
  Undertale、女神異聞錄5 皇家版、絲之歌（與 DATA_NOTES §10.2 一致）；
  死亡細胞只有香港有價、香港編號未找到。
- 健身環：下載版已停售——JP 搜尋 API 回 `nsuid=null`／not_found，
  TW not_found、HK sales_termination、AU 命中 `70010000004565` 亦查無價；
  僅盒裝＋環同捆在售。
- KR 只對到 3 款：清單頁僅 13 筆精選（見 §6），非比對失敗。
- 雙人成行：EU／TW／HK 編號（`...121107`／`...121109`）是 Switch 2
  Edition（Solr system=Nintendo Switch 2）；Switch 1 原版 EU 編號不在
  Solr 前列，`...49283` 猜測經價格 API 證偽（GB／TW／HK 皆 not_found）；
  US／AU／JP 原版（`...49281`／`...49282`／`...49280`）已
  sales_termination／not_found。

本次調查修正的兩處舊資料：
1. `data/title-ids.json` 的咚奇剛（`70010000096812`）與瑪利歐賽車世界
   （`70010000096808`）所謂「JP 編號」實為台港編號（查 JP 為 not_found）；
   正確 JP 編號為咚奇剛 `70010000096306`、瑪利歐賽車世界 `70010000092842`
   （日本搜尋 API，皆 onsale：¥7,980／¥8,980）。`title-ids.json` 本身未改，
   修正值在 `data/region-title-ids-partial.json` 的 notes 欄位。
2. 標題正規化教訓：NFKD 會把 `™` 展開成 `TM`，導致
   "Mario Kart™ 8 Deluxe" 等第一方標題比對失敗（首版建置 NA 僅 13/32）。
   修正為先去掉 `™®©℠` 再 NFKD，NA 回升至 31/32。
   同一教訓適用 `map-title-ids.mjs`／`map-tw-hk-title-ids.mjs` 的
   `normalizeTitle`（台港中文標題影響較小，但建議一併修）。

## 附錄：重現方式

```bash
cd ~/workspace/switch-price-site
node scripts/probe-region-lists.mjs        # 每國來源、筆數、範例編號、價格驗證
node scripts/build-region-title-ids.mjs    # 重建 data/region-title-ids-partial.json（約 2 分鐘）
```

實測時間：2026-11-16（台北）。所有筆數皆為當日快照；Algolia／Solr
索引即時更新，筆數會浮動。價格 API 驗證皆以當日 `sales_status` 為準。
