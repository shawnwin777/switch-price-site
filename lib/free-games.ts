import type {
  DealsCarouselItem,
  DealsCarouselSource,
  FreeKind,
} from "./deals-carousel";
import { isSaleEndingSoon, saleEndLabel } from "./format";

/** 免費 PC 遊戲清單（/deals 免費遊戲分頁用），網站直接抓、完全自動化。
 *  來源：Epic 官方（US 店面，TW 店面會漏遊戲）＋ GamerPower 聚合
 *  （Steam、IndieGala、itch.io 等）。GOG 目前無進行中限時免費，
 *  GamerPower 也會收 GOG 的贈送，所以 GOG 經由 GamerPower 覆蓋；
 *  GOG 目錄直接掃描太貴（425 頁），目前不做。
 *  收錄範圍（2026-11-26 他說的）：PC 完整遊戲＋PC DLC＋主機遊戲／DLC。
 *  GamerPower 只留 status Active、type Game／Early Access／DLC，
 *  platforms 含 PC 或主機（PlayStation／Xbox／Nintendo Switch）；
 *  手遊限定、Other 類型全濾掉。
 *  備註（放進卡片 subLine）：DLC 標「DLC」；主機標「主機：PS5／XSX／Switch」
 *  （列出該物品有的主機平台）；兩者都有就合併，如「DLC・主機：PS5／XSX」。
 *  Epic 官方優先：同一款遊戲同時在 Epic 與 GamerPower 出現時，
 *  只留 Epic 官方那筆（用標題歸一化比對去重）。
 *  抓取失敗時回空陣列（免費遊戲區顯示空狀態），不讓整個 /deals 頁面壞掉。
 *  呼叫端用 lib/cached-data.ts 的 unstable_cache 包一層（1 小時）。 */

const EPIC_FREE_URL =
  "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US";
const GAMERPOWER_URL = "https://www.gamerpower.com/api/giveaways";

const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "shawn-game-studio-deals-page/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
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

/** Epic US 店面的 originalPrice 是美金分（1999＝$19.99），不是台幣分，
 *  所以用美元顯示；0 或空值回 null（卡片只顯示「免費領取／即將免費」）。 */
function formatUsdCents(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

/** 標題歸一化（去重用）：小寫、去空白與標點、去掉 Giveaway／平台後綴。 */
function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/giveaway|steam key|playtest|beta|key/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

interface EpicElement {
  title?: string;
  urlSlug?: string;
  price?: { totalPrice?: { originalPrice?: number } };
  keyImages?: { type?: string; url?: string }[];
  promotions?: {
    promotionalOffers?: { promotionalOffers?: {
      discountSetting?: { discountPercentage?: number };
      startDate?: string;
      endDate?: string;
    }[] }[];
    upcomingPromotionalOffers?: { promotionalOffers?: {
      discountSetting?: { discountPercentage?: number };
      startDate?: string;
      endDate?: string;
    }[] }[];
  };
}

function epicImage(el: EpicElement): string | null {
  const imgs = el.keyImages ?? [];
  const wide = imgs.find((i) => i.type === "DieselStoreFrontWide")?.url;
  const thumb = imgs.find((i) => i.type === "Thumbnail")?.url;
  return wide ?? thumb ?? null;
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
    if (typeof el?.title !== "string" || !el.title) continue;
    if (typeof el?.urlSlug !== "string" || !el.urlSlug) continue;
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
    const originalPrice = formatUsdCents(
      el.price?.totalPrice?.originalPrice
    );
    if (freeNow) {
      // 截止日跟 Switch 牆一樣：顯示時間＋倒數（剩 X 小時／天），
      // 24 小時內設 endingSoon，卡片用琥珀色＋⚠ 警告。
      const endLabel = saleEndLabel(freeNow.endDate);
      current.push({
        badge: "免費",
        endingSoon: isSaleEndingSoon(freeNow.endDate),
        freeKinds: ["pc"],
        image,
        key: `free-epic-${el.urlSlug}`,
        priceLine: originalPrice ? `原價 ${originalPrice}` : "免費領取",
        sortKey: Date.parse(freeNow.endDate ?? "") || 0,
        source: "epic",
        subLine: `免費領取至 ${endLabel}`,
        title: el.title,
        url: `https://store.epicgames.com/p/${el.urlSlug}`,
      });
    } else if (freeNext) {
      const start = formatTaipeiDate(freeNext.startDate);
      upcoming.push({
        badge: "即將免費",
        freeKinds: ["pc"],
        image,
        key: `free-epic-${el.urlSlug}`,
        priceLine: originalPrice ? `原價 ${originalPrice}` : "即將免費",
        sortKey: Date.parse(freeNext.startDate ?? "") || 0,
        source: "epic",
        subLine: start ? `${start} 起免費` : null,
        title: el.title,
        url: `https://store.epicgames.com/p/${el.urlSlug}`,
      });
    }
  }
  current.sort((a, b) => a.sortKey - b.sortKey);
  upcoming.sort((a, b) => a.sortKey - b.sortKey);
  return { current, upcoming };
}

