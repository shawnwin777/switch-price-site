// ============================================================================
// Game Pass 最近新增（/deals PC 分頁、/console 家機分頁）：伺服器端抓取
// （不需金鑰）。2026-11-23 上線。
// ----------------------------------------------------------------------------
// 兩段式（2026-11-23 實測台灣區都通）：
//   1. 清單：GET https://catalog.gamepass.com/sigls/v3
//        ?id=06323672-b8c8-43cc-b0de-32d5a9834749
//        &language=zh-tw&market=TW
//        &platformContext=ConsoleGen8;ConsoleGen9（家機）或 pc（PC）
//        &subscriptionContext=cfq7ttc0khs0（Ultimate）
//      → xbox.com 最近新增清單（xgpcatPopulate-2025.js 拆出的參數；
//        這個分類 UUID 是「recentlyadded」，console/pc 用同一個 id、
//        只差 platformContext；subscriptionContext 用 Ultimate，
//        它的最近新增是全方案裡最廣的）。
//      回傳是陣列：第 0 個是清單本身 {siglId, title: "最近新增",
//      description}，第 1 個起是 {id}（productId，可直接餵 Display Catalog）。
//      實測：家機 31 款、PC 33 款。注意：sigls 回傳沒有逐款加入日期，
//      所以卡片標「新進」、分頁標「本期／近期新增」，不寫具體日期。
//      參數寫法（之前踩過的坑）：id 只放 UUID（不要加 ,console,ultimate
//      後綴，否則 400）；platformContext 是 ConsoleGen8;ConsoleGen9 或
//      pc（不是 "console"）；subscriptionContext 是 cfq7ttc0khs0
//      （不是佔位字 GP_BIGID）。
//   2. 補資料：GET https://displaycatalog.mp.microsoft.com/v7.0/products
//        ?market=TW&languages=zh-Hant&bigIds=<id,...>&MS-CV=<值>
//      → 標題、圖片、平台（跟 Xbox 特價同一條管線，見 lib/xbox-deals.ts；
//        MS-CV 值裡的 + 一定要 URL-encode，否則 400）。
//      只留對應平台（PC 驗 Windows.Desktop、家機驗 Windows.Xbox）；
//      Play Anywhere 同時有兩個平台的，副行寫「家機 · PC」。
// 卡片：badge「新進」（不是折扣％）、priceLine「Game Pass 訂閱包含」
//   （新進遊戲沒有價格，訂閱內含）；順序維持官方清單順序，不重排。
// 快取：呼叫端用 lib/cached-data.ts 的 unstable_cache 包一層（1 小時），
// 頁面每次載入不直接打 Microsoft API。任一段失敗回空陣列、該分頁不顯示。
// ============================================================================

import type { DealsCarouselItem } from "./deals-carousel";

export interface GamePassNewData {
  items: DealsCarouselItem[];
  /** 抓取時間（ISO），除錯／快取觀察用。 */
  fetchedAt: string;
  /** sigls 清單的款數（去重後、平台篩選前）。 */
  totalCount: number;
  /** 本次列出的款數。 */
  shownCount: number;
}

export type GamePassPlatform = "console" | "pc";

/** xbox.com 最近新增分類（recentlyadded，console／pc 共用同一個 id）。 */
const RECENTLY_ADDED_ID = "06323672-b8c8-43cc-b0de-32d5a9834749";
/** Game Pass Ultimate 的 subscriptionContext（全方案裡最近新增最廣的）。 */
const ULTIMATE_CONTEXT = "cfq7ttc0khs0";
const SIGLS_BASE = "https://catalog.gamepass.com/sigls/v3";

const PLATFORM_CONTEXT: Record<GamePassPlatform, string> = {
  console: "ConsoleGen8;ConsoleGen9",
  pc: "pc",
};

const CATALOG_URL = "https://displaycatalog.mp.microsoft.com/v7.0/products";
/** Display Catalog 要求的 MS-CV（固定值；+ 必須 URL-encode，見上方說明）。 */
const MS_CV = "DGU1mcuYo0WMMp+F.1";
/** Display Catalog 一批最多 50 個 id（跟 Xbox 特價同一批大小）。 */
const CATALOG_BATCH_SIZE = 50;

const USER_AGENT = "switch-price-site-gamepass-new/1.0";

/** 單一來源失敗不拋錯到上層；偶爾瞬斷時重試一次（間隔 500ms）。 */
async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20000),
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

function toHttps(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith("//")) return `https:${uri}`;
  if (uri.startsWith("https://")) return uri;
  return null;
}

interface CatalogImage {
  ImagePurpose?: string;
  Uri?: string;
  Width?: number;
}

interface CatalogAvailability {
  Conditions?: {
    ClientConditions?: {
      AllowedPlatforms?: { PlatformName?: string }[];
    };
  };
}

interface CatalogProduct {
  ProductId?: string;
  LocalizedProperties?: {
    ProductTitle?: string;
    Images?: CatalogImage[];
  }[];
  DisplaySkuAvailabilities?: {
    Availabilities?: CatalogAvailability[];
  }[];
}

