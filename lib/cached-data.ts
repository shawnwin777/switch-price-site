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
//      例外：首頁列表的 key 包含呼叫端傳入的可見國家範圍字串（cookie
//      解析出的 "ALL" 或代碼清單，公開設定、非個人資料），不同設定
//      不會共用同一份快取；cookie 本身由頁面（Server Component）讀，
//      不由快取函式讀。
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
  fetchGamesPagePublicCore,
  fetchGamePublicCore,
  fetchHistoricalLowPagePublic,
  fetchNearLowPagePublic,
  fetchUpcomingPagePublic,
  getLatestFx,
  getLatestPriceUpdate,
  getProductTypes,
  getRanking,
  type GamesPagePublicArgs,
  type GamesPageResult,
  type HistoricalLowPageResult,
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
 *  deals-page-v1（資料形狀改了，舊快取沒有分來源陣列，換 key 立刻重算）。
 *  2026-11-23 分頁改版：Steam 改走特價搜尋 API 取前 200 款，key 再換成
 *  deals-page-v2（舊快取的 Steam 只有 10 款精選）。抓取頁數 2 頁→3 頁
 *  時 key 再換成 deals-page-v3（Data Cache 存在磁碟、部署也不會清，
 *  2 頁版算出的 199 款會一直被 v2 快取吃到）。2026-11-23 再加 Steam
 *  限時免費（steamFree 欄位）與分頁改名，key 換成 deals-page-v4。
 *  2026-11-23 上限 200→350→510（Steam 抓 6 頁 600 列取前 510），key 換成
 *  deals-page-v6。2026-11-23 每頁 24 款→30 款（510 款剛好 17 頁），key 換成
 *  deals-page-v7。2026-11-23：四個清單全空時拋錯、不快取（見下方；
 *  key 不動，舊的好快取續用）。
 *  2026-11-23 21:00 高-1：Steam 搜尋從 Vercel 抓失敗、靜默退回 10 款
 *  specials 備援，還被當成正式結果快取 1 小時（STEAM 分頁只剩 10 款、
 *  steamTotalCount 0）。改法：(1) Steam 全空（搜尋＋備援都沒東西，
 *  不論 Epic 有沒有資料）就拋錯、不快取空結果——跟 Xbox／GamePass
 *  三個分頁 18:14 的「0 筆就拋錯」同一套做法，下次請求重抓；
 *  (2) 只有備援時（steamFromFallback）仍回傳、頁面顯示
 *  「Steam 資料暫時不完整」提示——備援跟 Epic 同包在這份資料裡，
 *  這裡拋錯會連 Epic 一起丟掉，標記＋提示比丟掉更實用；
 *  (3) key 換成 deals-page-v8，立刻丟掉被 10 款備援污染的 v7 快取、馬上重抓搜尋。 */
export const getCachedDealsPage = unstable_cache(
  async (): Promise<DealsPageData> => {
    const data = await fetchDealsPage();
    // Steam 全空＝上游 Steam 來源全掛（搜尋＋備援都沒東西；Steam 常年
    // 上千款特價，0 款只會是抓失敗），拋錯、不把空 Steam 快取 1 小時；
    // Epic 有資料也不救——Epic 跟 Steam 同包在這份資料裡，空 Steam 被
    // 快取會把 STEAM 分頁鎖住 1 小時，下次請求重抓才會恢復（跟 Xbox
    // 三個分頁 18:14 空結果中毒同一類問題）。只有備援時不拋錯
    // （steamFromFallback=true）：備援至少有 10 款可看，頁面會標示
    // 「資料暫時不完整」，快取到期重抓時搜尋恢復就自動回到 510 款。
    if (data.steam.length === 0 && data.steamFree.length === 0) {
      throw new Error("Steam 特價全部抓取失敗（回傳 0 款，不快取空結果）");
    }
    return data;
  },
  ["deals-page-v8"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["deals-page"] }
);

import {
  fetchXboxPcDeals,
  type XboxPcDealsData,
} from "./xbox-deals";

