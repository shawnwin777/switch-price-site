// ============================================================================
// Steam 特價＋Epic 免費遊戲（/deals 獨立頁面）：伺服器端抓取（不需金鑰）。
// ----------------------------------------------------------------------------
// 資料來源（2026-11-20 已驗證無需金鑰，2026-11-23 早上再驗證仍通）：
//   Steam 特價：特價搜尋 API
//     GET https://store.steampowered.com/search/results/?query&start=0&count=100
//       &dynamic_data=&sort_by=_ASC&specials=1&infinite=1&cc=TW&l=tchinese
//     回 results_html（HTML 片段），每列有 app id、名稱、折扣％、台幣原價／特價。
//     2026-11-23 實測台灣區特價中 15,020 款；sort_by 傳 Discount_DESC
//     與 _ASC 回傳順序相同（不支援折扣排序），所以抓前六頁（600 列）
//     再在伺服器端按折扣大→小排序取前 510。注意：這是「取回 600 列
//     裡的前 510」，不是全台灣 15,020 款裡的全域前 510。只做台灣
//     （cc=TW），不加跨區切換——跨區帳號可能被鎖。搜尋結果沒有特價
//     截止日，subLine 為空。
//     舊的 featuredcategories specials 只回 10 款精選，搜尋失敗時才當備援。
//     連結：https://store.steampowered.com/app/<id>/
//   Steam 限時免費領取（免費遊戲分頁的 Steam 部分）：同一支特價搜尋 API
//     裡折扣 100% 的品項（付費遊戲降到 0 元、可永久保留；特價寫「免費」）。
//     跟「免費遊玩」（F2P）分得開：F2P 沒有原價也不在 specials=1 的結果裡，
//     100% 列必須有原價才算。抓法：前六頁解析後拆出 100% 列，另外再用
//     sort_by=Price_ASC 抓一頁（特價按最終價低→高排，0 元一定在最前面，
//     一頁就能抓齊、不怕 100% 品項排在 600 列之外）；兩邊合併去重。
//     2026-11-23 實測：當週台灣區 100% 品項 0 款（Price_ASC 第一頁最便宜
//     是 NT$ 11，沒有 0 元列），所以免費分頁目前只有 Epic 的 1 款預告——
//     這是資料現況、不是 bug；有 100% 遊戲出現時會自動列進來。
//   Epic 免費遊戲：GET https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-Hant&country=TW&allowCountries=TW
//     data.Catalog.searchStore.elements：title、price.totalPrice（originalPrice，台幣分）、
//     keyImages（DieselStoreFrontWide／Thumbnail）、urlSlug、promotions。
//     連結：https://store.epicgames.com/zh-Hant/p/<urlSlug>
//     只做台灣（country=TW），不加跨區切換。
//   注意：Epic「免費」的判斷是 promotionalOffers 裡
//   discountSetting.discountPercentage === 0（2026-11-23 實測：回應沒有
//   discountPrice 欄位；Mark of the Deep 本週只在 US 回應出現，TW 回應沒有，
//   所以 TW 本週可能沒有進行中免費遊戲——此時只顯示下週預告，不硬湊）。
// 快取：呼叫端用 lib/cached-data.ts 的 unstable_cache 包一層（1 小時），
// 頁面每次載入不直接打 Steam／Epic API。抓取失敗時該來源回空陣列，
// 頁面只顯示另一來源；兩邊都失敗時顯示空狀態（頁面不壞）。
// ============================================================================

export type DealsCarouselSource = "steam" | "epic" | "xbox" | "ps";

export interface DealsCarouselItem {
  source: DealsCarouselSource;
  /** 來源內的穩定 key（Steam app id／Epic urlSlug），給 React key 用。 */
  key: string;
  title: string;
  /** 616x353 膠囊圖（Steam）或寬圖（Epic），直接用 <img> 顯示。 */
  image: string;
  /** 點了連去 Steam／Epic 商店（新分頁）。 */
  url: string;
  /** 徽章：Steam 為「-85%」；Epic 為「免費」／「即將免費」。 */
  badge: string;
  /** 價格行：Steam「NT$ 193（原價 NT$ 1,290）」；Epic「原價 NT$ 289」。 */
  priceLine: string;
  /** 副行：Steam「特價至 2026/12/21」；Epic「免費領取至 2026/11/26」／「11/26 起免費」。 */
  subLine: string | null;
  /** 排序鍵：Steam 折扣大→小；Epic 進行中（依截止日近→遠）在前、下週預告在後。 */
  sortKey: number;
}

