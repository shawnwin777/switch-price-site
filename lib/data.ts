// 直接用 Supabase client 讀公開資料（讀取走 client，寫入走 /api/* 合約）。
// 所有函式第一個參數都是 Supabase client（server 用 createSupabaseServerClient()，
// 瀏覽器用 createSupabaseBrowserClient()），查詢失敗時回傳空值、不拋錯，
// 所以 Supabase 專案不存在時頁面仍可建置與顯示「尚無資料」。
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";
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
      .sort((a, b) => (a.price_twd ?? Infinity) - (b.price_twd ?? Infinity)),
    likes_count: likesCount,
    collections_count: collectionsCount,
    liked_by_me: likedByMe,
    collected_by_me: collectedByMe,
    purchased_by_me: purchasedByMe,
  };
}

export function cheapestPrice(
  prices: Price[],
  visibleCountries?: Set<string>
): Price | null {
  const list = prices.filter(
    (p) =>
      p.price_twd != null &&
      (!visibleCountries || visibleCountries.has(p.country))
  );
  if (list.length === 0) return null;
  return list.reduce((a, b) => ((b.price_twd ?? Infinity) < (a.price_twd ?? Infinity) ? b : a));
}

export function isOnSale(prices: Price[]): boolean {
  return prices.some((p) => (p.discount_pct ?? 0) > 0);
}

export function saleEndOf(prices: Price[]): string | null {
  const ends = prices
    .filter((p) => (p.discount_pct ?? 0) > 0 && p.sale_end)
    .map((p) => p.sale_end as string)
    .sort();
  return ends[0] ?? null;
}

// ============================================================================
// 首頁伺服器端分頁（2026-11-16 修復：PostgREST 預設只回 1,000 筆，
// 舊版一次 select("*") 只能拿到前 1,000 款遊戲與 1,000 筆價格，
// 中文標題的遊戲排在 1,000 名外就搜不到也看不到）。
// 新版：搜尋／篩選／排序／總數都在資料庫做，每頁只抓 12 款，
// 價格、讚數、收藏數也只抓當頁 12 款的。
// 最低價／折扣排序與「只看特價」需要 games_with_price_stats 檢視
// （supabase/migrations/20261117_homepage_price_stats.sql）；
// 檢視尚未建立時自動退回 games 表（排序改為名稱排序），首頁不會壞掉。
// ============================================================================

/** 首頁每頁筆數。 */
export const PAGE_SIZE = 12;

/** games / games_with_price_stats 查詢時明確選取的遊戲欄位（不含統計欄位）。 */
const GAME_COLUMNS =
  "id,slug,title_zh,title_en,genre,publisher,platform,product_type,has_demo,cover_url,youtube_id,title_id,historical_low_twd,is_manual,created_by,created_at";

export type HomeSortKey = "cheap-asc" | "cheap-desc" | "title" | "discount";

export interface GamesPageFilters {
  q?: string;
  platform?: string;
  productType?: string;
  demo?: number;
  sort?: HomeSortKey;
  onlySale?: boolean;
  onlyMine?: boolean;
  onlyPurchased?: boolean;
  page?: number;
  userId?: string | null;
}

