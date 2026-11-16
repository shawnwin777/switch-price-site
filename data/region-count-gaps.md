# 各區數量差距驗證報告（2026-11-16）

> 驗證員：歐美日三區數量差距驗證。範圍：歐洲（EU Solr）、日本（日本搜尋 API）、
> 北美（NA Algolia）。台港另有一路調查員負責，不在此報告內；
> 韓國（App 顯示 2 款）亦不在本次驗證範圍，僅在總表備註。
> 方法：只用任天堂官方端點與公開資料，不爬任何比價站的遊戲／價格資料庫；
> 所有請求節流 250–400ms。App 數字來自使用者提供的某比價 App「設定顯示國家」
> 截圖（快照日期不明，視為約數）。
> 探測腳本：`scripts/probe-count-gaps.mjs`、`probe-count-gaps2.mjs`、
> `probe-count-gaps3.mjs`、`probe-count-gaps4.mjs`、`probe-count-gaps5.mjs`、
> `probe-price-fields.mjs`（可重跑；原始統計見 `/tmp/count-gaps*.json`、
> `/tmp/price-fields.json`）。

## 總表

| 區 | App 數字 | 官方來源數字 | 差距 | 成因 | 還缺什麼 |
|---|---|---|---|---|---|
| 歐洲 GB | 24,314 | Solr GAME 有 nsuid 20,217；GAME 總數 23,932；DLC 10,494 | +4,097（對 20,217）；+382（對 23,932） | DLC＋組合包只能補約 420–1,260 款，補不上 4,097；最接近的是 GAME 總數（含 3,715 個無 nsuid 舊主機／手機遊戲），差距僅 382（1.6%） | GB 差距未完全解釋：若 App 只計有 nsuid 的 Switch 遊戲，仍差約 2,800–3,700；需確認 App 是否把無 nsuid 的 GAME 也計入 |
| 歐洲 CZ | 21,710 | 同上（EU 群組共用編號） | +1,493（對 20,217） | 與 GB 同一口徑問題，量級一致 | 同上 |
| 歐洲 HU／CH／DK | 11,105／11,067／11,110 | 同上；價格 API 抽查 158 款 GAME＋40 款 DLC，五國有價率完全相同 | 約為 CZ 的 51%，差距約 10,600 | 三個假設（只計有價／只計 Switch 1／Solr 含未上架）全部被實測推翻 | **未解釋**：官方端顯示五國應有相同量級，差距在 App 端計數口徑，不在任天堂資料 |
| 歐洲 ZA／NZ | 21,665／20,528 | 同上 | +1,448／+311（對 20,217） | 與 CZ 同量級，符合 GAME 有 nsuid＋少量組合包的口徑 | 同 GB |
| 日本 | 23,482 | 搜尋 API 1_HAC 29,995；其中本體(7001)約 16,500、DLC(7005)約 9,100、組合包(7007)約 4,100 | −6,513 | 本體＋組合包約 21,500（含 Switch 2 的約 1,000），可解釋約 70% 的差距；扣掉 DLC 後仍差約 1,900（8%） | **未完全解釋**：差約 1,900 款，可能是抽樣誤差（±600）＋App 另計部分 DLC／快照時間差，需更大樣本或 App 口徑確認 |
| 北美 CA | 23,627 | Algolia en_us Games 36,745；en_ca Games 33,303 | −13,118（對 US）；−9,676（對 CA 自身） | 不是 DLC／組合包（前 1,000 筆 97.1% 是本體，DLC 佔比低），也不是加拿大商店較小（抽查 50 款 US／CA 有價率完全相同） | **未解釋**：全量 prefix 分佈取不到（browse 403）；App CA 目錄可能不完整，或 App 只計某子集 |

## §1 歐洲：GB 24,314 vs Solr GAME 20,217

### 來源數字（2026-11-16 實測，Solr `search.nintendo-europe.com/en/select`）

