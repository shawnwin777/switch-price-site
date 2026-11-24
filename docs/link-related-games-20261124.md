# DLC／組合包連結方法與同名雙版本配對（2026-11-24）

工頭：DLC 連結方法。產出：

- `supabase/migrations/20261124_add_game_relations.sql` — 關聯表（shawn 在 SQL Editor 跑）
- `scripts/link-related-games.mjs` — 回填腳本（`--dry-run` 預設只印不寫；`--apply` 才寫）
- `data/game-relations-20261124.json` — 腳本 `--dry-run` 產出的連結資料檔（3,289 列）
- 本文件 — 方法、量測、限制

## 1. 問題

`games` 表沒有 parent 欄位；`public/data/tw-addons.json` 的 5,284 筆
`parentVerified` 全是 false，匯入時沒有建立任何父子關係。要回答兩個問題：

1. 某款 DLC／語言包／組合包屬於哪款本體遊戲？
2. 某款本體遊戲的「同名另一代主程式」是哪一款（如 Witcher 3 Complete
   Edition（Switch 1）↔ Remastered（Switch 2））？

母體：庫內具名 DLC／組合包 3,498 筆（DLC 2,727＋組合包 771；未具名
1,786 筆標題是佔位文字，不參與連結）。

## 2. 連結方法

### 2.1 正規化（雙邊同一套）

1. 先去 `®™©` —— 一定要在 NFKC **之前**，否則 `™` 會被轉成 `"TM"`
  （實測：`UNO™` 曾被誤正規化成 `unotm`）。
2. NFKC（全半形統一）、小寫。
3. 標點（`《》「」『』()[]:：-–—/\"'.,，、·・~!！?？。♡#` 等）轉空白、`+` 轉空白、壓縮空白。
4. 羅馬數字 token 轉阿拉伯數字（`II→2`、`IV→4`、`VII→7`；`X`、`I` 不動），
   讓 `Bare Knuckle IV` 對上 `Bare Knuckle 4`。

### 2.2 候選本體標題

- `title_zh` 為主。
- `title_en` 只有在「不是 `title_zh` 的子字串」時才加入。庫裡很多英文名是殘缺片段
  （`LEGO`、`DX`、`Nintendo Switch`、`Fresh`），直接拿來比對會把
  `LEGO Star Wars` 的 DLC 連到 `LEGO®ワールド` 這類錯誤本體。
  驗證：過濾後 `lego`／`dx`／`fresh`／`nintendo switch` 都不再是候選標題。
- 另外索引：去括號版（`潛水員戴夫 (DAVE THE DIVER)` → `潛水員戴夫`）、
  中英併寫版（`雙人成行 It Takes Two`）。

### 2.3 孩子標題的前處理（先剝後綴，再比對）

| 種類 | 剝法 | 例 |
|---|---|---|
| 升級通行證 | 截斷到 `Nintendo Switch 2 Edition` 之前（含後面的 `+ XXX`） | `星之卡比 探索發現 … + 星耀世界 升級通行證` → `星之卡比 探索發現` |
| 語言包（英文） | 去 `xxx Language Pack`＋語種詞 | `Hogwarts Legacy: German Language Pack` → `Hogwarts Legacy` |
| 語言包（中文） | `《本體》語言包`／`《本體》：德文語言包` 取 `《》` 內文 | `《霍格華茲的傳承》：德文語言包` → `霍格華茲的傳承` |
| 其他 | 不剝，整標題比對 | — |

升級通行證連到「截斷後的本體」（Switch 1 本體），不是連到 Switch 2 Edition
那一列；Switch 2 Edition 本身再用 edition 配對連回本體，詳情頁可透過
edition 圖走訪。

### 2.4 比對順序（先命中先贏）

0. **exact**：core 與本體標題完全相等（含中英併寫）。
0a. **multi**：多遊戲組合包。`A＋B`／`A＆B`／`《A》《B》` 且兩個以上的部分
    都是遊戲 → 每個內含遊戲各寫一列 `bundle`。`&` 在 `《》` 裡不算切分
    （`《Raining Cats & Dog》` 是 DLC 名稱）；`&` 分支還要求第一部分
    （幾乎）就是一款遊戲，否則 `MARVEL Cosmic Invasion - Cyclops & The Thing`
    會誤把兩個角色當兩個遊戲。
0b. **paren-for**：括號裡的 `（X專用）`／`(for X)`，X 就是本體。
    例：`御魂神樂・神意之舞（真・女神轉生Ⅴ Vengeance專用）`。
