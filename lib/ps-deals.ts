// ============================================================================
// PS 家機特價（/console 家機頁）：伺服器端抓取（不需金鑰、不需登入）。
// 2026-11-23 上線。官方優惠清單的來源終於打通——不是之前卡住的 EMS
// 查詢（getDefaultView，hash 未知），而是同一支 GraphQL 的另一個
// persisted 操作 categoryGridRetrieve，hash 是公開文件裡的
//   mrt1m/playstation-store-api 的 OperationSha256Enum::categoryGridRetrieve
//   4ce7d410a4db2c8b635a48c1dcec375906ff63b19dadd87e073f8fd0c0481d35
// （README 舊範例的 9845afc0... 實測也通，但以 enum 的新值為準）。
// ----------------------------------------------------------------------------
// 抓法（2026-11-23 實測台灣區都通）：
//   GET https://web.np.playstation.com/api/graphql/v1/op
//     ?operationName=categoryGridRetrieve
//     &variables={"id":"<分類>","pageArgs":{"size":24,"offset":N},
//       "sortBy":{"name":"productReleaseDate","isAscending":false},
//       "filterBy":[],"facetOptions":[]}
//     &extensions={"persistedQuery":{"version":1,"sha256Hash":"<上>"}}
//   標頭：Accept/Content-Type application/json、
//   apollo-require-preflight: true、x-apollo-operation-name，
//   加瀏覽器 UA＋Referer/Origin（沒加 preflight 標頭會被擋 CSRF）。
//   兩個特價分類都抓（同一份 enum 裡的兩個 deals 分類）：
//     SALES  803cee19-e5a1-4d59-a463-0b6b2701bf7c（AllDeals，總數 210）
//     OFFERS 16b8d09a-d0e3-44e3-96cb-a3b2a21b6d69（Deals group A，總數 150）
//   兩個分類裡「目前真的有折扣」的才列（discountedPrice < basePrice）——
//   分類裡大半品項當下其實沒折扣（原價＝特價），不篩會列出一堆沒特價的。
//   2026-11-23 實測：SALES 210 款裡 30 款有折扣、OFFERS 150 款裡 23 款，
//   聯集去重後 44 款（目前沒大檔期，數量就是這麼少，不是 bug；
//   黑五前後再看會不會變多）。PS5 遊戲也在內（PS4/PS5 混著列）。
// 價格：回傳的 price 是字串「NT$1,790」，basePrice／discountedPrice／
//   discountText（「-80%」）都有；折扣％自己用原價／特價算。
//   動態定價驗證（2026-11-23）：抽 2 款對照未登入商店產品頁內嵌價——
//   Monster Harvest NT$590→59、Saints Row NT$890→133，
//   originalPriceValue／discountPriceValue（分）完全一致。
// 名稱：回傳的 name 尾巴常帶語言清單，如「 (日语, 简体中文, 繁体中文, 英语)」
//   或「 (中日英韩文版)」——顯示前去掉（只去語言清單，不動其他括號）。
//   PS4／PS5 兩個版本名字相同時去重（留折扣最大、再留特價最低的）。
// 圖片：media 裡挑 FOUR_BY_THREE_BANNER（橫圖），沒有退 BACKGROUND、
//   再退 MASTER；都是 image.api.playstation.com 官方 CDN。
//   連結：https://store.playstation.com/zh-hant-tw/product/<id>。
//   沒有特價截止日（grid 回傳沒有 endDate），subLine 放平台（PS4 · PS5）。
// 快取：呼叫端用 lib/cached-data.ts 的 unstable_cache 包一層（1 小時），
// 頁面每次載入不直接打 Sony API。任一段失敗回空陣列、該分頁不顯示。
// 注意：總數會隨檔期浮動（目前 44 款），頁面顯示「台灣區共 N 款特價」
//   時 N 就是當下真的有折扣的款數，不是分類總數。
// ============================================================================

import type { DealsCarouselItem } from "./deals-carousel";

export interface PsDealsData {
  items: DealsCarouselItem[];
  /** 抓取時間（ISO），除錯／快取觀察用。 */
  fetchedAt: string;
  /** 目前真的有折扣的款數（SALES＋OFFERS 聯集去重後）。 */
  totalCount: number;
  /** 本次列出的款數。 */
  shownCount: number;
}

const ENDPOINT = "https://web.np.playstation.com/api/graphql/v1/op";
const OPERATION = "categoryGridRetrieve";
/** mrt1m/playstation-store-api OperationSha256Enum::categoryGridRetrieve。 */
const HASH =
  "4ce7d410a4db2c8b635a48c1dcec375906ff63b19dadd87e073f8fd0c0481d35";
/** 兩個特價分類（同一個公開 enum 裡的 SALES／OFFERS）。 */
const CATEGORIES = [
  "803cee19-e5a1-4d59-a463-0b6b2701bf7c", // SALES（AllDeals）
  "16b8d09a-d0e3-44e3-96cb-a3b2a21b6d69", // OFFERS（Deals group A）
];
const PAGE_SIZE = 24;
const MAX_ITEMS = 200;
const CONCURRENCY = 3;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          "Accept-Language": "zh-Hant-TW,zh;q=0.9,en;q=0.8",
          Referer: "https://store.playstation.com/zh-hant-tw/pages/deals",
          Origin: "https://store.playstation.com",
          "apollo-require-preflight": "true",
          "x-apollo-operation-name": OPERATION,
        },
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

