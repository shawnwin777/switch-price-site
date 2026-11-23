// ============================================================================
// Xbox PC 特價（/deals 下方區塊）：伺服器端抓取（不需金鑰）。
// ----------------------------------------------------------------------------
// 兩段式（2026-11-23 實測台灣區都通）：
//   1. 清單：GET https://apps.microsoft.com/api/Reco/GetComputedProductsList
//        ?gl=TW&hl=zh-Hant-TW&listName=Deal&pgNo=1&noItems=100
//        &filteredCategories=AllProducts&mediaType=games
//      → 台灣 PC 商店特價清單的 productId（productsList[].productId）。
//      實測 totalCount 約 500 款；這裡取第 1–4 頁（共 400 個 id），
//      折扣大→小取前 350 款，頁面註明總數並連去微軟商店看完整清單
//      （一次抓 500 款太重）。
//   2. 補資料：GET https://displaycatalog.mp.microsoft.com/v7.0/products
//        ?market=TW&languages=zh-Hant&bigIds=<id,...>&MS-CV=<值>
//      → 標題、圖片、台幣價。MS-CV 值裡的 + 一定要 URL-encode（%2B），否則 400。
//      價格在 DisplaySkuAvailabilities[].Availabilities[].OrderManagementData.Price：
//      MSRP vs ListPrice 算折扣％，特價結束看 Conditions.EndDate。
//      只留 CurrencyCode=TWD 且 ListPrice < MSRP 的購買選項（取最低價那個）；
//      Game Pass 等 0 元／非台幣選項不算。
// 只列 Windows.Desktop（PC）；Play Anywhere 同時有 Windows.Xbox 的也算
// （本來就是 PC 遊戲）。圖片優先 16:9 的 TitledHeroArt／SuperHeroArt，
// 沒有才用 Screenshot／BoxArt。連結用 apps.microsoft.com/detail/<id>（免 slug）。
// 快取：呼叫端用 lib/cached-data.ts 的 unstable_cache 包一層（1 小時），
// 頁面每次載入不直接打 Microsoft API。任一段失敗回空陣列、該區塊顯示空狀態。
// ============================================================================

import type { DealsCarouselItem } from "./deals-carousel";

export interface XboxPcDealsData {
  items: DealsCarouselItem[];
  /** 抓取時間（ISO），除錯／快取觀察用。 */
  fetchedAt: string;
  /** 台灣 PC 商店特價總數（清單 API 的 totalCount）。 */
  totalCount: number;
  /** 本次列出的款數。 */
  shownCount: number;
}

const LIST_BASE =
  "https://apps.microsoft.com/api/Reco/GetComputedProductsList" +
  "?gl=TW&hl=zh-Hant-TW&listName=Deal" +
  "&filteredCategories=AllProducts&mediaType=games";
/** 清單取前 400 個 id（4 頁 × 100），折扣大→小取前 350 款
 *  （2026-11-23 從 200 改成 350）；補資料每批 50 個 id、最多 3 批並行
 *  （20 款約 1 MB，50 款一批約 2.5 MB；8 批跑約數秒，在 60 秒內）。 */
const LIST_PAGES = 4;
/** 本分頁列出的上限款數（折扣大→小）。 */
const TOP_COUNT = 350;
const LIST_PAGE_SIZE = 100;
const CATALOG_BATCH_SIZE = 50;
const CATALOG_CONCURRENCY = 3;
const CATALOG_URL = "https://displaycatalog.mp.microsoft.com/v7.0/products";
/** Display Catalog 要求的 MS-CV（固定值；+ 必須 URL-encode，見上方說明）。 */
const MS_CV = "DGU1mcuYo0WMMp+F.1";

const USER_AGENT = "switch-price-site-xbox-deals/1.0";

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

