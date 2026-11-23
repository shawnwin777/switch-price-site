// ============================================================================
// Steam 特價＋Epic 免費遊戲（/deals 獨立頁面）：伺服器端抓取（不需金鑰）。
// ----------------------------------------------------------------------------
// 資料來源（2026-11-20 已驗證無需金鑰，2026-11-23 早上再驗證仍通）：
//   Steam 特價：GET https://store.steampowered.com/api/featuredcategories/?cc=TW&l=tchinese
//     specials.items：name、discount_percent、original_price／final_price
//     （台幣，以分為單位，除以 100）、large_capsule_image、id、discount_expiration（unix 秒）。
//     連結：https://store.steampowered.com/app/<id>/
//     注意：只做台灣（cc=TW），不加跨區切換——跨區帳號可能被鎖。
//     specials 目前 API 回 10 款，這裡不截斷，全部列出（未來 API 回更多
//     就列更多，不只留輪播時代的 10 款）。
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

export type DealsCarouselSource = "steam" | "epic" | "xbox";

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
  /** Steam 特價完整清單（不截斷）。 */
  steam: DealsCarouselItem[];
  /** Epic 本週免費遊戲。 */
  epicCurrent: DealsCarouselItem[];
  /** Epic 下週預告。 */
  epicUpcoming: DealsCarouselItem[];
  /** 抓取時間（ISO），除錯／快取觀察用。 */
  fetchedAt: string;
  steamCount: number;
  epicCurrentCount: number;
  epicUpcomingCount: number;
}

const STEAM_URL =
  "https://store.steampowered.com/api/featuredcategories/?cc=TW&l=tchinese";
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
      const priceLine =
        finalPrice && originalPrice && originalPrice !== finalPrice
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
        badge: `-${it.discount_percent}%`,
        priceLine,
        subLine: expiration ? `特價至 ${expiration}` : null,
        sortKey: it.discount_percent ?? 0,
      };
    });
  return items;
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
 *  單一來源失敗不影響另一來源；兩邊都失敗回空陣列。 */
export async function fetchDealsPage(): Promise<DealsPageData> {
  const nowMs = Date.now();
  const [steamRes, epicRes] = await Promise.allSettled([
    fetchJson(STEAM_URL),
    fetchJson(EPIC_URL),
  ]);
  let steamItems: DealsCarouselItem[] = [];
  if (steamRes.status === "fulfilled") {
    try {
      steamItems = parseSteam(steamRes.value);
    } catch (e) {
      console.warn("[deals-carousel] Steam 資料解析失敗：", e);
    }
  } else {
    console.warn("[deals-carousel] Steam API 失敗：", steamRes.reason);
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
    epicCurrent,
    epicUpcoming,
    fetchedAt: new Date(nowMs).toISOString(),
    steamCount: steamItems.length,
    epicCurrentCount: epicCurrent.length,
    epicUpcomingCount: epicUpcoming.length,
  };
}