/** Xbox PC 特價（/deals 下方區塊，伺服器端抓取、每小時更新一次，
 *  不每次載入頁面都打 Microsoft API；抓取失敗時回空陣列、該區塊顯示空狀態）。
 *  2026-11-23 分頁改版：從前 50 款擴到前 200 款，key 換成
 *  xbox-pc-deals-v2（舊快取只有 50 款）。2026-11-23 上限 200→350→510
 *  （Reco 取 6 頁 600 個 id 取前 510），key 換成 xbox-pc-deals-v4。
 *  2026-11-23 每頁 24 款→30 款，key 換成 xbox-pc-deals-v5。
 *  2026-11-23 18:14 微軟端從 Vercel 抓失敗、空結果被快取 1 小時
 *  （XBOX PC 分頁變 0 款）；改成 0 款就拋錯、不快取空結果，key 換成
 *  xbox-pc-deals-v6 立刻重算（跟 /near-low commit b4dc3c49 同一套修法）。 */
export const getCachedXboxPcDeals = unstable_cache(
  async (): Promise<XboxPcDealsData> => {
    const data = await fetchXboxPcDeals();
    if (data.items.length === 0) {
      throw new Error("Xbox PC 特價抓取失敗（回傳 0 款，不快取空結果）");
    }
    return data;
  },
  ["xbox-pc-deals-v6"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["xbox-pc-deals"] }
);

import {
  fetchXboxConsoleDeals,
  type XboxConsoleDealsData,
} from "./xbox-console-deals";

/** Xbox 家機特價（/console 家機頁，伺服器端抓取、每小時更新一次）。
 *  2026-11-23 新增：與 PC 版同一條管線（Reco 清單＋Display Catalog），
 *  只差平台 filter 為 Windows.Xbox；實測抽 50 款有 48 款是家機＋台幣折價。
 *  2026-11-23 12:17 shawn 改方向：家機不做 /deals 第四分頁，改獨立頁 /console，
 *  這裡的快取不動（key 仍是 xbox-console-deals-v1，資料本身沒變）。
 *  2026-11-23 上限 200→350→510（Reco 取 6 頁 600 個 id 取前 510），key 換成
 *  xbox-console-deals-v3。2026-11-23 每頁 24 款→30 款，key 換成
 *  xbox-console-deals-v4。2026-11-23 18:14 微軟端從 Vercel 抓失敗、
 *  空結果被快取 1 小時（XBOX 家機分頁變 0 款）；改成 0 款就拋錯、
 *  不快取空結果，key 換成 xbox-console-deals-v5 立刻重算
 *  （跟 /near-low commit b4dc3c49 同一套修法）。 */
export const getCachedXboxConsoleDeals = unstable_cache(
  async (): Promise<XboxConsoleDealsData> => {
    const data = await fetchXboxConsoleDeals();
    if (data.items.length === 0) {
      throw new Error("Xbox 家機特價抓取失敗（回傳 0 款，不快取空結果）");
    }
    return data;
  },
  ["xbox-console-deals-v5"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["xbox-console-deals"] }
);

import { fetchPsDeals, type PsDealsData } from "./ps-deals";

/** PS 家機特價（/console 家機頁，伺服器端抓取、每小時更新一次）。
 *  2026-11-23 新增：官方 GraphQL categoryGridRetrieve（persisted hash
 *  來自公開文件 mrt1m/playstation-store-api），抓 SALES＋OFFERS
 *  兩個特價分類、只列目前真的有折扣的；實測當下聯集去重後 44 款
 *  （沒大檔期所以少，不是 bug），價格已抽 2 款對照未登入商店頁驗證過。
 *  2026-11-23 擴量：改抓優惠頁「所有優惠」分類
 *  （3f772501…，總數 2,862；瀏覽器實測抓到的分類 ID），sales30 倒序
 *  分段抓、只列折扣 ≥50%、折扣大→小、前 200 款；key 換成 ps-deals-v2
 *  （舊快取是 SALES＋OFFERS 的 44 款舊形狀）。2026-11-23 上限 200→350→510
 *  （最多掃 50 頁、抓滿 510 款 ≥50% 就停），key 換成 ps-deals-v4。
 *  2026-11-23 每頁 24 款→30 款，key 換成 ps-deals-v5。
 *  2026-11-23 晚：標題改繁中（X-PSN-Store-Locale-Override）＋誠實 UA，
 *  key 換成 ps-deals-v6（舊快取是簡體標題）。
 *  2026-11-23：0 款就拋錯、不快取空結果（跟 Xbox 三個分頁 18:14
 *  空結果中毒同一類問題；「所有優惠」分類 2,862 款、≥50% 實測 510 款，
 *  真的 0 款只會是 GraphQL 抓失敗。key 不動，舊的好快取續用）。 */