- `type:GAME` 總數 **23,932**（de locale 23,997、fr 23,872，各 locale 浮動約 ±60）。
- 其中有 nsuid（`nsuid_txt:*`）**20,217**；無 nsuid **3,715**（舊主機／手機遊戲，無 eShop 編號）。
- `type:DLC` 總數 **10,494**，全部有 nsuid；**沒有 BUNDLE 這個 type**（facet：game 23,932、dlc 10,494，其餘為 news／support／interview 等非遊戲內容）。
- 有 nsuid 的 GAME 全是 Switch 系（`system_names_txt:switch` = 20,217）；其中 Switch 2 約 **730** 款（token `2`），僅 Switch 1 約 19,487 款；`eshop_removed_b:true` 的有 nsuid GAME 為 0。
- 附註：`system_names_txt:3ds` 查詢回 20,217（等於全部），與 facet（3ds token 全索引僅 1,684 筆）矛盾，是未解釋的查詢異常，本報告不採用該 token 的計數；switch／2 的拆分有「730＋19,487＝20,217」的算術一致性，才採用。

### DLC＋組合包能補多少？

- DLC 標題關鍵字分類（多段抽樣 5 段 × 20 筆，n=100）：bundle／collection／complete edition 等組合包字樣僅 **4%**，edition 類 2%，其餘 94% 為純 DLC（任務、造型、關卡等）。
  單段抽樣（n=100，Zombie Army 4 聚類）曾得 12%，屬聚類偏差；以多段 4% 為準，組合包約 **420 款**，寬鬆估計（12%）約 1,260 款。
- 20,217＋420 ≈ 20,637；即使寬鬆算 20,217＋1,260 ≈ 21,477，離 24,314 仍差約 **2,800–3,700**。
- **結論：DLC＋組合包補不上 4,097 的差距。**最接近 App 數字的反而是 GAME 總數 23,932（含 3,715 個無 nsuid 的舊遊戲），差距僅 +382（1.6%）。
  但一個 Switch 比價 App 照理不會把無 nsuid 的舊主機／手機遊戲計入，因此 GB 差距只能算**部分解釋**：
  若 App 口徑 ≈ GAME 總數，差距只剩 382（可能是新作／跨 locale 浮動）；若 App 口徑 = 有 nsuid 的 Switch 遊戲＋組合包，仍有約 2,800–3,700 未解釋。

## §2 歐洲內部：HU／CH／DK 約 11,064 vs CZ 21,710、GB 24,314

### 實測（三個假設全數推翻）

抽樣：Solr GAME 隨機三段（start=5,000／12,000／19,000，各 40 款，合計 118 款）
＋先前一段 40 款，共 158 款；另抽 DLC 40 款。以價格 API（每國 1 次呼叫，≤50 個 ID）
查 GB、CZ、HU、CH、DK 五國 `sales_status`。

- GAME 118 款：**五國完全相同**——onsale 116 款、其他狀態 2 款（同一 2 款在五國皆非 onsale），
  HU／CH／DK 沒有任何一款比 GB／CZ 少。
- DLC 40 款：五國皆 40/40 onsale。
- (a)「App 只計有該國價格的商品」：**推翻**——HU／CH／DK 對抽查商品幾乎 100% 有價。
- (b)「只計 Switch 1 不計 Switch 2」：**推翻**——Switch 2 遊戲全 EU 僅約 730 款（3.6%），
  扣掉也只剩 19,487，遠高於 11,064。
- (c)「Solr 含該國未上架商品」：**推翻**——同 (a)，抽查商品在 HU／CH／DK 皆在售。

### 差距成因：未解釋

- HU／CH／DK 三國數字高度一致（11,105／11,067／11,110），皆約為 CZ 21,710 的 **51%**，
  這種整齊的比例不像各國上架差異（上架差異不會三國同步到同一個百分比），
  比較像 App 端的計數口徑或抓取覆蓋問題（例如該 App 這三國的目錄只抓了一半、
  或只計了某個子集），但**無法從任天堂官方端驗證 App 的內部口徑**。
