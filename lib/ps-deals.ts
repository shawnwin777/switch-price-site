// ============================================================================
// PS 家機特價（/console 家機頁）：伺服器端抓取（不需金鑰、不需登入）。
// 2026-11-23 上線。官方優惠清單的來源——不是之前卡住的 EMS
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
//       "sortBy":{"name":"sales30","isAscending":false},
//       "filterBy":[],"facetOptions":[]}
//     &extensions={"persistedQuery":{"version":1,"sha256Hash":"<上>"}}
//   標頭：Accept/Content-Type application/json、
//   apollo-require-preflight: true、x-apollo-operation-name，
//   加誠實 UA（shawn-game-studio/1.0，不偽裝瀏覽器）＋
//   X-PSN-Store-Locale-Override: zh-hant-tw（沒加這個回簡體標題；
//   Accept-Language 沒用，API 不理它），不送 Referer／Origin
//   （2026-11-23 實測：誠實 UA、無 Referer／Origin 照樣通，
//   標題回繁中；沒加 preflight 標頭會被擋 CSRF）。
//   分類：優惠頁「所有優惠」→「檢視全部」的分類
//     3f772501-f6f8-49b7-abac-874a88ca4897
//     （瀏覽器實測抓到的分類頁網址裡的 ID；pageInfo.totalCount = 2862，
//     注意 totalCount 在 pageInfo 裡，不在頂層）。
//   舊做法（SALES 803cee19…＋OFFERS 16b8d09a… 兩個小分類，聯集去重後
//   只有 44 款）已棄用——那兩個分類不是完整優惠清單。
//   關鍵：這個分類不是預先篩過折扣的——按發售日倒序（productReleaseDate）
//   第 1 頁 24 款裡 0 款有折扣（都是剛上市的原價遊戲）；改用
//   sortBy sales30（30 天銷量倒序）後，每頁幾乎全是有折扣的
//   （2026-11-23 實測：offset 0～2800 抽 9 頁，每頁 19～24 款有折扣，
//   其中 10～19 款折扣 ≥50%）。該操作沒有折扣排序（排序只有
//   default／sales30／downloads30／productName／productReleaseDate／
//   webBasePrice），也沒有折扣篩選——所以分段抓＋程式端篩選。
//   做法：sales30 倒序，每批 3 頁並行，抓到 1621 款折扣 ≥50%（去重後）
//   就停，最多掃 130 頁（3120 款；2026-11-23 實測 200 款要掃 16 頁，
//   510 款約 35–40 頁，900 款約 65–70 頁，1621 款約 120 頁。實測每頁約
//   0.5～1 秒，整輪約 25 秒，掃滿 130 頁約 35 秒，仍在 Vercel 60 秒上限內）。
//   只列折扣 ≥50% 的（shawn：大致上抓到 -50% 就好），折扣大→小、前 1621 款。
//   2026-11-24 教訓：Vercel 上兩輪掃描都停在 90 頁（offset 2160 之後的頁面
//   回空陣列／失敗，live 只收到 1,378 款；同一時間本機全掃 120 頁都通、
//   1,621 款），疑似 Sony 限流 Vercel 出口 IP——所以空頁／失敗頁要重掃
//   （見 fetchPsDeals 尾段的重掃迴圈，隔 2 秒、5 秒各一次）。
// 價格：回傳的 price 是字串「NT$1,790」，basePrice／discountedPrice／
//   discountText（「-80%」）都有；折扣％自己用原價／特價算。
//   動態定價驗證（2026-11-23）：抽 2 款對照未登入商店產品頁驗證過：
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
// 注意：總數會隨檔期浮動（2026-11-23 實測 2,862 款），頁面顯示
//   「台灣區共 N 款特價」時 N 是優惠分類總數，不是本頁列出的 1621 款。
// ============================================================================

import type { DealsCarouselItem } from "./deals-carousel";

export interface PsDealsData {
  items: DealsCarouselItem[];
  /** 抓取時間（ISO），除錯／快取觀察用。 */
  fetchedAt: string;
  /** 優惠分類總數（pageInfo.totalCount，2026-11-23 實測 2,862）。 */
  totalCount: number;
  /** 本次列出的款數（折扣 ≥50%、去重後，前 1621 款）。 */
  shownCount: number;
}