1. **split**：在第一個冒號／破折號／加號切分，head 正好是一款遊戲。
    `"GAME: DLC名"`／`"GAME - DLC名"` 是任天堂商店的標準寫法，直接點名本體，
    只有餘部是續作數字時才拒絕。括號優先：`《X》` 內的冒號不切。
    head 是遊戲標題開頭時走 **split-reverse**（如 `Fitness Boxing 3` <
    `Fitness Boxing 3: Your Personal Trainer`），再用同一套接受條件驗證。
2. **bracket**：`《本體》- 追加內容`，`《》` 內文就是本體；內文含冒號時取
    token 前綴（如 `《芬尼克斯傳說：失落眾神》` → `芬尼克斯傳說`）。
3. **最長 token 前綴**：core 的開頭 token 序列是最長的本體標題，或是某款
    遊戲標題的開頭（如 `Formula Racing Pro 2026` <
    `Formula Racing Pro 2026 職業方程式賽車 2026`；`勇者鬥惡龍 尋寶探險團` <
    `勇者鬥惡龍 尋寶探險團 藍色眼眸與天空羅盤`）。後者要求候選夠長、
    共享前綴的遊戲 ≤5 款且最短者明顯最短（防 `sega`、`kawaii` 這種
    1-token 通用前綴誤連 40 幾款遊戲）。
4. **char-prefix**：字元前綴，處理中文無空格黏合
    （`雷納提斯解放者版` → `雷納提斯`）。
5. **reverse**：遊戲標題以 core 開頭（本體標題帶英文別名，如
    `霍格華茲的傳承` < `霍格華茲的傳承 Hogwarts Legacy`）。只用在語言包／
    升級通行證，或 core ≥12 字元時。

### 2.5 接受條件（前綴類）

- 餘部含 DLC 標記 → 接受。標記表：`season pass`／`expansion pass`／`dlc`／
  `pack`／`bundle`／`deluxe`／`edition`／`pass`／追加／擴充／擴展／內容包／
  服裝／造型／樂曲／組合包／豪華版／升級包／升級通行證／數位豪華版／故事／
  劇情／關卡／角色／人物包／語言包／主題／季票／通行證／外傳／特典／服裝包／
  音樂包／地圖包／武器包／包／套組／章節／篇／版／plus／prologue／序章／
  終極版／完全版／決定版／重製版／紀念版／uniform／制服／collection。
- 餘部無標記時：父標題夠長（中文 ≥6 字元、純拉丁 ≥8 字元）且是最長唯一匹配
  （與次長候選差 ≥2 字元）→ 接受；中文父標題 ≥5 字元且餘部只有 1 個 token
  → 接受（如 `寶可夢 紫 零之秘寶`）。
- **續作守門**：餘部以 `2`／`3`／`ii`／`iii`… 開頭 → 拒絕。例：
  `Metal Gear Solid 2: Digital Graphic Novel` 不連到 `METAL GEAR SOLID`
  （1 代）；`Fitness Boxing 3: Encore Tunes EX` 不連到 `Fitness Boxing`
  （1 代）；`冒險村物語2 …升級通行證` 不連到 `冒險村物語`（1 代）。
  例外：數字是數量不是代數時放行（`GigaBash 4 Kaiju Pack` 的 `4` 後面
  不是標記詞，照常接受）。
- **多遊戲守門**：餘部是「三部曲合輯／trilogy collection」→ 拒絕，
  因為內含多款遊戲、沒有單一本體。例：`勇者鬥惡龍 HD-2D版 羅德三部曲合輯`
  不連到 `勇者鬥惡龍`（1 代）。DLC 名稱裡提到某三部曲（如跨界合作）
  不受影響。

### 2.6 同名雙版本配對（edition）

- 本體標題去版次後綴（`Complete Edition`／`Remastered`／`Deluxe Edition`／
  `Definitive Edition`／`Ultimate Edition`／`Nintendo Switch 2 Edition`／
  `重製版`／`完全版`／`終極版`／`豪華版`／`決定版`／`典藏版`／`年度版`／
  `加強版`／`Remake` 等）得到 base；同一 base 下，不同（標題、主機）組合
  兩兩配對。
- 配對條件：主機不同（且都不為空）**或**標題不同。標題相同且其中一邊主機
  為空＝重複上架列，不是另一代，跳過（樣本裡 `legends saint george`、
  `axobubble`、`boxville 2`、`we were here together` 皆屬此類）。
- Witcher 3：`the witcher 3 wild hunt` base 下，
  `the-witcher-3-wild-hunt-complete-edition`（Switch）↔
  `the-witcher-3-wild-hunt-remastered`（Switch 2）配對成功。
  第三列 `tw-70010000128695`（巫師3：狂獵 — 重製版）是中文標題，
  base 不同（`巫師3 狂獵`），未配對——中英跨語言的同名配對是已知限制。