- 官方端結論：EU 群組 20 國共用同一組編號，價格 API 證實 HU／CH／DK 與 GB／CZ
  的有價率相同，因此本站目錄應以 **20,217 款 GAME（＋10,494 DLC）**為準，
  不應把 HU／CH／DK 當成只有 11,064 款。
- 附註：ZA 21,665、NZ 20,528 與 CZ 21,710 同量級，符合 GAME 有 nsuid＋少量組合包的口徑；
  只有 HU／CH／DK 三國異常偏低。

## §3 日本：App 23,482 vs 搜尋 API 29,995

### 來源數字（`search.nintendo.jp/nintendo_soft/search.json`，空查詢 total）

- 無 `opt_hard`：36,331；`opt_hard=1_HAC`（Switch 1）：**29,995**；
  `05_BEE`（Switch 2）：2,181；`2_CTR`（3DS）：1,855；`4_WUP`（Wii U）：766。
  四者加總 34,797，與無 opt 的 36,331 差 1,534（原因未明，可能是無 hard 值項目或跨 hard 重複計數）。
- `limit` 上限約 150（`limit=1000` 實回 400，後續分頁以 150 計）；同一頁重抓兩次 id 集合完全相同，
  分頁穩定；但無 opt 查詢的排序會按 hard 分群（第 1 頁全是 05_BEE，中段全是 1_HAC），
  隨機取頁時須按 hard 分層，否則 hard 比例會失真。

### 總數構成拆解（隨機取頁抽樣，1_HAC 兩輪合計 n=2,250；05_BEE n=900）

按 nsuid 前綴分類（與 `sform`／`sctg` 完全對應：7001＝遊戲本體 `HAC_DL`／`dl_soft`；
7005＝追加內容 `DLC`／`aoc`；7007＝組合包 `DL_DLC`／`bundle`）：

| 類別 | 1_HAC（29,995）佔比 | 推算款數 | 05_BEE（2,181）佔比 | 推算款數 | 合計 |
|---|---|---|---|---|---|
| 遊戲本體 7001 | 54.9% | 約 16,500 | 34.7% | 約 760 | 約 17,200 |
| DLC 7005 | 30.4% | 約 9,100 | 53.4% | 約 1,170 | 約 10,300 |
| 組合包 7007 | 13.6% | 約 4,100 | 11.3% | 約 250 | 約 4,300 |
| 無 nsuid | 1.2% | 約 350 | 0.6% | 約 10 | 約 360 |

- 狀態（`ssitu`）：1_HAC 抽樣 onsale 95.0%、sales_termination 3.0%、not_found 2.0%；
  05_BEE 抽樣 onsale 89.1%、sales_termination 7.9%、not_found 2.8%、unreleased 0.2%。
  重複 nsuid 極少（1_HAC 1,500 筆中 1 筆）。
- 3DS（2_CTR）與 Wii U（4_WUP）抽樣（n=300／150）：nsuid 前綴分別為 5001／2001（非 Switch 編號），
  `ssitu` **全部 not_found**（兩平台 eShop 已關閉，皆為失效條目），故不應計入 Switch 遊戲數。

### 差距從哪裡補

- 本體＋組合包（Switch 1＋2）≈ 17,200＋4,300 ≈ **21,500**，與 App 23,482 差約 **1,900（8%）**。
- 其他組合皆對不上：本體 alone 約 17,200（差 6,300）；本體＋DLC 約 27,500（多 4,000）；
  全部 onsale 項目約 30,400（多 6,900）；本體＋組合包只計 onsale 約 20,300（差 3,200）。
