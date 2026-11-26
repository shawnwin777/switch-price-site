// 直接用 Supabase client 讀公開資料（讀取走 client，寫入走 /api/* 合約）。
// 所有函式第一個參數都是 Supabase client（server 用 createSupabaseServerClient()，
// 瀏覽器用 createSupabaseBrowserClient()），查詢失敗時回傳空值、不拋錯，
// 所以 Supabase 專案不存在時頁面仍可建置與顯示「尚無資料」。
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";
import { taipeiDateKey } from "./format";
import type {
  CollectedOnSale,
  CommentItem,
  FxRate,
  Game,
  GameWithPrices,
  Price,
  RankingEntry,
} from "./types";

export const PLACEHOLDER_COVER = "/covers/placeholder.svg";

/** 種子檔封面是 "./blobs/<base64>"，base64 解開是 "covers/xxx.jpg" → 轉成 "/covers/xxx.jpg"。 */
function decodeBase64(input: string): string {
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(input, "base64").toString("utf-8");
    }
    return atob(input);
  } catch {
    return "";
  }
}

export function resolveCoverUrl(coverUrl: string | null | undefined): string {
  if (!coverUrl) return PLACEHOLDER_COVER;
  if (coverUrl.startsWith("./blobs/")) {
    const decoded = decodeBase64(coverUrl.slice("./blobs/".length));
    if (decoded) return `/${decoded.replace(/^\//, "")}`;
    return PLACEHOLDER_COVER;
  }
  return coverUrl;
}

function toGameWithPrices(
  game: Game,
  prices: Price[],
  likesCount: number,
  collectionsCount: number,
  likedByMe = false,
  collectedByMe = false,
  purchasedByMe = false
): GameWithPrices {
  return {
    ...game,
    cover_url: resolveCoverUrl(game.cover_url),
    prices: prices
      .filter((p) => p.game_id === game.id)
      // 未確認價格排最後面：先分已確認／未確認，組內再依台幣價由低到高。
      // 欄位不存在時 verified 為 undefined，視為已確認（見 isVerifiedPrice）。
      .sort(
        (a, b) =>
          Number(isVerifiedPrice(b)) - Number(isVerifiedPrice(a)) ||
          (a.price_twd ?? Infinity) - (b.price_twd ?? Infinity)
      ),
    likes_count: likesCount,
    collections_count: collectionsCount,
    liked_by_me: likedByMe,
    collected_by_me: collectedByMe,
    purchased_by_me: purchasedByMe,
  };
}

/** 單一價格是否已確認（2026-11-24 新規則：未確認的先排最後、不算特價）。
 *  verified 欄位還不存在（migration 未跑）時，價格查詢用 select("*")，
 *  不會回傳該欄位，undefined 視為已確認，舊行為不變；只有明確 false
 *  才是未確認。寫入端：新匯入的外國價格帶 verified = false，探針驗證
 *  通過後才改 true（見 price-verified-migration-20261124.sql）。 */
export function isVerifiedPrice(p: Pick<Price, "verified">): boolean {
  return p.verified !== false;
}

export function cheapestPrice(
  prices: Price[],
  visibleCountries?: Set<string>
): Price | null {
  // 最低價只算已確認價格：未確認價格再便宜也不當最低價。
  const list = prices.filter(
    (p) =>
      isVerifiedPrice(p) &&
      p.price_twd != null &&
      (!visibleCountries || visibleCountries.has(p.country))
  );
  if (list.length === 0) return null;
  return list.reduce((a, b) => ((b.price_twd ?? Infinity) < (a.price_twd ?? Infinity) ? b : a));
}

/** 單一價格是否仍在特價：有折扣，且特價結束時間未過。
 *  未確認價格永遠不算特價（即使 discount_pct > 0）。
 *  sale_end 為 NULL＝長期特價（無結束時間），維持特價中；
 *  sale_end 無效字串時也維持現況，不誤判為已結束。
 *  時間比較用同一瞬間（Date.now()），台北時間與 UTC 只是顯示時區，
 *  過期判斷不受時區影響。 */
export function isPriceOnSale(p: Price): boolean {
  if (!isVerifiedPrice(p)) return false;
  if ((p.discount_pct ?? 0) <= 0) return false;
  if (!p.sale_end) return true;
  const end = new Date(p.sale_end).getTime();
  if (Number.isNaN(end)) return true;
  return end > Date.now();
}

export function isOnSale(prices: Price[]): boolean {
  return prices.some(isPriceOnSale);
}

/** 遊戲卡片／詳情頁顯示的特價結束時間。
 *  優先取「仍在特價」的結束時間（最早的）；若全部特價都已過期，
 *  取最早的那個已過期時間，讓卡片仍能顯示「特價至：已結束」，
 *  而不是整個特價至消失。混合情況（某國已結束、另一國還在特價）
 *  顯示還在特價那國的結束時間，不再誤寫已結束。 */
export function saleEndOf(prices: Price[]): string | null {
  // 特價結束時間只取已確認價格：未確認價格的 sale_end 不顯示。
  const ends = prices
    .filter((p) => isVerifiedPrice(p) && (p.discount_pct ?? 0) > 0 && p.sale_end)
    .map((p) => p.sale_end as string)
    .sort();
  if (ends.length === 0) return null;
  const activeEnd = ends.find((e) => {
    const t = new Date(e).getTime();
    return !Number.isNaN(t) && t > Date.now();
  });
  return activeEnd ?? ends[0];
}

// ============================================================================
// 首頁伺服器端分頁（2026-11-16 修復：PostgREST 預設只回 1,000 筆，
// 舊版一次 select("*") 只能拿到前 1,000 款遊戲與 1,000 筆價格，
// 中文標題的遊戲排在 1,000 名外就搜不到也看不到）。
// 新版：搜尋／篩選／排序／總數都在資料庫做，每頁只抓 12 款，
// 價格、讚數、收藏數也只抓當頁 12 款的。
// 最低價／折扣／特價優先排序與「只看特價」需要 games_with_price_stats 檢視
// （supabase/migrations/20261117_homepage_price_stats.sql）；
// 特價優先另外需要 min_sale_end 欄位
// （supabase/migrations/20261118_add_min_sale_end.sql，未套用時退回折扣排序）；
// 檢視尚未建立時自動退回 games 表（排序改為名稱排序），首頁不會壞掉。
// ============================================================================

/** 首頁每頁筆數。 */
export const PAGE_SIZE = 12;

/** 首頁遊戲牆每頁筆數（六欄 × 三排＝18 款）。 */
export const HOME_PAGE_SIZE = 18;

/** 接近歷史低價每頁筆數（四欄 × 25 排＝100 款）。 */
export const NEAR_LOW_PAGE_SIZE = 100;
export const UPCOMING_PAGE_SIZE = 100;

/** games / games_with_price_stats 查詢時明確選取的遊戲欄位（不含統計欄位）。 */
const GAME_COLUMNS =
  "id,slug,title_zh,title_en,genre,publisher,platform,product_type,has_demo,cover_url,youtube_id,title_id,historical_low_twd,is_manual,name_source,created_by,created_at";

export type HomeSortKey =
  | "deals"
  | "cheap-asc"
  | "cheap-desc"
  | "title"
  | "discount"
  | "release";

export interface GamesPageFilters {
  q?: string;
  platform?: string;
  productType?: string;
  /** ?type= 是否由使用者明確指定（見 app/switch-price/page.tsx 的 parseParams）。
   *  未指定時商品類型預設依主機而定（Switch 2 預設全部、其餘預設遊戲本體）；
   *  前端寫回 URL 時只有明確指定才帶 type，避免隱含預設被寫成明確參數
   *  （例如點主機 Switch 2 時把隱含的 game 寫成 ?type=game 蓋掉新預設）。 */
  typeExplicit?: boolean;
  demo?: number;
  /** 國家篩選：只顯示在該國有價格的遊戲（國家代碼，如 JP）。 */
  country?: string;
  /** 伺服器端可見國家（從 cookie 讀到）："ALL" = 全部國家，不做國家過濾；
   *  代碼清單 = 只撈那些國家有價的遊戲；undefined = 預設全部 35 國（不做國家過濾）。
   *  ?country=XX 單一國家篩選優先於此欄位。 */
  visibleCountries?: string[] | "ALL";
  sort?: HomeSortKey;
  onlySale?: boolean;
  onlyMine?: boolean;
  /** 排除已購買：登入時預設排除（undefined = 預設排除）；false = 顯示已購買。 */
  excludePurchased?: boolean;
  page?: number;
  userId?: string | null;
}

export interface GamesPageResult {
  games: GameWithPrices[];
  total: number;
  page: number;
  totalPages: number;
  /** 查詢失敗時帶錯誤訊息（此時 games 為空、total 為 0）；
   *  呼叫端據此區分「查詢失敗」與「資料庫真的沒遊戲」。
   *  2026-11-23：migration 空窗（DROP VIEW＋CREATE VIEW）寫進
   *  快取的空結果讓首頁誤顯示「尚未匯入種子資料」，自此失敗
   *  與空結果分開處理（見 lib/cached-data.ts）。 */
  error?: string | null;
}

