// 各區官方遊戲清單抓取器 + 目錄同步的純函式（不碰 DB，可單元驗算）。
//
// 背景：使用者要求「網頁自主更新、自己串聯」——每日更新不能再靠手動跑
// 種子腳本把新遊戲灌進目錄。本模組是全自動更新的第一半：
//   (a) 自己去抓各區官方遊戲清單（每區一個抓取器，來源可插拔）；
//   (b) 把清單條目對進現有目錄（比對規則見 planCatalogSync），
//       產出「新遊戲／補編號／補 title_id」的計畫；寫庫由 lib/catalog-sync.ts 做。
//
// 來源可插拔的設計：
//   - 每個來源是一個 CatalogSourceDef：{ id, country, label, status, fetch }。
//   - status = "active" 會被每日同步排程呼叫；"pending" 是來源調查結果
//     還沒回來、或端點還沒驗證的來源，只在回報裡列出，不會被呼叫、
//     不會讓同步失敗。調查結果一到：把該來源的 fetch 實作補上、
//     status 改 active、註冊進 ACTIVE_SOURCES 即可，不用改路由與排程。
//   - 抓取器永遠不拋錯：單一來源失敗回 { status: "failed", error }，
//     其他來源照常跑；整批失敗也不影響當天的價格更新（不同 cron）。

// ---------------------------------------------------------------------------
// 共用型別
// ---------------------------------------------------------------------------

/** 一條清單條目：某區官方清單上的一款遊戲。titleId 是「該區」的 NSUID。 */
export interface CatalogListEntry {
  /** 該區專屬 NSUID（JP 區即 games.title_id，TW/HK 區即 game_region_ids 的值）。 */
  titleId: string;
  /** 清單上的標題原文（JP 區是日文、TW/HK 區是中文）。 */
  title: string;
  /** 製作／發行商（只有 JP XML 有 MakerName；TW/HK 清單沒有）。 */
  maker?: string | null;
  /** 封面圖網址（只有 JP XML 有 ScreenshotImgURL；TW/HK 清單沒有）。 */
  coverUrl?: string | null;
  /** 發售日（只有 JP XML 有 SalesDate，格式如 2025-05-01）。 */
  salesDate?: string | null;
  /** 國家代碼（JP / TW / HK / US …）。 */
  country: string;
  /** 來源 id（jp-search / na-algolia / eu-solr / au-algolia / jp-xml …）。 */
  source: string;
  /** 完整 product code（8／9 字元，如 HACPAAAAA）：EU Solr
   *  product_code_txt（部分遊戲有）、JP XML InitialCode（全部有）。
   *  NA／AU 命中沒有此欄位；TW／HK／KR 清單的 softCode 不是 product code。 */
  productCode?: string | null;
  /** 日本搜尋 API 的 icode（product code 核心 5 碼，如 BDGEA）；
   *  跨區 join 用的 unique_id 約為 icode 前 4 碼，但推導規則尚未驗證，
   *  目前只記錄、不自動合併（見 DATA_NOTES.md §12.4）。 */
  icode?: string | null;
  /** 平台（完整來源才有：JP 搜尋 API 的 hard、EU Solr 的
   *  system_names_txt、NA／AU Algolia 的 platform／console；
   *  JP XML 與台港清單一律視為 Switch）。 */
  platform?: "Switch" | "Switch 2" | null;
  /** 遊戲類型（只有 AU Algolia 命中帶 genre；其他來源沒有）。 */
  genre?: string | null;
  /** 項目種類：game＝遊戲本體才會進目錄；dlc／bundle／upgrade 由各來源
   *  的編號前綴（NA 7005／7007、EU nsuid_txt、JP id 含 "_"）判斷，
   *  規劃時跳過、只計數（見 planCatalogSync）。 */
  productKind?: "game" | "dlc" | "bundle" | "upgrade";
  /** 商店前端自帶的價格（已驗證，可當新遊戲即時價；見 DATA_NOTES.md §12.6）：
   *  - JP 搜尋 API：dprice＝下載版定價、pprice＝套裝定價、sprice＝特價、
   *    current_price＝現價，皆日圓整數；sale_flg 0／1。實測 BOTW 7,678
   *    與價格 API 一致；特價例 pprice 4,290 → current_price／sprice 2,574。
   *    無特價結束日欄位（saleEnd 永為 null，特價剩餘天數以價格 API 為準）。
   *  - NA Algolia eshopDetails：regularPrice／discountPrice／
   *    discountPriceEndTimestamp（特價結束 Unix 秒）／currency／
   *    isPurchasable／productType（TITLE／ADD_ON_CONTENT）。實測 MKW
   *    regularPrice 79.99 USD 與價格 API 一致。
   *  規則：只寫新遊戲的「本國價」（JP 搜尋→JP、NA Algolia→US）；每日更新
   *  仍以價格 API 為準，價格 API 查到該國價時會覆蓋這筆（見
   *  lib/catalog-sync.ts 第 5 步），兩者不一致時價格 API 勝出。 */
  storePrice?: {
    regularRaw: number | null;
    effectiveRaw: number | null;
    currency: string;
    /** 特價結束時間（ISO；NA 有，JP 無）。 */
    saleEnd?: string | null;
    /** 是否特價中。 */
    onSale?: boolean;
  } | null;
  /** EU Solr 參考價（只記錄、永不寫入 prices）：price_regular_f／
   *  price_lowest_f／price_discount_percentage_f，僅 /en/ locale（≈GB，GBP）。
   *  只能當參考價——每個 locale 只有一個價（無法給 EU 20 國逐國價），
   *  且有異常樣本：BOTW de 三欄皆 89.98（＝69.99＋19.99），與價格 API
   *  的 DE €69.99 不符；BOTW en regular 77.98（＝59.99＋17.99）。
   *  新遊戲同步時以價格 API 的 GB 價交叉驗證，差異記進
   *  reference_price_mismatches，價格 API 勝出（見 lib/catalog-sync.ts）。 */
  referencePrice?: {
    regularRaw: number | null;
    effectiveRaw: number | null;
    discountPct: number | null;
    currency: string;
  } | null;
}

/** 單一來源的抓取結果（永遠有值，失敗也以 failed 回報、不拋錯）。 */
export interface CatalogSourceResult {
  source: string;
  country: string;
  entries: CatalogListEntry[];
  fetchedAt: string;
  status: "ok" | "partial" | "failed" | "pending";
  /** 失敗或部分失敗的原因（HTTP 狀態、逾時、解析異常…）。 */
  error?: string;
  /** 來源備註（筆數、覆蓋限制、停更日期…）。 */
  note?: string;
  /** 分頁進度（完整來源才有）：這次從第幾頁抓到第幾頁、下次從哪頁繼續、
   *  總共幾頁（total 未知時為 null）、是否已跑完一整輪。 */
  paging?: {
    startPage: number;
    nextPage: number | null;
    totalPages: number | null;
    done: boolean;
  };
}

export interface CatalogSourceDef {
  id: string;
  country: string;
  label: string;
  /** active：每日同步會呼叫；pending：來源未定／未驗證，不呼叫、只列在回報。 */
  status: "active" | "pending";
  /** pending 時寫明待補什麼（調查結果回來後照著補）。 */
  reason?: string;
  /** 全量抓取（小來源）；完整來源另有 fetchPaged（分頁窗口＋游標）。 */
  fetch: () => Promise<CatalogSourceResult>;
  fetchPaged?: (startPage: number, pageCount: number) => Promise<PagedFetchResult>;
}

// ---------------------------------------------------------------------------
// 純函式：標題正規化 / 拉丁抽取 / slug（沿用 scripts/build-expanded-catalog.mjs，
// 與擴大目錄同一套規則，舊目錄的 slug 才能對得上）
// ---------------------------------------------------------------------------

/** 標題正規化：比對鍵用。先去掉 ™®©℠（NFKD 會把 ™ 展開成 "TM"，
 *  導致 "Mario Kart™ 8 Deluxe" 等第一方標題比對失敗，見
 *  data/region-sources-report.md §11），再 NFKD → 小寫 → 只留字母數字。 */
export function normalizeTitle(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/[™®©℠]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** 從標題抽出拉丁字母部分作英文名；沒有拉丁字母回 null（呼叫端改用原文）。
 *  先看括號外的部分（例：「ゼルダの伝説 (ゼノブレイド3)」→ 括號是日文附註，
 *  應去掉）；括號外沒有拉丁字母時，再看括號內容
 *  （例：「ゼルダの伝説 (The Legend of Zelda)」→ 拉丁名在括號裡）。 */
export function extractLatin(title: string | null | undefined): string | null {
  if (!title) return null;
  const s = String(title).normalize("NFKD");
  const latinOnly = (str: string): string | null => {
    const latin = str
      .replace(/[^\x20-\x7E]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    return /[A-Za-z]/.test(latin) ? latin : null;
  };
  const noParen = s.replace(/\([^)]*\)/g, " ");
  const fromNoParen = latinOnly(noParen);
  if (fromNoParen) return fromNoParen;
  for (const m of s.matchAll(/\(([^)]*)\)/g)) {
    const fromParen = latinOnly(m[1]);
    if (fromParen) return fromParen;
  }
  return null;
}

