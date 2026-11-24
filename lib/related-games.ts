// 詳情頁「相關內容」區的即時查詢（server-only 呼叫端用；不進快取）。
//
// 資料來源：game_relations 表（migration 20261124_add_game_relations.sql）。
// 方向約定（與 migration／回填腳本／資料檔一致）：
//   - dlc／language_pack／upgrade_pass／bundle：game_id＝子項、
//     related_game_id＝本體。本體頁查 related_game_id＝當前遊戲；
//     DLC 頁查 game_id＝當前遊戲，得到所屬本體（parent 組）。
//   - edition：雙向各寫一列，兩邊都要查，排除自己。
//
// 容錯（重要）：表目前可能還不存在（shawn 還沒跑 migration）。
// PostgREST 在表不存在時回 PGRST205（relation does not exist）。
// 任何查詢失敗都視為「無相關內容」回空分組，絕對不拋錯、
// 絕對不讓詳情頁 500。頁面也不把這份資料放進 getCachedGamePublic
// 的 1 小時快取：shawn 跑完 migration＋回填後，相關內容立刻出現。
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCoverUrl } from "./data";
import type {
  Game,
  RelatedGameGroups,
  RelatedGameItem,
  RelationType,
} from "./types";

export const EMPTY_RELATED_GROUPS: RelatedGameGroups = {
  parent: [],
  dlc: [],
  language_pack: [],
  upgrade_pass: [],
  bundle: [],
  edition: [],
};

interface RelationRow {
  game_id: string;
  related_game_id: string;
  relation_type: string;
}

function isRelationType(v: string): v is RelationType {
  return (
    v === "dlc" ||
    v === "language_pack" ||
    v === "upgrade_pass" ||
    v === "bundle" ||
    v === "edition"
  );
}

function sortItems(items: RelatedGameItem[]): RelatedGameItem[] {
  return items.sort(
    (a, b) =>
      (a.cheapest_twd ?? Infinity) - (b.cheapest_twd ?? Infinity) ||
      a.title_zh.localeCompare(b.title_zh, "zh-Hant")
  );
}

export async function fetchRelatedGames(
  db: SupabaseClient,
  gameId: string
): Promise<RelatedGameGroups> {
  try {
    // 兩邊都查：related_game_id＝我（我的子項＋edition 另一邊），
    // game_id＝我（我的本體＋edition 這一邊）。
    const [asRelated, asGame] = await Promise.all([
      db
        .from("game_relations")
        .select("game_id,related_game_id,relation_type")
        .eq("related_game_id", gameId),
      db
        .from("game_relations")
        .select("game_id,related_game_id,relation_type")
        .eq("game_id", gameId),
    ]);
    const firstError = asRelated.error ?? asGame.error;
    if (firstError) {
      // 表不存在（PGRST205）或任何查詢失敗：一律視為無相關內容。
      console.warn(
        "[related] game_relations 查詢失敗，視為無相關內容：",
        firstError.message
      );
      return EMPTY_RELATED_GROUPS;
    }
    const rowsAsRelated = (asRelated.data ?? []) as RelationRow[];
    const rowsAsGame = (asGame.data ?? []) as RelationRow[];
    if (rowsAsRelated.length === 0 && rowsAsGame.length === 0) {
      return EMPTY_RELATED_GROUPS;
    }

    // 分類：每列的「對方」才是要顯示的遊戲。
    const grouped = new Map<keyof RelatedGameGroups, Map<string, RelationType>>();
    const put = (
      group: keyof RelatedGameGroups,
      otherId: string,
      type: RelationType
    ) => {
      if (otherId === gameId) return;
      let m = grouped.get(group);
      if (!m) {
        m = new Map();
        grouped.set(group, m);
      }
      if (!m.has(otherId)) m.set(otherId, type);
    };
    for (const r of rowsAsRelated) {
      if (!isRelationType(r.relation_type)) continue;
      if (r.relation_type === "edition") put("edition", r.game_id, "edition");
      else put(r.relation_type, r.game_id, r.relation_type);
    }
    for (const r of rowsAsGame) {
      if (!isRelationType(r.relation_type)) continue;
      if (r.relation_type === "edition")
        put("edition", r.related_game_id, "edition");
      else put("parent", r.related_game_id, r.relation_type);
    }

    const otherIds = [
      ...new Set(
        [...grouped.values()].flatMap((m) => [...m.keys()])
      ),
    ];
    if (otherIds.length === 0) return EMPTY_RELATED_GROUPS;

    const { data: games, error: gamesError } = await db
      .from("games")
      .select("id,slug,title_zh,title_en,cover_url,platform,product_type")
      .in("id", otherIds);
    if (gamesError || !games) {
      console.warn(
        "[related] 相關遊戲查詢失敗，視為無相關內容：",
        gamesError?.message
      );
      return EMPTY_RELATED_GROUPS;
    }
    const gameById = new Map<string, Game>(
      (games as Game[]).map((g) => [g.id, g])
    );

    // 最低價：只算已確認價格（與站上 cheapestPrice 同一規則）；
    // 某款遊戲若只有未確認價格，才退回未確認價取最低（有價總比
    // 「尚無價格」有用）；完全無價＝null。0 元＝免費，照常顯示 NT$ 0。
    const cheapestById = new Map<string, number | null>();
    const { data: prices, error: pricesError } = await db
      .from("prices")
      .select("game_id,price_twd,verified")
      .in("game_id", otherIds);
    if (!pricesError && prices) {
      const byGame = new Map<
        string,
        { verified: number[]; all: number[] }
      >();
      for (const p of prices as {
        game_id: string;
        price_twd: number | null;
        verified?: boolean | null;
      }[]) {
        if (p.price_twd == null) continue;
        let bucket = byGame.get(p.game_id);
        if (!bucket) {
          bucket = { verified: [], all: [] };
          byGame.set(p.game_id, bucket);
        }
        bucket.all.push(p.price_twd);
        if (p.verified !== false) bucket.verified.push(p.price_twd);
      }
      for (const [id, bucket] of byGame) {
        const list = bucket.verified.length > 0 ? bucket.verified : bucket.all;
        cheapestById.set(id, Math.min(...list));
      }
    } else if (pricesError) {
      console.warn(
        "[related] 相關遊戲價格查詢失敗，價格欄顯示尚無價格：",
        pricesError.message
      );
    }

    const result: RelatedGameGroups = {
      parent: [],
      dlc: [],
      language_pack: [],
      upgrade_pass: [],
      bundle: [],
      edition: [],
    };
    for (const [group, m] of grouped) {
      for (const [id, type] of m) {
        const g = gameById.get(id);
        if (!g) continue;
        result[group].push({
          id: g.id,
          slug: g.slug,
          title_zh: g.title_zh,
          title_en: g.title_en,
          cover_url: resolveCoverUrl(g.cover_url),
          platform: g.platform,
          product_type: g.product_type,
          relation_type: type,
          cheapest_twd: cheapestById.get(id) ?? null,
        });
      }
    }
    // 各組內依最低價由低到高（無價排最後），再依標題排。
    (Object.keys(result) as (keyof RelatedGameGroups)[]).forEach((k) => {
      result[k] = sortItems(result[k]);
    });
    return result;
  } catch (e) {
    // 表不存在以外的任何意外（例如連線中斷）：同樣視為無相關內容。
    console.warn(
      "[related] 查詢例外，視為無相關內容：",
      e instanceof Error ? e.message : e
    );
    return EMPTY_RELATED_GROUPS;
  }
}