/** 搜尋字串清理：PostgREST or() 用逗號與括號分隔條件，ilike 的 % _ \ 是萬用字元。
 *  逗號／括號改為空白，\ % _ 加上跳脫，長度上限 100 字。 */
function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .trim()
    .slice(0, 100);
}

interface RawGamesPage {
  data: Game[] | null;
  count: number | null;
  error: { message: string; code?: string } | null;
}

/** games / games_with_price_stats 查詢的 builder 型別（未產生 Database 型別，泛型為 any）。 */
type GamesQueryBuilder = PostgrestFilterBuilder<any, any, any, any>;

/**
 * 依搜尋／篩選條件建立遊戲查詢（不含排序與分頁範圍）。
 * headCount=true 時只取 count（不回資料列），給「總數」查詢用。
 * 注意：這個函式必須是同步的——PostgrestFilterBuilder 本身是 thenable，
 * 從 async 函式回傳它會被 await 再解一層，型別會變成 response。
 * onlyMine 的 id 清單由呼叫端先取好傳進來；
 * 清單為空陣列時回傳 null（結果為空），null 則不套用該篩選。
 */
function buildFilteredGamesQuery(
  db: SupabaseClient,
  opts: GamesPageFilters,
  source: "games_with_price_stats" | "games",
  useStats: boolean,
  headCount: boolean,
  mineIds: string[] | null,
  // 未具名遊戲（games.is_unnamed，見 migration 20261118_unnamed_games.sql）
  // 不出現在首頁遊戲牆／搜尋結果。filterUnnamed=false 只用在 migration
  // 尚未套用的短暫退回期間（此時根本還沒有未具名遊戲，因為匯入腳本也
  // 需要此欄位才能寫入），見 fetchGamesPagePublicCore 的退回邏輯。
  filterUnnamed = true,
  // 國家篩選（view 的 price_country_list，見 migration
  // 20261119_add_price_country_list.sql）。filterCountry=false 只用在
  // migration 尚未套用的短暫退回期間（此時篩選不生效、顯示全部遊戲），
  // 見 fetchGamesPagePublicCore 的退回邏輯。
  filterCountry = true
): GamesQueryBuilder | null {
  const query: GamesQueryBuilder = headCount
    ? db.from(source).select("id", { count: "exact", head: true })
    : db.from(source).select(GAME_COLUMNS, { count: "exact" });

  // 未具名遊戲不上首頁／搜尋（單一過濾點：快取版與即時版都走這裡）。
  if (filterUnnamed) query.eq("is_unnamed", false);
  // 國家篩選：只顯示在該國家有價格的遊戲。注意：特價統計（has_sale、
  // min_sale_end）仍是全部國家的，不隨國家篩選改變。
  // 沒選國家時：依 cookie 的可見國家設定撈遊戲——"ALL" 不做國家過濾、
  // 代碼清單只撈那些國家有價的遊戲、沒有 cookie（或非法值）時用預設
  // 全部 35 國（2026-11-26 改：之前預設只留台港，shawn 說預設全部
  // 國家可見比較舒服）。?country=XX 單一國家篩選優先於 cookie 設定。
  // 只看我的收藏（onlyMine）不套用預設篩選：那是使用者自己的清單，
  // 不該因為沒台港價就整款消失。
  if (filterCountry) {
    if (opts.country) {
      query.contains("price_country_list", [opts.country]);
    } else if (!opts.onlyMine) {
      const vis = opts.visibleCountries;
      if (vis === "ALL") {
        // 全部國家可見：不做國家過濾。
      } else if (vis && vis.length > 0) {
        // 代碼皆由伺服器端 parseVisibleCountriesCookie 驗證過（只含
        // 35 國清單內的代碼），可直接拼進 or() 條件。
        query.or(vis.map((c) => `price_country_list.cs.{${c}}`).join(","));
      } else {
        // 沒有 cookie（或非法值）：預設全部國家可見，不做國家過濾。
      }
    }
  }
  const term = sanitizeSearchTerm(opts.q ?? "");
  if (term) {
    query.or(`title_zh.ilike.%${term}%,title_en.ilike.%${term}%`);
  }
  if (opts.platform) query.eq("platform", opts.platform);
  if (opts.productType && opts.productType !== "all") {
    // 舊資料 product_type 為 NULL 時視為 "game"（與舊版前端行為一致）。
    if (opts.productType === "game") {
      query.or("product_type.eq.game,product_type.is.null");
    } else {
      query.eq("product_type", opts.productType);
    }
  }
  if (opts.demo != null) query.eq("has_demo", opts.demo);
  if (opts.onlySale && useStats) query.eq("has_sale", true);
  if (opts.onlyMine) {
    if (!mineIds || mineIds.length === 0) return null;
    query.in("id", mineIds);
  }
  return query;
}

async function fetchGamesPageRows(
  db: SupabaseClient,
  opts: GamesPageFilters,
  source: "games_with_price_stats" | "games",
  useStats: boolean,
  lists: GamesPageListIds,
  filterUnnamed = true,
  filterCountry = true
): Promise<RawGamesPage> {
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * HOME_PAGE_SIZE;
  const to = from + HOME_PAGE_SIZE - 1;

  const base = buildFilteredGamesQuery(
    db,
    opts,
    source,
    useStats,
    false,
    lists.mineIds,
    filterUnnamed,
    filterCountry
  );
  if (!base) return { data: [], count: 0, error: null };

  // 已購買排除：只在一般遊戲牆／搜尋時套用（只看我的收藏／只看已購買
  // 是使用者自己的清單，不排除）。
  const exclusionActive = lists.excludePurchasedIds.length > 0;
  if (exclusionActive) {
    base.not("id", "in", `(${lists.excludePurchasedIds.join(",")})`);
  }

  const sort = opts.sort ?? "deals";
  if (sort === "title") {
    base.order("title_zh", { ascending: true });
  } else if (sort === "release") {
    // 上市日期：新 → 舊；沒有上市日期的排在最後面（nullsFirst: false）。
    // release_date 欄位還沒建（migration 未跑）時這裡會報錯，
    // 由 fetchGamesPagePublicCore 捕捉後自動退回名稱排序。
    base
      .order("release_date", { ascending: false, nullsFirst: false })
      .order("title_zh", { ascending: true });
  } else if (!useStats) {
    base.order("title_zh", { ascending: true });
  } else if (sort === "cheap-asc") {
    base
      .order("cheapest_twd", { ascending: true, nullsFirst: false })
      .order("title_zh", { ascending: true });
  } else if (sort === "cheap-desc") {
    base
      .order("cheapest_twd", { ascending: false, nullsFirst: false })
      .order("title_zh", { ascending: true });
  } else if (sort === "deals") {
    // 特價優先：特價中的排前面，依特價結束時間近 → 遠；
    // 長期特價（無結束日）接在有結束日的特價後面；
    // 沒特價的排最後面，裡面再依最低價。
    // min_sale_end 欄位還沒建（migration 未跑）時這裡會報錯，
    // 由 fetchGamesPagePublicCore 捕捉後自動退回折扣排序。
    base
      .order("has_sale", { ascending: false, nullsFirst: false })
      .order("min_sale_end", { ascending: true, nullsFirst: false })
      .order("cheapest_twd", { ascending: true, nullsFirst: false })
      .order("title_zh", { ascending: true });
  } else {
    // discount：折扣大 → 小。
    base
      .order("max_discount_pct", { ascending: false, nullsFirst: false })
      .order("title_zh", { ascending: true });
  }
  // 決定性排序：前面的鍵相同時用 id 收尾，避免分頁邊界跳動。
  base.order("id", { ascending: true });

  const { data, count, error } = await base.range(from, to);
  if (error || !data) {
    // 越界頁碼（PostgREST 416）：先跑一次 head count 取正確總數，
    // 回空頁＋正確 totalPages，不要把錯誤當成 error 回傳，
    // 頁面層的「越界導回最後一頁」才能生效。head count 不帶已購買
    // 排除——跟下面排除時的總數重算一致（總數顯示維持全站總數）。
    if (error && isRangeNotSatisfiableError(error)) {
      const totalQuery = buildFilteredGamesQuery(
        db,
        opts,
        source,
        useStats,
        true,
        lists.mineIds,
        filterUnnamed,
        filterCountry
      );
      if (totalQuery) {
        const { count: totalCount, error: totalError } = await totalQuery;
        if (!totalError && totalCount != null) {
          return { data: [], count: totalCount, error: null };
        }
      }
    }
    return {
      data: (data as Game[] | null) ?? null,
      count: count ?? null,
      error: error as RawGamesPage["error"],
    };
  }
  // 排除已購買時，上面回來的 count 是排除後的數字；總數顯示要維持全站
  // 總數（不過濾已購買），所以另外跑一次不帶排除的 head count。
  let total = count ?? null;
  if (exclusionActive) {
    const totalQuery = buildFilteredGamesQuery(
      db,
      opts,
      source,
      useStats,
      true,
      lists.mineIds,
      filterUnnamed,
      filterCountry
    );
    if (totalQuery) {
      const { count: totalCount, error: totalError } = await totalQuery;
      if (!totalError && totalCount != null) total = totalCount;
    }
  }
  return {
    data: (data as Game[] | null) ?? null,
    count: total,
    error: null,
  };
}

