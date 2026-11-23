// ============================================================================
// 快取層（server-only：這個檔案只能被 Server Component / Route Handler import，
// 絕對不要被 Client Component 引用——它 import 了 next/cache）。
// ----------------------------------------------------------------------------
// 策略：公開資料用 Next.js unstable_cache 快取 1 小時（Vercel Data Cache，
// Hobby 免費方案內含，不用加購、不用換方案、不用多接服務）。
// 頁面本身維持 force-dynamic（每次請求仍跑 middleware＋讀登入狀態），
// 但點進去時重的資料庫查詢都變成快取命中，所以 TTFB 從 2 秒級降到毫秒級。
//
// 個人狀態絕對正確的保證（分三層）：
//   1. 快取的函式只讀「公開資料」（遊戲列、價格、公開的讚數／收藏數、
//      匯率、排行），key 裡沒有任何 userId，裡面也不讀 cookies。
//      快取函式用的 client 是不帶 cookie 的公開 client
//      （lib/supabase-public.ts），就算快取被打穿，裡面也沒有個人資料。
//   2. 個人狀態（我是否按讚／收藏／已購買）永遠即時查、不快取：
//      頁面拿到快取的公開結果後，再用請求的 server client 跑
//      overlayMyGameFlags() 補上（只有當頁 12 款的 3 個小查詢）。
//   3. 會改變列表組成的個人清單（我的收藏 id、已購買 id）也是即時取，
//      而且它們是快取鍵的一部分——收藏／購買一變，下次就是新的 key，
//      不會拿到舊的排除結果。
// 按讚／收藏會改變公開計數（讚數／收藏數）：mutation API 路由
// （/api/likes、/api/collections）在成功後呼叫 revalidateTag()，
// 讓相關快取立即失效，下次載入就是新數字；就算沒清到，1 小時也會到期。
// 留言不進快取（留言一發就要看得到）；特價提醒（SaleBanner）是
// Client Component 本來就即時查，也不進快取。
// ============================================================================
import { unstable_cache } from "next/cache";
import { createPublicClient } from "./supabase-public";
import type { GameWithPrices } from "./types";
import {
  fetchGamesByIdsPublic,
  fetchGamesPagePublicCore,
  fetchGamePublicCore,
  fetchNearLowCandidates,
  fetchUpcomingPagePublic,
  getLatestFx,
  getLatestPriceUpdate,
  getProductTypes,
  getRanking,
  paginateNearLow,
  type GamesPagePublicArgs,
  type GamesPageResult,
  type NearLowCandidate,
  type NearLowPageResult,
  type UpcomingPageResult,
} from "./data";

/** 公開資料快取時間：1 小時（價格每小時更新一次即可；見任務說明）。 */
export const CACHE_REVALIDATE_SECONDS = 3600;

import {
  fetchDealsPage,
  type DealsPageData,
} from "./deals-carousel";

/** Steam 特價＋Epic 免費遊戲（/deals 獨立頁面，伺服器端抓取、每小時更新一次，
 *  不每次載入頁面都打 Steam／Epic API；抓取失敗時該來源回空陣列）。
 *  2026-11-23 輪播改獨立頁面：快取 key 從 deals-carousel-v1 換成
 *  deals-page-v1（資料形狀改了，舊快取沒有分來源陣列，換 key 立刻重算）。 */
export const getCachedDealsPage = unstable_cache(
  async (): Promise<DealsPageData> => fetchDealsPage(),
  ["deals-page-v1"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["deals-page"] }
);

import {
  fetchXboxPcDeals,
  type XboxPcDealsData,
} from "./xbox-deals";

/** Xbox PC 特價（/deals 下方區塊，伺服器端抓取、每小時更新一次，
 *  不每次載入頁面都打 Microsoft API；抓取失敗時回空陣列、該區塊顯示空狀態）。 */
export const getCachedXboxPcDeals = unstable_cache(
  async (): Promise<XboxPcDealsData> => fetchXboxPcDeals(),
  ["xbox-pc-deals-v1"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["xbox-pc-deals"] }
);

/** 首頁公開列表（分頁＋篩選＋排序）。key = 全部篩選條件＋個人 id 清單，
 *  所以不同篩選／不同使用者的排除清單不會共用同一份快取。 */