export interface DealsPageData {
  /** 全部項目（Steam 在前、Epic 進行中、Epic 下週預告在後），舊輪播時代的扁平順序，保留供相容。 */
  items: DealsCarouselItem[];
  /** Steam 特價完整清單（不截斷；不含 100% 限時免費，那些在 steamFree）。 */
  steam: DealsCarouselItem[];
  /** Steam 限時免費領取（折扣 100% 的付費遊戲，可永久保留）。 */
  steamFree: DealsCarouselItem[];
  /** Epic 本週免費遊戲。 */
  epicCurrent: DealsCarouselItem[];
  /** Epic 下週預告。 */
  epicUpcoming: DealsCarouselItem[];
  /** 抓取時間（ISO），除錯／快取觀察用。 */
  fetchedAt: string;
  steamCount: number;
  steamFreeCount: number;
  /** Steam 台灣區特價中的總款數（搜尋 API 的 total_count）。 */
  steamTotalCount: number;
  epicCurrentCount: number;
  epicUpcomingCount: number;
}

const STEAM_URL =
  "https://store.steampowered.com/api/featuredcategories/?cc=TW&l=tchinese";
/** Steam 特價搜尋 API（回 results_html；一次最多 100 列）。
 *  sort_by 由呼叫端帶（預設 _ASC；限時免費另用 Price_ASC 抓一頁）。 */
const STEAM_SEARCH_URL =
  "https://store.steampowered.com/search/results/?query" +
  "&dynamic_data=&specials=1&infinite=1&cc=TW&l=tchinese";
/** 每平台分頁取的前 510 款（2026-11-23 從 200 改成 350、再改成 510）。
 *  注意 Steam 是「取回 600 列裡的前 510」，不是全台灣特價款裡的全域前 510。 */
export const DEALS_TOP_COUNT = 510;
const EPIC_URL =
  "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-Hant&country=TW&allowCountries=TW";

const USER_AGENT = "switch-price-site-deals-page/1.0";

function formatTwdCents(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return `NT$ ${Math.round(cents / 100).toLocaleString("zh-Hant-TW")}`;
}

function formatTaipeiDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).format(d);
}

/** 單一來源失敗不拋錯到上層（由呼叫端降級處理）；Steam 偶爾會瞬斷，
 *  失敗時重試一次（間隔 500ms），再失敗才放棄該來源。 */
async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res.json();
    } catch (e) {
      lastError = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastError;
}

interface SteamSpecialItem {
  id?: number;
  name?: string;
  discount_percent?: number;
  original_price?: number;
  final_price?: number;
  large_capsule_image?: string;
  discount_expiration?: number;
}

function parseSteam(data: unknown): DealsCarouselItem[] {
  const root = data as { specials?: { items?: SteamSpecialItem[] } } | null;
  const rawItems = Array.isArray(root?.specials?.items)
    ? root!.specials!.items!
    : [];
  const items = rawItems
    .filter(
      (it) =>
        typeof it?.id === "number" &&
        typeof it?.name === "string" &&
        it.name.length > 0 &&
        typeof it?.large_capsule_image === "string" &&
        it.large_capsule_image.length > 0 &&
        (it.discount_percent ?? 0) > 0
    )
    .sort((a, b) => (b.discount_percent ?? 0) - (a.discount_percent ?? 0))
    .map((it): DealsCarouselItem => {
      const finalPrice = formatTwdCents(it.final_price);
      const originalPrice = formatTwdCents(it.original_price);
      // 100% 折扣＝限時免費領取（付費遊戲降到 0 元，須有原價才算）。
      const isFree =
        (it.discount_percent ?? 0) === 100 &&
        (it.final_price ?? -1) === 0 &&
        (it.original_price ?? 0) > 0;
      const priceLine = isFree
        ? `免費（原價 ${originalPrice}）`
        : finalPrice && originalPrice && originalPrice !== finalPrice
          ? `${finalPrice}（原價 ${originalPrice}）`
          : (finalPrice ?? originalPrice ?? "特價中");
      const expiration =
        typeof it.discount_expiration === "number" && it.discount_expiration > 0
          ? formatTaipeiDate(
              new Date(it.discount_expiration * 1000).toISOString()
            )
          : null;
      return {
        source: "steam",
        key: `steam-${it.id}`,
        title: it.name as string,
        image: it.large_capsule_image as string,
        url: `https://store.steampowered.com/app/${it.id}/`,
        badge: isFree ? "限時免費" : `-${it.discount_percent}%`,
        priceLine,
        subLine: expiration ? `特價至 ${expiration}` : null,
        sortKey: it.discount_percent ?? 0,
      };
    });
  return items;
}