/** 首頁分頁查詢用、事先取好的個人 id 清單（由呼叫端即時取，絕不快取；
 *  同時是快取鍵的一部分，所以收藏／購買一變，下次就是新的 key，
 *  不會拿到舊的排除結果）。 */
export interface GamesPageListIds {
  mineIds: string[] | null;
  excludePurchasedIds: string[];
}

/** 首頁公開查詢的參數（可序列化，可進 unstable_cache 的 key；不含 userId，
 *  userId 只用在呼叫端的即時覆蓋，不進快取）。 */
export interface GamesPagePublicArgs {
  q?: string;
  platform?: string;
  productType?: string;
  demo?: number;
  /** 國家篩選：只顯示在該國有價格的遊戲（國家代碼，如 JP）。 */
  country?: string;
  /** 伺服器端可見國家（從 cookie 讀到，見 GamesPageFilters）；
   *  可序列化、是 unstable_cache key 的一部分，不同設定不會共用同一份快取。 */
  visibleCountries?: string[] | "ALL";
  sort?: HomeSortKey;
  onlySale?: boolean;
  onlyMine?: boolean;
  /** 排除已購買：undefined = 預設排除（登入時）；false = 顯示已購買。 */
  excludePurchased?: boolean;
  page?: number;
  mineIds: string[] | null;
  excludePurchasedIds: string[];
}

/** 檢視本身不存在的錯誤（PGRST205 或 relation does not exist）。
 *  注意：欄位不存在時 Postgres 也會報 "... does not exist"（如
 *  column ... min_sale_end does not exist），那是欄位缺失，各有專屬
 *  的退回邏輯（isSaleEndColumnError／isReleaseColumnError／
 *  isUnnamedColumnError），絕對不能在這裡被誤判成檢視不存在——
 *  否則會錯誤退回 games 表、排序變成名稱排序（2026-11-17 實測教訓：
 *  migration 未跑時「特價優先」應退回折扣排序，卻變成名稱排序）。 */
function isViewMissingError(error: RawGamesPage["error"]): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  const code = error.code ?? "";
  if (code === "PGRST205") return true;
  return /relation .*games_with_price_stats.* does not exist/i.test(msg);
}

/** min_sale_end 欄位還不存在的錯誤（migration 未跑）。 */
function isSaleEndColumnError(error: RawGamesPage["error"]): boolean {
  if (!error) return false;
  return /min_sale_end/i.test(error.message ?? "");
}

/** release_date 欄位還不存在的錯誤（migration 未跑）。 */
function isReleaseColumnError(error: RawGamesPage["error"]): boolean {
  if (!error) return false;
  return /release_date/i.test(error.message ?? "");
}

/** price_country_list 欄位還不存在的錯誤（migration 未跑）。 */
function isPriceCountryListColumnError(
  error: RawGamesPage["error"]
): boolean {
  if (!error) return false;
  return /price_country_list/i.test(error.message ?? "");
}

/** is_unnamed 欄位還不存在的錯誤（migration 20261118_unnamed_games.sql 未跑）。
 *  檢視／games 表任一缺此欄位時，查詢會報 "column ... is_unnamed does not exist"
 * （PostgREST 42703／PGRST204）。此時根本還沒有未具名遊戲（匯入腳本也需要
 *  此欄位才能寫入），所以退回「不過濾」是安全的，見 fetchGamesPagePublicCore。 */
function isUnnamedColumnError(error: RawGamesPage["error"]): boolean {
  if (!error) return false;
  return /is_unnamed/i.test(error.message ?? "");
}

/** PostgREST 416「Requested range not satisfiable」（PGRST103）：
 *  .range() 的頁碼超出總筆數。不是查詢失敗——呼叫端應改跑一次
 *  head count 取正確總數、回空頁＋正確 totalPages，讓頁面層的
 *  「越界導回最後一頁」生效，而不是把錯誤當成 error 回傳。 */
function isRangeNotSatisfiableError(
  error: { message?: string | null; code?: string | null } | null
): boolean {
  if (!error) return false;
  if (error.code === "PGRST103") return true;
  return /requested range not satisfiable/i.test(error.message ?? "");
}

/** 當頁 12 款的價格、讚數、收藏數（公開資料，可快取；不含個人狀態）。 */
export async function fetchExtrasForIds(
  db: SupabaseClient,
  ids: string[]
): Promise<{
  prices: Price[];
  likeCount: Map<string, number>;
  collectionCount: Map<string, number>;
}> {
  const [pricesRes, likesRes, collRes] = await Promise.all([
    db.from("prices").select("*").in("game_id", ids),
    db.from("game_likes").select("game_id").in("game_id", ids),
    db.from("collections").select("game_id").in("game_id", ids),
  ]);
  const prices = (pricesRes.data as Price[] | null) ?? [];
  const likeCount = new Map<string, number>();
  ((likesRes.data as { game_id: string }[] | null) ?? []).forEach((r) =>
    likeCount.set(r.game_id, (likeCount.get(r.game_id) ?? 0) + 1)
  );
  const collectionCount = new Map<string, number>();
  ((collRes.data as { game_id: string }[] | null) ?? []).forEach((r) =>
    collectionCount.set(r.game_id, (collectionCount.get(r.game_id) ?? 0) + 1)
  );
  return { prices, likeCount, collectionCount };
}

/** 首頁公開資料核心（可進 unstable_cache）：分頁列＋價格／讚數／收藏數。
 *  個人狀態（我是否按讚／收藏／購買）不在這裡，由 overlayMyGameFlags
 *  在呼叫端即時補上，所以快取絕不會把 A 的狀態發給 B。
 *  退回邏輯（與舊版一致）：檢視未建時改用 games 表；「上市日期」排序
 *  在 release_date 欄位未建時自動退回名稱排序（migration 跑完後，
 *  快取到期 1 小時內自動恢復上市日期排序）。 */
export async function fetchGamesPagePublicCore(
  db: SupabaseClient,
  args: GamesPagePublicArgs
): Promise<GamesPageResult> {
  const page = Math.max(1, args.page ?? 1);
  const empty: GamesPageResult = { games: [], total: 0, page, totalPages: 0 };

  const lists: GamesPageListIds = {
    mineIds: args.mineIds,
    excludePurchasedIds: args.excludePurchasedIds,
  };

  // 嘗試順序：(檢視, 原排序) → 欄位缺失退回名稱排序 → 檢視缺失改用 games 表
  //   → is_unnamed 欄位缺失退回不過濾（migration 未跑時的短暫狀態）
  //   → min_sale_end 欄位缺失時「特價優先」退回折扣排序
  //   → price_country_list 欄位缺失時國家篩選暫時關閉（顯示全部遊戲）。
  let source: "games_with_price_stats" | "games" = "games_with_price_stats";
  let useStats = true;
  let sort = args.sort ?? "deals";
  let filterUnnamed = true;
  let filterCountry = true;
  let res: RawGamesPage | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetchGamesPageRows(
      db,
      { ...args, sort },
      source,
      useStats,
      lists,
      filterUnnamed,
      filterCountry
    );
    if (!res.error) break;
    if (isViewMissingError(res.error) && source === "games_with_price_stats") {
      console.warn(
        "[data] games_with_price_stats 檢視不存在，改用 games 表（最低價／折扣排序暫時退為名稱排序；請套用 supabase/migrations/20261117_homepage_price_stats.sql）。"
      );
      useStats = false;
      source = "games";
      continue;
    }
    if (isSaleEndColumnError(res.error) && sort === "deals") {
      console.warn(
        "[data] min_sale_end 欄位不存在，「特價優先」排序暫時退為折扣排序；請套用 supabase/migrations/20261118_add_min_sale_end.sql。"
      );
      sort = "discount";
      continue;
    }
    if (isPriceCountryListColumnError(res.error) && filterCountry) {
      console.warn(
        "[data] price_country_list 欄位不存在，國家篩選暫時關閉；請套用 supabase/migrations/20261119_add_price_country_list.sql。"
      );
      filterCountry = false;
      continue;
    }
    if (isReleaseColumnError(res.error) && sort === "release") {
      console.warn(
        "[data] release_date 欄位不存在，「上市日期」排序暫時退為名稱排序；請套用 supabase/migrations/20261118_add_release_date.sql。"
      );
      sort = "title";
      continue;
    }
    if (isUnnamedColumnError(res.error) && filterUnnamed) {
      console.warn(
        "[data] is_unnamed 欄位不存在，未具名過濾暫時關閉（此時尚無未具名遊戲）；請套用 supabase/migrations/20261118_unnamed_games.sql。"
      );
      filterUnnamed = false;
      continue;
    }
    break;
  }
  if (!res || res.error || !res.data) {
    if (res?.error) console.warn("[data] 首頁查詢失敗：", res.error.message);
    // 失敗的空結果要帶 error 回去——呼叫端（快取層）靠它判斷不寫快取，
    // 頁面靠它顯示「資料載入失敗」而非誤寫「尚未匯入種子資料」。
    return { ...empty, error: res?.error?.message ?? "首頁查詢失敗" };
  }
  const total = res.count ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / HOME_PAGE_SIZE) : 0;
  const games = res.data;
  if (games.length === 0) return { games: [], total, page, totalPages };

  const ids = games.map((g) => g.id);
  const extras = await fetchExtrasForIds(db, ids);
  // 價格查詢失手時（Supabase 瞬斷）extras.prices 會是空陣列；此時名單上
  // 的遊戲在 view 裡明明有價（國家篩選已保證每款至少在一個可見國家有價），
  // 絕不能把「有名單、沒價格」的半空結果快取 1 小時（2026-11-25 台港
  // 第一頁快取中毒：卡片全顯示「可見國家尚無價格」）。回 error，讓快取層
  // 不寫快取、下次請求重查。只看我的收藏不套用：那是使用者自己的清單，
  // 收藏的遊戲有可能真的沒有價格；退回模式（view 不存在）也不套用。
  if (useStats && !args.onlyMine && extras.prices.length === 0) {
    return {
      ...empty,
      total,
      page,
      totalPages,
      error: "價格讀取失敗，請重整再試",
    };
  }
  let result = games.map((g) =>
    toGameWithPrices(
      g,
      extras.prices,
      extras.likeCount.get(g.id) ?? 0,
      extras.collectionCount.get(g.id) ?? 0
    )
  );
  // 退回模式且只看特價：檢視的 has_sale 不能用，改用當頁價格過濾
  //（總數會是未過濾的數字，僅出現在 migration 尚未套用的短暫期間）。
  if (args.onlySale && !useStats) {
    result = result.filter((g) => isOnSale(g.prices));
  }
  return { games: result, total, page, totalPages };
}