interface GamerPowerGiveaway {
  id?: number;
  title?: string;
  worth?: string;
  thumbnail?: string;
  image?: string;
  description?: string;
  open_giveaway_url?: string;
  published_date?: string;
  type?: string;
  platforms?: string;
  end_date?: string;
  status?: string;
}

/** 從 platforms 字串抽出主機平台（PS5／PS4／XSX／Xbox One／Switch）。 */
function consolePlatforms(platforms: string): string[] {
  const out: string[] = [];
  if (/Playstation 5/i.test(platforms)) out.push("PS5");
  if (/Playstation 4/i.test(platforms)) out.push("PS4");
  if (/Xbox Series/i.test(platforms)) out.push("XSX");
  if (/Xbox One/i.test(platforms)) out.push("Xbox One");
  if (/Nintendo Switch/i.test(platforms)) out.push("Switch");
  return out;
}

function parseGamerPower(data: unknown): DealsCarouselItem[] {
  if (!Array.isArray(data)) return [];
  const items: DealsCarouselItem[] = [];
  for (const g of data as GamerPowerGiveaway[]) {
    // 收錄範圍：PC 完整遊戲＋PC DLC＋主機遊戲／DLC。
    // type 只要 Game／Early Access／DLC；platforms 含 PC 或主機；
    // status Active。手遊限定、Other 類型、VR 全濾掉。
    if (g?.status !== "Active") continue;
    if (
      g?.type !== "Game" &&
      g?.type !== "Early Access" &&
      g?.type !== "DLC"
    )
      continue;
    const platforms = g?.platforms ?? "";
    const hasPc = platforms.includes("PC");
    const consoles = consolePlatforms(platforms);
    if (!hasPc && consoles.length === 0) continue;
    if (typeof g?.title !== "string" || !g.title) continue;
    const image =
      (typeof g?.image === "string" && g.image) ||
      (typeof g?.thumbnail === "string" && g.thumbnail) ||
      "";
    if (!image) continue;
    const url =
      (typeof g?.open_giveaway_url === "string" && g.open_giveaway_url) ||
      "";
    if (!url) continue;
    // 標題去掉 Giveaway 後綴（GamerPower 標題自帶 "Giveaway"）。
    const title = g.title.replace(/\s*Giveaway\s*$/i, "").trim();
    const worth =
      typeof g?.worth === "string" && g.worth && g.worth !== "N/A"
        ? g.worth
        : null;
    // end_date 是 "YYYY-MM-DD HH:MM:SS" 或 "N/A"，當 UTC 解析；
    // 已過期的不顯示截止日（GamerPower 的 end_date 有時是舊值）。
    const endRaw =
      typeof g?.end_date === "string" && g.end_date !== "N/A"
        ? g.end_date
        : null;
    const endMs = endRaw
      ? Date.parse(endRaw.replace(" ", "T") + "Z")
      : NaN;
    const hasFutureEnd = Number.isFinite(endMs) && endMs > Date.now();
    // 截止日跟 Switch 牆一樣：顯示時間＋倒數（剩 X 小時／天），
    // 24 小時內設 endingSoon，卡片用琥珀色＋⚠ 警告。
    // endRaw 當 UTC 解析（轉成 ISO 再交給 saleEndLabel）。
    const endIso = hasFutureEnd ? endRaw!.replace(" ", "T") + "Z" : null;
    const deadline = endIso ? `免費領取至 ${saleEndLabel(endIso)}` : null;
    const endingSoon = endIso ? isSaleEndingSoon(endIso) : false;
    // 備註：DLC 標「DLC」；主機標「主機：PS5／XSX／Switch」；
    // 兩者都有就合併。放進 subLine（跟截止日合併顯示）。
    const noteParts: string[] = [];
    if (g?.type === "DLC") noteParts.push("DLC");
    if (consoles.length > 0)
      noteParts.push(`主機：${consoles.join("／")}`);
    const note = noteParts.join("・") || null;
    const subLine =
      deadline && note
        ? `${deadline} · ${note}`
        : (deadline ?? note);
    // 分類（篩選鈕用）：DLC 進 dlc／家機 DLC，完整遊戲進 pc／家機；
    // 跨平台同時進兩類（例如巫師 3 DLC 同時是 dlc 與 console-dlc）。
    const freeKinds: FreeKind[] = [];
    if (g?.type === "DLC") {
      if (hasPc) freeKinds.push("dlc");
      if (consoles.length > 0) freeKinds.push("console-dlc");
    } else {
      if (hasPc) freeKinds.push("pc");
      if (consoles.length > 0) freeKinds.push("console");
    }
    items.push({
      badge: "免費",
      endingSoon,
      freeKinds,
      image,
      key: `free-gamerpower-${g.id}`,
      priceLine: worth ? `原價 ${worth}` : "免費領取",
      sortKey: hasFutureEnd ? endMs : Number.MAX_SAFE_INTEGER,
      source: "gamerpower" as DealsCarouselSource,
      subLine,
      title,
      url,
    });
  }
  items.sort((a, b) => a.sortKey - b.sortKey);
  return items;
}