- **結論：未完全解釋。**扣掉 DLC（7005）是最合理的口徑（App 計的是「遊戲」，不計追加內容），
  可解釋 6,513 差距中的約 4,600，剩下約 1,900。抽樣誤差約 ±600（95% 信賴區間），
  剩餘差距可能是 App 另計部分 DLC（如可獨立遊玩的內容）、快照時間差，或 App 的去重口徑不同。
  需更大樣本（或 App 口徑說明）才能收斂，不硬湊。

## §4 北美：App 加拿大 23,627 vs Algolia Games 36,745

### 來源數字（`store_all_products_<locale>`，空查詢 `nbHits`＋`facets=productType`）

| locale | 全部商品 nbHits | Games（Juegos／Jogos） | 其他 |
|---|---|---|---|
| en_us | 37,632 | **36,745** | Merchandise 687、Hardware 266 |
| en_ca | 33,309 | **33,303** | Hardware 1 |
| es_mx | 34,429 | 34,429 | — |
| pt_br | 29,776 | 29,768 | Hardware 8 |

### 遊戲本體實際多少：取不到全量，只能給範圍

- 全量 prefix 分佈**無法用公開 search key 取得**：browse 端點回 403
  （`Method not allowed with this API key`）；nsuid 是字串屬性，數值區間 filter（`nsuid>=70010000000000`）回 0；
  全文 query（`query=7001`）只回 3 筆（nsuid 不是全文檢索欄位）。
- 前 1,000 筆 Games 命中（空查詢第 1 頁）：**7001 971 筆（97.1%）、7007 28 筆（2.8%）、7005 1 筆（0.1%）**；
  第 901–1,000 筆 100% 是 7001。但空查詢排序有人氣／新作加權（前 5 筆多為未發售新作），
  樣本偏向新遊戲，DLC 在全量中的佔比可能高於 2.8%；即便如此，DLC 佔比低是明確的，
  與日本搜尋 API（DLC 佔 30%）的構成完全不同。
- **結論：NA 的 36,745 款 Games 中本體佔絕大多數，DLC／組合包只佔小部分，
  因此「扣掉 DLC／組合包」解釋不了 13,118 的差距。**若硬要本體數 ≈ 23,627，
  需 DLC 佔比達 36%，與前 1,000 筆證據（2.8%）矛盾。

### 加拿大商店是否小於美國：實測否定

- 抽查 50 個 7001 Games nsuid（取自前 1,000 筆，隨機抽）打價格 API：
  US onsale 49、其他狀態 1；**CA onsale 49、其他狀態 1，完全相同**，CA 獨有／US 獨有皆 0。
- CA 自身索引 Games 33,303，比 US 少 3,442 款（美加索引差異），但價格 API 顯示兩國在售重疊率極高；
  50 款熱門遊戲樣本中兩國毫無差別（冷門遊戲可能有差異，但改變不了量級）。
- **結論：App CA 23,627 與 CA 自身索引 33,303 仍差 9,676，差距成因未解釋。**
  最可能的解釋是 App 端 CA 目錄不完整（或 App 只計某子集），不是任天堂加拿大商店真的只有 23,627 款。

## §5 補充：商店前端端點是否自帶價格（目錄＋價格能否一次解決）

> 使用者追加問題：大多數比價站是定期抓各區官網前端公開 JSON／API，不一定用價格 API。
> 實測：三個端點的 payload **都自帶價格欄位**，但覆蓋與語義各有限制。

### EU Solr：有價格欄位，單一 locale 價，且有一例異常

- 欄位（以曠野之息 `/en/` 文件為例）：`price_regular_f`（原價）、`price_lowest_f`（現價／最低價）、
  `price_sorting_f`（排序用現價）、`price_has_discount_b`、`price_discount_percentage_f`。
- 乾淨對照（星露谷，無 DLC）：en 欄位三者皆 10.99（＝GB £10.99，與價格 API 一致）；
  de 皆 13.99（＝DE €13.99，與價格 API 一致）。特價範例：I am Setsuna regular 29.99／lowest 8.99／-70%；
  en locale 目前特價 GAME 共 1,993 款。