/** 英文名 → slug：小寫連字號、去標點；無英文名回 null（呼叫端用 game-<id>）。 */
export function slugify(en: string | null | undefined): string | null {
  if (!en) return null;
  const s = String(en)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return s || null;
}

/** slug 佔用時取唯一 slug：先試原 slug，再試 slug-<nsuid 末 6 碼>，再試 -2、-3…。 */
export function uniqueSlug(
  base: string,
  nsuid: string,
  taken: Set<string>
): string {
  if (!taken.has(base)) return base;
  const suffix = String(nsuid).slice(-6);
  const withId = `${base}-${suffix}`;
  if (!taken.has(withId)) return withId;
  let i = 2;
  while (taken.has(`${withId}-${i}`)) i++;
  return `${withId}-${i}`;
}

/** 疑似 DLC／追加內容的標題關鍵字：只列入 needs_review，不自動改 product_type。 */
const DLC_KEYWORDS =
  /dlc|追加|season\s*pass|季票|expansion|擴充|追加包|服裝| costume|DLCパック|追加コンテンツ/i;

export function looksLikeDlc(title: string | null | undefined): boolean {
  return title != null && DLC_KEYWORDS.test(title);
}

// ---------------------------------------------------------------------------
// 清單解析（純函式）：JP XML、台港 RSC payload
// ---------------------------------------------------------------------------

/** 解析日本 XML（https://www.nintendo.co.jp/data/software/xml/switch.xml）。
 *  欄位：TitleName / MakerName / SalesDate / SoftType / ScreenshotImgURL /
 *  LinkURL（/titles/<id> 即 JP 區 NSUID）。SoftType 只有 dl / pkg_dl，
 *  無法區分 DLC（見 planCatalogSync 的 needs_review）。 */
export function parseJpXml(xml: string): CatalogListEntry[] {
  const entries: CatalogListEntry[] = [];
  const seen = new Set<string>();
  const re = /<TitleInfo>([\s\S]*?)<\/TitleInfo>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const get = (t: string): string =>
      b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim() ?? "";
    const id = /\/titles\/(\d+)/.exec(get("LinkURL"))?.[1] ?? "";
    const title = get("TitleName");
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    entries.push({
      titleId: id,
      title,
      maker: get("MakerName") || null,
      coverUrl: get("ScreenshotImgURL") || null,
      salesDate: get("SalesDate") || null,
      country: "JP",
      source: "jp-xml",
      // InitialCode 即完整 product code（如 HACA6EVA），是 product code
      // 的全量來源（搜尋 API 只有 icode 核心 5 碼）；XML 本身已停更，
      // 只當 product code 輔助，不當新遊戲來源。
      productCode: get("InitialCode") || null,
      platform: "Switch",
      productKind: "game",
    });
  }
  return entries;
}

/** 解析台港／韓國官方清單頁的 RSC payload（source 隨國家取 <cc>-list）。 */
export function parseTwHkRsc(text: string, country: string): CatalogListEntry[] {
  const source = `${country.toLowerCase()}-list`;
  const unescaped = text.replace(/\\"/g, '"');
  const byNsuid = new Map<string, CatalogListEntry>();
  for (const m of unescaped.matchAll(
    /"title":"([^"]{1,120})","nsuid":"(\d+)"/g
  )) {
    const nsuid = m[2];
    if (!byNsuid.has(nsuid)) {
      byNsuid.set(nsuid, {
        titleId: nsuid,
        title: m[1].trim(),
        country,
        source,
      });
    }
  }
  return [...byNsuid.values()];
}

// ---------------------------------------------------------------------------
// 完整來源解析（純函式）：NA Algolia、EU Solr、JP 搜尋 API、AU Algolia
//   欄位與篩選規則見 data/region-sources-report.md §1–§4；
//   探測腳本 scripts/probe-region-lists.mjs 與建置腳本
//   scripts/build-region-title-ids.mjs 已實測同一套規則。
//   DLC／升級包／組合包一律標 productKind、不進遊戲目錄。
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;
const asStr = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const asStrArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => asStr(x)).filter(Boolean) : [];

/** NSUID 編號空間只提供初步類別：7001 一般商品、7005 DLC、7007 Bundle。
 *  7007 不應直接斷定是 Switch 2 升級包；母遊戲、版本及商店實際類型仍需確認。 */
export function kindFromNsuid(nsuid: string): "game" | "dlc" | "bundle" | "upgrade" {
  if (nsuid.startsWith("7005")) return "dlc";
  if (nsuid.startsWith("7007")) return "bundle";
  return "game";
}

function platformFromText(
  s: string | null | undefined
): "Switch" | "Switch 2" | null {
  if (!s) return null;
  if (/switch\s*2/i.test(s)) return "Switch 2";
  if (/switch/i.test(s)) return "Switch";
  return null;
}

/** NA Algolia 命中 → 條目（index store_all_products_en_us，約 37,632 筆，
 *  遊戲 36,745）。不加 productType filter（各地語言值不同會回 0 筆），
 *  客戶端以 nsuid 前綴篩。命中沒有 product code 欄位。 */
export function parseNaAlgoliaHits(hits: unknown[]): CatalogListEntry[] {
  const out: CatalogListEntry[] = [];
  const seen = new Set<string>();
  for (const h of hits as JsonRecord[]) {
    const nsuid = asStr(h?.nsuid);
    const title = asStr(h?.title).trim();
    if (!nsuid || !title || seen.has(nsuid)) continue;
    seen.add(nsuid);
    // eshopDetails.productType 可區分本體與 DLC（TITLE／ADD_ON_CONTENT）：
    // 曠野之息查詢首筆即為 ADD_ON_CONTENT（$9.99），nsuid 前綴未必能分。
    const details = (h?.eshopDetails ?? null) as JsonRecord | null;
    const productType = asStr(details?.productType);
    const kind =
      productType === "ADD_ON_CONTENT" ? "dlc" : kindFromNsuid(nsuid);
    // eshopDetails 價格（已驗證：MKW regularPrice 79.99 USD＝價格 API）。
    const regularRaw = parseRawNumber(details?.regularPrice);
    const discountRaw = parseRawNumber(details?.discountPrice);
    const currency = asStr(details?.currency) || "USD";
    // 封面：productImage 是 16:9 主視覺（1920×1080，已驗證），相對路徑需補
    // assets.nintendo.com 前綴；沒有時退回方形圖 productImageSquare。
    const productImage = asStr(h?.productImage);
    const coverUrl = productImage
      ? `https://assets.nintendo.com/image/upload/q_auto/f_auto/${productImage}`
      : asStr(h?.productImageSquare) || null;
    out.push({
      titleId: nsuid,
      title,
      country: "US",
      source: "na-algolia",
      platform: platformFromText(asStr(h?.platform)),
      productKind: kind,
      coverUrl,
      storePrice:
        regularRaw != null || discountRaw != null
          ? {
              regularRaw: regularRaw ?? discountRaw,
              effectiveRaw: discountRaw ?? regularRaw,
              currency,
              saleEnd: parseSaleEnd(
                details?.discountPriceEndTimestamp ?? details?.discountPriceEnd
              ),
              onSale:
                discountRaw != null &&
                regularRaw != null &&
                discountRaw < regularRaw,
            }
          : null,
    });
  }
  return out;
}

/** 特價結束時間解析（Algolia discountPriceEndTimestamp：Unix 秒或毫秒；
 *  字串時先試數字、再試 Date.parse；解析失敗回 null）。 */