export const getCachedGamesPagePublic = unstable_cache(
  async (args: GamesPagePublicArgs): Promise<GamesPageResult> =>
    fetchGamesPagePublicCore(createPublicClient(), args),
  // v3：2026-11-23 沒選國家時查詢階段只撈 TW／HK 有價的遊戲參與排序與
  // 分頁（舊 key 的快取是全球特價排序、第一頁 18 款台港無價的舊資料），
  // 換 key 讓它立刻重算（部署不會清 Data Cache，舊項目會留到過期）。
  ["games-page-v3"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["games-page"] }
);

/** 遊戲詳情公開資料（遊戲＋價格＋公開讚數／收藏數）。 */
export const getCachedGamePublic = unstable_cache(
  async (slug: string): Promise<GameWithPrices | null> =>
    fetchGamePublicCore(createPublicClient(), slug),
  ["game"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["game"] }
);

/** 收藏排行 TOP 10（完全公開）。 */
export const getCachedRanking = unstable_cache(
  async (onlyOnSale: boolean, limit: number) =>
    getRanking(createPublicClient(), onlyOnSale, limit),
  ["ranking"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["ranking"] }
);

/** 匯率快照／價格最後更新時間／商品類型（公開、幾乎不變）。 */
export const getCachedLatestFx = unstable_cache(
  async () => getLatestFx(createPublicClient()),
  ["latest-fx"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["meta"] }
);

export const getCachedLatestPriceUpdate = unstable_cache(
  async () => getLatestPriceUpdate(createPublicClient()),
  ["latest-price-update"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["meta"] }
);

export const getCachedProductTypes = unstable_cache(
  async () => getProductTypes(createPublicClient()),
  ["product-types"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["meta"] }
);

/** 接近歷史低價的候選清單（掃描約 1 萬列，只在快取到期時跑一次）。 */
export const getCachedNearLowCandidates = unstable_cache(
  async (): Promise<{
    candidates: NearLowCandidate[];
    error: string | null;
  }> => fetchNearLowCandidates(createPublicClient()),
  // v2：2026-11-18 候選改帶 cheapest_country（國家篩選用），舊 key 的
  // 快取是沒有國家欄位的舊形狀，換 key 讓它立刻重算。
  ["near-low-candidates-v2"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["near-low"] }
);

/** 接近歷史低價列表頁（候選清單本身已快取，分頁只抓當頁 12 款）。
 *  country 有值時只留目前最低價在該國的遊戲（分頁前就先篩選）。 */
export const getCachedNearLowPage = unstable_cache(
  async (page: number, country?: string): Promise<NearLowPageResult> => {
    const p = Math.max(1, page);
    const { candidates, error } = await getCachedNearLowCandidates();
    if (error) {
      return {
        games: [],
        ratios: {},
        total: 0,
        page: p,
        totalPages: 0,
        error,
      };
    }
    const { slice, total, totalPages } = paginateNearLow(candidates, p, country);
    const games = await fetchGamesByIdsPublic(
      createPublicClient(),
      slice.map((c) => c.id)
    );
    const ratios: Record<string, number> = {};
    for (const c of slice) ratios[c.id] = c.ratio;
    return { games, ratios, total, page: p, totalPages, error: null };
  },
  // v2：2026-11-18 改 100 款／頁，舊 key 的快取是 12／50 款混舊資料
  // （第 2 頁曾顯示舊 12 款卻編號 51–62），換 key 讓它立刻重算。
  ["near-low-page-v2"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["near-low"] }
);

/** 準備上市列表頁（單一索引查詢，快取整頁結果）。
 * 2026-11-19：每頁 12 款 → 100 款（跟接近歷史低價一樣），key 換 v2，
 * 否則舊 12 款快取會用新頁碼切出錯的範圍（near-low 頁 2 曾因此重號）。 */
export const getCachedUpcomingPage = unstable_cache(
  async (page: number): Promise<UpcomingPageResult> =>
    fetchUpcomingPagePublic(createPublicClient(), page),
  ["upcoming-page-v2"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["upcoming"] }
);
