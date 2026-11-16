// 直接用 Supabase client 讀公開資料（讀取走 client，寫入走 /api/* 合約）。
// 所有函式第一個參數都是 Supabase client（server 用 createSupabaseServerClient()，
// 瀏覽器用 createSupabaseBrowserClient()），查詢失敗時回傳空值、不拋錯，
// 所以 Supabase 專案不存在時頁面仍可建置與顯示「尚無資料」。
import type { SupabaseClient } from "@supabase/supabase-js";
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
  collectedByMe = false
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

/** 讀全部遊戲 + 全部價格 + 讚數/收藏數（首頁用）。 */
export async function getGamesWithPrices(
  db: SupabaseClient,
  userId?: string | null
): Promise<GameWithPrices[]> {
  const [{ data: games, error: gErr }, { data: prices, error: pErr }] =
    await Promise.all([
      db.from("games").select("*").order("title_zh"),
      db.from("prices").select("*"),
    ]);
  if (gErr || pErr || !games) {
    if (gErr) console.warn("[data] games 讀取失敗：", gErr.message);
    if (pErr) console.warn("[data] prices 讀取失敗：", pErr.message);
    return [];
  }

  const [likes, collections, myLikes, myCollections] = await Promise.all([
    db.from("game_likes").select("game_id"),
    db.from("collections").select("game_id"),
    userId
      ? db.from("game_likes").select("game_id").eq("user_id", userId)
      : Promise.resolve({ data: [] as { game_id: string }[] }),
    userId
      ? db.from("collections").select("game_id").eq("user_id", userId)
      : Promise.resolve({ data: [] as { game_id: string }[] }),
  ]);
  const likeCount = new Map<string, number>();
  (likes.data ?? []).forEach((r: { game_id: string }) =>
    likeCount.set(r.game_id, (likeCount.get(r.game_id) ?? 0) + 1)
  );
  const collectionCount = new Map<string, number>();
  (collections.data ?? []).forEach((r: { game_id: string }) =>
    collectionCount.set(r.game_id, (collectionCount.get(r.game_id) ?? 0) + 1)
  );
  const myLikeSet = new Set((myLikes.data ?? []).map((r) => r.game_id));
  const myCollectionSet = new Set(
    (myCollections.data ?? []).map((r) => r.game_id)
  );

  return (games as Game[]).map((g) =>
    toGameWithPrices(
      g,
      (prices as Price[]) ?? [],
      likeCount.get(g.id) ?? 0,
      collectionCount.get(g.id) ?? 0,
      myLikeSet.has(g.id),
      myCollectionSet.has(g.id)
    )
  );
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
  const [likes, collections, myLike, myCollection] = await Promise.all([
    db.from("game_likes").select("id", { count: "exact", head: true }).eq("game_id", (game as Game).id),
    db.from("collections").select("id", { count: "exact", head: true }).eq("game_id", (game as Game).id),
    userId
      ? db.from("game_likes").select("id").eq("game_id", (game as Game).id).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? db.from("collections").select("id").eq("game_id", (game as Game).id).eq("user_id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return toGameWithPrices(
    game as Game,
    (prices as Price[]) ?? [],
    likes.count ?? 0,
    collections.count ?? 0,
    Boolean(myLike.data),
    Boolean(myCollection.data)
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

/** 收藏排行 TOP 50。onlyOnSale=true 時只顯示特價中（預設）。 */
export async function getRanking(
  db: SupabaseClient,
  onlyOnSale = true,
  limit = 50
): Promise<RankingEntry[]> {
  const games = await getGamesWithPrices(db);
  const entries: RankingEntry[] = games.map((g) => ({
    game: g,
    collections_count: g.collections_count,
    likes_count: g.likes_count,
    cheapest: cheapestPrice(g.prices),
    on_sale: isOnSale(g.prices),
    sale_end: saleEndOf(g.prices),
  }));
  const filtered = onlyOnSale ? entries.filter((e) => e.on_sale) : entries;
  return filtered
    .sort((a, b) => b.collections_count - a.collections_count)
    .slice(0, limit);
}

/** 全部價格裡最新的 updated_at（首頁「價格最後更新時間」用）。 */
export function latestPriceUpdate(prices: Price[]): string | null {
  const times = prices
    .map((p) => p.updated_at)
    .filter((t): t is string => Boolean(t))
    .sort();
  return times.length > 0 ? times[times.length - 1] : null;
}