function parseSaleEnd(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (Number.isFinite(n) && n > 0) {
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** EU Solr 文件 → 條目（/en/ GAME 有 nsuid 共 20,217 筆）。
 *  nsuid_txt 是陣列（常含 7001 本體＋7007 DLC），取 7001 者；
 *  system_names_txt 過濾 Switch／Switch 2（排除 Wii U／3DS／手機遊戲）；
 *  product_code_txt 只部分遊戲有（Switch 2 新作多無）。 */
export function parseEuSolrDocs(docs: unknown[]): CatalogListEntry[] {
  const out: CatalogListEntry[] = [];
  const seen = new Set<string>();
  for (const d of docs as JsonRecord[]) {
    const title = asStr(d?.title).trim();
    const systems = asStrArray(d?.system_names_txt);
    const platform =
      systems.find((s) => /Nintendo Switch 2/i.test(s)) != null
        ? "Switch 2"
        : systems.find((s) => /Nintendo Switch/i.test(s)) != null
          ? "Switch"
          : null;
    if (!title || !platform) continue;
    const nsuid = asStrArray(d?.nsuid_txt).find((n) => n.startsWith("7001"));
    if (!nsuid || seen.has(nsuid)) continue;
    seen.add(nsuid);
    const productCode =
      asStrArray(d?.product_code_txt).find((c) => /^HAC/i.test(c)) ?? null;
    const released = asStrArray(d?.dates_released_dts)[0] ?? null;
    // 參考價（只記錄、永不寫入 prices）：/en/ locale ≈ GB，幣別 GBP。
    // 星露谷 en 10.99＝GB £10.99、de 13.99＝DE €13.99，與價格 API 一致；
    // 但 BOTW de 三欄皆 89.98（與價格 API €69.99 不符），故需交叉驗證。
    const regularRaw = parseRawNumber(d?.price_regular_f);
    const lowestRaw = parseRawNumber(d?.price_lowest_f);
    out.push({
      titleId: nsuid,
      title,
      country: "GB",
      source: "eu-solr",
      productCode,
      platform,
      salesDate: released ? released.slice(0, 10) : null,
      // 16:9 主視覺（本站卡片就是 16:9 框）；Solr 抓取時需列入 fl 欄位。
      coverUrl: asStr(d?.image_url_h16x9_s) || null,
      productKind: "game",
      referencePrice:
        regularRaw != null || lowestRaw != null
          ? {
              regularRaw: regularRaw ?? lowestRaw,
              effectiveRaw: lowestRaw ?? regularRaw,
              discountPct: parseRawNumber(d?.price_discount_percentage_f),
              currency: "GBP",
            }
          : null,
    });
  }
  return out;
}

/** JP 搜尋 API 項目 → 條目（search.json，total 約 29,995 筆 Switch 軟體）。
 *  過濾：nsuid 為空跳過（下架如健身環）、非 7001 開頭跳過、
 *  id 含 "_" 跳過（nintendeals noj 的非本體項目過濾規則）、
 *  hard 不是 1_HAC／05_BEE 跳過（非 Switch 軟體）。
 *  價格（已驗證：BOTW pprice／dprice／current_price 皆 7,678＝價格 API；
 *  特價例 pprice 4,290 → current_price／sprice 2,574、sale_flg=1；
 *  純 DLC pprice 為 null、dprice／current_price 199）：原價取下載版定價
 *  dprice（無則 pprice），現價取 current_price（無則 sprice／dprice／pprice）。
 *  無特價結束日欄位，saleEnd 永為 null。 */
export function parseJpSearchItems(items: unknown[]): CatalogListEntry[] {
  const out: CatalogListEntry[] = [];
  const seen = new Set<string>();
  for (const it of items as JsonRecord[]) {
    const nsuid = asStr(it?.nsuid);
    const title = asStr(it?.title).trim();
    if (!nsuid || !nsuid.startsWith("7001") || !title || seen.has(nsuid)) continue;
    if (typeof it?.id === "string" && it.id.includes("_")) continue;
    const hard = asStr(it?.hard);
    const platform =
      hard === "05_BEE" ? "Switch 2" : hard === "1_HAC" ? "Switch" : null;
    if (hard && !platform) continue;
    seen.add(nsuid);
    const dprice = parseRawNumber(it?.dprice);
    const pprice = parseRawNumber(it?.pprice);
    const sprice = parseRawNumber(it?.sprice);
    const current = parseRawNumber(it?.current_price);
    // iurl 是任天堂 CDN 圖片 hash（64 碼 hex）：封面＝
    // https://img-eshop.cdn.nintendo.net/i/<hash>.jpg（已驗證回 200 image/jpeg）。
    const iurl = asStr(it?.iurl);
    const coverUrl = /^[0-9a-f]{64}$/.test(iurl)
      ? `https://img-eshop.cdn.nintendo.net/i/${iurl}.jpg`
      : null;
    const regularRaw = dprice ?? pprice;
    const effectiveRaw = current ?? sprice ?? dprice ?? pprice;
    out.push({
      titleId: nsuid,
      title,
      country: "JP",
      source: "jp-search",
      icode: asStr(it?.icode) || null,
      platform,
      salesDate: asStr(it?.sdate) || null,
      coverUrl,
      productKind: "game",
      storePrice:
        regularRaw != null || effectiveRaw != null
          ? {
              regularRaw: regularRaw ?? effectiveRaw,
              effectiveRaw: effectiveRaw ?? regularRaw,
              currency: "JPY",
              saleEnd: null,
              onSale:
                asStr(it?.sale_flg) === "1" ||
                (regularRaw != null &&
                  effectiveRaw != null &&
                  effectiveRaw < regularRaw),
            }
          : null,
    });
  }
  return out;
}

/** 價格數字解析（"7,678"／7678／null → number／null，與 lib/nintendo.ts
 *  的 parseRawValue 同義；本檔獨立編譯驗證用，故本地重寫一份）。 */
function parseRawNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** AU Algolia 命中 → 條目（index prod_games_and_products，1,707 筆精選子集）。
 *  只取 objectType=game 且 nsuid 為 7001 開頭者；命中帶 genre
 *  （目前唯一帶 genre 的來源）與 date_timestamp（Unix 秒）。 */
export function parseAuAlgoliaHits(hits: unknown[]): CatalogListEntry[] {
  const out: CatalogListEntry[] = [];
  const seen = new Set<string>();
  for (const h of hits as JsonRecord[]) {
    if (asStr(h?.objectType) !== "game") continue;
    const nsuid = asStr(h?.nsuid);
    const title = asStr(h?.title).trim();
    if (!nsuid || !title || seen.has(nsuid)) continue;
    seen.add(nsuid);
    const ts = typeof h?.date_timestamp === "number" ? h.date_timestamp : null;
    out.push({
      titleId: nsuid,
      title,
      country: "AU",
      source: "au-algolia",
      platform: platformFromText(asStr(h?.console)),
      genre: asStr(h?.genre) || null,
      salesDate: ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null,
      productKind: kindFromNsuid(nsuid),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 抓取器（每區一個；失敗回 failed、不拋錯）
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 20_000;
const UA = "switch-price-site/1.0 (catalog sync)";

async function fetchTextRetry(
  url: string,
  attempts = 2
): Promise<{ ok: boolean; status: number; text: string }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError ?? new Error("fetch 失敗");
}

export const JP_XML_URL =
  "https://www.nintendo.co.jp/data/software/xml/switch.xml";

/** 日本官方 Switch 軟體清單（約 10,045 個 title ID；最新發售日約 2025-05-01，
 *  Switch 2 發售後的遊戲不在其中——這是目前最大的覆蓋缺口，見 pending 來源）。 */
export async function fetchJpXml(): Promise<CatalogSourceResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const { ok, status, text } = await fetchTextRetry(JP_XML_URL);
    if (!ok) {
      return {
        source: "jp-xml",
        country: "JP",
        entries: [],
        fetchedAt,
        status: "failed",
        error: `日本 XML HTTP ${status}`,
      };
    }
    const entries = parseJpXml(text);
    return {
      source: "jp-xml",
      country: "JP",
      entries,
      fetchedAt,
      status: entries.length > 0 ? "ok" : "failed",
      error: entries.length === 0 ? "日本 XML 解析出 0 筆（格式可能已變）" : undefined,
      note: "約 10,045 筆；最新發售日約 2025-05-01，Switch 2 之後的新作不在其中",
    };
  } catch (err) {
    return {
      source: "jp-xml",
      country: "JP",
      entries: [],
      fetchedAt,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const TW_LIST_URL = "https://www.nintendo.com/tw/software/switch/";
export const HK_LIST_URL = "https://www.nintendo.com/hk/software/switch/";

/** 台灣／香港官方軟體清單（Next.js 頁，RSC payload 含 title＋nsuid）。
 *  分頁 ?spage=N，每頁約 96 筆但多數是精選＋最新重複項；
 *  抓到「某一頁沒有新 nsuid」就停（沿用 map-tw-hk 腳本的停止規則）。
 *  上限 12 頁，避免對方改版成無限分頁時把 60 秒燒光。 */
export async function fetchTwHkList(
  country: "TW" | "HK"
): Promise<CatalogSourceResult> {
  const source = country === "TW" ? "tw-list" : "hk-list";
  const baseUrl = country === "TW" ? TW_LIST_URL : HK_LIST_URL;
  const fetchedAt = new Date().toISOString();
  const byNsuid = new Map<string, CatalogListEntry>();
  let pagesFetched = 0;
  let lastError: string | undefined;
  for (let page = 1; page <= 12; page++) {
    let res: { ok: boolean; status: number; text: string };
    try {
      res = await fetchTextRetry(`${baseUrl}?spage=${page}`);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      break;
    }
    pagesFetched++;
    if (!res.ok) {
      lastError = `清單 HTTP ${res.status}（${baseUrl}?spage=${page}）`;
      break;
    }
    const before = byNsuid.size;
    for (const e of parseTwHkRsc(res.text, country)) {
      if (!byNsuid.has(e.titleId)) byNsuid.set(e.titleId, e);
    }
    if (byNsuid.size === before) break; // 這頁沒有新 nsuid，後面只會重複
  }
  const entries = [...byNsuid.values()];
  return {
    source,
    country,
    entries,
    fetchedAt,
    status:
      entries.length > 0
        ? lastError
          ? "partial"
          : "ok"
        : "failed",
    error:
      entries.length === 0
        ? (lastError ?? "台港清單解析出 0 筆（格式可能已變）")
        : lastError,
    note: `分頁抓了 ${pagesFetched} 頁；清單僅含任天堂發行＋部分第三方精選（台灣約 166 款、香港約 176 款），不是 eShop 全部目錄`,
  };
}

/** 韓國官方軟體清單（單頁精選＋新作，僅約 13 個 nsuid 項目，
 *  無 ?spage= 分頁、不是完整目錄；見 region-sources-report.md §6）。 */
export const KR_LIST_URL = "https://www.nintendo.com/kr/software/switch/";

export async function fetchKrList(): Promise<CatalogSourceResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const { ok, status, text } = await fetchTextRetry(KR_LIST_URL);
    if (!ok) {
      return {
        source: "kr-list",
        country: "KR",
        entries: [],
        fetchedAt,
        status: "failed",
        error: `韓國清單 HTTP ${status}`,
      };
    }
    const entries = parseTwHkRsc(text, "KR");
    return {
      source: "kr-list",
      country: "KR",
      entries,
      fetchedAt,
      status: entries.length > 0 ? "ok" : "failed",
      error: entries.length === 0 ? "韓國清單解析出 0 筆" : undefined,
      note: "單頁精選＋新作約 13 筆，不是完整目錄；KR 完整來源仍缺",
    };
  } catch (err) {
    return {
      source: "kr-list",
      country: "KR",
      entries: [],
      fetchedAt,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// 完整來源：分頁抓取（NA Algolia／EU Solr／JP 搜尋 API／AU Algolia）
//   完整清單太大（NA 約 38 頁、EU 21 頁、JP 約 300 頁、AU 2 頁），
//   單次 60 秒執行裝不下「全量」——所以用游標分片：每次只抓一個
//   頁數窗口（startPage＋pageCount），游標存在 sync_state 表
//   （見 supabase/migrations/20261117_catalog_sync_state.sql），
//   下次從上次停的地方繼續；跑完一輪游標歸零。每日 4 支 sync cron
//   各推進一個窗口，全目錄約 1 天跑完一輪（JP 約 300 頁是瓶頸，
//   見 DATA_NOTES.md §12.3 的頁數與耗時表）。
//   單頁失敗就停在該頁（游標不前進，下次重試）、已抓到的照常用。
// ---------------------------------------------------------------------------

export interface PagedFetchResult {
  source: string;
  country: string;
  entries: CatalogListEntry[];
  /** 下次從第幾頁繼續（null＝已跑完一輪）；失敗時停在失敗那頁。 */
  nextPage: number | null;
  totalPages: number | null;
  done: boolean;
  error?: string;
}

/** 單次執行每來源最多抓幾頁（預設窗口；?pages= 可調）。
 *  NA 38 頁一輪、EU 21 頁一輪、JP 約 300 頁需 3 次、AU 2 頁一輪。 */
export const PAGE_CAP: Record<string, number> = {
  // 每輪抓的頁數要小到一次同步能在 Vercel Hobby 60 秒上限內跑完
  // （抓＋比對＋寫庫＋查價），否則整輪被砍、游標永遠不前進、
  // 封面與上市日期永遠補不上（2026-11-18 前就是這樣：JP 100 頁／輪跑不完）。
  "na-algolia": 10,
  "eu-solr": 10,
  "jp-search": 20,
  "au-algolia": 5,
};

/** 分頁抓取的小型並行池（保持頁面順序；單頁失敗即停、回傳已抓到的部分）。 */
async function fetchPagesInPool<T>(
  pages: number[],
  worker: (page: number) => Promise<T>,
  concurrency: number
): Promise<{ results: Map<number, T>; failedPage: number | null; error?: string }> {
  const results = new Map<number, T>();
  let failedPage: number | null = null;
  let failedError: string | undefined;
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, pages.length) }, async () => {
    while (next < pages.length && failedPage == null) {
      const page = pages[next++];
      try {
        results.set(page, await worker(page));
      } catch (err) {
        if (failedPage == null) {
          failedPage = page;
          failedError = err instanceof Error ? err.message : String(err);
        }
      }
    }
  });
  await Promise.all(runners);
  return { results, failedPage, error: failedError };
}

// NA Algolia：nintendo.com 官網商店前端自己的搜尋後端。
// app／key 是官網前端內嵌的「公開 search key」（不是使用者憑證，
// 同值已在 scripts/probe-region-lists.mjs；任天堂輪換 key 時抓取失敗、
// 其他來源照常，屆時從官網前端重新取得並更新此處或環境變數）。
const NA_ALGOLIA_APP = "U3B6GR4UA3";
const NA_ALGOLIA_KEY =
  process.env.NA_ALGOLIA_API_KEY ?? "a29c6927638bfd8cee23993e51e721c9";
const NA_PAGE_SIZE = 1000;
// AU Algolia：nintendo.com/au 官網首頁 RSC payload 內嵌的公開 search key。
const AU_ALGOLIA_APP = "FMW57F6ERV";
const AU_ALGOLIA_KEY =
  process.env.AU_ALGOLIA_API_KEY ?? "c8e4e9f60190ef785d167da77ba0b4fe";
const AU_PAGE_SIZE = 1000;
const EU_PAGE_SIZE = 1000;
const JP_PAGE_SIZE = 100; // limit 上限未實測超過 150，用 100 保守值

async function algoliaPage(
  app: string,
  key: string,
  index: string,
  page: number,
  pageSize: number
): Promise<{ hits: unknown[]; nbHits: number }> {
  // 探測實測：250–400ms 節流下數百次請求無 429；並行度壓在 2、每頁前
  // 停 200ms，避免觸發限流。
  await new Promise((r) => setTimeout(r, 200));
  const res = await fetch(`https://${app}-dsn.algolia.net/1/indexes/${index}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Algolia-Application-Id": app,
      "X-Algolia-API-Key": key,
    },
    body: JSON.stringify({
      params: `query=&hitsPerPage=${pageSize}&page=${page}`,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Algolia ${index} HTTP ${res.status}（page=${page}）`);
  const data = (await res.json()) as { hits?: unknown[]; nbHits?: number };
  return { hits: data?.hits ?? [], nbHits: data?.nbHits ?? 0 };
}

async function fetchPagedSource(
  source: string,
  country: string,
  pageSize: number,
  startPage: number,
  pageCount: number,
  fetchPage: (page: number) => Promise<{ entries: CatalogListEntry[]; total: number }>
): Promise<PagedFetchResult> {
  const pages = Array.from({ length: pageCount }, (_, i) => startPage + i);
  const { results, failedPage, error } = await fetchPagesInPool(
    pages,
    fetchPage,
    source.includes("algolia") ? 2 : 4
  );
  const entries: CatalogListEntry[] = [];
  let total: number | null = null;
  let lastOk = startPage - 1;
  for (const page of pages) {
    const r = results.get(page);
    if (!r) break;
    entries.push(...r.entries);
    if (total == null) total = r.total;
    lastOk = page;
  }
  const totalPages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const done = totalPages != null && lastOk + 1 >= totalPages;
  return {
    source,
    country,
    entries,
    nextPage: failedPage ?? (done ? null : lastOk + 1),
    totalPages,
    done,
    error,
  };
}

/** NA Algolia 分頁：store_all_products_en_us，空查詢＋分頁瀏覽全部 hits。 */
export async function fetchNaAlgoliaPages(
  startPage: number,
  pageCount: number
): Promise<PagedFetchResult> {
  return fetchPagedSource("na-algolia", "US", NA_PAGE_SIZE, startPage, pageCount, async (page) => {
    const { hits, nbHits } = await algoliaPage(
      NA_ALGOLIA_APP,
      NA_ALGOLIA_KEY,
      "store_all_products_en_us",
      page,
      NA_PAGE_SIZE
    );
    return { entries: parseNaAlgoliaHits(hits), total: nbHits };
  });
}

/** EU Solr 分頁：/en/ select，fq=type:GAME＋nsuid_txt:*，rows=1000。 */
export async function fetchEuSolrPages(
  startPage: number,
  pageCount: number
): Promise<PagedFetchResult> {
  return fetchPagedSource("eu-solr", "GB", EU_PAGE_SIZE, startPage, pageCount, async (page) => {
    const url =
      `https://search.nintendo-europe.com/en/select?q=*&fq=type%3AGAME` +
      `&fq=nsuid_txt%3A*&rows=${EU_PAGE_SIZE}&start=${page * EU_PAGE_SIZE}` +
      `&wt=json&fl=title,nsuid_txt,product_code_txt,system_names_txt,dates_released_dts,image_url_h16x9_s`;
    const { ok, status, text } = await fetchTextRetry(url);
    if (!ok) throw new Error(`EU Solr HTTP ${status}（start=${page * EU_PAGE_SIZE}）`);
    const data = JSON.parse(text) as {
      response?: { numFound?: number; docs?: unknown[] };
    };
    return {
      entries: parseEuSolrDocs(data?.response?.docs ?? []),
      total: data?.response?.numFound ?? 0,
    };
  });
}

/** JP 搜尋 API 分頁：search.json，空查詢、不加 opt_hard（一次取 Switch 1＋2），
 *  limit=100。total 約 29,995 筆，約 300 頁。 */
export async function fetchJpSearchPages(
  startPage: number,
  pageCount: number
): Promise<PagedFetchResult> {
  return fetchPagedSource("jp-search", "JP", JP_PAGE_SIZE, startPage, pageCount, async (page) => {
    const url =
      `https://search.nintendo.jp/nintendo_soft/search.json` +
      `?q=&limit=${JP_PAGE_SIZE}&page=${page + 1}`;
    const { ok, status, text } = await fetchTextRetry(url);
    if (!ok) throw new Error(`JP 搜尋 API HTTP ${status}（page=${page + 1}）`);
    const data = JSON.parse(text) as {
      result?: { total?: number; items?: unknown[] };
    };
    return {
      entries: parseJpSearchItems(data?.result?.items ?? []),
      total: data?.result?.total ?? 0,
    };
  });
}

/** AU Algolia 分頁：prod_games_and_products，約 1,707 筆（2 頁）。 */
export async function fetchAuAlgoliaPages(
  startPage: number,
  pageCount: number
): Promise<PagedFetchResult> {
  return fetchPagedSource("au-algolia", "AU", AU_PAGE_SIZE, startPage, pageCount, async (page) => {
    const { hits, nbHits } = await algoliaPage(
      AU_ALGOLIA_APP,
      AU_ALGOLIA_KEY,
      "prod_games_and_products",
      page,
      AU_PAGE_SIZE
    );
    return { entries: parseAuAlgoliaHits(hits), total: nbHits };
  });
}

/** 分頁來源調度：sourceId → 該窗口的抓取結果（小來源不用分頁，走全量）。 */
export async function fetchSourcePages(
  sourceId: string,
  startPage: number,
  pageCount: number
): Promise<PagedFetchResult> {
  switch (sourceId) {
    case "na-algolia":
      return fetchNaAlgoliaPages(startPage, pageCount);
    case "eu-solr":
      return fetchEuSolrPages(startPage, pageCount);
    case "jp-search":
      return fetchJpSearchPages(startPage, pageCount);
    case "au-algolia":
      return fetchAuAlgoliaPages(startPage, pageCount);
    default:
      throw new Error(`來源 ${sourceId} 不支援分頁抓取（小來源請走全量 fetch）`);
  }
}

/** 分頁來源一覽（需要 sync_state 游標的來源）。 */
export const PAGED_SOURCES = ["na-algolia", "eu-solr", "jp-search", "au-algolia"];

/** 分頁抓取結果 → 來源結果（供 fetchCatalogLists 與預設 fetch 共用）。 */
export function toSourceResult(p: PagedFetchResult): CatalogSourceResult {
  return {
    source: p.source,
    country: p.country,
    entries: p.entries,
    fetchedAt: new Date().toISOString(),
    status: p.entries.length > 0 ? (p.error ? "partial" : "ok") : "failed",
    error: p.error ?? (p.entries.length === 0 ? "分頁抓取回 0 筆" : undefined),
    paging: {
      startPage: 0,
      nextPage: p.nextPage,
      totalPages: p.totalPages,
      done: p.done,
    },
  };
}

// ---------------------------------------------------------------------------
// 來源註冊表：來源可插拔的唯一入口。
//   - 每日同步只跑 status = "active" 的來源（fetchCatalogLists）。
//   - pending 來源：調查結果還沒回來、或端點還沒驗證；回報時列出，
//     讓人知道「這區還沒自動化、為什麼」。調查結果一到：
//     把 fetch 實作補上、status 改 active 即可，不用改路由與排程。
// ---------------------------------------------------------------------------

export const CATALOG_SOURCES: CatalogSourceDef[] = [
  {
    id: "jp-search",
    country: "JP",
    label: "日本官網搜尋 API（主來源，約 29,995 筆，含 Switch 2）",
    status: "active",
    fetch: () => fetchSourcePages("jp-search", 0, PAGE_CAP["jp-search"]).then(toSourceResult),
    fetchPaged: (startPage, pageCount) => fetchJpSearchPages(startPage, pageCount),
  },
  {
    id: "na-algolia",
    country: "US",
    label: "美洲 Algolia（主來源，約 37,632 筆，遊戲 36,745）",
    status: "active",
    fetch: () => fetchSourcePages("na-algolia", 0, PAGE_CAP["na-algolia"]).then(toSourceResult),
    fetchPaged: (startPage, pageCount) => fetchNaAlgoliaPages(startPage, pageCount),
  },
  {
    id: "eu-solr",
    country: "GB",
    label: "歐洲 Solr（主來源，GAME 有 nsuid 共 20,217 筆）",
    status: "active",
    fetch: () => fetchSourcePages("eu-solr", 0, PAGE_CAP["eu-solr"]).then(toSourceResult),
    fetchPaged: (startPage, pageCount) => fetchEuSolrPages(startPage, pageCount),
  },
  {
    id: "au-algolia",
    country: "AU",
    label: "澳洲 Algolia（精選子集 1,707 筆，唯一帶 genre 的來源）",
    status: "active",
    fetch: () => fetchSourcePages("au-algolia", 0, PAGE_CAP["au-algolia"]).then(toSourceResult),
    fetchPaged: (startPage, pageCount) => fetchAuAlgoliaPages(startPage, pageCount),
  },
  {
    id: "jp-xml",
    country: "JP",
    label: "日本官方 Switch 軟體清單（XML，已停更，僅當 product code 輔助）",
    status: "active",
    fetch: fetchJpXml,
  },
  {
    id: "tw-list",
    country: "TW",
    label: "台灣官方軟體清單（RSC payload，精選約 166 款）",
    status: "active",
    fetch: () => fetchTwHkList("TW"),
  },
  {
    id: "hk-list",
    country: "HK",
    label: "香港官方軟體清單（RSC payload，精選約 176 款）",
    status: "active",
    fetch: () => fetchTwHkList("HK"),
  },
  {
    id: "kr-list",
    country: "KR",
    label: "韓國官方軟體清單（單頁精選約 13 筆，非完整目錄）",
    status: "active",
    fetch: fetchKrList,
  },
  {
    id: "hk-json",
    country: "HK",
    label: "香港軟體清單 JSON（舊端點）",
    status: "pending",
    reason:
      "內容約停在 2022-06 且偏舊，已被 tw-list／hk-list 取代；僅在新清單失效時才考慮作備援，不列入每日同步",
    fetch: async () => ({
      source: "hk-json",
      country: "HK",
      entries: [],
      fetchedAt: new Date().toISOString(),
      status: "pending",
      error: "來源未啟用：內容停在 2022-06，見 DATA_NOTES.md §10.2",
    }),
  },
  {
    id: "weekly-articles",
    country: "TW",
    label: "港台每週新作文章（107 篇，內文自帶 title＋nsuid）",
    status: "pending",
    reason:
      "新遊戲台港編號的主要來源，但要逐篇爬 107 篇文章，單次同步 60 秒內跑不完；目前仍由 scripts/harvest-weekly-articles.mjs 在外部跑、再經 seed-region-ids.mjs 灌對照表。待找到輕量索引端點（或把文章爬取拆成多天輪轉）再接入",
    fetch: async () => ({
      source: "weekly-articles",
      country: "TW",
      entries: [],
      fetchedAt: new Date().toISOString(),
      status: "pending",
      error: "來源未啟用：107 篇逐篇爬取超出單次 60 秒預算，見 DATA_NOTES.md §12.5",
    }),
  },
  {
    id: "sg-my-th",
    country: "SG",
    label: "新加坡／馬來西亞／泰國（無官方清單來源）",
    status: "pending",
    reason:
      "eShop 存在、價格 API 支援這三國幣別，但編號體系不明、無官方清單入口（nintendo.com 無商店前端、ec.nintendo.com/SG 404、價格 API 掃描零個 onsale）；對照表目前不含這三國，待找到 SG 清單或掃描到在售編號再補。不要以 US／EU 編號硬填（實測皆 not_found），見 region-sources-report.md §7",
    fetch: async () => ({
      source: "sg-my-th",
      country: "SG",
      entries: [],
      fetchedAt: new Date().toISOString(),
      status: "pending",
      error: "來源未啟用：SG／MY／TH 無官方清單入口",
    }),
  },
];

/** 抓全部 active 來源（並行；單一來源失敗不影響其他來源）。
 *  分頁來源（NA／EU／JP／AU）可帶 pageWindows 指定窗口
 *  （{ startPage, pageCount }；預設從第 0 頁抓 PAGE_CAP 頁）；
 *  小來源（JP XML、台港、韓國）每次全量抓，不用窗口。
 *  回傳含 paging（nextPage／totalPages／done），呼叫端據此推進游標。 */
export async function fetchCatalogLists(
  onlyIds?: string[],
  pageWindows?: Record<string, { startPage: number; pageCount: number }>
): Promise<CatalogSourceResult[]> {
  const wanted = CATALOG_SOURCES.filter(
    (s) => s.status === "active" && (!onlyIds || onlyIds.includes(s.id))
  );
  const results = await Promise.all(
    wanted.map(async (s) => {
      try {
        if (s.fetchPaged) {
          const window = pageWindows?.[s.id] ?? {
            startPage: 0,
            pageCount: PAGE_CAP[s.id] ?? 10,
          };
          const paged = await s.fetchPaged(window.startPage, window.pageCount);
          return {
            ...toSourceResult(paged),
            paging: {
              startPage: window.startPage,
              nextPage: paged.nextPage,
              totalPages: paged.totalPages,
              done: paged.done,
            },
          };
        }
        return await s.fetch();
      } catch (err) {
        return {
          source: s.id,
          country: s.country,
          entries: [],
          fetchedAt: new Date().toISOString(),
          status: "failed" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );
  return results;
}

/** pending 來源一覽（供回報與文件對照：哪些區還沒自動化、為什麼）。 */
export function pendingCatalogSources(): {
  id: string;
  country: string;
  label: string;
  reason: string;
}[] {
  return CATALOG_SOURCES.filter((s) => s.status === "pending").map((s) => ({
    id: s.id,
    country: s.country,
    label: s.label,
    reason: s.reason ?? "",
  }));
}

// ---------------------------------------------------------------------------
// 比對與計畫（純函式）：清單條目 → 新遊戲／補編號／補 title_id
// ---------------------------------------------------------------------------

export interface ExistingGameLite {
  id: string;
  slug: string;
  title_id: string | null;
  title_zh: string;
  title_en: string;
  cover_url: string | null;
  /** 歷史低價（台幣；目錄同步不用，/api/refresh 讀庫時共用此型別）。 */
  historical_low_twd?: number | null;
  /** 上市日期（YYYY-MM-DD；目錄同步讀取用，寫入時只補空值）。 */
  release_date?: string | null;
}

export interface ExistingRegionId {
  game_id: string;
  country: string;
  title_id: string;
}

export interface NewGameRow {
  slug: string;
  title_zh: string;
  title_en: string;
  genre: string | null;
  publisher: string | null;
  platform: string;
  product_type: string;
  has_demo: number;
  cover_url: string;
  youtube_id: null;
  /** JP 區 NSUID；TW/HK-only 新遊戲為 null（等 JP 清單出現再補）。 */
  title_id: string | null;
  /** 上市日期（YYYY-MM-DD）：來源條目的 salesDate（JP 搜尋 API sdate、
   *  EU Solr dates_released_dts、JP XML SalesDate、AU Algolia date_timestamp；
   *  TW/HK 清單沒有）；沒有時為 null，等回填腳本或日後來源補。 */
  release_date: string | null;
  is_manual: false;
}

export interface RegionIdUpsert {
  /** 已在庫的遊戲用 id；新遊戲用 slug（寫庫後再對 id）。 */
  gameId: string | null;
  gameSlug: string;
  country: string;
  title_id: string;
  source: string;
}

export interface CatalogSyncPlan {
  newGames: NewGameRow[];
  regionIdUpserts: RegionIdUpsert[];
  /** 已在庫、title_id 目前為 null 的遊戲，補上 JP 清單找到的編號。 */
  titleIdFills: { gameId: string; slug: string; title_id: string }[];
  /** 已在庫、cover_url 目前為 null 的遊戲，補上 JP 清單的封面。 */
  coverFills: { gameId: string; slug: string; cover_url: string }[];
  /** 已在庫、release_date 目前為 null 的遊戲，補上來源條目的發售日。
   *  只在為空時寫（寫庫時有 .is("release_date", null) 守衛，絕不覆蓋已有值）。 */
  releaseDateFills: { gameId: string; slug: string; release_date: string }[];
  /** 需人工看一眼的項目（標題撞名、疑似 DLC 等）：不自動寫入、不擋同步。 */
  needsReview: { slug: string; title: string; reason: string }[];
  /** 衝突（同名不同編號等）：本次跳過、只記錄。 */
  conflicts: string[];
  /** 新遊戲自帶的商店前端價（JP 搜尋 API／NA Algolia，已驗證與價格 API
   *  一致；見 §12.6）：同步時先寫入當新遊戲即時價，價格 API 查到該國價
   *  時覆蓋它（價格 API 為準）。 */
  storefrontPrices: {
    gameSlug: string;
    title: string;
    country: string;
    regularRaw: number | null;
    effectiveRaw: number | null;
    currency: string;
    saleEnd: string | null;
    onSale: boolean;
    source: string;
  }[];
  /** 新遊戲的 EU Solr 參考價（只記錄、永不寫入 prices）：同步時以價格 API
   *  的 GB 價交叉驗證，差異記進回報的 reference_price_mismatches。 */
  referencePrices: {
    gameSlug: string;
    title: string;
    country: string;
    regularRaw: number | null;
    effectiveRaw: number | null;
    discountPct: number | null;
    currency: string;
    source: string;
  }[];
  stats: {
    listEntries: number;
    matchedByTitleId: number;
    matchedByRegionId: number;
    matchedByTitle: number;
    newFromJp: number;
    newFromNonJp: number;
    titleIdFills: number;
    coverFills: number;
    /** 非遊戲項目（DLC／組合包／升級包）跳過數：只計數、不進目錄。 */
    skippedNonGame: number;
  };
}

/**
 * 比對鍵（優先順序，決定性、與擴大目錄同一套規則；30,000 款規模重估見
 * DATA_NOTES.md §12.4——跨語言標題比對在大規模下失效率高，編號 diff
 * 才是主力，標題比對只是跨區合併的輔助）：
 *
 *   0. 分區 NSUID diff（主力）：每區清單用自己的 NSUID 對自己的索引
 *      （JP 對 games.title_id、NA 對 game_region_ids 的 US 列、EU 對 GB 列…）。
 *      已在庫 → 什麼都不做；不在庫 → 候選新遊戲。30,000 款下絕大多數
 *      條目走這條路，不需要標題比對。
 *   1. title_id（NSUID，分區）：JP 條目對 games.title_id；
 *      TW/HK 條目對 game_region_ids（country, title_id）。
 *      編號命中即同一款遊戲，不看標題。
 *   1b. 跨區編號碰撞守衛：某編號已在他區對照表出現（例如 JP 編號恰好等於
 *      某遊戲的 TW 編號），但標題對不上 → 不建新遊戲、不自動合併，
 *      列入 needs_review（可能是同一款遊戲、也可能只是數字撞號）。
 *   2. 標題正規化（normalizeTitle）：先去 ™®©℠ 再 NFKD（否則 "Mario Kart™
 *      8 Deluxe" 會比對失敗，見 region-sources-report.md §11），去掉
 *      標點／空白／大小寫差異後比對 games.title_zh 與 title_en。
 *      只在「唯一命中」時採用；命中 0 款 → 新遊戲；命中 ≥2 款 → 撞名，
 *      列 needs_review、不自動合併。
 *      限制（大規模下更明顯）：片假名標題對不上中文／英文標題
 *      （例：マリオカートワールド vs 瑪利歐賽車世界／Mario Kart World），
 *      這類跨語言合併目前無自動解，只能靠 product code（見下）。
 *   3. product code（unique_id，中間 4 碼）：目前「只記錄、不自動合併」。
 *      供應：JP 搜尋 API 的 icode（全部有）、JP XML 的 InitialCode（全部有）、
 *      EU Solr 的 product_code_txt（部分有）；NA／AU 命中沒有、TW／HK／KR
 *      的 softCode 不是 product code。推導規則（完整碼第 4–7 字元＝icode
 *      前 4 碼）尚未以實例驗證，驗證通過後才能當跨區合併鍵（見 §12.4 開放問題）。
 *
 * 新遊戲進庫時：
 *   - 能自動填：slug（拉丁 slug 或 game-<title_id>／tw-<nsuid>）、
 *     title_zh（TW/HK 標題優先，否則該區原文標題）、title_en
 *     （標題的拉丁部分，無則沿用原文）、title_id（JP 條目才有；
 *     NA／EU 條目掛 game_region_ids，不填 games.title_id）、
 *     publisher（JP XML 的 MakerName；其他來源沒有 → null）、
 *     cover_url（JP XML 的 ScreenshotImgURL；其他來源用佔位圖）、
 *     platform（完整來源的 hard／system_names／console；JP XML 與台港
 *     清單一律視為 Switch）、genre（只有 AU Algolia 命中帶 genre）、
 *     release_date（條目的 salesDate：JP 搜尋 API sdate、EU Solr
 *     dates_released_dts、JP XML SalesDate、AU Algolia date_timestamp；
 *     TW/HK 清單沒有 → null，等回填腳本或日後來源補）、
 *     product_type = "game"、has_demo = 0。
 *   - 填不了（留 null，等人工或日後來源補）：genre（除 AU 子集外沒有來源）、
 *     youtube_id、中文名（台港清單只覆蓋約 342 款，其餘新遊戲的 title_zh
 *     是日文／英文原文）、publisher（除 JP XML 外沒有來源）、封面
 *     （除 JP XML 外沒有來源，新遊戲多半是佔位圖）。
 *   - DLC／組合包／升級包：完整來源用編號前綴區分（NA 7005／7007、
 *     EU nsuid_txt 取 7001、JP id 含 "_" 過濾），直接跳過、不進目錄，
 *     只計入 stats.skippedNonGame；JP XML 的 SoftType 仍無法區分，
 *     標題含 DLC 關鍵字的另列入 needs_review。
 */
export function planCatalogSync(
  existingGames: ExistingGameLite[],
  existingRegionIds: ExistingRegionId[],
  sourceResults: CatalogSourceResult[]
): CatalogSyncPlan {
  const byTitleId = new Map<string, ExistingGameLite>();
  const byNormTitle = new Map<string, ExistingGameLite[]>();
  const takenSlugs = new Set<string>();
  for (const g of existingGames) {
    takenSlugs.add(g.slug);
    if (g.title_id) byTitleId.set(String(g.title_id), g);
    for (const t of [g.title_zh, g.title_en]) {
      const n = normalizeTitle(t);
      if (!n) continue;
      const list = byNormTitle.get(n) ?? [];
      if (!list.includes(g)) list.push(g);
      byNormTitle.set(n, list);
    }
  }
  const regionIndex = new Map<string, string>(); // `${country}|${titleId}` → game_id
  for (const r of existingRegionIds) {
    regionIndex.set(`${r.country.toUpperCase()}|${String(r.title_id)}`, r.game_id);
  }
  // 跨區編號索引：titleId（不分國家）→ game_id。同一數字編號若已在他區
  // 對照表出現，JP 條目不能直接當新遊戲建檔（可能是同一款遊戲、也可能
  // 只是不同區的編號撞號），一律進 needs_review、由人工確認。
  const regionTitleIdToGameId = new Map<string, string>();
  for (const r of existingRegionIds) {
    const key = String(r.title_id);
    if (!regionTitleIdToGameId.has(key)) regionTitleIdToGameId.set(key, r.game_id);
  }
  const gameById = new Map(existingGames.map((g) => [g.id, g]));

  const plan: CatalogSyncPlan = {
    newGames: [],
    regionIdUpserts: [],
    titleIdFills: [],
    coverFills: [],
    releaseDateFills: [],
    needsReview: [],
    conflicts: [],
    storefrontPrices: [],
    referencePrices: [],
    stats: {
      listEntries: 0,
      matchedByTitleId: 0,
      matchedByRegionId: 0,
      matchedByTitle: 0,
      newFromJp: 0,
      newFromNonJp: 0,
      titleIdFills: 0,
      coverFills: 0,
      skippedNonGame: 0,
    },
  };

  // JP 新遊戲候選：key = JP title_id（寫庫後要把 TW/HK 編號掛上去）。
  const jpCandidates = new Map<string, NewGameRow>();
  const candidateByNormTitle = new Map<string, NewGameRow[]>();
  /** 全部「本次新建」遊戲的正規化標題索引（JP 候選＋TW-only 新遊戲皆登記，
   *  否則同一款的另一區條目會誤建成第二款重複遊戲）。 */
  const pendingByNorm = new Map<string, NewGameRow[]>();
  const indexPendingTitle = (row: NewGameRow) => {
    for (const t of [row.title_zh, row.title_en]) {
      const n = normalizeTitle(t);
      if (!n) continue;
      const list = pendingByNorm.get(n) ?? [];
      if (!list.includes(row)) list.push(row);
      pendingByNorm.set(n, list);
    }
  };
  /** 把候選遊戲的一個標題寫進 JP 候選索引（TW/HK 中文標題掛上來時也要補，
   *  否則同一款的另一區條目會誤建成重複遊戲）。 */
  const indexCandidateTitle = (row: NewGameRow) => {
    for (const t of [row.title_zh, row.title_en]) {
      const n = normalizeTitle(t);
      if (!n) continue;
      const list = candidateByNormTitle.get(n) ?? [];
      if (!list.includes(row)) list.push(row);
      candidateByNormTitle.set(n, list);
    }
    indexPendingTitle(row);
  };
  const registerCandidate = (row: NewGameRow, jpTitleId: string) => {
    jpCandidates.set(jpTitleId, row);
    indexCandidateTitle(row);
  };
  const uniqueNormMatch = (
    norm: string
  ): { game: ExistingGameLite } | { candidate: NewGameRow } | null => {
    const games = byNormTitle.get(norm) ?? [];
    const cands = candidateByNormTitle.get(norm) ?? [];
    if (games.length === 1 && cands.length === 0) return { game: games[0] };
    if (games.length === 0 && cands.length === 1) return { candidate: cands[0] };
    return null; // 0 款或撞名（≥2）→ 不自動合併
  };

  const jpResults = sourceResults.filter((r) => r.country === "JP");
  const otherResults = sourceResults.filter((r) => r.country !== "JP");
  const allEntries: CatalogListEntry[] = [];
  for (const r of [...jpResults, ...otherResults]) {
    plan.stats.listEntries += r.entries.length;
    for (const e of r.entries) {
      // 非遊戲項目（DLC／組合包／升級包）不進遊戲目錄，只計數。
      if (e.productKind && e.productKind !== "game") {
        plan.stats.skippedNonGame++;
        continue;
      }
      allEntries.push(e);
    }
  }

  // ---- 第 1 步：JP 條目（先跑：建立新遊戲候選，TW/HK 條目才能掛上去）----
  const jpEntries = allEntries.filter((e) => e.country === "JP");
  const seenJp = new Set<string>();
  for (const e of jpEntries) {
    if (seenJp.has(e.titleId)) continue;
    seenJp.add(e.titleId);
    const existing = byTitleId.get(e.titleId);
    if (existing) {
      plan.stats.matchedByTitleId++;
      if (
        (!existing.cover_url ||
          existing.cover_url === "/covers/placeholder.svg") &&
        e.coverUrl
      ) {
        plan.coverFills.push({
          gameId: existing.id,
          slug: existing.slug,
          cover_url: e.coverUrl,
        });
      }
      if (!existing.release_date && e.salesDate) {
        plan.releaseDateFills.push({
          gameId: existing.id,
          slug: existing.slug,
          release_date: e.salesDate,
        });
      }
      continue;
    }
    // 編號對不到：標題唯一命中且該遊戲 title_id 為空 → 補編號（例如先以
    // TW/HK-only 進庫的 Switch 2 遊戲，JP 清單出現後回填）。
    // 但若此 JP 編號已在他區對照表屬於另一款遊戲，標題命中也不可信，
    // 一律跳過、列衝突（不同區的數字編號可能撞號）。
    const norm = normalizeTitle(e.title);
    const match = uniqueNormMatch(norm);
    const regionOwnerId = regionTitleIdToGameId.get(e.titleId);
    if (match && "game" in match) {
      const g = match.game;
      if (regionOwnerId && regionOwnerId !== g.id) {
        plan.conflicts.push(
          `JP ${e.titleId}「${e.title}」標題對到 ${g.slug}，但此編號已在他區對照表屬於 ${gameById.get(regionOwnerId)?.slug ?? regionOwnerId}，未合併（可能是編號撞號）`
        );
        continue;
      }
      if (!g.release_date && e.salesDate) {
        plan.releaseDateFills.push({
          gameId: g.id,
          slug: g.slug,
          release_date: e.salesDate,
        });
      }
      if (!g.title_id) {
        plan.titleIdFills.push({ gameId: g.id, slug: g.slug, title_id: e.titleId });
        if (
          (!g.cover_url || g.cover_url === "/covers/placeholder.svg") &&
          e.coverUrl
        ) {
          plan.coverFills.push({ gameId: g.id, slug: g.slug, cover_url: e.coverUrl });
        }
        continue;
      }
      plan.conflicts.push(
        `JP ${e.titleId}「${e.title}」標題對到已有編號 ${g.title_id} 的 ${g.slug}，未合併（可能是同名不同版本）`
      );
      continue;
    }
    if (match && "candidate" in match) {
      plan.conflicts.push(
        `JP ${e.titleId}「${e.title}」標題撞名（已有同名候選），未建新遊戲`
      );
      continue;
    }
    // 此 JP 編號已在他區對照表出現（例如先以 TW/HK-only 進庫的遊戲，
    // 其 TW 編號恰好與 JP 編號同號）：可能是同一款遊戲、也可能只是
    // 不同區的數字編號撞號，標題語言不同又無法自動確認——不建新遊戲，
    // 列入 needs_review 待人工確認，避免目錄出現重複遊戲。
    if (regionOwnerId) {
      const owner = gameById.get(regionOwnerId);
      plan.needsReview.push({
        slug: owner?.slug ?? "",
        title: e.title,
        reason: `JP 編號 ${e.titleId} 已在他區對照表出現（${owner?.slug ?? regionOwnerId} 的某國編號），疑似同一款遊戲但標題無法自動對上，未建新遊戲，待人工確認是否合併`,
      });
      continue;
    }
    const latin = extractLatin(e.title);
    const base = slugify(latin) ?? `game-${e.titleId}`;
    const slug = uniqueSlug(base, e.titleId, takenSlugs);
    takenSlugs.add(slug);
    const row: NewGameRow = {
      slug,
      title_zh: e.title,
      title_en: latin ?? e.title,
      genre: e.genre ?? null,
      publisher: e.maker ?? null,
      platform: e.platform ?? "Switch",
      product_type: "game",
      has_demo: 0,
      cover_url: e.coverUrl ?? "/covers/placeholder.svg",
      youtube_id: null,
      title_id: e.titleId,
      release_date: e.salesDate ?? null,
      is_manual: false,
    };
    plan.newGames.push(row);
    registerCandidate(row, e.titleId);
    plan.stats.newFromJp++;
    if (e.storePrice) {
      plan.storefrontPrices.push({
        gameSlug: slug,
        title: e.title,
        country: e.country,
        regularRaw: e.storePrice.regularRaw,
        effectiveRaw: e.storePrice.effectiveRaw,
        currency: e.storePrice.currency,
        saleEnd: e.storePrice.saleEnd ?? null,
        onSale: e.storePrice.onSale ?? false,
        source: e.source,
      });
    }
    if (looksLikeDlc(e.title)) {
      plan.needsReview.push({
        slug,
        title: e.title,
        reason: "標題疑似 DLC／追加內容，但 JP XML 的 SoftType 無法區分，仍先記 product_type=game，待人工確認",
      });
    }
  }

  // ---- 第 2 步：TW/HK（及其他區）條目：掛編號 → 掛到 JP 候選 → 新遊戲 ----
  const seenRegion = new Set<string>();
  for (const e of allEntries.filter((x) => x.country !== "JP")) {
    const regionKey = `${e.country}|${e.titleId}`;
    if (seenRegion.has(regionKey)) continue;
    seenRegion.add(regionKey);
    const existingGameId = regionIndex.get(regionKey);
    if (existingGameId) {
      plan.stats.matchedByRegionId++;
      const g = gameById.get(existingGameId);
      if (g && !g.release_date && e.salesDate) {
        plan.releaseDateFills.push({
          gameId: g.id,
          slug: g.slug,
          release_date: e.salesDate,
        });
      }
      // 非 JP 條目（NA／EU 帶圖）也能補封面：佔位圖一樣算缺圖。
      if (
        g &&
        (!g.cover_url || g.cover_url === "/covers/placeholder.svg") &&
        e.coverUrl
      ) {
        plan.coverFills.push({
          gameId: g.id,
          slug: g.slug,
          cover_url: e.coverUrl,
        });
      }
      continue; // 編號已在對照表，什麼都不用做
    }
    const norm = normalizeTitle(e.title);
    const match = uniqueNormMatch(norm);
    if (match && "game" in match) {
      // 標題唯一命中已在庫遊戲 → 只補該國編號，不新建遊戲、不改標題。
      plan.regionIdUpserts.push({
        gameId: match.game.id,
        gameSlug: match.game.slug,
        country: e.country,
        title_id: e.titleId,
        source: e.source,
      });
      if (!match.game.release_date && e.salesDate) {
        plan.releaseDateFills.push({
          gameId: match.game.id,
          slug: match.game.slug,
          release_date: e.salesDate,
        });
      }
      if (
        (!match.game.cover_url ||
          match.game.cover_url === "/covers/placeholder.svg") &&
        e.coverUrl
      ) {
        plan.coverFills.push({
          gameId: match.game.id,
          slug: match.game.slug,
          cover_url: e.coverUrl,
        });
      }
      plan.stats.matchedByTitle++;
      continue;
    }
    if (match && "candidate" in match) {
      // 掛到本次 JP 新遊戲候選：TW/HK 標題是中文，優先作 title_zh，
      // 並把中文標題補進索引（否則同一款的另一區條目會誤建成重複遊戲）。
      const cand = match.candidate;
      cand.title_zh = e.title;
      if (!cand.release_date && e.salesDate) cand.release_date = e.salesDate;
      if (
        (!cand.cover_url || cand.cover_url === "/covers/placeholder.svg") &&
        e.coverUrl
      ) {
        cand.cover_url = e.coverUrl;
      }
      indexCandidateTitle(cand);
      plan.regionIdUpserts.push({
        gameId: null,
        gameSlug: cand.slug,
        country: e.country,
        title_id: e.titleId,
        source: e.source,
      });
      plan.stats.matchedByTitle++;
      continue;
    }
    const gamesHit = (byNormTitle.get(norm) ?? []).length;
    const candsHit = (candidateByNormTitle.get(norm) ?? []).length;
    const pendHit = (pendingByNorm.get(norm) ?? []).length;
    if (gamesHit + candsHit + pendHit > 1) {
      plan.needsReview.push({
        slug: "",
        title: e.title,
        reason: `${e.country} 編號 ${e.titleId} 的標題撞名（${gamesHit + candsHit + pendHit} 款同名），未自動建新遊戲、未掛編號，待人工確認是哪一款`,
      });
      continue;
    }
    if (pendHit === 1) {
      // 同一款的另一區條目：本次已建的 TW-only 新遊戲（JP 候選已在
      // uniqueNormMatch 處理），只掛編號，不再建第二款。
      const row = pendingByNorm.get(norm)![0];
      plan.regionIdUpserts.push({
        gameId: null,
        gameSlug: row.slug,
        country: e.country,
        title_id: e.titleId,
        source: e.source,
      });
      plan.stats.matchedByTitle++;
      continue;
    }
    // 全新 TW/HK-only 遊戲（多半是 JP XML 還沒有的 Switch 2 新作，或
    // 台港獨佔上架）：沒有 JP 編號，title_id 留空等 JP 清單出現再補。
    const latin = extractLatin(e.title);
    const base = slugify(latin) ?? `tw-${e.titleId}`;
    const slug = uniqueSlug(base, e.titleId, takenSlugs);
    takenSlugs.add(slug);
    const row: NewGameRow = {
      slug,
      title_zh: e.title,
      title_en: latin ?? e.title,
      genre: e.genre ?? null,
      publisher: null,
      platform: e.platform ?? "Switch",
      product_type: "game",
      has_demo: 0,
      cover_url: e.coverUrl ?? "/covers/placeholder.svg",
      youtube_id: null,
      title_id: null,
      release_date: e.salesDate ?? null,
      is_manual: false,
    };
    plan.newGames.push(row);
    indexPendingTitle(row);
    if (e.storePrice) {
      plan.storefrontPrices.push({
        gameSlug: slug,
        title: e.title,
        country: e.country,
        regularRaw: e.storePrice.regularRaw,
        effectiveRaw: e.storePrice.effectiveRaw,
        currency: e.storePrice.currency,
        saleEnd: e.storePrice.saleEnd ?? null,
        onSale: e.storePrice.onSale ?? false,
        source: e.source,
      });
    }
    if (e.referencePrice) {
      plan.referencePrices.push({
        gameSlug: slug,
        title: e.title,
        country: e.country,
        regularRaw: e.referencePrice.regularRaw,
        effectiveRaw: e.referencePrice.effectiveRaw,
        discountPct: e.referencePrice.discountPct,
        currency: e.referencePrice.currency,
        source: e.source,
      });
    }
    plan.regionIdUpserts.push({
      gameId: null,
      gameSlug: slug,
      country: e.country,
      title_id: e.titleId,
      source: e.source,
    });
    plan.stats.newFromNonJp++;
    if (looksLikeDlc(e.title)) {
      plan.needsReview.push({
        slug,
        title: e.title,
        reason: "標題疑似 DLC／追加內容，但清單無法區分，仍先記 product_type=game，待人工確認",
      });
    }
  }

  plan.stats.titleIdFills = plan.titleIdFills.length;
  // coverFills 去重（同一遊戲可能被多個 JP 條目命中，實際只會有一條）。
  const seenCover = new Set<string>();
  plan.coverFills = plan.coverFills.filter((c) => {
    if (seenCover.has(c.gameId)) return false;
    seenCover.add(c.gameId);
    return true;
  });
  plan.stats.coverFills = plan.coverFills.length;
  return plan;
}
