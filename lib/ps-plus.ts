// ============================================================================
// PS Plus 本月新進（/console 家機頁 PS PLUS 分頁）：伺服器端抓取
// （不需金鑰、不需登入）。2026-11-23 上線。
// ----------------------------------------------------------------------------
// 兩段式（2026-11-23 實測都通）：
//   1. 找文章：PS Blog 的 sitemap 自動發現當月文章——
//      https://blog.playstation.com/sitemap.xml（index）→
//      wp-sitemap-posts-recent.xml（最近 40 篇）裡找
//      /playstation-plus-game-catalog-for-/（遊戲目錄，Extra／Premium）
//      與 /playstation-plus-monthly-games-for-/（每月遊戲，Essential）
//      的最新一篇（取網址裡 /YYYY/MM/DD/ 最新的）；最近 40 篇裡
//      沒有時，改抓當年的 wp-sitemap-posts-YYYY.xml 再找一次。
//      注意：分類頁 blog.playstation.com/category/playstation-plus/
//      的 HTML 是殼、裡面沒有文章連結，這條路不通，不要再試。
//      PS_PLUS 分類（038b4df3…）的 categoryGridRetrieve 回
//      totalCount 0——也是死路，不要再試。
//   2. 解析＋對應：文章內文的 <strong>「遊戲名 | PS5, PS4」</strong>
//      結構乾淨可解析（2026-11-10 目錄文：8 款目錄＋2 款 Premium
//      經典；2026-10-28 每月遊戲文：3 款）；再用官方 GraphQL
//      getSearchResults（persisted hash 4df6284f…1958aa，Delphi 寫法）
//      把英文標題對到台灣商店商品拿圖片／連結。
//      搜尋寫法（之前踩過的坑）：variables 不帶 nextCursor，
//      languageCode 是 "zh"（locale 第一節，不是 "ch"），
//      countryCode "TW"，還要加標頭 X-PSN-Store-Locale-Override:
//      zh-hant-tw——缺了這個或 languageCode 寫 "ch"，搜尋永遠回 0 款。
//      對應規則：先排除試玩版／DLC／追加包（搜尋常把體驗版排第一），
//      再比對核心標題（去平台與版本字尾後的正規化標題）：完全相同優先，
//      其次是包含、且多出來的部分不能是數字（「Monster Train」不能對上
//      「Monster Train 2」；「Soul Reaver 2」對上
//      「Legacy of Kain: Soul Reaver 2」可以），最後取搜尋排第一的候選
//      （搜尋引擎認得跨語言標題，例如《怪物火车2》對 "Monster Train 2"）；
//      對不到商品的標題直接跳過、不硬湊。
// 卡片：badge「新進」、priceLine「PS Plus 訂閱包含」（新進遊戲沒有
//   價格，訂閱內含）、subLine 用文章寫的平台（PS5 · PS4）；順序維持
//   文章順序（目錄文在前、每月遊戲文在後），不重排。月份標籤取自
//   目錄文網址的日期（例如 2026 年 11 月）。
// 快取：呼叫端用 lib/cached-data.ts 的 unstable_cache 包一層（1 小時），
// 頁面每次載入不直接打 Sony API。任一段失敗回空陣列、該分頁不顯示。
// ============================================================================

import type { DealsCarouselItem } from "./deals-carousel";

export interface PsPlusNewData {
  items: DealsCarouselItem[];
  /** 抓取時間（ISO），除錯／快取觀察用。 */
  fetchedAt: string;
  /** 月份標籤（取自目錄文網址日期，例如「2026 年 11 月」）。 */
  month: string | null;
  /** 目錄文網址（Extra／Premium 遊戲目錄）。 */
  catalogUrl: string | null;
  /** 每月遊戲文網址（Essential 每月遊戲）。 */
  monthlyUrl: string | null;
  /** 文章解析出的遊戲款數（搜尋對應前）。 */
  totalCount: number;
  /** 本次列出的款數（對應到商店商品後）。 */
  shownCount: number;
}

const BLOG_BASE = "https://blog.playstation.com";
const SITEMAP_INDEX = `${BLOG_BASE}/sitemap.xml`;
const SEARCH_ENDPOINT = "https://web.np.playstation.com/api/graphql/v1/op";
const SEARCH_OPERATION = "getSearchResults";
/** Delphi 公開寫法的 getSearchResults persisted hash。 */
const SEARCH_HASH =
  "4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa";