/** 搜尋結果標題裡的 HTML 實體（&amp;、&#039; 等）解回原字。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseTwdAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatTwdAmount(amount: number): string {
  return `NT$ ${Math.round(amount).toLocaleString("zh-Hant-TW")}`;
}

/** 解析特價搜尋一頁的 results_html，取 app id、名稱、折扣％、台幣價。
 *  列結構（實測）：<a href=".../app/<id>/..." class="search_result_row ...">
 *  內含 <span class="title">、discount_block（data-discount、data-price-final）
 *  與 discount_original_price／discount_final_price。缺欄位的列跳過。 */
function parseSteamSearchPage(html: string): DealsCarouselItem[] {
  const items: DealsCarouselItem[] = [];
  if (!html) return items;
  const rowRe =
    /<a href="https:\/\/store\.steampowered\.com\/app\/(\d+)\/[^"]*"[^>]*class="search_result_row[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(rowRe)) {
    const appId = Number(m[1]);
    const body = m[2] ?? "";
    if (!Number.isFinite(appId) || appId <= 0) continue;
    const titleM = /<span class="title">([\s\S]*?)<\/span>/.exec(body);
    const title = titleM ? decodeEntities(titleM[1].trim()) : "";
    if (!title) continue;
    const discM =
      /discount_pct"[^>]*>([^<]*)</.exec(body) ??
      /data-discount="(\d+)"/.exec(body);
    const discText = discM ? discM[1] : "";
    let discount = Math.abs(parseInt(discText.replace(/[^0-9]/g, ""), 10));
    const origM = /discount_original_price">([^<]*)</.exec(body);
    const finalM = /discount_final_price">([^<]*)</.exec(body);
    const original = parseTwdAmount(origM?.[1]);
    // 100% 折扣的特價寫「免費」（final 0 元），parseTwdAmount 會回 null，
    // 要另外認出它——沒有原價就不是付費遊戲降價（免費遊玩沒有原價），
    // 所以 100% 列必須有原價才算限時免費領取。
    const finalText = (finalM?.[1] ?? "").trim();
    const final = /免費/.test(finalText)
      ? 0
      : parseTwdAmount(finalM?.[1]);
    if (original && final != null && final < original) {
      discount = Math.round((1 - final / original) * 100);
    }
    if (!Number.isFinite(discount) || discount <= 0) continue;
    const isFree = discount === 100;
    if (isFree) {
      // 限時免費領取：付費遊戲降到 0 元（有原價、特價 0 元）才算；
      // 免費遊玩（F2P）不會出現在 specials=1 的結果裡，萬一混進來
      // 也會因沒有原價在這裡被擋掉。
      if (!original || final !== 0) continue;
    } else if (final == null || final <= 0) {
      continue;
    }
    const priceLine = isFree
      ? `免費（原價 ${formatTwdAmount(original as number)}）`
      : original
        ? `${formatTwdAmount(final as number)}（原價 ${formatTwdAmount(original)}）`
        : formatTwdAmount(final as number);
    items.push({
      source: "steam",
      key: `steam-${appId}`,
      title,
      // 搜尋列只有 231x87 小圖；卡片用標準 460x215 header 圖。
      image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
      url: `https://store.steampowered.com/app/${appId}/`,
      badge: isFree ? "限時免費" : `-${discount}%`,
      priceLine,
      // 搜尋結果沒有特價截止日。
      subLine: null,
      sortKey: discount,
    });
  }
  return items;
}