export const getCachedPsDeals = unstable_cache(
  async (): Promise<PsDealsData> => {
    const data = await fetchPsDeals();
    if (data.items.length === 0) {
      throw new Error("PS 特價抓取失敗（回傳 0 款，不快取空結果）");
    }
    return data;
  },
  ["ps-deals-v6"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["ps-deals"] }
);

import {
  fetchGamePassNew,
  type GamePassNewData,
  type GamePassPlatform,
} from "./gamepass";

/** Game Pass 最近新增（/deals PC 分頁、/console 家機分頁，伺服器端抓取、
 *  每小時更新一次）。2026-11-23 新增：xbox.com sigls v3 recentlyadded
 *  分類＋Display Catalog 補資料；家機 31 款、PC 33 款（實測）。
 *  快取 key 分平台（gamepass-new-console-v1／gamepass-new-pc-v1）。
 *  2026-11-23：0 款就拋錯、不快取空結果（18:14 微軟端抓失敗、XGP
 *  家機被空結果鎖 1 小時，跟 /near-low commit b4dc3c49 同一套修法）。
 *  家機 key 換成 gamepass-new-console-v2 立刻重算；PC 當時快取是好的
 *  （33 款），key 不動、舊快取續用到期，之後重抓一樣受拋錯保護。 */
export const getCachedGamePassNew = (
  platform: GamePassPlatform
): Promise<GamePassNewData> =>
  platform === "console"
    ? getCachedGamePassNewConsole()
    : getCachedGamePassNewPc();

const getCachedGamePassNewConsole = unstable_cache(
  async (): Promise<GamePassNewData> => {
    const data = await fetchGamePassNew("console");
    if (data.items.length === 0) {
      throw new Error("Game Pass 家機新進抓取失敗（回傳 0 款，不快取空結果）");
    }
    return data;
  },
  ["gamepass-new-console-v2"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["gamepass-new"] }
);

const getCachedGamePassNewPc = unstable_cache(
  async (): Promise<GamePassNewData> => {
    const data = await fetchGamePassNew("pc");
    if (data.items.length === 0) {
      throw new Error("Game Pass PC 新進抓取失敗（回傳 0 款，不快取空結果）");
    }
    return data;
  },
  ["gamepass-new-pc-v1"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["gamepass-new"] }
);

import { fetchPsPlusNew, type PsPlusNewData } from "./ps-plus";

/** PS Plus 本月新進（/console 家機頁 PS PLUS 分頁，伺服器端抓取、
 *  每小時更新一次）。2026-11-23 新增：PS Blog sitemap 自動發現當月
 *  目錄文＋每月遊戲文，解析 <strong>遊戲名 | PS5, PS4</strong> 清單，
 *  再用官方搜尋對應到台灣商店商品拿圖片／連結。
 *  2026-11-23：0 款就拋錯、不快取空結果（跟 Xbox 三個分頁 18:14
 *  空結果中毒同一類問題；文章存在就一定有遊戲，0 款只會是抓失敗。
 *  key 不動，舊的好快取續用）。
 *  2026-11-23 晚：誠實 UA（不偽裝瀏覽器、拿掉 Referer／Origin），
 *  key 換成 ps-plus-new-v2，強制用新 UA 重抓一次。 */
export const getCachedPsPlusNew = unstable_cache(
  async (): Promise<PsPlusNewData> => {
    const data = await fetchPsPlusNew();
    if (data.items.length === 0) {
      throw new Error("PS Plus 新進抓取失敗（回傳 0 款，不快取空結果）");
    }
    return data;
  },
  ["ps-plus-new-v2"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["ps-plus-new"] }
);

/** 首頁公開列表（分頁＋篩選＋排序）。key = 全部篩選條件＋個人 id 清單，
 *  所以不同篩選／不同使用者的排除清單不會共用同一份快取。
 *  內層 unstable_cache：查詢失敗時直接拋錯——Next 14.2.35 的
 *  unstable_cache 只在 cb 成功回傳後才寫 Data Cache，拋出的錯誤
 *  不會被快取，下次請求會重新查詢，不會把 migration 空窗等短暫
 *  錯誤的空結果鎖住 1 小時（2026-11-23 TW,HK 快取中毒事件）。
 *  外層接住錯誤，回傳帶 error 的空結果，頁面據此顯示
 *  「資料載入失敗」橫幅（不當成資料庫沒遊戲）。 */