/** 搜尋每款最多取 5 筆、3 個並行（13 款左右，一輪數秒）。 */
const SEARCH_PAGE_SIZE = 5;
const SEARCH_CONCURRENCY = 3;

const BLOG_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** 單一來源失敗不拋錯到上層；偶爾瞬斷時重試一次（間隔 500ms）。 */
async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      lastError = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastError;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const text = await fetchText(url, headers);
  return JSON.parse(text);
}

/** 抓 sitemap index 裡的 <loc> 清單。 */
function sitemapLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

/** 網址裡的 /YYYY/MM/DD/ 轉成可比的數字（沒有日期回 0）。 */
function urlDateNum(url: string): number {
  const m = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (!m) return 0;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

function formatMonth(url: string): string | null {
  const m = url.match(/\/(\d{4})\/(\d{2})\/\d{2}\//);
  if (!m) return null;
  return `${m[1]} 年 ${Number(m[2])} 月`;
}

/** 從 sitemap 找最新的 PS Plus 目錄文與每月遊戲文網址。 */
async function discoverArticles(): Promise<{
  catalogUrl: string | null;
  monthlyUrl: string | null;
}> {
  const pick = (urls: string[]) => {
    const catalog = urls
      .filter((u) => u.includes("/playstation-plus-game-catalog-for-"))
      .sort((a, b) => urlDateNum(b) - urlDateNum(a))[0];
    const monthly = urls
      .filter((u) => u.includes("/playstation-plus-monthly-games-for-"))
      .sort((a, b) => urlDateNum(b) - urlDateNum(a))[0];
    return {
      catalogUrl: catalog ?? null,
      monthlyUrl: monthly ?? null,
    };
  };
  try {
    const indexXml = await fetchText(SITEMAP_INDEX, {
      Accept: "application/xml",
      "User-Agent": BLOG_UA,
    });
    const sitemaps = sitemapLocs(indexXml);
    const recent =
      sitemaps.find((u) => u.includes("wp-sitemap-posts-recent.xml")) ??
      sitemaps[0];
    if (recent) {
      const recentXml = await fetchText(recent, {
        Accept: "application/xml",
        "User-Agent": BLOG_UA,
      });
      const found = pick(sitemapLocs(recentXml));
      if (found.catalogUrl || found.monthlyUrl) return found;
    }
    // 最近 40 篇裡沒有（月初文章可能已被洗掉）：改抓當年 sitemap。
    const year = new Date().getFullYear();
    const yearSitemap = `${BLOG_BASE}/wp-sitemap-posts-${year}.xml`;
    const yearXml = await fetchText(yearSitemap, {
      Accept: "application/xml",
      "User-Agent": BLOG_UA,
    });
    return pick(sitemapLocs(yearXml));
  } catch (e) {
    console.warn("[ps-plus-new] sitemap 自動發現失敗：", e);
    return { catalogUrl: null, monthlyUrl: null };
  }
}

/** 解常見 HTML 實體（&nbsp;、&#8211; 之類）與數字實體。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

interface BlogGame {
  title: string;
  platforms: string;
}

/** 文章內文的 <strong>「遊戲名 | PS5, PS4」</strong> 清單。 */
function parseArticleGames(html: string): BlogGame[] {
  const out: BlogGame[] = [];
  const re = /<strong>([^<]+)<\/strong>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = decodeEntities(m[1]).replace(/\u00a0/g, " ").trim();
    const mm = raw.match(
      /^(.*?)\s*\|\s*(PS5(?:\s*,\s*PS4)?|PS4(?:\s*,\s*PS5)?)\s*$/
    );
    if (!mm) continue;
    const title = mm[1].trim();
    const platforms = mm[2].replace(/\s*,\s*/g, " · ");
    // 排除欄位標題（「PlayStation Plus Extra and Premium | Game Catalog」）。
    if (
      !title ||
      title.includes("PlayStation Plus") ||
      title.includes("Game Catalog")
    )
      continue;
    out.push({ title, platforms });
  }
  return out;
}

const LANG_TOKENS = [
  "日语",
  "韩语",
  "简体中文",
  "繁体中文",
  "英语",
  "中文",
  "泰语",
  "文版",
];

/** 去掉店名尾巴的語言清單，如「 (日语, 简体中文, 繁体中文, 英语)」。 */
function cleanName(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (m && LANG_TOKENS.some((t) => m[2].includes(t))) return m[1].trim();
  return name;
}

/** 正規化標題供比對：小寫、去標點空白、破折號統一。 */
function normalizeName(name: string): string {
  return cleanName(name)
    .toLowerCase()
    .replace(/[–—―‐‑‐]/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff]/g, "");
}