export interface FreeGamesData {
  current: DealsCarouselItem[];
  upcoming: DealsCarouselItem[];
  fetchedAt: string;
}

export async function fetchFreeGames(): Promise<FreeGamesData> {
  const nowMs = Date.now();
  const empty: FreeGamesData = {
    current: [],
    upcoming: [],
    fetchedAt: new Date(nowMs).toISOString(),
  };
  const [epicRes, gpRes] = await Promise.allSettled([
    fetchJson(EPIC_FREE_URL),
    fetchJson(GAMERPOWER_URL),
  ]);
  let epicCurrent: DealsCarouselItem[] = [];
  let epicUpcoming: DealsCarouselItem[] = [];
  if (epicRes.status === "fulfilled") {
    try {
      const parsed = parseEpic(epicRes.value, nowMs);
      epicCurrent = parsed.current;
      epicUpcoming = parsed.upcoming;
    } catch (e) {
      console.warn("[free-games] Epic 解析失敗：", e);
    }
  } else {
    console.warn("[free-games] Epic API 失敗：", epicRes.reason);
  }
  let gpItems: DealsCarouselItem[] = [];
  if (gpRes.status === "fulfilled") {
    try {
      gpItems = parseGamerPower(gpRes.value);
    } catch (e) {
      console.warn("[free-games] GamerPower 解析失敗：", e);
    }
  } else {
    console.warn("[free-games] GamerPower API 失敗：", gpRes.reason);
  }
  // 去重：同一款同時在 Epic 與 GamerPower 出現時只留 Epic 官方那筆。
  const epicTitles = new Set(
    [...epicCurrent, ...epicUpcoming].map((it) => normTitle(it.title))
  );
  const dedupedGp = gpItems.filter(
    (it) => !epicTitles.has(normTitle(it.title))
  );
  const current = [...epicCurrent, ...dedupedGp].sort(
    (a, b) => a.sortKey - b.sortKey
  );
  return { current, upcoming: epicUpcoming, fetchedAt: empty.fetchedAt };
}