const getCachedGamesPagePublicInner = unstable_cache(
  async (args: GamesPagePublicArgs): Promise<GamesPageResult> => {
    const result = await fetchGamesPagePublicCore(createPublicClient(), args);
    if (result.error) throw new Error(result.error);
    return result;
  },
  // v6：2026-11-23 遊戲牆預設只列遊戲本體（productType 沒帶參數時
  // 預設 "game"，不再是全部類型）；舊 key 的快取是不篩類型的舊列表，
  // 換 key 讓它立刻重算（部署不會清 Data Cache）。
  ["games-page-v6"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["games-page"] }
);

export async function getCachedGamesPagePublic(
  args: GamesPagePublicArgs
): Promise<GamesPageResult> {
  try {
    return await getCachedGamesPagePublicInner(args);
  } catch (e) {
    const page = Math.max(1, args.page ?? 1);
    return {
      games: [],
      total: 0,
      page,
      totalPages: 0,
      error: e instanceof Error ? e.message : "首頁查詢失敗",
    };
  }
}

/** 遊戲詳情公開資料（遊戲＋價格＋公開讚數／收藏數）。key 換 game-v2
 *  （2026-11-24）：Game 多了 screenshots 欄位，舊 key 的快取沒有它，
 *  換 key 讓畫廊立刻有截圖，不用等 1 小時舊快取過期。 */
export const getCachedGamePublic = unstable_cache(
  async (slug: string): Promise<GameWithPrices | null> =>
    fetchGamePublicCore(createPublicClient(), slug),
  ["game-v2"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["game"] }
);

/** 收藏排行 TOP 10（完全公開）。key 換 ranking-v2（2026-11-23）：
 *  on_sale／sale_end 是 getRanking 裡算好才快取的，舊 key 的快取
 *  會把已結束的特價繼續當特價中再錯 1 小時；換 key 立刻重算。 */
export const getCachedRanking = unstable_cache(
  async (onlyOnSale: boolean, limit: number) =>
    getRanking(createPublicClient(), onlyOnSale, limit),
  ["ranking-v2"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["ranking"] }
);

/** 匯率快照／價格最後更新時間／商品類型（公開、幾乎不變）。 */
export const getCachedLatestFx = unstable_cache(
  async () => getLatestFx(createPublicClient()),
  ["latest-fx"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["meta"] }
);

import {
  NSO_FX_DATE,
  NSO_FX_PER_USD,
  NSO_FX_SOURCE,
} from "./nso-prices";

export interface NsoFxData {
  /** 每 1 美元兌各幣別（與 NSO_FX_PER_USD 同形）。 */
  perUsd: Record<string, number>;
  /** 匯率日期（台北日期 YYYY-MM-DD）。 */
  date: string;
  /** 來源說明（頁面顯示用）。 */
  source: string;
  /** true = 即時抓到的；false = 抓不到、退回靜態快照。 */
  live: boolean;
}

/** NSO 換算用的即時匯率（/nso 頁，2026-11-23 起不用靜態快照）。
 *  來源 https://open.er-api.com/v6/latest/USD（站上其他地方本來就用
 *  這個來源；er-api 每天 00:02 UTC 左右更新一次）。每小時快取一次；
 *  抓不到（斷線、回應異常、缺幣別）就退回 lib/nso-prices.ts 的靜態
 *  快照表（2026-11-23），頁面照常顯示、只在匯率行註明是快照。 */
const NSO_FX_URL = "https://open.er-api.com/v6/latest/USD";
const NSO_FX_LIVE_SOURCE = "open.er-api.com（USD 基準，即時）";