/** 比對用的核心標題：正規化後再去掉平台與版本字尾
 *  （PS4／PS5、豪華版／Deluxe／Complete Edition 之類），
 *  讓「Atomfall PS4 & PS5」對得上部落格的「Atomfall」。 */
function coreName(name: string): string {
  return normalizeName(name)
    .replace(/ps4ps5/g, "")
    .replace(/ps4/g, "")
    .replace(/ps5/g, "")
    .replace(/deluxeedition/g, "")
    .replace(/completeedition/g, "")
    .replace(/豪华版/g, "")
    .replace(/数字豪华版/g, "")
    .replace(/数字版/g, "")
    .replace(/完整版/g, "")
    .replace(/标准版/g, "")
    .replace(/gameoftheyearedition/g, "");
}

/** 版本字尾（豪華版／完整版之類）：同一個核心標題有多個版本時，
 *  優先選沒有版本字尾的本體（例如 "Atomfall" 不要 "Atomfall Deluxe Edition"）。 */
const EDITION_RE = /deluxe|complete|豪华版|数字豪华版|gameoftheyear|goty/i;

function preferBase(list: SearchResult[]): SearchResult[] {
  return [...list].sort((a, b) => {
    const ea = EDITION_RE.test(cleanName(a.name ?? "")) ? 1 : 0;
    const eb = EDITION_RE.test(cleanName(b.name ?? "")) ? 1 : 0;
    return ea - eb;
  });
}
const NON_GAME_RE =
  /demo|trial|体验版|試玩版|试玩版|体験版|追加|擴充|扩展|expansion|upgrade|升級|组合版|合辑|服裝|服装|音樂|音乐|seasonpass|季票|角色包|武器包|道具包|造型包|通行证|collection/i;

function isNonGame(r: SearchResult): boolean {
  return NON_GAME_RE.test(cleanName(r.name ?? "")) || /DEMO/i.test(r.id ?? "");
}

function pickImage(media: { role?: string; type?: string; url?: string }[] | undefined): string | null {
  if (!Array.isArray(media)) return null;
  for (const role of ["FOUR_BY_THREE_BANNER", "BACKGROUND", "MASTER"]) {
    const found = media.find(
      (m) => m.role === role && m.type === "IMAGE" && m.url
    );
    if (found?.url) return found.url;
  }
  return null;
}

interface SearchResult {
  __typename?: string;
  id?: string;
  name?: string;
  media?: { role?: string; type?: string; url?: string }[];
}

interface SearchResponse {
  data?: {
    universalSearch?: {
      pageInfo?: { totalCount?: number };
      results?: SearchResult[];
    };
  };
}

function searchUrl(term: string): string {
  const variables = {
    searchTerm: term,
    pageSize: SEARCH_PAGE_SIZE,
    pageOffset: 0,
    countryCode: "TW",
    languageCode: "zh",
  };
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: SEARCH_HASH },
  };
  const q = new URLSearchParams({
    operationName: SEARCH_OPERATION,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify(extensions),
  });
  return `${SEARCH_ENDPOINT}?${q.toString()}`;
}