- 結果：490 組 base → 454 對（雙向 908 列）。

## 3. Schema 決定：`game_relations` 關聯表（不用 `games.parent_game_id`）

| 考量 | `parent_game_id` 一欄 | `game_relations` 表（選定） |
|---|---|---|
| 多本體 | 一列只能指一個本體，多遊戲組合包（P3P＋P4G 同捆包等 9 筆）放不下 | 每個內含遊戲一列 |
| 重複上架列 | 一列只能指一個 slug，canonical＋tw- 列只能選一邊 | 每個 slug 一列，兩邊詳情頁都看得到 |
| edition 對稱性 | A 是 B 的另一代、B 也是 A 的另一代，一欄無法雙向 | 雙向各寫一列，詳情頁單一查詢就拿到 |
| 查詢 | — | 本體的相關內容：`WHERE related_game_id = :game AND relation_type IN (...)`；DLC 的本體：`WHERE game_id = :dlc`；另一代：`WHERE game_id = :game AND relation_type = 'edition'` |
| 可追溯／可重算 | 改規則要改 games 結構 | `method`／`confidence` 欄位記錄每列怎麼來的，規則改了重跑腳本即可 |

欄位：`game_id`、`related_game_id`（皆 FK games，ON DELETE CASCADE）、
`relation_type`（`dlc`／`language_pack`／`upgrade_pass`／`bundle`／`edition`）、
`method`、`confidence`（`high`／`medium`）、`source`（預設
`link-related-games`；`--prune` 只清這個來源的列）、`created_at`／`updated_at`。
唯一鍵 `(game_id, related_game_id, relation_type)`，腳本重跑 upsert 不重複。
RLS：公開 SELECT；寫入只走 Service Role Key（同 `game_region_ids` 的寫法）。

relation_type 判定：語言包 → `language_pack`；升級通行證 → `upgrade_pass`；
組合包／多遊戲 → `bundle`；DLC → `dlc`；標題與本體完全相同的組合包
（如 `《雙人成行》── 好友通行證`）→ `edition`（它是同一商品的另一種賣法，
不是 DLC）；edition 配對 → `edition`（雙向）。

## 4. 樣本量測（人工逐筆對，2026-11-24）

母體：庫內具名 DLC／組合包 3,498 筆；最終規則匹配 1,680 筆（48.0%）。
量測是邊修規則邊抽查，共四輪；數字是「該輪規則下」的結果，不是事後挑選。

### 4.1 第一輪（v4，寬鬆前綴＋比率門檻，樣本 120 筆）

- 匹配 60 筆：59 正確、1 錯誤（`勇者鬥惡龍 HD-2D版 羅德三部曲合輯` 連到
  `勇者鬥惡龍` 1 代——多遊戲組合包誤連單一本體）。精確率 59/60＝98.3%。
- 拒絕 30 筆：17 筆其實有本體可連（漏連），13 筆正確拒絕。漏連主因：
  `《芬尼克斯傳說：失落眾神》` 等括號內冒號、`寶可夢 朱／紫 零之秘寶`、
  `歐利歐利世界` 系列（父標題 6 字元被長度門檻擋下）、`潛水員戴夫` 括號別名。
- 未連 30 筆：29 筆確實無法從標題判斷，1 筆漏連（`雷納提斯解放者版`——
  中文無空格黏合，token 前綴抓不到）。
- 教訓：比率門檻是錯的方向（升級通行證後綴很長，比率都很低但完全正確）；
  真正有用的是「餘部含不含 DLC 標記」＋「父標題夠不夠長」。

### 4.2 第二輪（v5，加入切分／括號／CJK 長度規則，樣本 120 筆）

- 匹配 60 筆：57 正確、3 錯誤。3 錯都是切分規則誤傷：
  `勇者鬥惡龍 尋寶探險團 Deluxe Edition Upgrade` 連到 `勇者鬥惡龍`（應連
  尋寶探險團——本體標題帶副標，token 前綴抓不到）；
  `Om Nom: Run 2 - 超強奧姆` 連到 `Om Nom: Run`（冒號在遊戲名裡，切錯位置，
  把 2 代 DLC 連到 1 代）；`《忍者龜：史林特的命運》— 黃金版` 連到
  `忍者龜：許瑞德的復仇`（同上，冒號在 `《》` 內）。
  精確率 57/60＝95.0%。