/** 抓一頁 Steam 特價搜尋（results_html 解析；失敗時拋錯，呼叫端處理）。 */
async function fetchSteamSearchPage(
  start: number,
  count: number,
  sortBy = "_ASC"
): Promise<{ items: DealsCarouselItem[]; totalCount: number }> {
  const res = await fetch(
    `${STEAM_SEARCH_URL}&sort_by=${sortBy}&start=${start}&count=${count}`,
    {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!res.ok)
    throw new Error(`HTTP ${res.status} Steam 搜尋 start=${start}`);
  const data = (await res.json()) as {
    results_html?: string;
    total_count?: number;
  };
  return {
    items: parseSteamSearchPage(data.results_html ?? ""),
    totalCount: data.total_count ?? 0,
  };
}

/** 抓 Steam 特價搜尋前六頁（600 列），去重後按折扣大→小取前 510 款
 *  （不含 100% 限時免費，那些另外進免費分頁，不佔特價名額）。
 *  （兩頁 200 列實測會有 1 款重複，所以多抓頁數補滿；600 列去重後
 *  仍有 510 款以上才取得到 510——不夠時就列實際抓到的款數。）
 *  限時免費另外用 sort_by=Price_ASC 抓一頁（特價按最終價低→高排，
 *  0 元的 100% 折扣一定在最前面，一頁就能抓齊、不怕它排在 600 列之外）。
 *  同時回傳台灣區特價總款數（total_count）。任一頁失敗回空陣列。 */
async function fetchSteamSearchTop(): Promise<{
  items: DealsCarouselItem[];
  freeItems: DealsCarouselItem[];
  totalCount: number;
}> {
  const [pages, freeByPrice] = await Promise.all([
    Promise.allSettled(
      [0, 100, 200, 300, 400, 500].map((start) => fetchSteamSearchPage(start, 100))
    ),
    fetchSteamSearchPage(0, 100, "Price_ASC").catch(() => ({
      items: [],
      totalCount: 0,
    })),
  ]);
  const ok = pages
    .filter(
      (p): p is PromiseFulfilledResult<{ items: DealsCarouselItem[]; totalCount: number }> =>
        p.status === "fulfilled"
    )
    .map((p) => p.value);
  if (ok.length === 0) return { items: [], freeItems: [], totalCount: 0 };
  const seen = new Set<string>();
  const merged = ok
    .flatMap((p) => p.items)
    .filter((it) => {
      if (seen.has(it.key)) return false;
      seen.add(it.key);
      return true;
    })
    .sort((a, b) => b.sortKey - a.sortKey || a.key.localeCompare(b.key));
  // 100% 限時免費領取進免費分頁（兩邊來源合併去重）；其餘按折扣取前 510。
  const freeSeen = new Set<string>();
  const freeItems = [...merged, ...freeByPrice.items]
    .filter((it) => it.sortKey === 100)
    .filter((it) => {
      if (freeSeen.has(it.key)) return false;
      freeSeen.add(it.key);
      return true;
    });
  const items = merged
    .filter((it) => it.sortKey < 100)
    .slice(0, DEALS_TOP_COUNT);
  return { items, freeItems, totalCount: ok[0]?.totalCount ?? 0 };
}

interface EpicOffer {
  startDate?: string;
  endDate?: string;
  discountSetting?: { discountPercentage?: number };
}

interface EpicElement {
  title?: string;
  urlSlug?: string;
  price?: { totalPrice?: { originalPrice?: number } };
  keyImages?: { type?: string; url?: string }[];
  promotions?: {
    promotionalOffers?: { promotionalOffers?: EpicOffer[] }[];
    upcomingPromotionalOffers?: { promotionalOffers?: EpicOffer[] }[];
  } | null;
}

function epicImage(el: EpicElement): string | null {
  const images = Array.isArray(el.keyImages) ? el.keyImages : [];
  const wide = images.find((k) => k.type === "DieselStoreFrontWide")?.url;
  if (wide) return wide;
  return images.find((k) => k.type === "Thumbnail")?.url ?? null;
}

function parseEpic(data: unknown, nowMs: number): {
  current: DealsCarouselItem[];
  upcoming: DealsCarouselItem[];
} {
  const root = data as {
    data?: { Catalog?: { searchStore?: { elements?: EpicElement[] } } };
  } | null;
  const elements = root?.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) return { current: [], upcoming: [] };

  const current: DealsCarouselItem[] = [];
  const upcoming: DealsCarouselItem[] = [];
  for (const el of elements) {
    if (
      typeof el?.title !== "string" ||
      !el.title ||
      typeof el?.urlSlug !== "string" ||
      !el.urlSlug
    )
      continue;
    const image = epicImage(el);
    if (!image) continue;
    const offers =
      el.promotions?.promotionalOffers?.flatMap(
        (g) => g.promotionalOffers ?? []
      ) ?? [];
    const upcomingOffers =
      el.promotions?.upcomingPromotionalOffers?.flatMap(
        (g) => g.promotionalOffers ?? []
      ) ?? [];
    // 免費＝discountPercentage 0（Epic 免費遊戲的實際標記方式）。
    const freeNow = offers.find(
      (o) =>
        o.discountSetting?.discountPercentage === 0 &&
        o.startDate &&
        o.endDate &&
        Date.parse(o.startDate) <= nowMs &&
        nowMs <= Date.parse(o.endDate)
    );
    const freeNext = upcomingOffers.find(
      (o) =>
        o.discountSetting?.discountPercentage === 0 &&
        o.startDate &&
        Date.parse(o.startDate) > nowMs
    );
    const originalPrice = formatTwdCents(
      el.price?.totalPrice?.originalPrice
    );
    if (freeNow) {
      const end = formatTaipeiDate(freeNow.endDate);
      current.push({
        source: "epic",
        key: `epic-${el.urlSlug}`,
        title: el.title,
        image,
        url: `https://store.epicgames.com/zh-Hant/p/${el.urlSlug}`,
        badge: "免費",
        priceLine: originalPrice ? `原價 ${originalPrice}` : "免費領取",
        subLine: end ? `免費領取至 ${end}` : null,
        sortKey: Date.parse(freeNow.endDate ?? "") || 0,
      });
    } else if (freeNext) {
      const start = formatTaipeiDate(freeNext.startDate);
      upcoming.push({
        source: "epic",
        key: `epic-${el.urlSlug}`,
        title: el.title,
        image,
        url: `https://store.epicgames.com/zh-Hant/p/${el.urlSlug}`,
        badge: "即將免費",
        priceLine: originalPrice ? `原價 ${originalPrice}` : "即將免費",
        subLine: start ? `${start} 起免費` : null,
        sortKey: Date.parse(freeNext.startDate ?? "") || 0,
      });
    }
  }
  // 進行中依截止日近→遠；下週預告依開始日近→遠。
  current.sort((a, b) => a.sortKey - b.sortKey);
  upcoming.sort((a, b) => a.sortKey - b.sortKey);
  return { current, upcoming };
}

