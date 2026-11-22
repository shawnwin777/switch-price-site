# Steam / Xbox / PlayStation / Nintendo 多平台資料來源與 GitHub 實作研究

> 2026-11-22；研究筆記，寫入 PR 草稿分支，**不是程式碼合併、部署或資料庫變更**。對未公開／未保證穩定的商店接口，使用前需另檢查最新回傳、頻率與服務條款。

## 核心發現：先解決跨平台「遊戲身分」層

### 1. JigSawFr/Atlas — 遊戲對照索引
- 倉庫：https://github.com/JigSawFr/Atlas
- 主要檔案：[tools/links.py](https://github.com/JigSawFr/Atlas/blob/main/tools/links.py)
- 發佈資料：`data-stores` 分支的 `links.json`；README 指明透過 Wikidata QID、IGDB 來源連結 `steam` AppID、`ps` Concept ID、`ps_product`、`xbox` Product ID，以及 Switch **16 字元十六進位 Title ID**。
- **重要：Switch Title ID 不是台灣 eShop 的 14 位數字 NSUID，不能直接等值 Join。** 部分遊戲有多地區／多版本，要保留一對多的 identity evidence 與審核狀態。
- Atlas 已將價格資料移出自身產品（2026-10-30 起），**只能當遊戲身分／名稱對照**，不能當最新售價來源。
- 使用前須按 `index.json` 的來源 license/attribution 各自檢查。

### 2. Ephellon/store-scraper — 各商店 Adapter
- 倉庫：https://github.com/Ephellon/store-scraper
- 真正存在的程式：
  - [nintendo.py](https://github.com/Ephellon/store-scraper/blob/main/scripts/catalog/adapters/nintendo.py)
  - [steam.py](https://github.com/Ephellon/store-scraper/blob/main/scripts/catalog/adapters/steam.py)
  - [xbox.py](https://github.com/Ephellon/store-scraper/blob/main/scripts/catalog/adapters/xbox.py)
  - [psn.py](https://github.com/Ephellon/store-scraper/blob/main/scripts/catalog/adapters/psn.py)
- 共同介面輸出 `GameRecord`，將抓價、補資料、驗證、去重及存入資料庫拆分。支援 SQLite checkpoint 與出錯重試。
- Xbox 探測包含 `emerald.xboxservices.com/xboxcomfd/browse`；PS 會嘗試 GraphQL 分頁或頁面 `__NEXT_DATA__`/JSON-LD 備援；接口可能變動。
- 同系列 [game-store-catalog](https://github.com/Ephellon/game-store-catalog) 產出 5 大商店統一 JSON，README 明示**不定期更新**；數量不是台灣現售數量。

### 3. Furkan5E/GamePrice-Index — 統一價格資料模型與測試
- https://github.com/Furkan5E/GamePrice-Index
- 程式：`src/gameprice_index/scrapers/{steam,xbox,playstation_store,nintendo}.py`、共用 base、schema/ETL/歷史。
- PlayStation Store 抓 GraphQL `categoryGridRetrieve`；Xbox 抓 browse API 之 `specificPrices.purchaseable`；Steam 從 search results 取得 appid 與現價。
- 適合借鏡錯誤／限流處理、離線 fixtures 單元測試、快取不可用時保留舊的最後成功快照，**但舊快照不能當新價格**。
- MIT 授權專案，改用片段需保留授權聲明；商店資料另看來源條款。

## Nintendo（現有主站，優先完成）
- 已實測台灣官方 `https://www.nintendo.com/tw/api/software?sftab=all&spage=N`，195 頁共 4,668 列，配合 `https://api.ec.nintendo.com/v1/price?country=TW&ids=...`。
- PR #1 的 `scripts/collect-tw-name-evidence.mjs` 已跑出 2,384 筆「歷史有價格但未具名、官方 NSUID 精確相符」待審證據，並標出來源名稱衝突；**沒有寫正式 DB**。
- [cutecore/Nintendo-Switch-eShop-API](https://github.com/cutecore/Nintendo-Switch-eShop-API) 列出日港美歷史來源與 HAC code 線索；舊 endpoint 可能失效，且 HAC code 共通片段不是商品同版的證據。

## Steam（可優先開發的新平台）
- API 與資料模型：`appid`（商品應用 ID），另外要保存 `subid`（套裝 package）、bundle id 及 `type`，避免把 DLC／配樂／組合包當作本體價格。
- 有價值的商品端點（**非保證穩定的官方公開開發者合約**）：
  - `https://store.steampowered.com/api/appdetails?appids=...&cc=tw&l=tchinese`：查台灣商店價格、名稱及語言；
  - `https://store.steampowered.com/api/packagedetails?packageids=...`：不同於 AppID；
  - `https://store.steampowered.com/appreviews/<appid>?json=1`：評論樣本及摘要，另設爬取限流與時間戳。
- 參考 [Ephellon SteamAdapter](https://github.com/Ephellon/store-scraper/blob/main/scripts/catalog/adapters/steam.py)（全站 AppID 清單，appdetails hydration；預設會跳過 DLC，未來需切成獨立表）。
- 歷史參考 [scos-lab/steamcozy-prices](https://github.com/scos-lab/steamcozy-prices)（GitHub Actions 一日兩次記錄 CSV；注意其採樣區域**不含 TW**），及 [aaoollaaooll/steam-price-history](https://github.com/aaoollaaooll/steam-price-history)（差異事件壓縮、bucket `appid % 256`；當前示範為墨西哥而非 TW）。Steam 不提供完整歷史價格 API，**只能從自己開始採樣之日累積**。

## Xbox（第二個新平台）
- 主識別：Microsoft Store `Product ID`（例如 12 字元字母數字）。台灣商店以 market `TW`、locale `zh-TW` 作獨立驗證。
- [OpenXbox/xbox-webapi-python catalog provider](https://github.com/OpenXbox/xbox-webapi-python/blob/master/xbox/webapi/api/provider/catalog/__init__.py)：真實程式用 `https://displaycatalog.mp.microsoft.com/v7.0/products`、`bigIds`、`market`、`languages`，另有產品 autosuggest 查詢。
- [lucasromerodb/xbox-store-api](https://github.com/lucasromerodb/xbox-store-api) 展示 `catalog.gamepass.com`（Game Pass 資格／上下架）、`reco-public.rec.mp.microsoft.com`（分類商品 ID）、`displaycatalog.mp.microsoft.com`（商品資訊／區域價格）的不同用途。
- [Ephellon XboxAdapter](https://github.com/Ephellon/store-scraper/blob/main/scripts/catalog/adapters/xbox.py) 把商品瀏覽與價格資料分開解析。
- **Xbox 商品可買的價格與 Game Pass 訂閱包含資格是兩件事**，不可拿後者當售價 0 元。

## PlayStation（第三個新平台，脆弱度較高）
- 主識別層：`Concept ID`（較跨地區共用的遊戲概念），`Product ID`（地區或版本特定 SKU）；應將 PS4、PS5、豪華版、DLC、PS Plus 訂閱結果分開。
- 台灣區頁面路徑：https://store.playstation.com/zh-hant-tw/
- [imbbloh/ps-prices](https://github.com/imbbloh/ps-prices)：`server.js` 實作「概念頁 → 商品頁 → 地區搜尋」三層備援，將跨區版號差異視為常態；並確認是否真的有購買價格，排除 PS Plus/Trial 上架資訊。
- [Furkan5E PlayStation scraper](https://github.com/Furkan5E/GamePrice-Index/blob/main/src/gameprice_index/scrapers/playstation_store.py)：GraphQL category grid pagination，需維護 persisted-query 或相關請求方式。
- [RavelloH/PSGameSpider](https://github.com/RavelloH/PSGameSpider)：透過 GitHub Actions 週期性整理多區 PS 商品與歷史資料；需確認現行可用性。
- Sony 沒有穩定、開放且保證抓價的通用 PS Store API；GraphQL query hashes、嵌入頁面資料以及 CDN 地域導向會變。若無有效價格證據，顯示「無法確認」，**不當成免費或下架**。

## 建議的 Supabase 目標資料模型（僅研究方案，尚未套用）

- `canonical_games` — 独立作品概念、名稱、發行商、系列、可選 Wikidata QID/IGDB ID。
- `products` — 一款作品底下的實際版本：本體、DLC、豪華版、組合包、Switch 2 升級包；`parent_product_id` 可為空，不憑名稱自動填。
- `store_listings` — (`store`,`market`,`store_product_id`) 唯一；Steam AppID/SubID、Xbox ProductID、PS ProductID、Nintendo NSUID 每種是不同 namespace。
- `identity_evidence` — 候選關聯、來源 URL、信心狀態（exact / reviewed / disputed）、觀察日期；跨商店不能單靠文字類似合併。
- `price_observations` — 各商店、區域、幣別、原價／折扣價、擷取時間與來源，為史低／通知的基礎。
- `subscription_entitlements` — Game Pass／PS Plus 等訂閱資訊另存，不混入購買價格。

### 最省重工的順序
1. 現有 Switch PR #1：官方精確補名 → 兩筆名稱衝突審核 → 7005/7007 最新掃描與類型確認。
2. 新建各商店 Adapter 設計，不在 Switch 原程式裡寫大量平台分支。
3. Steam TW 小範圍唯讀價格原型與離線 fixtures；確認 AppID、DLC、bundle 分類。
4. Xbox TW 產品 ID 與 DisplayCatalog 唯讀原型，分開訂閱。
5. PS 台灣區 concept/product 對照與售價實測；拒絕將其他地區價格標為 TW。
6. Atlas／Wikidata／IGDB 當遊戲概念關聯「候選來源」，不當作跨區 SKU 同版保證。
7. 分別通過測試與人工審核後，設計可回滾 DB 遷移、再談新平台正式顯示。

## 禁止
- 禁止未經核准操作正式 Supabase、合併 PR、部署 Vercel。
- 禁止未經授權大量複製第三方價格資料或程式碼；尊重個別授權與服務條款。
- 禁止把 GitHub README 中的歷史資料量當作最新商品數，或把非 TW 市場價格直接當台灣價格。