/** 即時補上個人狀態（我是否按讚／收藏／已購買）：永遠即時查、不快取。
 *  userId 為 null 時原樣回傳。呼叫端在快取的公開結果上套用，確保
 *  個人狀態永遠是當下登入者自己的、不會從快取漏給別人。 */
export async function overlayMyGameFlags(
  db: SupabaseClient,
  games: GameWithPrices[],
  userId: string | null
): Promise<GameWithPrices[]> {
  if (!userId || games.length === 0) return games;
  const ids = games.map((g) => g.id);
  const [myLikesRes, myCollRes, myPurchRes] = await Promise.all([
    db
      .from("game_likes")
      .select("game_id")
      .in("game_id", ids)
      .eq("user_id", userId),
    db
      .from("collections")
      .select("game_id")
      .in("game_id", ids)
      .eq("user_id", userId),
    db
      .from("user_purchases")
      .select("game_id")
      .in("game_id", ids)
      .eq("user_id", userId),
  ]);
  const myLikeSet = new Set(
    ((myLikesRes.data as { game_id: string }[] | null) ?? []).map(
      (r) => r.game_id
    )
  );
  const myCollectionSet = new Set(
    ((myCollRes.data as { game_id: string }[] | null) ?? []).map(
      (r) => r.game_id
    )
  );
  const myPurchaseSet = new Set(
    ((myPurchRes.data as { game_id: string }[] | null) ?? []).map(
      (r) => r.game_id
    )
  );
  return games.map((g) => ({
    ...g,
    liked_by_me: myLikeSet.has(g.id),
    collected_by_me: myCollectionSet.has(g.id),
    purchased_by_me: myPurchaseSet.has(g.id),
  }));
}

/** 首頁分頁查詢：搜尋／篩選／排序／總數都在資料庫做，每頁 12 款。
 *  （即時版；頁面改走 lib/cached-data.ts 的快取版，邏輯相同。）
 *  注意：最低價／折扣排序是「全部國家」的最低價／最大折扣，
 *  不是「可見國家」的（封鎖清單只存在瀏覽器 localStorage，伺服器不知道）；
 *  卡片上顯示的最低價仍依可見國家計算，與以前一致。
 *  登入後，已購買的遊戲不顯示在遊戲牆／搜尋結果裡（伺服器端排除）；
 *  總數顯示維持全站總數（不過濾已購買），只看我的收藏／只看已購買
 *  是使用者自己的清單，不排除。 */
export async function getGamesPage(
  db: SupabaseClient,
  opts: GamesPageFilters
): Promise<GamesPageResult> {
  const page = Math.max(1, opts.page ?? 1);
  const empty: GamesPageResult = { games: [], total: 0, page, totalPages: 0 };

  if (opts.onlyMine && !opts.userId) return empty;

  // 個人 id 清單即時取（小查詢，不快取；它們同時是快取鍵的一部分，
  // 所以收藏／購買一變，下次就是新的 key，不會拿到舊的排除結果）。
  let mineIds: string[] | null = null;
  let excludePurchasedIds: string[] = [];
  if (opts.onlyMine) {
    mineIds = await getUserCollectionGameIds(db, opts.userId!);
  }
  // 排除已購買：登入時預設排除（一般遊戲牆／搜尋）；只看我的收藏是
  // 使用者自己的清單，不排除；excludePurchased=false 時不排除。
  if (opts.userId && !opts.onlyMine && opts.excludePurchased !== false) {
    excludePurchasedIds = await getUserPurchaseGameIds(db, opts.userId);
  }

  const result = await fetchGamesPagePublicCore(db, {
    q: opts.q,
    platform: opts.platform,
    productType: opts.productType,
    demo: opts.demo,
    sort: opts.sort,
    onlySale: opts.onlySale,
    onlyMine: opts.onlyMine,
    excludePurchased: opts.excludePurchased,
    page: opts.page,
    mineIds,
    excludePurchasedIds,
  });
  if (!opts.userId) return result;
  return {
    ...result,
    games: await overlayMyGameFlags(db, result.games, opts.userId),
  };
}

/** 已知商品類型（app/switch-price/page.tsx 的 PRODUCT_TYPES 同步）。
 *  2026-11-23 修正：舊寫法是 product_type 排序後取前 1,000 列再去重，
 *  bundle 破千列後前 1,000 列全是 bundle，結果永遠只有 ["bundle"]，
 *  牆上 DLC 按鈕消失。改成逐一 existence check，只回傳 DB 裡真的有的
 *  類型；game 含 product_type 為 NULL 的舊列。不要用加大 limit 的做法，
 *  那只是把問題往後推。 */
const KNOWN_PRODUCT_TYPES = ["game", "dlc", "bundle", "subscription"] as const;

export async function getProductTypes(
  db: SupabaseClient
): Promise<string[]> {
  const checks = await Promise.all(
    KNOWN_PRODUCT_TYPES.map(async (t) => {
      const query = db.from("games").select("id").limit(1);
      const { data, error } =
        t === "game"
          ? await query.or("product_type.is.null,product_type.eq.game")
          : await query.eq("product_type", t);
      return !error && data && data.length > 0 ? t : null;
    })
  );
  const types = checks.filter(
    (t): t is (typeof KNOWN_PRODUCT_TYPES)[number] => t !== null
  );
  return types.length > 0 ? types : ["game"];
}

/** 全部價格裡最新的 updated_at（首頁「價格最後更新時間」用）。 */
export async function getLatestPriceUpdate(
  db: SupabaseClient
): Promise<string | null> {
  const { data, error } = await db
    .from("prices")
    .select("updated_at")
    .not("updated_at", "is", null)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return (data[0] as { updated_at: string | null }).updated_at ?? null;
}

/** 讀單一遊戲的公開資料（可快取）：遊戲＋價格＋讚數／收藏數。
 *  個人狀態不在這裡，由 overlayMyGameFlags 即時補。 */
export async function fetchGamePublicCore(
  db: SupabaseClient,
  slug: string
): Promise<GameWithPrices | null> {
  const { data: game, error } = await db
    .from("games")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !game) {
    if (error) console.warn("[data] game 讀取失敗：", error.message);
    return null;
  }
  const { data: prices } = await db
    .from("prices")
    .select("*")
    .eq("game_id", (game as Game).id);
  const [likes, collections] = await Promise.all([
    db
      .from("game_likes")
      .select("id", { count: "exact", head: true })
      .eq("game_id", (game as Game).id),
    db
      .from("collections")
      .select("id", { count: "exact", head: true })
      .eq("game_id", (game as Game).id),
  ]);
  return toGameWithPrices(
    game as Game,
    (prices as Price[]) ?? [],
    likes.count ?? 0,
    collections.count ?? 0
  );
}