- **異常一例**：曠野之息 en：regular 77.98／lowest 59.99（77.98＝59.99＋17.99，恰為本體＋擴充票合計）；
  de：三個欄位皆 89.98（＝69.99＋19.99），與價格 API 的 DE €69.99 不符。單一樣本，原因未明。
- **限制**：每個 locale 只有一個價格（en≈GB、de≈DE），**不能給出 20 國逐國價**；
  且有上述異常樣本，Solr 價格不宜直接當作各國現價，需以價格 API 為準。

### NA Algolia：有完整價格欄位，分 locale 幣別

- `eshopDetails`：`regularPrice`、`discountPrice`、`discountPriceStart`／`discountPriceEnd`／
  `discountPriceEndTimestamp`、`currency`、`isPurchasable`、`isPreorderable`、
  `productType`（`TITLE`／`ADD_ON_CONTENT`，可區分本體與 DLC）。
  頂層另有 `price`：`finalPrice`／`regPrice`／`discounted`／`salePrice`／`amountOff`／`percentOff`，
  以及 `priceRange`／`collectionPriceRange`。
- 實測：Mario Kart World `eshopDetails.regularPrice=79.99`、`currency=USD`，
  與價格 API 的 US $79.99 一致；曠野之息查詢首筆為 DLC 項目（`ADD_ON_CONTENT`，$9.99）。
- **結論**：NA 目錄＋價格可由 Algolia 一站解決（每 locale 一個幣別，8 個 locale 索引），
  價格 API 仍可作交叉驗證。

### 日本搜尋 API：有完整價格欄位（日圓）

- 欄位：`pprice`（套裝／定價；純 DLC 為 null）、`dprice`（下載版定價）、`sprice`（特價；無特價為 null）、
  `current_price`（現價）、`price`、`sale_flg`（0／1）、`ssitu`（onsale 等）。皆為日圓整數。
- 實測：曠野之息 pprice／dprice／current_price／price 皆 7,678，與價格 API ¥7,678 一致；
  特價範例「超兄貴 爆烈亂鬥篇」pprice 4,290 → current_price／sprice 2,574、sale_flg=1；
  DLC 範例 pprice null、dprice／current_price／price 199。
- **結論**：JP 目錄＋價格可由搜尋 API 一站解決，不需價格 API。

### 對更新程式的意義

- **可以**用商店前端端點同時解決目錄與價格：NA（Algolia，8 locale）、JP（搜尋 API）皆有完整分區價格；
  EU Solr 只有每 locale 一個價格，可作目錄＋參考價。
- **但多國比價仍需價格 API**：Solr 一個 locale 只給一個價，無法覆蓋 EU 20 國逐國價；
  且 Solr 有 BOTW／de 的異常樣本。建議：目錄與參考價走前端端點，逐國現價走價格 API
  （每款最多 6 個群組編號覆蓋 32 國），兩者互為交叉驗證。

## 方法與限制

- 全部數據為 2026-11-16 當日快照；Algolia／Solr／日本搜尋 API 索引即時更新，筆數會浮動。
- 抽樣誤差：JP 構成推算基於 n=2,250（1_HAC）＋n=900（05_BEE），本體＋組合包合計的 95% 信賴區間約 ±600；
  EU DLC 組合包比例基於標題關鍵字 n=100，約 ±4 個百分點；NA CA／US 有價抽查 n=50（熱門遊戲），冷門遊戲未覆蓋。
- 未爬任何比價站資料庫；未推 GitHub；未碰 Supabase；無任何 Secret 寫入檔案。
- 韓國 App 顯示 2 款：不在本次驗證範圍；已知背景為 KR 官方清單頁僅 13 筆精選（見 `data/region-sources-report.md` §6），
  App 的 2 款與該背景不矛盾，但未實測。