const ENDPOINT = "https://web.np.playstation.com/api/graphql/v1/op";
const OPERATION = "categoryGridRetrieve";
/** mrt1m/playstation-store-api OperationSha256Enum::categoryGridRetrieve。 */
const HASH =
  "4ce7d410a4db2c8b635a48c1dcec375906ff63b19dadd87e073f8fd0c0481d35";
/** 優惠頁「所有優惠」→「檢視全部」的分類（瀏覽器實測抓到的 ID）。 */
const CATEGORY = "3f772501-f6f8-49b7-abac-874a88ca4897";
const PAGE_SIZE = 24;
/** 只列折扣 ≥50% 的（shawn：大致上抓到 -50% 就好）。 */
const MIN_DISCOUNT = 50;
const MAX_ITEMS = 1621;
/** DLC 額外上限（本體優先：本體先抓滿 1621，再加 DLC 最多 300；
 *  2026-11-26 使用者原則：本體是優先、DLC 是額外 300–500）。 */
const MAX_DLC_COUNT = 300;
/** 最多掃 130 頁（3120 款）；抓滿 1621 款 ≥50% 就提前停。 */
const MAX_PAGES = 90;
const CONCURRENCY = 3;

/** 誠實 UA（2026-11-23 L-2：不偽裝瀏覽器；實測無 Referer／Origin 照樣通）。 */
const USER_AGENT = "shawn-game-studio/1.0";

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
          "X-PSN-Store-Locale-Override": "zh-hant-tw",
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