/** 讀單一遊戲（詳細頁用；即時版，頁面改走快取版，邏輯相同）。 */
export async function getGameBySlug(
  db: SupabaseClient,
  slug: string,
  userId?: string | null
): Promise<GameWithPrices | null> {
  const game = await fetchGamePublicCore(db, slug);
  if (!game) return null;
  if (!userId) return game;
  const [overlaid] = await overlayMyGameFlags(db, [game], userId);
  return overlaid;
}

/** 依 id 清單讀遊戲的公開資料（可快取）：遊戲＋價格＋讚數／收藏數。
 *  回傳順序與傳入的 ids 一致（找不到的跳過）。 */
export async function fetchGamesByIdsPublic(
  db: SupabaseClient,
  ids: string[]
): Promise<GameWithPrices[]> {
  if (ids.length === 0) return [];
  const { data: games } = await db
    .from("games")
    .select(GAME_COLUMNS)
    .in("id", ids);
  if (!games) return [];
  const extras = await fetchExtrasForIds(db, ids);
  const byId = new Map<string, Game>(
    (games as Game[]).map((g) => [g.id, g])
  );
  return ids.flatMap((id) => {
    const g = byId.get(id);
    if (!g) return [];
    return [
      toGameWithPrices(
        g,
        extras.prices,
        extras.likeCount.get(id) ?? 0,
        extras.collectionCount.get(id) ?? 0
      ),
    ];
  });
}

/** 讀最新一期匯率快照（date_key 最新的那一批）。回傳 { rates, dateKey, asOf }。 */
export async function getLatestFx(
  db: SupabaseClient
): Promise<{ rates: FxRate[]; dateKey: string | null; asOf: string | null }> {
  const { data, error } = await db
    .from("fx_rates")
    .select("*")
    .order("date_key", { ascending: false })
    .order("currency")
    .limit(60);
  if (error || !data || data.length === 0) {
    if (error) console.warn("[data] fx_rates 讀取失敗：", error.message);
    return { rates: [], dateKey: null, asOf: null };
  }
  const rows = data as FxRate[];
  const dateKey = rows[0].date_key;
  const rates = rows.filter((r) => r.date_key === dateKey);
  return { rates, dateKey, asOf: rates[0]?.as_of ?? null };
}

/** 讀某遊戲留言（依讚數排序在前端做；這裡回傳原始留言 + 讚數 + 我是否按過讚）。
 * blockedUserIds：被封鎖者的 UUID 集合，過濾掉他們的留言（封鎖不刪文，
 * 解封後恢復顯示）。 */
export async function getComments(
  db: SupabaseClient,
  gameId: string,
  userId?: string | null,
  blockedUserIds?: ReadonlySet<string>
): Promise<CommentItem[]> {
  const { data, error } = await db
    .from("comments")
    .select("*")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false });
  if (error || !data) {
    if (error) console.warn("[data] comments 讀取失敗：", error.message);
    return [];
  }
  // 封鎖過濾：被封鎖者的留言不顯示。
  const rows =
    blockedUserIds && blockedUserIds.size > 0
      ? (data as Record<string, unknown>[]).filter(
          (c) => !blockedUserIds.has(c.user_id as string)
        )
      : (data as Record<string, unknown>[]);
  const ids = rows.map((c) => c.id as string);
  const [likes, myLikes] = await Promise.all([
    ids.length > 0
      ? db.from("comment_likes").select("comment_id").in("comment_id", ids)
      : Promise.resolve({ data: [] as { comment_id: string }[] }),
    userId && ids.length > 0
      ? db
          .from("comment_likes")
          .select("comment_id")
          .in("comment_id", ids)
          .eq("user_id", userId)
      : Promise.resolve({ data: [] as { comment_id: string }[] }),
  ]);
  const likeCount = new Map<string, number>();
  (likes.data ?? []).forEach((r: { comment_id: string }) =>
    likeCount.set(r.comment_id, (likeCount.get(r.comment_id) ?? 0) + 1)
  );
  const myLikeSet = new Set((myLikes.data ?? []).map((r) => r.comment_id));
  return rows.map((c) => ({
    id: c.id as string,
    game_id: c.game_id as string,
    // 不回傳 user_id：前端只顯示 author_name，留言者的 UUID 不應隨詳情頁
    // 送給所有訪客（CommentItem.user_id 欄位保留型別相容，值固定為 null）。
    user_id: null,
    author_name:
      (c.author_name as string | null) ??
      (c.nickname as string | null) ??
      null,
    body: (c.body as string) ?? "",
    created_at: (c.created_at as string | null) ?? null,
    likes_count: likeCount.get(c.id as string) ?? 0,
    liked_by_me: myLikeSet.has(c.id as string),
    // 一層回覆：這裡用 select("*")，migration（20261124_add_comment_parent）
    // 還沒跑時欄位不存在也不會報錯，值就是 null、只回上層留言，GET 不 500。
    parent_comment_id: (c.parent_comment_id as string | null) ?? null,
  }));
}

/** 讀某使用者的收藏遊戲 id 清單。 */
export async function getUserCollectionGameIds(
  db: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data, error } = await db
    .from("collections")
    .select("game_id")
    .eq("user_id", userId);
  if (error || !data) return [];
  return (data as { game_id: string }[]).map((r) => r.game_id);
}

/** 讀某使用者的已購買遊戲 id 清單。 */
export async function getUserPurchaseGameIds(
  db: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data, error } = await db
    .from("user_purchases")
    .select("game_id")
    .eq("user_id", userId);
  if (error || !data) return [];
  return (data as { game_id: string }[]).map((r) => r.game_id);
}

/** 某使用者已收藏且正在特價的遊戲（首頁進站提醒、詳細頁提醒用）。 */
export async function getCollectedOnSale(
  db: SupabaseClient,
  userId: string
): Promise<CollectedOnSale[]> {
  const ids = await getUserCollectionGameIds(db, userId);
  if (ids.length === 0) return [];
  const { data: games } = await db.from("games").select("*").in("id", ids);
  const { data: prices } = await db
    .from("prices")
    .select("*")
    .in("game_id", ids);
  if (!games) return [];
  const result: CollectedOnSale[] = [];
  for (const g of games as Game[]) {
    const ps = ((prices as Price[]) ?? []).filter((p) => p.game_id === g.id);
    const salePrices = ps.filter(isPriceOnSale);
    if (salePrices.length === 0) continue;
    result.push({
      game: { ...g, cover_url: resolveCoverUrl(g.cover_url) },
      cheapest_sale: cheapestPrice(salePrices),
    });
  }
  return result.sort(
    (a, b) =>
      (a.cheapest_sale?.price_twd ?? Infinity) -
      (b.cheapest_sale?.price_twd ?? Infinity)
  );
}

/** 收藏排行 TOP 10。onlyOnSale=true 時只顯示特價中（預設）。
 *  只看有收藏的遊戲：先彙總 collections 再分批抓遊戲、價格、讚數，
 *  不再一次載入全部遊戲（舊版會撞上 PostgREST 1,000 筆上限）。
 *  注意：與舊版差一點——舊版在收藏數不足 50 款時會用 0 收藏的遊戲補滿，
 *  新版只列有收藏的遊戲（0 收藏的遊戲本來就不該出現在「收藏排行」）。 */
export async function getRanking(
  db: SupabaseClient,
  onlyOnSale = true,
  limit = 10
): Promise<RankingEntry[]> {
  // 1. 全部收藏彙總（range 迴圈，突破 1,000 筆上限）。
  const counts = new Map<string, number>();
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("collections")
      .select("game_id")
      .range(from, from + 999);
    if (error || !data) {
      if (error) console.warn("[data] collections 讀取失敗：", error.message);
      return [];
    }
    (data as { game_id: string }[]).forEach((r) =>
      counts.set(r.game_id, (counts.get(r.game_id) ?? 0) + 1)
    );
    if (data.length < 1000) break;
    from += 1000;
  }
  if (counts.size === 0) return [];
  const rankedIds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // 2. 分批抓遊戲、價格、讚數（每批 200 個 id，避免 URL 過長）。
  const gamesById = new Map<string, Game>();
  const pricesByGame = new Map<string, Price[]>();
  const likeCounts = new Map<string, number>();
  for (let i = 0; i < rankedIds.length; i += 200) {
    const batch = rankedIds.slice(i, i + 200);
    const [gamesRes, pricesRes, likesRes] = await Promise.all([
      db.from("games").select(GAME_COLUMNS).in("id", batch),
      db.from("prices").select("*").in("game_id", batch),
      db.from("game_likes").select("game_id").in("game_id", batch),
    ]);
    ((gamesRes.data as Game[] | null) ?? []).forEach((g) =>
      gamesById.set(g.id, g)
    );
    ((pricesRes.data as Price[] | null) ?? []).forEach((p) => {
      const list = pricesByGame.get(p.game_id) ?? [];
      list.push(p);
      pricesByGame.set(p.game_id, list);
    });
    ((likesRes.data as { game_id: string }[] | null) ?? []).forEach((r) =>
      likeCounts.set(r.game_id, (likeCounts.get(r.game_id) ?? 0) + 1)
    );
  }

  const entries: RankingEntry[] = rankedIds.flatMap((id) => {
    const g = gamesById.get(id);
    if (!g) return [];
    const ps = pricesByGame.get(id) ?? [];
    return [
      {
        game: { ...g, cover_url: resolveCoverUrl(g.cover_url) },
        collections_count: counts.get(id) ?? 0,
        likes_count: likeCounts.get(id) ?? 0,
        cheapest: cheapestPrice(ps),
        on_sale: isOnSale(ps),
        sale_end: saleEndOf(ps),
      },
    ];
  });
  const filtered = onlyOnSale ? entries.filter((e) => e.on_sale) : entries;
  return filtered.slice(0, limit);
}