/** 抓 Steam 特價＋Epic 免費遊戲（/deals 獨立頁面用，分來源回傳）。
 *  單一來源失敗不影響另一來源；兩邊都失敗回空陣列。
 *  Steam 先走特價搜尋（前 510 款、折扣大→小；100% 限時免費另外拆出）；
 *  搜尋無結果才退回 featuredcategories specials（10 款精選，當備援）。 */
export async function fetchDealsPage(): Promise<DealsPageData> {
  const nowMs = Date.now();
  const [steamSearch, epicRes] = await Promise.allSettled([
    fetchSteamSearchTop(),
    fetchJson(EPIC_URL),
  ]);
  let steamItems: DealsCarouselItem[] = [];
  let steamFree: DealsCarouselItem[] = [];
  let steamTotalCount = 0;
  if (steamSearch.status === "fulfilled") {
    steamItems = steamSearch.value.items;
    steamFree = steamSearch.value.freeItems;
    steamTotalCount = steamSearch.value.totalCount;
  } else {
    console.warn("[deals-carousel] Steam 搜尋失敗：", steamSearch.reason);
  }
  if (steamItems.length === 0 && steamFree.length === 0) {
    try {
      const fallback = parseSteam(await fetchJson(STEAM_URL));
      steamFree = fallback.filter((it) => it.sortKey === 100);
      steamItems = fallback.filter((it) => it.sortKey < 100);
      if (fallback.length > 0) {
        console.warn("[deals-carousel] Steam 搜尋無結果，已退回 specials 備援");
      }
    } catch (e) {
      console.warn("[deals-carousel] Steam 備援 specials 也失敗：", e);
    }
  }
  let epicCurrent: DealsCarouselItem[] = [];
  let epicUpcoming: DealsCarouselItem[] = [];
  if (epicRes.status === "fulfilled") {
    try {
      const parsed = parseEpic(epicRes.value, nowMs);
      epicCurrent = parsed.current;
      epicUpcoming = parsed.upcoming;
    } catch (e) {
      console.warn("[deals-carousel] Epic 資料解析失敗：", e);
    }
  } else {
    console.warn("[deals-carousel] Epic API 失敗：", epicRes.reason);
  }
  // Steam 特價在前（折扣大→小），Epic 免費在後（進行中→下週預告）。
  const items = [...steamItems, ...epicCurrent, ...epicUpcoming];
  return {
    items,
    steam: steamItems,
    steamFree,
    epicCurrent,
    epicUpcoming,
    fetchedAt: new Date(nowMs).toISOString(),
    steamCount: steamItems.length,
    steamFreeCount: steamFree.length,
    steamTotalCount,
    epicCurrentCount: epicCurrent.length,
    epicUpcomingCount: epicUpcoming.length,
  };
}