function pickImage(images: CatalogImage[] | undefined): string | null {
  if (!Array.isArray(images)) return null;
  const byPurpose = (purpose: string) =>
    images.find((i) => i.ImagePurpose === purpose);
  // 16:9 優先（卡片是 16:9），再退到截圖、最後盒裝圖（方形）。
  const hero = byPurpose("TitledHeroArt") ?? byPurpose("SuperHeroArt");
  if (hero) {
    const uri = toHttps(hero.Uri);
    if (uri) return uri;
  }
  const shot = images.find(
    (i) => i.ImagePurpose === "Screenshot" && (i.Width ?? 0) >= 1920
  );
  if (shot) {
    const uri = toHttps(shot.Uri);
    if (uri) return uri;
  }
  const box = byPurpose("BoxArt");
  if (box) {
    const uri = toHttps(box.Uri);
    if (uri) return uri;
  }
  return null;
}

function platformsOf(p: CatalogProduct): string[] {
  const set = new Set<string>();
  for (const sku of p.DisplaySkuAvailabilities ?? []) {
    for (const av of sku.Availabilities ?? []) {
      for (const plat of av.Conditions?.ClientConditions?.AllowedPlatforms ??
        []) {
        if (plat.PlatformName) set.add(plat.PlatformName);
      }
    }
  }
  return [...set];
}

/** sigls 回傳：[0] 是清單本身，[1..] 是 {id}。 */
function parseSigls(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const entry of data.slice(1)) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id) ids.push(id);
  }
  return [...new Set(ids)];
}

/** 抓 Game Pass 最近新增（家機或 PC，官方清單順序、Ultimate 方案）。
 *  單一環節失敗回空。 */
export async function fetchGamePassNew(
  platform: GamePassPlatform
): Promise<GamePassNewData> {
  const nowMs = Date.now();
  const empty: GamePassNewData = {
    items: [],
    fetchedAt: new Date(nowMs).toISOString(),
    totalCount: 0,
    shownCount: 0,
  };
  let ids: string[] = [];
  try {
    const q = new URLSearchParams({
      id: RECENTLY_ADDED_ID,
      language: "zh-tw",
      market: "TW",
      platformContext: PLATFORM_CONTEXT[platform],
      subscriptionContext: ULTIMATE_CONTEXT,
    });
    const data = await fetchJson(`${SIGLS_BASE}?${q.toString()}`);
    ids = parseSigls(data);
  } catch (e) {
    console.warn("[gamepass-new] sigls 最近新增清單抓取失敗：", e);
    return empty;
  }
  if (ids.length === 0) return empty;
  const totalCount = ids.length;
  // 補資料：每批 50 個 id。
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += CATALOG_BATCH_SIZE) {
    batches.push(ids.slice(i, i + CATALOG_BATCH_SIZE));
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  const items: DealsCarouselItem[] = [];
  try {
    for (const batch of batches) {
      const url =
        `${CATALOG_URL}?market=TW&languages=zh-Hant` +
        `&bigIds=${encodeURIComponent(batch.join(","))}` +
        `&MS-CV=${encodeURIComponent(MS_CV)}`;
      const data = (await fetchJson(url)) as {
        Products?: CatalogProduct[];
      } | null;
      for (const p of data?.Products ?? []) {
        const id = p.ProductId;
        const title = p.LocalizedProperties?.[0]?.ProductTitle;
        if (!id || !title) continue;
        const platforms = platformsOf(p);
        // 只留對應平台（PC：Windows.Desktop；家機：Windows.Xbox）。
        const wanted =
          platform === "pc" ? "Windows.Desktop" : "Windows.Xbox";
        if (!platforms.includes(wanted)) continue;
        const image = pickImage(p.LocalizedProperties?.[0]?.Images);
        if (!image) continue;
        const isDesktop = platforms.includes("Windows.Desktop");
        const isXbox = platforms.includes("Windows.Xbox");
        const subLine =
          isDesktop && isXbox ? "家機 · PC" : isXbox ? "家機" : "PC";
        items.push({
          source: "xbox",
          key: `gp-${platform}-${id}`,
          title,
          image,
          url: `https://apps.microsoft.com/detail/${id}?hl=zh-Hant&gl=TW`,
          badge: "新進",
          priceLine: "Game Pass 訂閱包含",
          subLine,
          // 維持官方清單順序（sortKey 越大越前）。
          sortKey: totalCount - (order.get(id) ?? 0),
        });
      }
    }
  } catch (e) {
    console.warn("[gamepass-new] Display Catalog 補資料失敗：", e);
    return { ...empty, totalCount };
  }
  // 去重（同一款多個 SKU 時留第一個），維持官方順序。
  const seen = new Set<string>();
  const deduped = items.filter((it) => {
    if (seen.has(it.key)) return false;
    seen.add(it.key);
    return true;
  });
  deduped.sort((a, b) => b.sortKey - a.sortKey);
  return {
    items: deduped,
    fetchedAt: new Date(nowMs).toISOString(),
    totalCount,
    shownCount: deduped.length,
  };
}