/** 全部價格裡最新的 updated_at（首頁「價格最後更新時間」用）。 */
export function latestPriceUpdate(prices: Price[]): string | null {
  const times = prices
    .map((p) => p.updated_at)
    .filter((t): t is string => Boolean(t))
    .sort();
  return times.length > 0 ? times[times.length - 1] : null;
}

// ============================================================================
// 接近歷史低價（/near-low）
// ----------------------------------------------------------------------------
// 規則（寫死在程式裡，頁面也顯示）：
//   最低價（全部國家換算台幣後）> 歷史低價，且 <= 歷史低價 × 1.10。
//   也就是「現在買只比歷史最低貴 0–10%」，但還沒等於歷史低價。
//   歷史低價為 0／NULL、或尚無價格的遊戲不列入。
//   排序：離歷史低價越近（比值越小）越前面；比值相同時 id 收尾。
// 實作（2026-11-23 改版，不要照抄舊的全掃描）：
//   主路徑：migration 20261123_add_is_near_historical_low.sql 給
//     games_with_price_stats 加 is_near_historical_low 與 near_low_ratio
//     欄位，DB 層直接篩選＋排序＋分頁，單一查詢（跟 /historical-low 的
//     is_at_historical_low 同一套做法）。PostgREST 不能直接比較兩個欄位，
//     所以比值先算成 view 欄位。
//   備援路徑（migration 還沒套用、欄位不存在時）：舊的
//     fetchNearLowCandidates 全掃描（13 頁全掃 12,102 列，慢、偶爾超時，
//     只是過渡；套用 migration 後自動切回主路徑）。
//   只列遊戲本體：DLC／組合包（product_type dlc／bundle）不進這頁，
//   跟首頁遊戲牆的預設篩選一致（見 buildFilteredGamesQuery）。
// ============================================================================

/** 接近歷史低價的比值上限：最低價 <= 歷史低價 × 1.10。 */
export const NEAR_LOW_MAX_RATIO = 1.1;

export interface NearLowCandidate {
  id: string;
  /** 最低價 ÷ 歷史低價（>1 且 <= 1.1 才算接近）。 */
  ratio: number;
  /** 目前最低價的國家（migration 20261120 未跑時為 null，國家篩選不生效）。 */
  cheapestCountry: string | null;
}

/** 掃描全部有歷史低價與價格的遊戲，算出接近歷史低價的候選清單
 *  （已按比值由小到大排好）。失敗時回傳 error，不拋錯。
 *  備援路徑專用：只有 view 欄位 is_near_historical_low 還沒建時，
 *  fetchNearLowPagePublic 才呼叫它（慢、偶爾超時，只是過渡）；套用
 *  migration 後頁面改走單一查詢，不再經過這裡。
 *  未具名遊戲（games.is_unnamed）不列入：每日更新會幫它們寫
 *  historical_low_twd（見 app/api/refresh/route.ts），特價結束漲價後
 *  比值會落進 1.0–1.1 區間，若不排除就會以「未命名商品」出現在此頁。
 *  is_unnamed 欄位還沒建（migration 20261118_unnamed_games.sql 未跑）
 *  時退回不過濾——此時尚無未具名遊戲，退回是安全的。 */