function gridUrl(categoryId: string, offset: number): string {
  const variables = {
    id: categoryId,
    pageArgs: { size: PAGE_SIZE, offset },
    sortBy: { name: "productReleaseDate", isAscending: false },
    filterBy: [],
    facetOptions: [],
  };
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: HASH },
  };
  const q = new URLSearchParams({
    operationName: OPERATION,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify(extensions),
  });
  return `${ENDPOINT}?${q.toString()}`;
}

/** 「NT$1,790」→ 1790；「內含」這類非價格字串回 null。 */
function parseTwd(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = s.match(/([\d,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatTwd(amount: number): string {
  return `NT$ ${Math.round(amount).toLocaleString("zh-Hant-TW")}`;
}

const LANG_TOKENS = [
  "日语",
  "韩语",
  "简体中文",
  "繁体中文",
  "英语",
  "中文",
  "文版",
];

/** 去掉名稱尾巴的語言清單，如「 (日语, 简体中文, 繁体中文, 英语)」。 */
function cleanName(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (m && LANG_TOKENS.some((t) => m[2].includes(t))) return m[1].trim();
  return name;
}

interface GridMedia {
  role?: string;
  type?: string;
  url?: string;
}

interface GridProduct {
  id?: string;
  name?: string;
  platforms?: string[];
  storeDisplayClassification?: string;
  media?: GridMedia[];
  price?: {
    basePrice?: string;
    discountedPrice?: string;
    discountText?: string | null;
  };
}

interface GridResponse {
  data?: {
    categoryGridRetrieve?: {
      pageInfo?: { isLast?: boolean; totalCount?: number };
      products?: GridProduct[];
    };
  };
}

function pickImage(media: GridMedia[] | undefined): string | null {
  if (!Array.isArray(media)) return null;
  for (const role of ["FOUR_BY_THREE_BANNER", "BACKGROUND", "MASTER"]) {
    const found = media.find(
      (m) => m.role === role && m.type === "IMAGE" && m.url
    );
    if (found?.url) return found.url;
  }
  return null;
}

function toItem(p: GridProduct): DealsCarouselItem | null {
  const id = p.id;
  const rawName = p.name;
  if (!id || !rawName) return null;
  const base = parseTwd(p.price?.basePrice);
  const disc = parseTwd(p.price?.discountedPrice);
  if (base === null || disc === null || disc >= base) return null;
  const image = pickImage(p.media);
  if (!image) return null;
  const title = cleanName(rawName);
  const discount = Math.round((1 - disc / base) * 100);
  if (discount <= 0) return null;
  const platforms = (p.platforms ?? []).filter(Boolean);
  return {
    source: "ps",
    key: `ps-${id}`,
    title,
    image,
    url: `https://store.playstation.com/zh-hant-tw/product/${id}`,
    badge: `-${discount}%`,
    priceLine: `${formatTwd(disc)}（原價 ${formatTwd(base)}）`,
    subLine: platforms.length > 0 ? platforms.join(" · ") : null,
    sortKey: discount,
  };
}

async function fetchCategory(categoryId: string): Promise<GridProduct[]> {
  const first = (await fetchJson(gridUrl(categoryId, 0))) as GridResponse;
  const grid = first.data?.categoryGridRetrieve;
  const products = [...(grid?.products ?? [])];
  const total = grid?.pageInfo?.totalCount ?? products.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (grid?.pageInfo?.isLast || pages <= 1) return products;
  const offsets: number[] = [];
  for (let i = 1; i < pages; i++) offsets.push(i * PAGE_SIZE);
  for (let i = 0; i < offsets.length; i += CONCURRENCY) {
    const chunk = offsets.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (offset) => {
        const d = (await fetchJson(gridUrl(categoryId, offset))) as GridResponse;
        return d.data?.categoryGridRetrieve?.products ?? [];
      })
    );
    for (const s of settled) {
      if (s.status === "fulfilled") products.push(...s.value);
      else console.warn("[ps-deals] 分類其中一頁失敗：", s.reason);
    }
  }
  return products;
}

/** 抓台灣 PS 特價（SALES＋OFFERS 聯集、目前有折扣的，折扣大→小，前 200 款）。 */
export async function fetchPsDeals(): Promise<PsDealsData> {
  const nowMs = Date.now();
  const empty: PsDealsData = {
    items: [],
    fetchedAt: new Date(nowMs).toISOString(),
    totalCount: 0,
    shownCount: 0,
  };
  let products: GridProduct[] = [];
  try {
    const settled = await Promise.allSettled(
      CATEGORIES.map((c) => fetchCategory(c))
    );
    for (const s of settled) {
      if (s.status === "fulfilled") products.push(...s.value);
      else console.warn("[ps-deals] 其中一個分類失敗：", s.reason);
    }
  } catch (e) {
    console.warn("[ps-deals] 特價分類抓取失敗：", e);
    return empty;
  }
  // 同名去重（PS4／PS5 版）：留折扣最大、再留特價最低的。
  const byName = new Map<string, { item: DealsCarouselItem; disc: number }>();
  for (const p of products) {
    const item = toItem(p);
    if (!item) continue;
    const disc = parseTwd(p.price?.discountedPrice);
    if (disc === null) continue;
    const key = item.title.toLowerCase();
    const prev = byName.get(key);
    if (
      !prev ||
      item.sortKey > prev.item.sortKey ||
      (item.sortKey === prev.item.sortKey && disc < prev.disc)
    ) {
      byName.set(key, { item, disc });
    }
  }
  const items = [...byName.values()]
    .map((v) => v.item)
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, MAX_ITEMS);
  return {
    items,
    fetchedAt: new Date(nowMs).toISOString(),
    totalCount: items.length,
    shownCount: items.length,
  };
}