- 拒絕 30 筆：13 筆可修的漏連（`寶可夢 零之秘寶`、` plus`、`終極版` 等標記缺漏），
  5 筆 UNO 變體（`UNO FLIP!`、`UNO The Call of Yara` 等——確實是 UNO 的 DLC，
  但父標題只有 3 字元、餘部無標記，安全起見不連），其餘正確拒絕
  （`Island Berry Set` 經查是 WorldNeverland 的 DLC，不是 `ISLAND`；
  `Echoes of the City` 是獨立遊戲，不是 `Echoes` 的 DLC；
  `Cat Baby Suits` 的候選本體 `.cat` 是壞標題）。
- 未連 30 筆：全數正確（或確實無法判斷）。

### 4.3 第三輪（v6，修切分＋反向前綴，樣本 105 筆）

- 匹配 60 筆：59 正確、1 錯誤（`SEGA 音樂包` 連到 `SEGA AGES 2`——
  單 token 前綴 `sega` 共享 40 幾款遊戲，最短者被誤選）。精確率 59/60＝98.3%。
- 拒絕 15 筆：7 正確、5 UNO 變體（接受漏連）、3 可修
  （`Brotato: Abyssal Terrors`、`停車堵塞:雪地快衝`、`小小夢魘3 - 幕後`——
  冒號切分已點名本體，不該再要求餘部有標記）。
- 未連 30 筆：全數正確。
- 另查：v6→v7 掉的 221 筆裡，抽查 30 筆幾乎全是 v6 的誤連
  （`Family Time DLC`→`Family Man`、`Cool Shades`→`Cool Animals`、
  `Star mine`→`Star Fox` 等單 token 前綴誤連），只有 2 筆是真漏連
  （`真人快打 1：戰慄`、`永泉傳說 —— 破碎之形`——CJK 短候選被門檻擋下），
  已在最終規則修掉。

### 4.4 最終規則（v8，樣本 40 筆驗證＋語言包全數）

- 匹配 40 筆：40 筆全對（其中 3 筆是多遊戲組合包，只連到其中一款是已知
  限制，見 §6）。
- 語言包 31 筆全數人工對過：30 筆連上且正確（LEGO 天行者傳奇 8 筆、
  霍格華茲 14 筆、MGS 4 筆、網球王子 2 筆、其餘 2 筆），
  1 筆未連：`《邊緣禁地3》額外語音語言`——庫裡沒有 `邊緣禁地3` 本體列
  （只有英文 `Borderlands 3 Ultimate Edition`，中英名無重疊）。
- 拒絕 13 筆全數正確（續作守門 3 筆：`冒險村物語2` 升級通行證、
  `Metal Gear Solid 2` 系列；多遊戲守門 1 筆：DQ 三部曲合輯；其餘為
  UNO 變體／WorldNeverland／獨立遊戲等正確拒絕）。
- 升級通行證 83 筆：82 筆連上（81 exact＋1 reverse），1 筆拒絕是正確的
  續作守門（`冒險村物語2`）。

### 4.5 最終數字（腳本 `--dry-run`，2026-11-24）

- 具名 DLC／組合包 3,498 筆 → 連結成功 1,680 筆（48.0%）、
  拒絕 13 筆、未連 1,805 筆。
- 方法分布：split 737、prefix-marker 585、prefix-long-cjk 102、exact 97、
  prefix-long 50、plus 37、split-reverse-prefix-marker 20、reverse 17、
  char-prefix-marker 14、multi 9、paren-for 4、bracket-prefix 2、
  prefix-short-cjk 2、split-reverse-prefix-long-cjk 2、char-prefix-long-cjk 1、
  char-prefix-long 1。
- 關係列：DLC／組合包 2,381 列（dlc 1,287、bundle 951、upgrade_pass 108、
  language_pack 31、exact-bundle 視為 edition 4 列）＋ edition 配對 454 對
  （雙向 908 列）＝ **3,289 列**。
- 同一本體多個上架列時，DLC 會連到每一個列（僅 12／1,680 筆連到跨主機的
  本體列，其餘皆為同主機重複上架）。

## 5. 使用方式

```bash
# 1. 先跑 migration（Supabase Dashboard → SQL Editor，貼上整個檔案）
#    supabase/migrations/20261124_add_game_relations.sql
#    （跑之前 --apply 會失敗；跑完才能寫入）

# 2. 只看計畫＋產出資料檔（不寫庫；讀取可用 anon key）
NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
node scripts/link-related-games.mjs --dry-run

# 3. 正式寫入（冪等；需 service role key）
NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
node scripts/link-related-games.mjs --apply

# 4. 順便清掉已不存在的舊連結（只清 source='link-related-games' 的列）
node scripts/link-related-games.mjs --apply --prune
```

