# 台灣 Nintendo eShop 商品覆蓋率：第三方來源與整合策略

> 研究文件／非部署指令。2026-11-22 更新。PR 分支內的工具只產報告，不動正式 Supabase。

## 已由 GitHub Actions 驗證的事實

- 官方 `https://www.nintendo.com/tw/api/software?spage=1` 預設回傳 `total=102`，每頁 24 筆。
- 加上 **`sftab=all`**：`https://www.nintendo.com/tw/api/software?sftab=all&spage=1` 回傳 **`total=4668`**，`spage=2` 和 `spage=10` 也有不同的有效 NSUID；見 [Run #45014432636](https://github.com/shawnwin777/switch-price-site/actions/runs/45014432636)。
- 官方 JSON 的商品列包含 `title`、`nsuid`、`publisher`、`softCode`、`hardwareCategory` 等欄位。
- repo 內 **2026-11-16 快照**的台灣在售價格記錄共 9,643 個 SKU（7001: 4,359；7005: 4,170；7007: 1,114），已具名 1,790、未具名 7,853；**不是 9,643 款不同遊戲**。見 [Run #45009633429](https://github.com/shawnwin777/switch-price-site/actions/runs/45009633429)。
- 本 PR 的 `scripts/collect-tw-name-evidence.mjs` 已改成 `sftab=all` 分頁讀取、按台灣 NSUID **精確比對**舊快照。新版完整結果須以該腳本最新 Actions 執行紀錄為準；API 回報的 4,668 不等於已成功配對 4,668 筆。

## 第三方作法（來源公開可核查的範圍）

### samsonjaw/tw-switch-price（開源，最適合台灣命名）

- https://github.com/samsonjaw/tw-switch-price
- `scripts/validate-tw-eshop.mjs` 使用 `/tw/api/software?sftab=all&spage=N` 列舉官方目錄，再以 `api.ec.nintendo.com/v1/price?country=TW` 查價，每批約 30 個編號，請求間有等待。
- `.github/workflows/pages.yml` 排程更新、靜態發布；把快照存成 `data/tw-eshop.json`，價格歷史存成 `data/price-history.json`。
- IGDB 用來補**評分／遊戲中繼資料**，不是官方台灣 NSUID 的權威來源。
- 我們只參考可驗證的方法，**不直接複製未經授權的原始碼或其整份數據**。

### 遊戲箱子 GameBox（非開源，參考功能）

- https://woo.gamebox.cool/AboutGameBox
- App Store: https://apps.apple.com/tw/app/id1461999065
- 官方商店文案表示收錄超過 8,000 個 Switch 遊戲，支援跨區價格、追蹤收藏與評分；**8,000 是 App 商品總量宣稱，不等於台灣在售遊戲數**。
- 未找到足以證實其後端 NSUID 配對與抓價演算法的公開原始碼，不應臆測，更不依賴未授權內部 API。

### Deku Deals（跨來源整合＋人工清理）

- https://www.dekudeals.com/
- 團隊說明不同區域官方網站與非文件化 API 都會作為來源，後台有大量 ingester/scraper 與管理審核功能；參考 https://www.reddit.com/r/NintendoSwitch/comments/1jrgjtz/were_the_deku_deals_team_helping_rnintendoswitch/
- 可學的是「多來源證據、資料清理後台、價格與使用者收藏分層」，**不是直接以名稱模糊配對後強制合併**。

### NTPrices（資料模型參考，API 付費）

- https://ntprices.com/api/v2/docs
- 文件將區域 `NSUID` 與跨商品身分鍵 `PPID` 區分，也列出 `IsDLC`、價格歷史、區域價格欄位。
- 可參考資料設計；其 API 不是可免費批量複製到本站的授權來源。

## 本站下一階段實作建議

1. **先完整盤點名稱：** 從 `sftab=all` 分頁下載台灣官方商品，保留 API 頁數、回報總量、每次更新時間、來源；若分頁失敗或不完整，報告標記 `incomplete`，**不寫入正式庫**。
2. **按 NSUID 精確關聯台灣價格：** 唯讀比對現有 7001／7005／7007 快照，分別計算遊戲本體、DLC/升級區間的有價數、有名數及空缺。
3. **商品與地區分開：** `canonical_product`（遊戲、版本、DLC、升級包等）、`region_listing`（國家＋NSUID）、`identity_evidence`（來源、欄位、驗證狀態）、`price_snapshot`（價格與時戳）、`parent_child_relation`（DLC 對母遊戲）。
4. **跨區配對分級：** 同國 NSUID 精確吻合可用來補名稱；日／美／台不同 NSUID 必須比對發行商、發售日、可靠代碼與版本，若 DLC 與本體、一般版與豪華版可能混淆，一律先不合併。
5. **歷史和快照分離：** 不因新一週掃描缺少 7005／7007 就覆蓋或遺失歷史 DLC；但也**不能把舊價格顯示為今天仍在售**。提供 freshness/last_verified_at。
6. **先測再部署：** 建立 SKU 重複鍵檢查、名稱衝突檢查、跨區錯配抽樣與 schema 回滾；通過後才進入 Supabase/前端整合。

## 安全邊界

- 不擅自合併 PR、部署、改正式資料庫。
- 不依相鄰 NSUID 直接合併商品。
- 不以 7001/7005/7007 字首代替商品內容類型的最終判定。
- 不假定香港、台灣所有商品都同價或同時上架。