export interface GamesPageResult {
  games: GameWithPrices[];
  total: number;
  page: number;
  totalPages: number;
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
 * onlyMine / onlyPurchased 的 id 清單由呼叫端先取好傳進來；
 * 清單為空陣列時回傳 null（結果為空），null 則不套用該篩選。
 */
function buildFilteredGamesQuery(
  db: SupabaseClient,
  opts: GamesPageFilters,
  source: "games_with_price_stats" | "games",
  useStats: boolean,
  headCount: boolean,
  mineIds: string[] | null,
  purchasedIds: string[] | null
): GamesQueryBuilder | null {
  const query: GamesQueryBuilder = headCount
    ? db.from(source).select("id", { count: "exact", head: true })
    : db.from(source).select(GAME_COLUMNS, { count: "exact" });

  const term = sanitizeSearchTerm(opts.q ?? "");
  if (term) {
    query.or(`title_zh.ilike.%${term}%,title_en.ilike.%${term}%`);
  }
  if (opts.platform) query.eq("platform", opts.platform);
  if (opts.productType) {
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
  if (opts.onlyPurchased) {
    if (!purchasedIds || purchasedIds.length === 0) return null;
    query.in("id", purchasedIds);
  }
  return query;
}

async function fetchGamesPageRows(
  db: SupabaseClient,
  opts: GamesPageFilters,
  source: "games_with_price_stats" | "games",
  useStats: boolean,
  excludePurchasedIds: string[] = []
): Promise<RawGamesPage> {
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // 只看我的收藏／只看已購買的 id 清單先取好（總數查詢會重用，不重取）。
  let mineIds: string[] | null = null;
  let purchasedIds: string[] | null = null;
  if (opts.onlyMine) {
    if (!opts.userId) return { data: [], count: 0, error: null };
    mineIds = await getUserCollectionGameIds(db, opts.userId);
  }
  if (opts.onlyPurchased) {
    if (!opts.userId) return { data: [], count: 0, error: null };
    purchasedIds = await getUserPurchaseGameIds(db, opts.userId);
  }

  const base = buildFilteredGamesQuery(
    db,
    opts,
    source,
    useStats,
    false,
    mineIds,
    purchasedIds
  );
  if (!base) return { data: [], count: 0, error: null };

  // 已購買排除：只在一般遊戲牆／搜尋時套用（只看我的收藏／只看已購買
  // 是使用者自己的清單，不排除）。
  const exclusionActive = excludePurchasedIds.length > 0;
  if (exclusionActive) {
    base.not("id", "in", `(${excludePurchasedIds.join(",")})`);
  }

  const sort = opts.sort ?? "cheap-asc";
  if (sort === "title" || !useStats) {
    base.order("title_zh", { ascending: true });
  } else if (sort === "cheap-asc") {
    base
      .order("cheapest_twd", { ascending: true, nullsFirst: false })
      .order("title_zh", { ascending: true });
  } else if (sort === "cheap-desc") {
    base
      .order("cheapest_twd", { ascending: false, nullsFirst: false })
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
      mineIds,
      purchasedIds
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

/** 首頁分頁查詢：搜尋／篩選／排序／總數都在資料庫做，每頁 12 款。
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
  if (opts.onlyPurchased && !opts.userId) return empty;

  // 已購買排除用的 id 清單（只在一般遊戲牆／搜尋時用）。
  let excludePurchasedIds: string[] = [];
  if (opts.userId && !opts.onlyMine && !opts.onlyPurchased) {
    excludePurchasedIds = await getUserPurchaseGameIds(db, opts.userId);
  }

  let res = await fetchGamesPageRows(
    db,
    opts,
    "games_with_price_stats",
    true,
    excludePurchasedIds
  );
  let useStats = true;
  if (res.error) {
    const msg = res.error.message ?? "";
    const code = res.error.code ?? "";
    if (code === "PGRST205" || /does not exist/i.test(msg)) {
      // 檢視還沒建立（migration 未套用）：退回 games 表，首頁不壞。
      console.warn(
        "[data] games_with_price_stats 檢視不存在，改用 games 表（最低價／折扣排序暫時退為名稱排序；請套用 supabase/migrations/20261117_homepage_price_stats.sql）。"
      );
      useStats = false;
      res = await fetchGamesPageRows(db, opts, "games", false, excludePurchasedIds);
    }
  }
  if (res.error || !res.data) {
    if (res.error) console.warn("[data] 首頁查詢失敗：", res.error.message);
    return empty;
  }
  const total = res.count ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 0;
  const games = res.data;
  if (games.length === 0) return { games: [], total, page, totalPages };

  // 當頁 12 款的價格、讚數、收藏數（不抓整張表）。
  const ids = games.map((g) => g.id);
  const [pricesRes, likesRes, collRes, myLikesRes, myCollRes] =
    await Promise.all([
      db.from("prices").select("*").in("game_id", ids),
      db.from("game_likes").select("game_id").in("game_id", ids),
      db.from("collections").select("game_id").in("game_id", ids),
      opts.userId
        ? db
            .from("game_likes")
            .select("game_id")
            .in("game_id", ids)
            .eq("user_id", opts.userId)
        : Promise.resolve({ data: [] as { game_id: string }[] }),
      opts.userId
        ? db
            .from("collections")
            .select("game_id")
            .in("game_id", ids)
            .eq("user_id", opts.userId)
        : Promise.resolve({ data: [] as { game_id: string }[] }),
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

  let result = games.map((g) =>
    toGameWithPrices(
      g,
      prices,
      likeCount.get(g.id) ?? 0,
      collectionCount.get(g.id) ?? 0,
      myLikeSet.has(g.id),
      myCollectionSet.has(g.id)
    )
  );
  // 退回模式且只看特價：檢視的 has_sale 不能用，改用當頁價格過濾
  //（總數會是未過濾的數字，僅出現在 migration 尚未套用的短暫期間）。
  if (opts.onlySale && !useStats) {
    result = result.filter((g) => isOnSale(g.prices));
  }
  return { games: result, total, page, totalPages };
}

/** 商品類型選項：product_type 依字母排序後取前 1,000 列再去重——
 *  不同類型在排序後會連在一起，少量 distinct 值一定落在前 1,000 列內。 */
export async function getProductTypes(
  db: SupabaseClient
): Promise<string[]> {
  const { data, error } = await db
    .from("games")
    .select("product_type")
    .order("product_type", { ascending: true })
    .limit(1000);
  if (error || !data) return ["game"];
  const types = [
    ...new Set(
      (data as { product_type: string | null }[]).map(
        (r) => r.product_type ?? "game"
      )
    ),
  ];
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

/** 讀單一遊戲（詳細頁用）。 */
export async function getGameBySlug(
  db: SupabaseClient,
  slug: string,
  userId?: string | null
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
  const [likes, collections, myLike, myCollection, myPurchase] = await Promise.all([
    db.from("game_likes").select("id", { count: "exact", head: true }).eq("game_id", (game as Game).id),
    db.from("collections").select("id", { count: "exact", head: true }).eq("game_id", (game as Game).id),
    userId
      ? db.from("game_likes").select("id").eq("game_id", (game as Game).id).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? db.from("collections").select("id").eq("game_id", (game as Game).id).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? db.from("user_purchases").select("id").eq("game_id", (game as Game).id).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return toGameWithPrices(
    game as Game,
    (prices as Price[]) ?? [],
    likes.count ?? 0,
    collections.count ?? 0,
    Boolean(myLike.data),
    Boolean(myCollection.data),
    Boolean(myPurchase.data)
  );
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

/** 讀某遊戲留言（依讚數排序在前端做；這裡回傳原始留言 + 讚數 + 我是否按過讚）。 */
export async function getComments(
  db: SupabaseClient,
  gameId: string,
  userId?: string | null
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
  const ids = (data as { id: string }[]).map((c) => c.id);
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
  return (data as Record<string, unknown>[]).map((c) => ({
    id: c.id as string,
    game_id: c.game_id as string,
    user_id: (c.user_id as string | null) ?? null,
    author_name:
      (c.author_name as string | null) ??
      (c.nickname as string | null) ??
      null,
    body: (c.body as string) ?? "",
    created_at: (c.created_at as string | null) ?? null,
    likes_count: likeCount.get(c.id as string) ?? 0,
    liked_by_me: myLikeSet.has(c.id as string),
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
    const salePrices = ps.filter((p) => (p.discount_pct ?? 0) > 0);
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