export async function fetchNearLowCandidates(
  db: SupabaseClient
): Promise<{ candidates: NearLowCandidate[]; error: string | null }> {
  const scan = async (filterUnnamed: boolean, withCountry: boolean) => {
    const rows: {
      id: string;
      cheapest: number;
      hist: number;
      cheapestCountry: string | null;
    }[] = [];
    let from = 0;
    for (;;) {
      let q = db
        .from("games_with_price_stats")
        .select(
          withCountry
            ? "id,cheapest_twd,historical_low_twd,cheapest_country"
            : "id,cheapest_twd,historical_low_twd"
        )
        .not("cheapest_twd", "is", null)
        .not("historical_low_twd", "is", null);
      if (filterUnnamed) q = q.eq("is_unnamed", false);
      const { data, error } = await q
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error || !data) {
        return { rows, error: error?.message ?? "讀取失敗" };
      }
      // select 是動態字串（有／無 cheapest_country 兩種），Supabase 的
      // 型別推斷會算出聯集，先轉 unknown 再轉列型別。
      for (const r of data as unknown as {
        id: string;
        cheapest_twd: number;
        historical_low_twd: number;
        cheapest_country?: string | null;
      }[]) {
        if (r.historical_low_twd > 0) {
          rows.push({
            id: r.id,
            cheapest: r.cheapest_twd,
            hist: r.historical_low_twd,
            cheapestCountry: withCountry ? (r.cheapest_country ?? null) : null,
          });
        }
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    return { rows, error: null as string | null };
  };

  let filterUnnamed = true;
  let withCountry = true;
  let result = await scan(filterUnnamed, withCountry);
  if (result.error && /is_unnamed/i.test(result.error)) {
    console.warn(
      "[data] is_unnamed 欄位不存在，接近歷史低價暫時不過濾未具名遊戲；請套用 supabase/migrations/20261118_unnamed_games.sql。"
    );
    filterUnnamed = false;
    result = await scan(filterUnnamed, withCountry);
  }
  if (result.error && /cheapest_country/i.test(result.error)) {
    console.warn(
      "[data] cheapest_country 欄位不存在，接近歷史低價暫時不支援國家篩選；請套用 supabase/migrations/20261120_add_cheapest_country.sql。"
    );
    withCountry = false;
    result = await scan(filterUnnamed, withCountry);
  }
  if (result.error) return { candidates: [], error: result.error };
  const rows = result.rows;
  const candidates = rows
    .map((r) => ({
      id: r.id,
      ratio: r.cheapest / r.hist,
      cheapestCountry: r.cheapestCountry,
    }))
    .filter((c) => c.ratio > 1 && c.ratio <= NEAR_LOW_MAX_RATIO)
    .sort((a, b) => a.ratio - b.ratio || (a.id < b.id ? -1 : 1));
  return { candidates, error: null };
}

/** 候選清單切一頁（純函式；快取版與即時版共用）。
 *  country 有值時只留目前最低價在該國的遊戲；候選沒有國家資訊
 *  （cheapest_country 欄位未建）時不篩選，顯示全部。 */
export function paginateNearLow(
  candidates: NearLowCandidate[],
  page: number,
  country?: string
): { slice: NearLowCandidate[]; total: number; totalPages: number } {
  const p = Math.max(1, page);
  const hasCountry = candidates.some((c) => c.cheapestCountry != null);
  const filtered =
    country && hasCountry
      ? candidates.filter((c) => c.cheapestCountry === country)
      : candidates;
  const total = filtered.length;
  return {
    slice: filtered.slice((p - 1) * NEAR_LOW_PAGE_SIZE, p * NEAR_LOW_PAGE_SIZE),
    total,
    totalPages: total > 0 ? Math.ceil(total / NEAR_LOW_PAGE_SIZE) : 0,
  };
}

export interface NearLowPageResult {
  games: GameWithPrices[];
  /** 每款遊戲的比值（最低價 ÷ 歷史低價），顯示「比歷史低貴 X%」用。 */
  ratios: Record<string, number>;
  total: number;
  page: number;
  totalPages: number;
  error: string | null;
}

/** 主路徑：view 欄位 is_near_historical_low 直接篩選＋排序＋分頁（單一查詢）。
 *  欄位不存在時回傳 { error } 且 error 帶欄位名，呼叫端改走備援路徑。
 *  只列遊戲本體（product_type game／NULL），DLC／組合包不進這頁。 */
async function fetchNearLowPageByView(
  db: SupabaseClient,
  page: number,
  country?: string
): Promise<NearLowPageResult> {
  const p = Math.max(1, page);
  const from = (p - 1) * NEAR_LOW_PAGE_SIZE;
  const build = (filterUnnamed: boolean, headCount: boolean) => {
    let q = db
      .from("games_with_price_stats")
      .select(
        "id,near_low_ratio",
        headCount ? { count: "exact", head: true } : { count: "exact" }
      )
      .eq("is_near_historical_low", true)
      .or("product_type.eq.game,product_type.is.null")
      .order("near_low_ratio", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    if (filterUnnamed) q = q.eq("is_unnamed", false);
    if (country) q = q.eq("cheapest_country", country);
    return q;
  };
  // 越界頁碼的 head count（PostgREST 416 時用）：回正確 total，
  // 不要把 416 當錯誤，頁面層的「越界導回最後一頁」才能生效。
  const fetchTotal = async (filterUnnamed: boolean): Promise<number | null> => {
    const res = await build(filterUnnamed, true);
    if (res.error) {
      if (/is_unnamed/i.test(res.error.message) && filterUnnamed) {
        return fetchTotal(false);
      }
      return null;
    }
    return res.count ?? null;
  };
  let filterUnnamed = true;
  let res = await build(true, false).range(from, from + NEAR_LOW_PAGE_SIZE - 1);
  if (res.error && /is_unnamed/i.test(res.error.message)) {
    // is_unnamed 欄位不存在時退回不過濾（migration 未跑的舊庫才會發生）。
    filterUnnamed = false;
    res = await build(false, false).range(from, from + NEAR_LOW_PAGE_SIZE - 1);
  }
  if (res.error) {
    if (isRangeNotSatisfiableError(res.error)) {
      const total = await fetchTotal(filterUnnamed);
      if (total != null) {
        return {
          games: [],
          ratios: {},
          total,
          page: p,
          totalPages: total > 0 ? Math.ceil(total / NEAR_LOW_PAGE_SIZE) : 0,
          error: null,
        };
      }
    }
    return {
      games: [],
      ratios: {},
      total: 0,
      page: p,
      totalPages: 0,
      error: res.error.message,
    };
  }
  const rows = (res.data ?? []) as {
    id: string;
    near_low_ratio: number | null;
  }[];
  const games = await fetchGamesByIdsPublic(
    db,
    rows.map((r) => r.id)
  );
  const ratios: Record<string, number> = {};
  for (const r of rows) {
    if (r.near_low_ratio != null) ratios[r.id] = Number(r.near_low_ratio);
  }
  const total = res.count ?? 0;
  return {
    games,
    ratios,
    total,
    page: p,
    totalPages: total > 0 ? Math.ceil(total / NEAR_LOW_PAGE_SIZE) : 0,
    error: null,
  };
}

/** 接近歷史低價列表頁（即時版；頁面改走快取版，邏輯相同）。 */
export async function fetchNearLowPagePublic(
  db: SupabaseClient,
  page: number,
  country?: string
): Promise<NearLowPageResult> {
  const p = Math.max(1, page);
  const byView = await fetchNearLowPageByView(db, p, country);
  if (!byView.error) return byView;
  // 只有 view 欄位不存在時才走備援；其他錯誤直接回報（頁面顯示資料準備中）。
  if (/is_near_historical_low|near_low_ratio/i.test(byView.error)) {
    console.warn(
      "[data] is_near_historical_low 欄位不存在，接近歷史低價改走全掃描備援；請套用 supabase/migrations/20261123_add_is_near_historical_low.sql。"
    );
    const { candidates, error } = await fetchNearLowCandidates(db);
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
      db,
      slice.map((c) => c.id)
    );
    const ratios: Record<string, number> = {};
    for (const c of slice) ratios[c.id] = c.ratio;
    return { games, ratios, total, page: p, totalPages, error: null };
  }
  return byView;
}

// ============================================================================
// 歷史低價（/historical-low）
// ----------------------------------------------------------------------------
// 規則：目前最低價 = 歷史低價（比值正好 = 1）的遊戲。
//   這正是 /near-low 收不到的區間：那頁只收 1 < 比值 <= 1.1，
//   比值 = 1 的遊戲（2026-11-23 實測 8,329 款，全部是具名遊戲）
//   一款都不在裡面，shawn 問得沒錯，所以獨立成頁。
//   還沒特價過的遊戲也在這裡（原價就是歷史最低價），只是排在後面；
//   排序：折扣最大優先，再按最低價由低到高、id 收尾。
// 實作（不要照抄 /near-low 的全掃描：13 頁全掃 12,175 列、常超時壞掉）：
//   主路徑：migration 20261123_add_is_at_historical_low.sql 給
//     games_with_price_stats 加 is_at_historical_low 欄位
//     （cheapest_twd = historical_low_twd），DB 層直接篩選＋分頁，
//     單一查詢（filter + order + range + count=exact）。
//   備援路徑（migration 還沒套用、欄位不存在時）：prices 表的
//     is_historical_low 旗標（refresh／catalog-sync 在寫入時算好：
//     該國現價 <= 歷史低價時為 true）由 DB 先篩選，只取符合的列
//     （2026-11-23 實測 9,396 列／9,282 款），程式端只做去重＋排序＋
//     切頁；顯示前再用即時查到的 cheapest／historical_low 驗證一次，
//     過期的剔掉。備援總數會比主路徑多約 11%（旗標最多約 4 天沒更新），
//     套用 migration 後自動切回主路徑。
// ============================================================================

/** 歷史低價每頁款數（比照 /near-low：100 款一頁）。 */
export const HISTORICAL_LOW_PAGE_SIZE = 100;

export interface HistoricalLowPageResult {
  games: GameWithPrices[];
  total: number;
  page: number;
  totalPages: number;
  error: string | null;
}

/** 主路徑：view 欄位 is_at_historical_low 直接篩選＋分頁（單一查詢）。
 *  欄位不存在時回傳 { error } 且 error 帶欄位名，呼叫端改走備援路徑。 */
async function fetchHistoricalLowPageByView(
  db: SupabaseClient,
  page: number,
  country?: string
): Promise<HistoricalLowPageResult> {
  const p = Math.max(1, page);
  const from = (p - 1) * HISTORICAL_LOW_PAGE_SIZE;
  const build = (filterUnnamed: boolean, headCount: boolean) => {
    let q = db
      .from("games_with_price_stats")
      .select(
        "id",
        headCount ? { count: "exact", head: true } : { count: "exact" }
      )
      .eq("is_at_historical_low", true)
      .or("product_type.eq.game,product_type.is.null")
      .order("max_discount_pct", { ascending: false, nullsFirst: false })
      .order("cheapest_twd", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    if (filterUnnamed) q = q.eq("is_unnamed", false);
    if (country) q = q.eq("cheapest_country", country);
    return q;
  };
  // 越界頁碼的 head count（PostgREST 416 時用）：回正確 total，
  // 不要把 416 當錯誤，頁面層的「越界導回最後一頁」才能生效。
  const fetchTotal = async (filterUnnamed: boolean): Promise<number | null> => {
    const res = await build(filterUnnamed, true);
    if (res.error) {
      if (/is_unnamed/i.test(res.error.message) && filterUnnamed) {
        return fetchTotal(false);
      }
      return null;
    }
    return res.count ?? null;
  };
  let filterUnnamed = true;
  let res = await build(true, false).range(
    from,
    from + HISTORICAL_LOW_PAGE_SIZE - 1
  );
  if (res.error && /is_unnamed/i.test(res.error.message)) {
    // is_unnamed 欄位不存在時退回不過濾（migration 未跑的舊庫才會發生）。
    filterUnnamed = false;
    res = await build(false, false).range(
      from,
      from + HISTORICAL_LOW_PAGE_SIZE - 1
    );
  }
  if (res.error) {
    if (isRangeNotSatisfiableError(res.error)) {
      const total = await fetchTotal(filterUnnamed);
      if (total != null) {
        return {
          games: [],
          total,
          page: p,
          totalPages:
            total > 0 ? Math.ceil(total / HISTORICAL_LOW_PAGE_SIZE) : 0,
          error: null,
        };
      }
    }
    return { games: [], total: 0, page: p, totalPages: 0, error: res.error.message };
  }
  const ids = ((res.data as { id: string }[] | null) ?? []).map((r) => r.id);
  const games = await fetchGamesByIdsPublic(db, ids);
  const total = res.count ?? 0;
  return {
    games,
    total,
    page: p,
    totalPages: total > 0 ? Math.ceil(total / HISTORICAL_LOW_PAGE_SIZE) : 0,
    error: null,
  };
}

interface HistoricalLowFallbackCandidate {
  id: string;
  /** 該遊戲所有歷史低價列裡的最大折扣％（排序用）。 */
  maxDiscount: number;
  /** 該遊戲歷史低價列裡的最低價（排序用）。 */
  cheapest: number;
  /** 最低價的國家（同價時取國家代碼較小者，與 view 的 cheapest_country 同規則）。 */
  cheapestCountry: string | null;
}

/** 備援路徑：prices.is_historical_low 由 DB 篩選後取回符合的列，去重＋排序＋切頁。
 *  只在主路徑的 view 欄位還沒建時用。 */
async function fetchHistoricalLowPageByFlag(
  db: SupabaseClient,
  page: number,
  country?: string
): Promise<HistoricalLowPageResult> {
  const p = Math.max(1, page);
  // 符合的列約 9,400 筆（1000 列一頁），3 批並行抓，約數秒。
  type FlagRow = {
    game_id: string;
    price_twd: number;
    discount_pct: number | null;
    country: string;
    verified?: boolean | null;
  };
  const fetchAll = async (
    withVerified: boolean
  ): Promise<{ rows: FlagRow[]; error: string | null }> => {
    const rows: FlagRow[] = [];
    let offset = 0;
    let done = false;
    while (!done) {
      const batchOffsets = [offset, offset + 1000, offset + 2000];
      const settled = await Promise.allSettled(
        batchOffsets.map((off) =>
          db
            .from("prices")
            .select(
              withVerified
                ? "game_id,price_twd,discount_pct,country,verified"
                : "game_id,price_twd,discount_pct,country"
            )
            .eq("is_historical_low", true)
            .not("price_twd", "is", null)
            .order("price_twd", { ascending: true })
            .range(off, off + 999)
        )
      );
      let fetched = 0;
      for (const s of settled) {
        if (s.status !== "fulfilled" || s.value.error || !s.value.data) {
          if (s.status === "fulfilled" && s.value.error) {
            return { rows, error: s.value.error.message };
          }
          continue;
        }
        const data = s.value.data as unknown as FlagRow[];
        fetched += data.length;
        rows.push(...data);
      }
      if (fetched < 3000) done = true;
      offset += 3000;
    }
    return { rows, error: null };
  };
  let fetched = await fetchAll(true);
  if (fetched.error && /verified/i.test(fetched.error)) {
    // verified 欄位還沒建（migration 未跑）：退回舊查詢，
    // 此時尚無未確認價格，全部視為已確認是安全的。
    console.warn(
      "[data] verified 欄位不存在，歷史低價備援暫時不區分未確認價格；請套用 price-verified-migration-20261124.sql。"
    );
    fetched = await fetchAll(false);
  }
  if (fetched.error) {
    return {
      games: [],
      total: 0,
      page: p,
      totalPages: 0,
      error: fetched.error,
    };
  }
  // 未確認價格不參與歷史低價計算：旗標是寫入時算的，未確認列
  // 也可能帶 is_historical_low = true，先在這裡濾掉。
  const rows = fetched.rows.filter(isVerifiedPrice);
  const byGame = new Map<string, HistoricalLowFallbackCandidate>();
  for (const r of rows) {
    const prev = byGame.get(r.game_id);
    const disc = r.discount_pct ?? 0;
    if (!prev) {
      byGame.set(r.game_id, {
        id: r.game_id,
        maxDiscount: disc,
        cheapest: r.price_twd,
        cheapestCountry: r.country,
      });
    } else {
      if (disc > prev.maxDiscount) prev.maxDiscount = disc;
      if (
        r.price_twd < prev.cheapest ||
        (r.price_twd === prev.cheapest &&
          (prev.cheapestCountry == null || r.country < prev.cheapestCountry))
      ) {
        prev.cheapest = r.price_twd;
        prev.cheapestCountry = r.country;
      }
    }
  }
  let candidates = [...byGame.values()];
  if (country) {
    candidates = candidates.filter((c) => c.cheapestCountry === country);
  }
  candidates.sort(
    (a, b) =>
      b.maxDiscount - a.maxDiscount || a.cheapest - b.cheapest || (a.id < b.id ? -1 : 1)
  );
  const total = candidates.length;
  const totalPages =
    total > 0 ? Math.ceil(total / HISTORICAL_LOW_PAGE_SIZE) : 0;
  const slice = candidates.slice(
    (p - 1) * HISTORICAL_LOW_PAGE_SIZE,
    p * HISTORICAL_LOW_PAGE_SIZE
  );
  const games = await fetchGamesByIdsPublic(
    db,
    slice.map((c) => c.id)
  );
  // 旗標可能過期（refresh 輪替約 4 天）：顯示前用即時價格驗證一次，
  // 最低價已經不等於歷史低價的剔掉（總數仍用旗標數，會略多，見上方說明）。
  // 只列遊戲本體：DLC／組合包不進這頁。
  const verified = games.filter((g) => {
    if (g.product_type != null && g.product_type !== "game") return false;
    const cheapest = cheapestPrice(g.prices);
    return (
      cheapest?.price_twd != null &&
      g.historical_low_twd != null &&
      cheapest.price_twd === g.historical_low_twd
    );
  });
  return { games: verified, total, page: p, totalPages, error: null };
}

/** 歷史低價列表頁（即時版；頁面改走快取版，邏輯相同）。 */
export async function fetchHistoricalLowPagePublic(
  db: SupabaseClient,
  page: number,
  country?: string
): Promise<HistoricalLowPageResult> {
  const p = Math.max(1, page);
  const byView = await fetchHistoricalLowPageByView(db, p, country);
  if (!byView.error) return byView;
  // 只有 view 欄位不存在時才走備援；其他錯誤直接回報（頁面顯示資料準備中）。
  if (/is_at_historical_low/i.test(byView.error)) {
    console.warn(
      "[data] is_at_historical_low 欄位不存在，歷史低價改走 prices 旗標備援；請套用 supabase/migrations/20261123_add_is_at_historical_low.sql。"
    );
    return fetchHistoricalLowPageByFlag(db, p, country);
  }
  return byView;
}

// ============================================================================
// 準備上市（/upcoming）
// ----------------------------------------------------------------------------
// 規則：release_date（上市日期）> 今天（台北日期）的遊戲，越快上市越前面。
//   今天上市的當天不列入（已經上市了，首頁遊戲牆看得到）。
//   沒有上市日期的遊戲不列入（不是排除在全站外，只是不出現在這區）。
// release_date 欄位還沒建（migration 未跑）或還沒有任何遊戲有上市日期時，
// 回傳 unavailable / hasAnyReleaseDate=false，頁面顯示「上市日期資料補充中」
// 而不是空白或壞掉。
// ============================================================================

export interface UpcomingPageResult {
  games: GameWithPrices[];
  total: number;
  page: number;
  totalPages: number;
  /** 全部遊戲裡至少有一款已有 release_date。 */
  hasAnyReleaseDate: boolean;
  /** release_date 欄位還不存在或查詢失敗（顯示「資料補充中」用）。 */
  unavailable: boolean;
}

/** 準備上市列表頁（即時版；頁面改走快取版，邏輯相同）。 */
export async function fetchUpcomingPagePublic(
  db: SupabaseClient,
  page: number
): Promise<UpcomingPageResult> {
  const p = Math.max(1, page);
  const empty: UpcomingPageResult = {
    games: [],
    total: 0,
    page: p,
    totalPages: 0,
    hasAnyReleaseDate: false,
    unavailable: true,
  };
  const today = taipeiDateKey();
  const { data, count, error } = await db
    .from("games")
    .select(GAME_COLUMNS + ",release_date", { count: "exact" })
    .gt("release_date", today)
    .order("release_date", { ascending: true })
    .order("id", { ascending: true })
    .range((p - 1) * UPCOMING_PAGE_SIZE, p * UPCOMING_PAGE_SIZE - 1);
  if (error || !data) {
    // 越界頁碼（PostgREST 416）：先跑一次 head count 取正確總數，
    // 回空頁＋正確 totalPages，不要把錯誤當成 unavailable，
    // 頁面層的「越界導回最後一頁」才能生效。
    if (error && isRangeNotSatisfiableError(error)) {
      const { count: totalCount, error: totalError } = await db
        .from("games")
        .select("id", { count: "exact", head: true })
        .gt("release_date", today);
      if (!totalError && totalCount != null) {
        const { count: datedCount } = await db
          .from("games")
          .select("id", { count: "exact", head: true })
          .not("release_date", "is", null);
        const total = totalCount;
        return {
          games: [],
          total,
          page: p,
          totalPages: total > 0 ? Math.ceil(total / UPCOMING_PAGE_SIZE) : 0,
          hasAnyReleaseDate: (datedCount ?? 0) > 0,
          unavailable: false,
        };
      }
    }
    if (error) console.warn("[data] 準備上市查詢失敗：", error.message);
    return empty;
  }
  const total = count ?? 0;
  // 是否已有任何上市日期資料（決定顯示「資料補充中」或「目前沒有即將上市」）。
  const { count: datedCount } = await db
    .from("games")
    .select("id", { count: "exact", head: true })
    .not("release_date", "is", null);
  const games = data as unknown as Game[];
  if (games.length === 0) {
    return {
      games: [],
      total,
      page: p,
      totalPages: total > 0 ? Math.ceil(total / UPCOMING_PAGE_SIZE) : 0,
      hasAnyReleaseDate: (datedCount ?? 0) > 0,
      unavailable: false,
    };
  }
  const ids = games.map((g) => g.id);
  const extras = await fetchExtrasForIds(db, ids);
  const result = games.map((g) =>
    toGameWithPrices(
      g,
      extras.prices,
      extras.likeCount.get(g.id) ?? 0,
      extras.collectionCount.get(g.id) ?? 0
    )
  );
  return {
    games: result,
    total,
    page: p,
    totalPages: Math.ceil(total / UPCOMING_PAGE_SIZE),
    hasAnyReleaseDate: (datedCount ?? 0) > 0,
    unavailable: false,
  };
}