`--emit <路徑>` 可改資料檔輸出位置（預設 `data/game-relations-20261124.json`）。
`--dry-run` 也會對照 `public/data/tw-addons.json`：裡面有、庫裡還沒有的 nsuid
會印出筆數（先跑 `scripts/import-tw-addons.mjs` 再跑本腳本）。

## 6. 連結不到的限制（已知缺口）

1. **DLC 標題完全不含本體名**（最大宗，約 1,800 筆未連的主因）：
   `Dress Code`、`CyberFunk`、`Stunt Sets`、`追加角色：Axel`、
   `服裝「中華兔女郎」`、`高級回復藥套組（2）` 等。標題本身沒有父子資訊，
   只能靠 NSUID 對照表或官方商店「需要主程式」欄位補，標題規則到此為止。
2. **中英名無重疊**：本體只有英文列、DLC 只有中文名（或反之），如
   `《邊緣禁地3》額外語音語言`（本體只有 `Borderlands 3 Ultimate Edition`）、
   `Holo's花牌 DLC`（本體是 `hololive Holo's花牌`，DLC 省了 `hololive` 前綴）。
   需要中英對照詞典才能補，不在本規則內。
3. **本體列根本不在庫裡**：如 `冒險村物語2`（升級通行證的本體列還沒建）、
   `忍者龜：史林特的命運`（遊戲列缺失，拒絕是正確的——不能連到許瑞德的復仇）。
   庫補齊後重跑腳本即可連上。
4. **未具名佔位列**（1,786 筆）：標題是 `未命名商品 <nsuid>`，沒有任何資訊，
   不參與連結；命名後重跑腳本即可。
5. **多遊戲組合包只連第一款／可辨識的幾款**：`P3P＋P4G 同捆包`、`瑪利歐銀河
   1＋2`、`Sayonara Wild Hearts＋Lorelei` 等有 `＋`／`＆`／`《A》《B》`
   結構的已全連；但 `三部曲合輯` 類（DQ、鍊金工房、槍彈辯駁、GTA、Batman）
   內含遊戲無法從標題一一列舉，守門規則直接不連（寧缺勿濫）。
6. **同名不同遊戲**：同一正規化標題對到多個不同遊戲時（如 `Sworn` 等），
   腳本會連到每一個列；抽查中跨主機的情況只有 12／1,680 筆，
   其餘皆為同一遊戲的重複上架列。
7. **中英跨語言的 edition 配對**：`tw-70010000128695`（巫師3：狂獵 — 重製版）
   與 `the-witcher-3-wild-hunt-remastered` 是同一商品的不同語言列，
   base 不同所以沒配對；同理 `Lynked`（中文列）與
   `Lynked: Banner of the Spark`（英文列）是同一遊戲的兩列，未配對。
   這是「重複上架列」問題，不是 edition 問題，留待命名／去重處理。
8. **UNO 變體等短名 DLC**：`UNO FLIP!`、`UNO The Call of Yara`、
   `UNO™ SHOW 'EM NO MERCY™`、`《UNO™ Fenyx's Quest》` 確實是 UNO 的 DLC，
   但父標題只有 3 字元、餘部無標記，安全起見不連（誤連代價大於漏連）。
   另有 `Neva: Prologue`、`GigaBash 4 Kaiju Pack` 等已用 `prologue`／
   數字規則修掉，不在此列。

## 7. 誤判風險（已知的殘留風險）

- **前綴相同但不同遊戲**：最長匹配＋續作守門已擋掉大部分；殘留風險在
  「本體列缺失時，較短的同系列標題被誤選」，如 `勇者鬥惡龍 尋寶探險團`
  若無副標列會連到 `勇者鬥惡龍`。本次抽查未再見到此類錯誤。
- **合集與本體**：`7007` 前綴只是「組合包」，不等於 Switch 2 Edition；
  腳本不以此判斷，只看標題。`bundle` relation 表示「這個組合包內含／
  屬於該本體」，不是「這個組合包就是該本體」——唯一例外是標題與本體
  完全相同的組合包，記為 `edition`。
- **系列名誤當本體**：`SEGA 音樂包`、`KAWAII Pop Idol Pack`、
  `Family Time DLC` 這類單 token 通用前綴已用「候選 ≥2 token 或中文
  ≥4 字元＋共享前綴 ≤5 款＋最短者明顯最短」擋下；抽查未再見到。
- **confidence 欄位**：`high`＝exact／split／bracket／paren-for／plus／
  multi／edition-base；`medium`＝prefix-*／char-*／reverse／split-reverse-*。
  UI 若要保守顯示，可先只顯示 `high`，再逐步放寬。
