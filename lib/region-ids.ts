// 各區編號對照表 game_region_ids 的純函式（不碰 DB／網路，可單元驗算）。
//
// 背景：NSUID 是分區的，games.title_id 只有日本／預設編號。
// 每日更新按國家查價時，每款遊戲每國的編號按以下優先順序決定：
//   1. region：game_region_ids 有該國編號 → 用它（正確的多國價來源）。
//   2. fallback：沒有對照編號 → 用 games.title_id（現況行為；JP 會中，
//      其他國家通常 not_found、保留舊價）。
//   3. none：兩者都沒有 → 該遊戲該國跳過、列 pending、保留舊價。
//
// 設計取捨（見 DATA_NOTES.md §11.6）：
//   - fallback 保留，是因為對照表是逐步補齊的（先有台港、後有美歐澳加），
//     還沒對照到的國家不能因為「沒有編號」就整個不查——JP 價必須每天更新，
//     且舊 32 款的種子價本來就是用各區編號抓的，fallback 查不到時也只是
//     not_found、保留舊價，不會寫錯價格。
//   - 兩個不同遊戲在同一國共用同一個 title_id 時（例如朱／紫兩個版本被
//     誤寫成同一編號），先登記者勝出，後者列入衝突警告，不靜默覆蓋。

export type RegionIdSource = "region" | "fallback" | "none";

export interface RegionIdRow {
  game_id: string;
  country: string;
  title_id: string;
}

/** 對照表列 → game_id →（country → title_id）。國家代碼統一轉大寫。 */
export function buildRegionIdIndex(
  rows: RegionIdRow[]
): Map<string, Map<string, string>> {
  const index = new Map<string, Map<string, string>>();
  for (const row of rows) {
    if (!row.game_id || !row.country || !row.title_id) continue;
    const country = row.country.trim().toUpperCase();
    const titleId = String(row.title_id).trim();
    if (!country || !titleId) continue;
    let byCountry = index.get(row.game_id);
    if (!byCountry) {
      byCountry = new Map<string, string>();
      index.set(row.game_id, byCountry);
    }
    // 同一（遊戲、國家）重複列：先登記者勝出，後到的忽略（匯入端有
    // unique 約束，正常不會發生；這裡只求決定性）。
    if (!byCountry.has(country)) byCountry.set(country, titleId);
  }
  return index;
}

export interface ResolvedCountryId {
  titleId: string | null;
  source: RegionIdSource;
}

/** 決定某款遊戲在某國查價用的編號（region → fallback → none）。 */
export function resolveGameCountryId(
  gameId: string,
  fallbackTitleId: string | null | undefined,
  regionIndex: Map<string, Map<string, string>>,
  country: string
): ResolvedCountryId {
  const code = country.trim().toUpperCase();
  const regional = regionIndex.get(gameId)?.get(code);
  if (regional) return { titleId: regional, source: "region" };
  const fallback =
    fallbackTitleId != null ? String(fallbackTitleId).trim() : "";
  if (fallback) return { titleId: fallback, source: "fallback" };
  return { titleId: null, source: "none" };
}

export interface CountryPlan {
  /** 該國要查的編號（已去重），順序與 games 陣列一致。 */
  titleIds: string[];
  /** 編號 → 遊戲（查價回應按 title_id 找回遊戲用）。 */
  titleIdToGame: Map<string, { id: string; slug: string }>;
  /** 用對照編號的遊戲數。 */
  usedRegion: number;
  /** 用 games.title_id fallback 的遊戲數。 */
  usedFallback: number;
  /** 該國完全無編號的遊戲 slug（跳過、保留舊價）。 */
  skippedSlugs: string[];
  /** 同一編號被兩個遊戲共用時的衝突（先登記者勝出，後者列在此）。 */
  collisions: { titleId: string; keptSlug: string; droppedSlug: string }[];
}

/** 為一國建查價計畫：每款遊戲按 region → fallback → none 決定編號。
 *  allowFallback（預設 true，舊行為）：沒有對照編號時用 games.title_id。
 *  30,000 款規模下 fallback 是浪費——JP 編號查非 JP 國家幾乎必回
 *  not_found（每片每國最多 8 個無用 chunk）；所以 /api/refresh 只對 JP
 *  開 fallback，其他國家沒對照編號就直接跳過（見 DATA_NOTES.md §12.5）。
 *  對照表還沒齊全時，這些國家維持種子舊價、等編號進庫後自動更新。 */
export function planCountryIds(
  games: { id: string; slug: string; title_id: string | null }[],
  regionIndex: Map<string, Map<string, string>>,
  country: string,
  allowFallback = true
): CountryPlan {
  const titleIds: string[] = [];
  const titleIdToGame = new Map<string, { id: string; slug: string }>();
  const collisions: CountryPlan["collisions"] = [];
  let usedRegion = 0;
  let usedFallback = 0;
  const skippedSlugs: string[] = [];
  for (const game of games) {
    const resolved = resolveGameCountryId(
      game.id,
      allowFallback ? game.title_id : null,
      regionIndex,
      country
    );
    if (!resolved.titleId) {
      skippedSlugs.push(game.slug);
      continue;
    }
    if (resolved.source === "region") usedRegion++;
    else usedFallback++;
    const existing = titleIdToGame.get(resolved.titleId);
    if (existing) {
      collisions.push({
        titleId: resolved.titleId,
        keptSlug: existing.slug,
        droppedSlug: game.slug,
      });
      continue;
    }
    titleIdToGame.set(resolved.titleId, { id: game.id, slug: game.slug });
    titleIds.push(resolved.titleId);
  }
  return {
    titleIds,
    titleIdToGame,
    usedRegion,
    usedFallback,
    skippedSlugs,
    collisions,
  };
}