function formatTwd(amount: number): string {
  return `NT$ ${Math.round(amount).toLocaleString("zh-Hant-TW")}`;
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
  Conditions?: { EndDate?: string };
  OrderManagementData?: {
    Price?: {
      MSRP?: number;
      ListPrice?: number;
      CurrencyCode?: string;
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
  const hero =
    byPurpose("TitledHeroArt") ?? byPurpose("SuperHeroArt");
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

function parseProducts(data: unknown): DealsCarouselItem[] {
  const root = data as { Products?: CatalogProduct[] } | null;
  const products = Array.isArray(root?.Products) ? root!.Products! : [];
  const items: DealsCarouselItem[] = [];
  for (const p of products) {
    const id = p.ProductId;
    const props = p.LocalizedProperties?.[0];
    const title = props?.ProductTitle;
    if (!id || !title) continue;
    // 只列 PC（Windows.Desktop）；Play Anywhere 同時有 Xbox 的也算。
    const firstAvail =
      p.DisplaySkuAvailabilities?.[0]?.Availabilities?.[0];
    const platforms =
      (
        firstAvail as unknown as {
          Conditions?: {
            ClientConditions?: {
              AllowedPlatforms?: { PlatformName?: string }[];
            };
          };
        }
      )?.Conditions?.ClientConditions?.AllowedPlatforms?.map(
        (x) => x.PlatformName
      ) ?? [];
    if (!platforms.includes("Windows.Desktop")) continue;
    // 全部購買選項裡找台幣、有折扣、最低價的那個。
    let best: {
      msrp: number;
      list: number;
      end: string | null;
    } | null = null;
    for (const sku of p.DisplaySkuAvailabilities ?? []) {
      for (const av of sku.Availabilities ?? []) {
        const price = av.OrderManagementData?.Price;
        const msrp = price?.MSRP;
        const list = price?.ListPrice;
        if (
          price?.CurrencyCode !== "TWD" ||
          typeof msrp !== "number" ||
          typeof list !== "number" ||
          msrp <= 0 ||
          list <= 0 ||
          list >= msrp
        )
          continue;
        if (!best || list < best.list) {
          best = { msrp, list, end: av.Conditions?.EndDate ?? null };
        }
      }
    }
    if (!best) continue;
    const image = pickImage(props?.Images);
    if (!image) continue;
    const discount = Math.round((1 - best.list / best.msrp) * 100);
    if (discount <= 0) continue;
    const end = formatTaipeiDate(best.end);
    items.push({
      source: "xbox",
      key: `xbox-${id}`,
      title,
      image,
      url: `https://apps.microsoft.com/detail/${id}?hl=zh-Hant&gl=TW`,
      badge: `-${discount}%`,
      priceLine: `${formatTwd(best.list)}（原價 ${formatTwd(best.msrp)}）`,
      subLine: end ? `特價至 ${end}` : null,
      sortKey: discount,
    });
  }
  // 折扣大→小。
  items.sort((a, b) => b.sortKey - a.sortKey);
  return items;
}

/** 抓台灣 PC 商店特價（前 350 款，折扣大→小）。單一環節失敗回空。 */
export async function fetchXboxPcDeals(): Promise<XboxPcDealsData> {
  const nowMs = Date.now();
  const empty: XboxPcDealsData = {
    items: [],
    fetchedAt: new Date(nowMs).toISOString(),
    totalCount: 0,
    shownCount: 0,
  };
  let ids: string[] = [];
  let totalCount = 0;
  try {
    const pages = await Promise.allSettled(
      Array.from({ length: LIST_PAGES }, (_, i) =>
        fetchJson(
          `${LIST_BASE}&pgNo=${i + 1}&noItems=${LIST_PAGE_SIZE}`
        )
      )
    );
    for (const p of pages) {
      if (p.status !== "fulfilled") continue;
      const list = p.value as {
        productsList?: { productId?: string }[];
        totalCount?: number;
      };
      totalCount = totalCount || list.totalCount || 0;
      for (const prod of list.productsList ?? []) {
        if (typeof prod.productId === "string" && prod.productId) {
          ids.push(prod.productId);
        }
      }
    }
    ids = [...new Set(ids)].slice(0, LIST_PAGES * LIST_PAGE_SIZE);
  } catch (e) {
    console.warn("[xbox-deals] 特價清單抓取失敗：", e);
    return empty;
  }
  if (ids.length === 0) return { ...empty, totalCount };
  // 補資料：每批 50 個 id，最多 3 批並行。
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += CATALOG_BATCH_SIZE) {
    batches.push(ids.slice(i, i + CATALOG_BATCH_SIZE));
  }
  let items: DealsCarouselItem[] = [];
  try {
    const results: DealsCarouselItem[][] = [];
    for (let i = 0; i < batches.length; i += CATALOG_CONCURRENCY) {
      const chunk = batches.slice(i, i + CATALOG_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async (batch) => {
          const url =
            `${CATALOG_URL}?market=TW&languages=zh-Hant` +
            `&bigIds=${encodeURIComponent(batch.join(","))}` +
            `&MS-CV=${encodeURIComponent(MS_CV)}`;
          return parseProducts(await fetchJson(url));
        })
      );
      for (const s of settled) {
        if (s.status === "fulfilled") results.push(s.value);
        else console.warn("[xbox-deals] Display Catalog 其中一批失敗：", s.reason);
      }
    }
    const seen = new Set<string>();
    items = results
      .flat()
      .filter((it) => {
        if (seen.has(it.key)) return false;
        seen.add(it.key);
        return true;
      })
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, TOP_COUNT);
  } catch (e) {
    console.warn("[xbox-deals] Display Catalog 補資料失敗：", e);
    return { ...empty, totalCount };
  }
  return {
    items,
    fetchedAt: new Date(nowMs).toISOString(),
    totalCount,
    shownCount: items.length,
  };
}