function gridUrl(offset: number): string {
  const variables = {
    id: CATEGORY,
    pageArgs: { size: PAGE_SIZE, offset },
    // sales30 倒序：每頁幾乎全是有折扣的（發售日倒序第 1 頁 0 款有折扣）。
    sortBy: { name: "sales30", isAscending: false },
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
  // 只列折扣 ≥50% 的。
  if (discount < MIN_DISCOUNT) return null;
  const platforms = (p.platforms ?? []).filter(Boolean);
  // 本體／DLC 分類（Sony 官方 storeDisplayClassification 欄位，
  // 2026-11-26 實測值：FULL_GAME／PREMIUM_EDITION／GAME_BUNDLE＝本體，
  // ADD_ON_PACK／SEASON_PASS／VIRTUAL_CURRENCY＝DLC；其他值一律算本體）。
  const kind: "game" | "dlc" =
    p.storeDisplayClassification === "ADD_ON_PACK" ||
    p.storeDisplayClassification === "SEASON_PASS" ||
    p.storeDisplayClassification === "VIRTUAL_CURRENCY"
      ? "dlc"
      : "game";
  return {
    source: "ps",
    key: `ps-${id}`,
    title,
    image,
    url: `https://store.playstation.com/zh-hant-tw/product/${id}`,
    badge: `-${discount}%`,
    priceLine: `${formatTwd(disc)}（原價 ${formatTwd(base)}）`,
    subLine: platforms.length > 0 ? platforms.join(" · ") : null,
    kind,
    sortKey: discount,
  };
}

/** 抓台灣 PS 優惠分類（sales30 倒序、分段抓、只留折扣 ≥50%、折扣大→小；
 *  本體優先取前 1621，再加 DLC 前 300（額外））。 */
export async function fetchPsDeals(): Promise<PsDealsData> {
  const nowMs = Date.now();
  const empty: PsDealsData = {
    items: [],
    fetchedAt: new Date(nowMs).toISOString(),
    totalCount: 0,
    shownCount: 0,
  };
  // 同名去重（PS4／PS5 版）：留折扣最大、再留特價最低的。
  const byName = new Map<string, { item: DealsCarouselItem; disc: number }>();
  const addProducts = (products: GridProduct[]) => {
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
  };

  let totalCount = 0;
  // 本體／DLC 各自計數（本體優先：抓取迴圈以「本體滿 1621 且 DLC 滿 300」
  // 為停表條件，不讓 DLC 擠掉本體名額；最終切片也是本體先取滿再加 DLC）。
  const counts = () => {
    let games = 0;
    let dlcs = 0;
    for (const v of byName.values()) {
      if (v.item.kind === "dlc") dlcs++;
      else games++;
    }
    return { games, dlcs };
  };
  const needsMore = () => {
    const c = counts();
    return c.games < MAX_ITEMS || c.dlcs < MAX_DLC_COUNT;
  };
  // 回空陣列／抓失敗的 offset（重掃用；見下方重掃迴圈）。
  const retryOffsets: number[] = [];
  const fetchPage = async (offset: number): Promise<GridProduct[]> => {
    const d = (await fetchJson(gridUrl(offset))) as GridResponse;
    return d.data?.categoryGridRetrieve?.products ?? [];
  };
  try {
    const first = (await fetchJson(gridUrl(0))) as GridResponse;
    const grid = first.data?.categoryGridRetrieve;
    totalCount = grid?.pageInfo?.totalCount ?? 0;
    const firstProducts = grid?.products ?? [];
    if (firstProducts.length === 0 && totalCount > 0) retryOffsets.push(0);
    else addProducts(firstProducts);
    const pages = Math.min(
      MAX_PAGES,
      Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    );
    // 每批 3 頁並行；本體滿 1621 且 DLC 滿 300 才停（本體優先）。
    for (let start = 1; start < pages && needsMore(); start += CONCURRENCY) {
      const offsets: number[] = [];
      for (let i = start; i < Math.min(start + CONCURRENCY, pages); i++) {
        offsets.push(i * PAGE_SIZE);
      }
      const settled = await Promise.allSettled(
        offsets.map(async (offset) => ({
          offset,
          products: await fetchPage(offset),
        }))
      );
      for (let k = 0; k < settled.length; k++) {
        const s = settled[k];
        const offset = offsets[k];
        if (s.status === "fulfilled") {
          if (s.value.products.length === 0) retryOffsets.push(offset);
          else addProducts(s.value.products);
        } else {
          console.warn("[ps-deals] 優惠分類其中一頁失敗：", s.reason);
          retryOffsets.push(offset);
        }
      }
    }
    // 重掃空頁／失敗頁：2026-11-24 兩輪 Vercel 掃描都停在 90 頁（offset 2160
    // 之後的頁面回空／失敗，live 只收到 1,378 款；同一時間本機全掃 120 頁
    // 都通、1,621 款），疑似 Sony 限流 Vercel 出口 IP。隔一段時間再抓，
    // 讓限流窗口過去；兩輪都還空／失敗就認了（只列抓到的，不 500）。
    for (const delayMs of [2000, 5000]) {
      if (retryOffsets.length === 0 || !needsMore()) break;
      await new Promise((r) => setTimeout(r, delayMs));
      const pending = [...retryOffsets];
      retryOffsets.length = 0;
      const settled = await Promise.allSettled(
        pending.map(async (offset) => ({
          offset,
          products: await fetchPage(offset),
        }))
      );
      for (let k = 0; k < settled.length; k++) {
        const s = settled[k];
        const offset = pending[k];
        if (s.status === "fulfilled") {
          if (s.value.products.length === 0) retryOffsets.push(offset);
          else addProducts(s.value.products);
        } else {
          console.warn("[ps-deals] 優惠分類重掃其中一頁失敗：", s.reason);
          retryOffsets.push(offset);
        }
      }
    }
    if (retryOffsets.length > 0) {
      console.warn(
        `[ps-deals] 重掃後仍空／失敗 ${retryOffsets.length} 頁（offset：${retryOffsets.join(",")}），本次只列 ${byName.size} 款`
      );
    }
  } catch (e) {
    console.warn("[ps-deals] 優惠分類抓取失敗：", e);
    return empty;
  }
  // 本體優先：本體按折扣取前 1621，再加 DLC 按折扣取前 300（額外），
  // 合併後再按折扣大→小排（不讓 DLC 擠掉本體名額）。
  const sorted = [...byName.values()]
    .map((v) => v.item)
    .sort((a, b) => b.sortKey - a.sortKey);
  const items = [
    ...sorted.filter((it) => it.kind !== "dlc").slice(0, MAX_ITEMS),
    ...sorted.filter((it) => it.kind === "dlc").slice(0, MAX_DLC_COUNT),
  ].sort((a, b) => b.sortKey - a.sortKey);
  return {
    items,
    fetchedAt: new Date(nowMs).toISOString(),
    totalCount,
    shownCount: items.length,
  };
}