async function fetchNsoFxLive(): Promise<NsoFxData> {
  const res = await fetch(NSO_FX_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "shawn-game-studio-nso-fx/1.0",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${NSO_FX_URL}`);
  const data = (await res.json()) as {
    result?: string;
    rates?: Record<string, number>;
    time_last_update_utc?: string;
  };
  if (data.result !== "success" || !data.rates) {
    throw new Error("er-api 回應異常");
  }
  const perUsd: Record<string, number> = {};
  for (const c of Object.keys(NSO_FX_PER_USD)) {
    const v = data.rates[c];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new Error(`er-api 缺 ${c} 匯率`);
    }
    perUsd[c] = v;
  }
  const updated = data.time_last_update_utc
    ? new Date(data.time_last_update_utc)
    : new Date();
  const date = Number.isNaN(updated.getTime())
    ? NSO_FX_DATE
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(updated);
  return { perUsd, date, source: NSO_FX_LIVE_SOURCE, live: true };
}

export const getCachedNsoFx = unstable_cache(
  async (): Promise<NsoFxData> => {
    try {
      return await fetchNsoFxLive();
    } catch (e) {
      console.warn("[nso-fx] 即時匯率抓取失敗，退回靜態快照：", e);
      return {
        perUsd: NSO_FX_PER_USD,
        date: NSO_FX_DATE,
        source: NSO_FX_SOURCE,
        live: false,
      };
    }
  },
  ["nso-fx-v1"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["nso-fx"] }
);

export const getCachedLatestPriceUpdate = unstable_cache(
  async () => getLatestPriceUpdate(createPublicClient()),
  ["latest-price-update"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["meta"] }
);

export const getCachedProductTypes = unstable_cache(
  async () => getProductTypes(createPublicClient()),
  // 2026-11-23：key 換 v2——舊 key 快取的是錯誤的 ["bundle"]（見
  // lib/data.ts getProductTypes 的修正說明），不換 key 還要再錯 1 小時。
  ["product-types-v2"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["meta"] }
);

/** 接近歷史低價列表頁（DB 層單一查詢，見 lib/data.ts）。
 *  失敗時拋錯、不回傳 error 形狀：拋錯不會被 unstable_cache 寫入，
 *  下次請求會重查；回傳 error 形狀會被快取 1 小時，頁面在這 1 小時
 *  內一直顯示「資料準備中」（2026-11-23 的教訓：首頁 0 款 bug 與
 *  /near-low 34 秒壞掉都是同一類問題）。頁面端用 try/catch 接住，
 *  照樣顯示「資料準備中」，畫面不變。
 *  2026-11-23：主路徑改 view 欄位單一查詢，key 換 v3（舊 v2 快取
 *  是全掃描候選的形狀，結構不同，換 key 立刻重算）。 */
export const getCachedNearLowPage = unstable_cache(
  async (page: number, country?: string): Promise<NearLowPageResult> => {
    const result = await fetchNearLowPagePublic(
      createPublicClient(),
      page,
      country
    );
    if (result.error) throw new Error(result.error);
    return result;
  },
  ["near-low-page-v3"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["near-low"] }
);

/** 準備上市列表頁（單一索引查詢，快取整頁結果）。
 *  2026-11-19：每頁 12 款 → 100 款（跟接近歷史低價一樣），key 換 v2，
 *  否則舊 12 款快取會用新頁碼切出錯的範圍（near-low 頁 2 曾因此重號）。
 *  2026-11-23：查詢失敗（unavailable）時拋錯，不快取「資料補充中」
 *  的空結果（跟 /near-low 同一個教訓）；頁面端 try/catch 接住後照樣
 *  顯示「資料補充中」，畫面不變。 */
export const getCachedUpcomingPage = unstable_cache(
  async (page: number): Promise<UpcomingPageResult> => {
    const result = await fetchUpcomingPagePublic(createPublicClient(), page);
    if (result.unavailable) {
      throw new Error("準備上市查詢失敗（資料補充中）");
    }
    return result;
  },
  ["upcoming-page-v2"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["upcoming"] }
);

/** 歷史低價列表頁（/historical-low）：目前最低價 = 歷史低價的遊戲，
 *  100 款一頁、折扣大優先。主路徑是 view 欄位 is_at_historical_low
 *  的單一查詢（migration 20261123_add_is_at_historical_low.sql）；
 *  欄位未建時自動改走 prices 旗標備援（見 lib/data.ts）。
 *  2026-11-23：失敗時拋錯，不快取 error 形狀的結果（跟 /near-low
 *  同一個教訓）；頁面端 try/catch 接住後照樣顯示「資料準備中」，
 *  畫面不變。key 換 v2。
 *  快取 key 另外開 historical-low-page-v2，不跟 near-low 共用。 */
export const getCachedHistoricalLowPage = unstable_cache(
  async (page: number, country?: string): Promise<HistoricalLowPageResult> => {
    const result = await fetchHistoricalLowPagePublic(
      createPublicClient(),
      page,
      country
    );
    if (result.error) throw new Error(result.error);
    return result;
  },
  ["historical-low-page-v2"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["historical-low"] }
);