/** 用官方搜尋把部落格標題對到台灣商店商品（取第一個最像的 Product）。 */
async function searchProduct(
  title: string
): Promise<{ id: string; name: string; image: string | null } | null> {
  try {
    const data = (await fetchJson(searchUrl(title), {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": PS_UA,
      "Accept-Language": "zh-Hant-TW,zh;q=0.9,en;q=0.8",
      Referer: "https://store.playstation.com/zh-hant-tw/pages/search/",
      Origin: "https://store.playstation.com",
      "X-PSN-Store-Locale-Override": "zh-hant-tw",
      "apollo-require-preflight": "true",
      "x-apollo-operation-name": SEARCH_OPERATION,
    })) as SearchResponse;
    const results = (data.data?.universalSearch?.results ?? []).filter(
      (r) => r.__typename === "Product" && r.id && r.name
    );
    if (results.length === 0) return null;
    // 先排除試玩版／DLC／追加包（搜尋常把體驗版排第一）；全被排除時才用原清單。
    const candidates = results.filter((r) => !isNonGame(r));
    // 同一核心標題有多個版本時，本體優先於豪華版／完整版。
    const pool = preferBase(candidates.length > 0 ? candidates : results);
    const want = coreName(title);
    // 1) 核心標題完全相同；2) 包含，但多出來的部分不能是數字
    //    （「Monster Train」不能對上「Monster Train 2」，多出來的 "2"
    //    是數字；「Soul Reaver 2」對上「Legacy of Kain: Soul Reaver 2」
    //    可以，多出來的是副標）；3) 搜尋排第一的候選（搜尋引擎認得
    //    跨語言標題，例如《怪物火车2》對 "Monster Train 2"）。
    const exact = pool.find((r) => coreName(r.name!) === want);
    const contained = pool.find((r) => {
      const n = coreName(r.name!);
      if (!n || !want || n === want) return false;
      const longer = n.length > want.length ? n : want;
      const shorter = n.length > want.length ? want : n;
      if (!longer.includes(shorter)) return false;
      const rest = longer.replace(shorter, "");
      return !/\d/.test(rest);
    });
    const best = exact ?? contained ?? pool[0];
    return {
      id: best.id!,
      name: cleanName(best.name!),
      image: pickImage(best.media),
    };
  } catch (e) {
    console.warn(`[ps-plus-new] 搜尋「${title}」失敗：`, e);
    return null;
  }
}

/** 抓 PS Plus 本月新進（目錄文＋每月遊戲文，文章順序、對應到商店商品）。 */
export async function fetchPsPlusNew(): Promise<PsPlusNewData> {
  const nowMs = Date.now();
  const empty: PsPlusNewData = {
    items: [],
    fetchedAt: new Date(nowMs).toISOString(),
    month: null,
    catalogUrl: null,
    monthlyUrl: null,
    totalCount: 0,
    shownCount: 0,
  };
  const { catalogUrl, monthlyUrl } = await discoverArticles();
  if (!catalogUrl && !monthlyUrl) return empty;
  const month = (catalogUrl && formatMonth(catalogUrl)) ||
    (monthlyUrl && formatMonth(monthlyUrl));
  // 目錄文在前、每月遊戲文在後，維持文章順序、去重。
  const games: BlogGame[] = [];
  const seenTitles = new Set<string>();
  for (const url of [catalogUrl, monthlyUrl]) {
    if (!url) continue;
    try {
      const html = await fetchText(url, {
        Accept: "text/html",
        "User-Agent": BLOG_UA,
      });
      for (const g of parseArticleGames(html)) {
        const key = normalizeName(g.title);
        if (seenTitles.has(key)) continue;
        seenTitles.add(key);
        games.push(g);
      }
    } catch (e) {
      console.warn(`[ps-plus-new] 文章抓取失敗 ${url}：`, e);
    }
  }
  if (games.length === 0) return { ...empty, month, catalogUrl, monthlyUrl };
  const totalCount = games.length;
  const items: DealsCarouselItem[] = [];
  for (let i = 0; i < games.length; i += SEARCH_CONCURRENCY) {
    const chunk = games.slice(i, i + SEARCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((g) => searchProduct(g.title))
    );
    chunk.forEach((g, j) => {
      const s = settled[j];
      if (s.status !== "fulfilled" || !s.value) {
        console.warn(`[ps-plus-new]「${g.title}」對不到商店商品，已跳過`);
        return;
      }
      const prod = s.value;
      if (!prod.image) {
        console.warn(`[ps-plus-new]「${g.title}」商店商品沒有圖片，已跳過`);
        return;
      }
      items.push({
        source: "ps",
        key: `psplus-${prod.id}`,
        title: prod.name,
        image: prod.image,
        url: `https://store.playstation.com/zh-hant-tw/product/${prod.id}`,
        badge: "新進",
        priceLine: "PS Plus 訂閱包含",
        subLine: g.platforms,
        // 維持文章順序（sortKey 越大越前）。
        sortKey: totalCount - games.indexOf(g),
      });
    });
  }
  items.sort((a, b) => b.sortKey - a.sortKey);
  return {
    items,
    fetchedAt: new Date(nowMs).toISOString(),
    month,
    catalogUrl,
    monthlyUrl,
    totalCount,
    shownCount: items.length,
  };
}
