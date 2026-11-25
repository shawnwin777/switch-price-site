// 全自動目錄同步的 DB 編排（lib/catalog-sources.ts 的計畫 → 寫庫）。
//
// 流程（每天由 /api/sync-catalog 跑 4 次，見 SETUP.md §8.10）：
//   1. 讀 sync_state 游標，分頁來源（NA／EU／JP／AU）從上次停的單位繼續抓
//      PAGE_CAP 個單位（?pages= 可覆蓋）；NA 逐款查詢的目標清單在讀庫後才
//      建（缺 US 編號的遊戲），一併傳入 fetchCatalogLists；單一來源失敗
//      不影響其他來源；
//   2. 分頁讀出現有 games＋game_region_ids（PostgREST 單次最多 1000 列，
//      10,051 款必須分頁讀——舊版 /api/refresh 直接 .select() 全讀，
//      實際只會拿到前 1000 款，這裡修掉，見 listAllGamesPaginated）；
//   3. planCatalogSync 比對（分區 NSUID diff 為主力、標題正規化唯一命中
//      為輔；跨區編號碰撞列 needs_review）；
//   4. 冪等寫入：games upsert（onConflict slug）、title_id／封面只在
//      為空時回填（update … is null 守衛）、game_region_ids upsert
//      （onConflict game_id,country）；重跑同一窗口 = 0 寫入；
//      寫入成功後推進 sync_state 游標（跑完一輪歸零）；
//   5. 新遊戲即時查價（商店前端價先寫、價格 API 覆蓋，上限 100 款／次，
//      超過的留到隔天同步再補；完整 35 國價仍走 /api/refresh 輪轉；
//      EU Solr 參考價只做交叉驗證、永不寫入）。
//
// 失敗語義：單一來源失敗、對照表未建、匯率抓不到，都只記進回報的
// errors，不讓整個同步失敗（目錄寫入優先於價格；價格下次輪轉會補）。
// 唯一會回 500 的是「完全寫不進資料庫」（games upsert 失敗）。

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FOREIGN_IMPORT_SOURCES,
  FOREIGN_PRICE_COUNTRIES,
  NA_RANK_BAND_COUNT,
  PAGED_SOURCES,
  PAGE_CAP,
  expandRegionIdUpserts,
  fetchCatalogLists,
  pendingCatalogSources,
  planCatalogSync,
  type CatalogSourceResult,
  type ExistingGameLite,
  type ExistingRegionId,
  type NaTitleTarget,
} from "./catalog-sources";
import {
  PRICE_COUNTRIES,
  fetchFxSnapshot,
  fetchPricesForCountry,
  parseRawValue,
  taipeiDateKey,
} from "./nintendo";

type AdminClient = SupabaseClient;

const PAGE_SIZE = 1000;
const GAME_BATCH_SIZE = 200;
const REGION_BATCH_SIZE = 500;
const PRICE_BATCH_SIZE = 200;
/** 新遊戲即時查價上限（款／次）：平日新作約數款～數十款；超過的隔天再補。 */
export const NEW_GAME_PRICE_CAP = 100;
/** 全程軟預算（毫秒）：超過就跳過價格階段（目錄已寫入，下次輪轉補價）。 */
const SYNC_TIME_BUDGET_MS = 50_000;

/** 探測某表有沒有某個欄位（migration 還沒跑時回 false，不拋錯）。 */
export async function probeTableColumn(
  admin: AdminClient,
  table: string,
  column: string
): Promise<boolean> {
  const { error } = await admin.from(table).select(column).limit(1);
  return !error;
}

/** 探測 games 有沒有某個欄位（migration 還沒跑時回 false，不拋錯）。 */
export async function probeGamesColumn(
  admin: AdminClient,
  column: string
): Promise<boolean> {
  return probeTableColumn(admin, "games", column);
}

/** 分頁讀全部遊戲（按 slug 排序；PostgREST 單次上限 1000 列，必須分頁）。 */
export async function listAllGamesPaginated(
  admin: AdminClient,
  columns = "id, slug, title_id, title_zh, title_en, cover_url, historical_low_twd"
): Promise<ExistingGameLite[]> {
  const out: ExistingGameLite[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("games")
      .select(columns)
      .order("slug")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`讀取 games 失敗：${error.message}`);
    const rows = (data ?? []) as unknown as ExistingGameLite[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** 分頁讀全部對照編號；表還沒建（migration 未跑）時回 missing，不拋錯。 */
export async function listAllRegionIdsPaginated(
  admin: AdminClient
): Promise<{ rows: ExistingRegionId[]; tableMissing: boolean }> {
  const rows: ExistingRegionId[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("game_region_ids")
      .select("game_id, country, title_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      return { rows: [], tableMissing: true };
    }
    const page = (data ?? []) as ExistingRegionId[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { rows, tableMissing: false };
}

/** 分頁讀指定國家的對照編號（供 refresh 分組輪轉用：先讀整組對照表，再由它算
 *  每款遊戲的組內對數與查價計畫，避免按 game_id 大 IN 清單讀取）。 */
export async function listRegionIdsForCountries(
  admin: AdminClient,
  countries: string[]
): Promise<{ rows: ExistingRegionId[]; tableMissing: boolean }> {
  const rows: ExistingRegionId[] = [];
  if (countries.length === 0) return { rows, tableMissing: false };
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("game_region_ids")
      .select("game_id, country, title_id")
      .in("country", countries)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      return { rows: [], tableMissing: true };
    }
    const page = (data ?? []) as ExistingRegionId[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { rows, tableMissing: false };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface CatalogSyncOptions {
  /** 只跑指定來源（預設全部 active 來源）；?sources=jp-search,tw-list。 */
  sources?: string[];
  /** dry_run=1：只比對、不寫庫（驗證與試算用）。 */
  dryRun?: boolean;
  /** skip_prices=1：不同步查新遊戲價格（只寫目錄）。 */
  skipPrices?: boolean;
  /** 分頁來源每支本次最多抓幾頁（?pages=；預設用各來源 PAGE_CAP）。 */
  pages?: number;
}

/** sync_state 游標列（分頁來源用；表未建時視為全部從第 0 頁開始）。 */
export interface SyncCursor {
  source: string;
  nextPage: number;
  totalPages: number | null;
}

/** 讀全部同步游標；表還沒建（migration 未跑）時回 tableMissing，不拋錯。 */
export async function readSyncCursors(
  admin: AdminClient
): Promise<{ cursors: Map<string, SyncCursor>; tableMissing: boolean }> {
  const cursors = new Map<string, SyncCursor>();
  const { data, error } = await admin
    .from("sync_state")
    .select("source, next_page, total_pages");
  if (error) return { cursors, tableMissing: true };
  for (const row of (data ?? []) as {
    source: string;
    next_page: number;
    total_pages: number | null;
  }[]) {
    cursors.set(row.source, {
      source: row.source,
      nextPage: row.next_page ?? 0,
      totalPages: row.total_pages ?? null,
    });
  }
  return { cursors, tableMissing: false };
}

/** 推進分頁來源的游標（跑完一輪時 next_page 歸 0、記 last_full_pass_date）。
 *  表未建時靜默跳過（由呼叫端在 errors 記一筆即可）。 */
export async function advanceSyncCursors(
  admin: AdminClient,
  results: CatalogSourceResult[],
  dateKey: string
): Promise<{ advanced: string[]; tableMissing: boolean }> {
  const advanced: string[] = [];
  for (const r of results) {
    if (!r.paging) continue;
    // last_full_pass_date 只在跑完一輪時寫（不寫 null，避免蓋掉上次的日期）。
    const row: Record<string, unknown> = {
      source: r.source,
      next_page: r.paging.done ? 0 : (r.paging.nextPage ?? 0),
      total_pages: r.paging.totalPages,
      updated_at: new Date().toISOString(),
    };
    if (r.paging.done) row.last_full_pass_date = dateKey;
    const { error } = await admin
      .from("sync_state")
      .upsert(row, { onConflict: "source" });
    if (error) return { advanced, tableMissing: true };
    advanced.push(r.source);
  }
  return { advanced, tableMissing: false };
}

export interface CatalogSyncSummary {
  ok: boolean;
  date_key: string;
  dry_run: boolean;
  sources: {
    id: string;
    country: string;
    status: string;
    entries: number;
    error?: string;
    note?: string;
  }[];
  pending_sources: { id: string; country: string; label: string; reason: string }[];
  total_games_before: number;
  games_inserted: number;
  title_id_filled: number;
  cover_filled: number;
  /** 本次補上的上市日期筆數（只補 release_date 為空的遊戲）。 */
  release_date_filled: number;
  region_ids_upserted: number;
  /** 外國匯入是否啟用（prices.verified 欄位存在才 true；false 時 NA／EU
   *  條目本次跳過、NA／EU 游標不推進，等 migration 跑完自動恢復）。 */
  foreign_import_enabled: boolean;
  /** 本次重算 price_countries 的遊戲數（供 /api/refresh 工作量切片用）。 */
  price_countries_updated: number;
  /** 本次全量重算補上的 price_countries 列數（§4e-2，含 NULL 補值）。 */
  price_countries_full_updated: number;
  /** 全量重算後仍未補上的列數（達單次上限或時間預算，下次同步繼續）。 */
  price_countries_full_remaining: number;
  new_game_prices: {
    attempted: number;
    priced: number;
    skipped_over_cap: number;
    skipped_over_budget: boolean;
    price_not_found: string[];
  };
  needs_review: { slug: string; title: string; reason: string }[];
  conflicts: string[];
  /** 新遊戲自帶的商店前端價（JP 搜尋 API／NA Algolia，已驗證）：
   *  同步時先寫入當新遊戲即時價，價格 API 查到該國價時覆蓋它
   *  （價格 API 為準；見 DATA_NOTES.md §12.6）。 */
  storefront_prices: {
    gameSlug: string;
    title: string;
    country: string;
    regularRaw: number | null;
    effectiveRaw: number | null;
    currency: string;
    saleEnd: string | null;
    onSale: boolean;
    source: string;
  }[];
  /** 本次實際以商店前端價寫入的價格列數（未被價格 API 覆蓋的）。 */
  storefront_prices_written: number;
  /** 新遊戲的 EU Solr 參考價（只記錄、永不寫入 prices）。 */
  reference_prices: {
    gameSlug: string;
    title: string;
    country: string;
    regularRaw: number | null;
    effectiveRaw: number | null;
    discountPct: number | null;
    currency: string;
    source: string;
  }[];
  /** 交叉驗證：Solr 參考價與價格 API 的 GB 價不一致時記錄（價格 API 勝出，
   *  Solr 價不寫入）。BOTW de 89.98 vs €69.99 就是這類異常。 */
  reference_price_mismatches: {
    slug: string;
    country: string;
    solrEffective: number | null;
    apiEffective: number | null;
    solrRegular: number | null;
    apiRegular: number | null;
    source: string;
  }[];
  /** 分頁來源的游標推進結果（本次從第幾頁抓到第幾頁、是否跑完一輪）。 */
  sync_cursors: {
    source: string;
    startPage: number;
    nextPage: number | null;
    totalPages: number | null;
    done: boolean;
  }[];
  stats: ReturnType<typeof planCatalogSync>["stats"];
  errors: { stage: string; message: string }[];
  duration_ms: number;
}

/** 重算受影響遊戲的 price_countries（可查價國家數）並寫回 games。
 *  規則（見 migration 20261117_game_price_countries.sql）：
 *  有 games.title_id 時 JP 算 1 國 ＋ game_region_ids 的 distinct 國家數。
 *  欄位還沒建（migration 未跑）時寫入失敗只記一筆錯誤、不中斷同步；
 *  下次 migration 跑完後回填 UPDATE 會一次算好。 */
export async function refreshPriceCountryCounts(
  admin: AdminClient,
  gameIds: string[],
  titleIdById: Map<string, string | null>,
  errors: { stage: string; message: string }[]
): Promise<number> {
  const ids = [...new Set(gameIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  let updated = 0;
  let warned = false;
  try {
    const counts = new Map<string, number>();
    for (const batch of chunk(ids, 200)) {
      const { data, error } = await admin
        .from("game_region_ids")
        .select("game_id, country")
        .in("game_id", batch);
      if (error) throw new Error(error.message);
      const byGame = new Map<string, Set<string>>();
      for (const row of (data ?? []) as { game_id: string; country: string }[]) {
        const set = byGame.get(row.game_id) ?? new Set<string>();
        set.add(String(row.country).toUpperCase());
        byGame.set(row.game_id, set);
      }
      for (const id of batch) {
        counts.set(
          id,
          (titleIdById.get(id) ? 1 : 0) + (byGame.get(id)?.size ?? 0)
        );
      }
    }
    for (const [id, n] of counts) {
      const { error } = await admin
        .from("games")
        .update({ price_countries: n })
        .eq("id", id);
      if (error) throw new Error(error.message);
      updated++;
    }
  } catch (err) {
    if (!warned) {
      warned = true;
      errors.push({
        stage: "price_countries",
        message: `price_countries 回填失敗（${err instanceof Error ? err.message : String(err)}）：若是欄位不存在，請執行 supabase/migrations/20261117_game_price_countries.sql；價格更新會暫用舊的款數切片`,
      });
    }
  }
  return updated;
}
/** 全量重算 price_countries（定期自我修復；2026-11-24 稽核修復）。
 *  用步驟 2 已讀進記憶體的 games＋game_region_ids 直接算期望值
 *  （有 title_id 算 1 國＋對照表 distinct 國家數），只 PATCH 與期望值
 *  不符的列——NULL 也算不符，會被補上正確值，所以寫庫路徑漏寫的 NULL
 *  不會一直留著、/api/refresh 也不再把 NULL 當 35 對虛增。
 *  排除 excludeIds（本次同步剛動過的遊戲：記憶體裡的對照表還沒包含
 *  本次新寫的編號，那幾款由 refreshPriceCountryCounts 從庫裡重算為準）。
 *  每次最多更新 maxUpdates 列、且不超過 timeBudgetMs（剩下的留給下次
 *  同步），所以平時幾乎 0 寫入、漂移累積時也能慢慢追平，不擠佔 60 秒預算。 */
export async function refreshAllPriceCountryCounts(
  admin: AdminClient,
  games: ExistingGameLite[],
  regionIds: ExistingRegionId[],
  excludeIds: Set<string>,
  errors: { stage: string; message: string }[],
  opts: { maxUpdates?: number; startedAt?: number; timeBudgetMs?: number } = {}
): Promise<{ checked: number; updated: number; remaining: number }> {
  const maxUpdates = opts.maxUpdates ?? 1000;
  const startedAt = opts.startedAt ?? Date.now();
  const timeBudgetMs = opts.timeBudgetMs ?? SYNC_TIME_BUDGET_MS;
  const byGame = new Map<string, Set<string>>();
  for (const r of regionIds) {
    const set = byGame.get(r.game_id) ?? new Set<string>();
    set.add(String(r.country).toUpperCase());
    byGame.set(r.game_id, set);
  }
  const mismatches: { id: string; n: number }[] = [];
  for (const g of games) {
    if (excludeIds.has(g.id)) continue;
    const expected = (g.title_id ? 1 : 0) + (byGame.get(g.id)?.size ?? 0);
    if (g.price_countries !== expected) mismatches.push({ id: g.id, n: expected });
  }
  let updated = 0;
  for (const m of mismatches) {
    if (updated >= maxUpdates) break;
    if (Date.now() - startedAt > timeBudgetMs) break;
    const { error } = await admin
      .from("games")
      .update({ price_countries: m.n })
      .eq("id", m.id);
    if (error) {
      errors.push({
        stage: "price_countries_full",
        message: `全量重算寫入失敗（${m.id}）：${error.message}；剩餘 ${mismatches.length - updated} 列下次同步再算`,
      });
      break;
    }
    updated++;
  }
  return { checked: games.length, updated, remaining: mismatches.length - updated };
}

export async function runCatalogSync(
  admin: AdminClient,
  opts: CatalogSyncOptions = {}
): Promise<CatalogSyncSummary> {
  const startedAt = Date.now();
  const dateKey = taipeiDateKey();
  const errors: CatalogSyncSummary["errors"] = [];

  // ---- 1. 讀 sync_state 游標，決定各分頁來源的窗口 ----
  // 分頁來源（NA／EU／JP／AU）用 sync_state 游標決定窗口：
  // 從上次停的單位繼續抓 PAGE_CAP 個單位（?pages= 可覆蓋）；跑完一輪歸零。
  // 表未建時游標預設 0（每次從第 0 單位重抓，新遊戲仍會被發現，
  // 只是完整一輪跑不完——見 errors 的提醒）。
  // NA 游標語義已改（2026-11-24）：單位 0–17 是人氣排名帶、18 起是
  // 逐款標題批次；舊游標的 totalPages＝38 是 offset 頁數——舊游標若停在
  // ≥18 頁（offset 幻影區，從未真正抓到資料），新語義會誤讀為「標題
  // 批次」、跳過人氣帶 0–17，偵測到就歸零重跑（重抓冪等安全）。
  const { cursors, tableMissing: syncStateMissing } = await readSyncCursors(admin);
  if (syncStateMissing) {
    errors.push({
      stage: "sync_state",
      message:
        "游標表還沒建（migration 未跑），分頁來源每次都從第 0 頁重抓；請執行 supabase/migrations/20261117_catalog_sync_state.sql",
    });
  }
  const pageWindows: Record<string, { startPage: number; pageCount: number }> = {};
  for (const source of PAGED_SOURCES) {
    if (opts.sources && !opts.sources.includes(source)) continue;
    const cursor = cursors.get(source);
    let startPage = cursor?.nextPage ?? 0;
    if (
      source === "na-algolia" &&
      cursor?.totalPages === 38 &&
      startPage >= NA_RANK_BAND_COUNT
    ) {
      startPage = 0;
    }
    pageWindows[source] = {
      startPage,
      pageCount: opts.pages ?? PAGE_CAP[source] ?? 10,
    };
  }

  // ---- 2. 讀現有目錄索引（分頁；10,051 款單次讀不完）----
  // 先讀庫、再抓清單：NA 逐款查詢需要「缺 US 編號的遊戲」清單當目標。
  // release_date 欄位還沒建（migration 未跑）時不讀它，否則整輪同步
  // 會報錯；探測到欄位存在才讀取、才寫入上市日（見下方 4a/4b）。
  // price_countries 同理：有欄位才讀（供 §4e-2 全量重算比對用）。
  const hasReleaseDateColumn = await probeGamesColumn(admin, "release_date");
  const hasPriceCountriesColumn = await probeGamesColumn(admin, "price_countries");
  const gameColumns =
    "id, slug, title_id, title_zh, title_en, cover_url, historical_low_twd" +
    (hasReleaseDateColumn ? ", release_date" : "") +
    (hasPriceCountriesColumn ? ", price_countries" : "");
  const existingGames = await listAllGamesPaginated(admin, gameColumns);
  const { rows: existingRegionIds, tableMissing } =
    await listAllRegionIdsPaginated(admin);
  if (tableMissing) {
    errors.push({
      stage: "game_region_ids",
      message:
        "對照表還沒建（migration 未跑），本次 TW/HK 編號無法寫入；請執行 supabase/migrations/20261116_game_region_ids.sql。JP 新遊戲照常進庫",
    });
  }

  // ---- 2b. NA 逐款查詢的目標：缺 US 編號的遊戲（slug 排序，見
  // lib/catalog-sources.ts 的 NA 單位說明）。title_id 為 7005／7007 開頭
  // 者是已知 DLC／組合包，NA 條目進不了目錄（planCatalogSync 會跳過），
  // 不浪費查詢；title_id 為空者無法判斷，一律納入。查詢標題用 title_en
  // 優先、無則 title_zh；標題完全沒有拉丁字母者跳過（NA 是英文索引，
  // 用中文／日文標題查不到，留給人氣帶或第二階段進口處理）。對照表未建
  // 時無法判斷誰缺編號，傳空清單（NA 只跑人氣帶，不做逐款查詢）。
  const naTitleTargets: NaTitleTarget[] = [];
  if (!tableMissing) {
    const hasUsId = new Set(
      existingRegionIds
        .filter((r) => r.country.toUpperCase() === "US")
        .map((r) => r.game_id)
    );
    for (const g of existingGames) {
      if (hasUsId.has(g.id)) continue;
      if (g.title_id && !g.title_id.startsWith("7001")) continue;
      const title = (g.title_en || "").trim() || (g.title_zh || "").trim();
      if (!title || !/[A-Za-z]/.test(title)) continue;
      naTitleTargets.push({ slug: g.slug, title });
    }
  }

  // ---- 2c. 抓各區官方清單（並行；單一來源失敗只記、不中斷）----
  const sourceResults: CatalogSourceResult[] = await fetchCatalogLists(
    opts.sources,
    pageWindows,
    { naTitleTargets }
  );
  for (const r of sourceResults) {
    if (r.status === "failed") {
      errors.push({
        stage: r.source,
        message: `清單抓取失敗：${r.error ?? "未知錯誤"}（該區本次不同步，其他區照常）`,
      });
    } else if (r.status === "partial") {
      errors.push({
        stage: r.source,
        message: `清單部分失敗：${r.error ?? ""}（已抓到的 ${r.entries.length} 筆照常用）`,
      });
    }
  }

  // ---- 3. 比對計畫（純函式，不碰 DB／網路）----
  // 外國匯入守衛：prices.verified 欄位未建時，NA／EU 條目整批暫緩
  // （plan 內跳過，不掛編號、不建新遊戲），否則 cron 自動同步會在
  // migration 之前把外國編號寫進庫、刷新再以「已確認」寫出未驗證價格；
  // 而帶 verified=false 寫入又會因欄位不存在報 42703。欄位存在時才放行。
  const hasVerifiedColumn = await probeTableColumn(admin, "prices", "verified");
  const plan = planCatalogSync(existingGames, existingRegionIds, sourceResults, {
    foreignImportEnabled: hasVerifiedColumn,
  });
  if (!hasVerifiedColumn) {
    errors.push({
      stage: "foreign_import",
      message:
        "外國匯入暫緩：prices.verified 欄位尚未建立（請執行 price-verified-migration-20261124.sql），本次 NA／EU 條目跳過、NA／EU 游標不推進；migration 跑完後下次同步自動恢復",
    });
  } else {
    // 分組展開（US → 美洲 8 國、GB → 歐洲 20 國）：plan 產出後、寫庫前，
    // 衝突的展開列跳過並記入 plan.conflicts（見 expandRegionIdUpserts）。
    const expansion = expandRegionIdUpserts(plan.regionIdUpserts, existingRegionIds);
    plan.regionIdUpserts = expansion.upserts;
    plan.conflicts.push(...expansion.conflicts);
  }

  const summary: CatalogSyncSummary = {
    ok: true,
    date_key: dateKey,
    dry_run: opts.dryRun ?? false,
    sources: sourceResults.map((r) => ({
      id: r.source,
      country: r.country,
      status: r.status,
      entries: r.entries.length,
      error: r.error,
      note: r.note,
    })),
    pending_sources: pendingCatalogSources(),
    total_games_before: existingGames.length,
    games_inserted: 0,
    title_id_filled: 0,
    cover_filled: 0,
    release_date_filled: 0,
    region_ids_upserted: 0,
    foreign_import_enabled: hasVerifiedColumn,
    price_countries_updated: 0,
    price_countries_full_updated: 0,
    price_countries_full_remaining: 0,
    new_game_prices: {
      attempted: 0,
      priced: 0,
      skipped_over_cap: 0,
      skipped_over_budget: false,
      price_not_found: [],
    },
    needs_review: plan.needsReview,
    conflicts: plan.conflicts,
    storefront_prices: plan.storefrontPrices,
    storefront_prices_written: 0,
    reference_prices: plan.referencePrices,
    reference_price_mismatches: [],
    sync_cursors: sourceResults
      .filter((r) => r.paging)
      .map((r) => ({
        source: r.source,
        startPage: r.paging!.startPage,
        nextPage: r.paging!.nextPage,
        totalPages: r.paging!.totalPages,
        done: r.paging!.done,
      })),
    stats: plan.stats,
    errors,
    duration_ms: 0,
  };
  if (opts.dryRun) {
    // dry-run 不寫庫，但 region_ids_upserted 回「計畫寫入數」
    // （展開後），供 Vercel dry-run 與本機 dry-run 交叉比對用。
    summary.region_ids_upserted = plan.regionIdUpserts.length;
    summary.duration_ms = Date.now() - startedAt;
    return summary;
  }

  // ---- 4a. 寫入新遊戲（upsert by slug；冪等：重跑同一天 = 0 寫入）----
  // 先寫遊戲、再寫編號（編號需要 game_id）。
  // release_date 欄位還沒建時，先把新遊戲的上市日欄位拿掉再 upsert，
  // 否則整批寫入會報錯；migration 跑完後下次同步自動寫入。
  if (!hasReleaseDateColumn && plan.newGames.length > 0) {
    for (const g of plan.newGames) {
      delete (g as Partial<typeof g>).release_date;
    }
    errors.push({
      stage: "release_date",
      message:
        "release_date 欄位尚未建立（migration 未跑），本次新遊戲的上市日未寫入；請執行 supabase/migrations/20261118_add_release_date.sql",
    });
  }
  const slugToId = new Map<string, string>();
  if (plan.newGames.length > 0) {
    for (const batch of chunk(plan.newGames, GAME_BATCH_SIZE)) {
      const { data, error } = await admin
        .from("games")
        .upsert(batch, { onConflict: "slug" })
        .select("id, slug");
      if (error) {
        throw new Error(`寫入 games 失敗：${error.message}`);
      }
      for (const row of (data ?? []) as { id: string; slug: string }[]) {
        slugToId.set(row.slug, row.id);
      }
    }
    // upsert 回傳的列若因故不含 id（例如 RLS），再按 slug 查一次補齊。
    const missing = plan.newGames
      .map((g) => g.slug)
      .filter((s) => !slugToId.has(s));
    if (missing.length > 0) {
      for (const batch of chunk(missing, 100)) {
        const { data, error } = await admin
          .from("games")
          .select("id, slug")
          .in("slug", batch);
        if (error) throw new Error(`讀取新遊戲 id 失敗：${error.message}`);
        for (const row of (data ?? []) as { id: string; slug: string }[]) {
          slugToId.set(row.slug, row.id);
        }
      }
    }
    const stillMissing = plan.newGames.filter((g) => !slugToId.has(g.slug));
    if (stillMissing.length > 0) {
      throw new Error(
        `寫入後查不到新遊戲 id：${stillMissing.map((g) => g.slug).join("、")}`
      );
    }
    summary.games_inserted = plan.newGames.length;
  }

  // ---- 4b. title_id／封面回填（只在目前為空時寫，絕不覆蓋已有值）----
  for (const fill of plan.titleIdFills) {
    const { error } = await admin
      .from("games")
      .update({ title_id: fill.title_id })
      .eq("id", fill.gameId)
      .is("title_id", null);
    if (error) {
      errors.push({ stage: "title_id_fill", message: `${fill.slug}：${error.message}` });
    } else {
      summary.title_id_filled++;
    }
  }
  for (const fill of plan.coverFills) {
    const { error } = await admin
      .from("games")
      .update({ cover_url: fill.cover_url })
      .eq("id", fill.gameId)
      // 空值或佔位圖都算缺圖，都補（佔位圖是寫庫時填的預設值，不是真的有圖）。
      .or("cover_url.is.null,cover_url.eq./covers/placeholder.svg");
    if (error) {
      errors.push({ stage: "cover_fill", message: `${fill.slug}：${error.message}` });
    } else {
      summary.cover_filled++;
    }
  }
  // ---- 4b-2. 上市日回填（只在目前為空時寫，絕不覆蓋已有值）----
  // 欄位還沒建時上面已經記過一筆 errors，這裡直接跳過。
  if (hasReleaseDateColumn) {
    for (const fill of plan.releaseDateFills) {
      const { error } = await admin
        .from("games")
        .update({ release_date: fill.release_date })
        .eq("id", fill.gameId)
        .is("release_date", null);
      if (error) {
        errors.push({ stage: "release_date_fill", message: `${fill.slug}：${error.message}` });
      } else {
        summary.release_date_filled++;
      }
    }
  }

  // ---- 4c. 寫入對照編號（upsert by game_id,country；表未建時跳過）----
  if (!tableMissing && plan.regionIdUpserts.length > 0) {
    const rows = plan.regionIdUpserts
      .map((u) => ({
        game_id: u.gameId ?? slugToId.get(u.gameSlug),
        country: u.country,
        title_id: u.title_id,
        source: u.source,
      }))
      .filter((r) => r.game_id != null);
    for (const batch of chunk(rows, REGION_BATCH_SIZE)) {
      const { error } = await admin
        .from("game_region_ids")
        .upsert(batch, { onConflict: "game_id,country" });
      if (error) {
        errors.push({
          stage: "game_region_ids",
          message: `寫入對照編號失敗：${error.message}`,
        });
        break;
      }
      summary.region_ids_upserted += batch.length;
    }
  } else if (tableMissing && plan.regionIdUpserts.length > 0) {
    errors.push({
      stage: "game_region_ids",
      message: `對照表未建，${plan.regionIdUpserts.length} 筆 TW/HK 編號本次未寫入（遊戲本身已進庫；建表後隔天同步會自動補上）`,
    });
  }

  // ---- 4d. 推進分頁游標（目錄寫入成功後才推進；寫入失敗拋錯時不推進，
  // 下次重抓同一窗口——冪等 upsert，重抓安全）。----
  // 外國匯入暫緩時 NA／EU 游標不推進：那些窗口的條目本次根本沒處理，
  // 推進了就得等下一輪（逐款長尾約 37 天）才回來；不推進則下次重跑同一窗口。
  if (!syncStateMissing) {
    const cursorResults = hasVerifiedColumn
      ? sourceResults
      : sourceResults.filter(
          (r) => !FOREIGN_IMPORT_SOURCES.includes(r.source)
        );
    const { tableMissing: cursorWriteMissing } = await advanceSyncCursors(
      admin,
      cursorResults,
      dateKey
    );
    if (cursorWriteMissing) {
      errors.push({
        stage: "sync_state",
        message: "游標寫入失敗（表可能未建），本次窗口下次會重抓；目錄寫入不受影響",
      });
    }
  }

  // ---- 4e. 維護 price_countries（供 /api/refresh 工作量切片用）----
  // 新遊戲＋本次拿到新編號／回填 title_id 的遊戲重算；其餘遊戲不受影響。
  {
    const titleIdById = new Map<string, string | null>(
      existingGames.map((g) => [g.id, g.title_id])
    );
    for (const g of plan.newGames) {
      const id = slugToId.get(g.slug);
      if (id) titleIdById.set(id, g.title_id);
    }
    const affected = new Set<string>();
    for (const id of slugToId.values()) affected.add(id);
    for (const f of plan.titleIdFills) affected.add(f.gameId);
    for (const u of plan.regionIdUpserts) {
      if (u.gameId) affected.add(u.gameId);
      else if (slugToId.get(u.gameSlug)) affected.add(slugToId.get(u.gameSlug)!);
    }
    const n = await refreshPriceCountryCounts(admin, [...affected], titleIdById, errors);
    summary.price_countries_updated = n;
    // ---- 4e-2. 全量重算 price_countries（定期自我修復；2026-11-24 稽核修復）----
    // 只對本次沒動過的遊戲用記憶體裡的對照表重算（本次剛寫的編號還沒進
    // 記憶體，那幾款上面已從庫裡重算過）；NULL／漂移值在這裡一次補齊，
    // 下次 /api/refresh 切片不再把 NULL 當 35 對虛增。欄位未建時跳過
    // （上面受影響重算已記過一筆錯誤，不重複報）。
    if (hasPriceCountriesColumn) {
      const full = await refreshAllPriceCountryCounts(
        admin,
        existingGames,
        existingRegionIds,
        affected,
        errors,
        { startedAt, timeBudgetMs: SYNC_TIME_BUDGET_MS }
      );
      summary.price_countries_full_updated = full.updated;
      summary.price_countries_full_remaining = full.remaining;
    }
  }
  // 目的：新遊戲進目錄當天就有價可看，不用等輪轉。
  // 價格來源優先順序：商店前端價（JP 搜尋 API／NA Algolia，已驗證）
  // 先寫入當即時價；價格 API 查到同一國價時覆蓋它（價格 API 為準）。
  // EU Solr 參考價只做交叉驗證、永不寫入。完整 35 國價仍走
  // /api/refresh 輪轉（對照表齊全後自動多國）。
  if (!opts.skipPrices && plan.newGames.length > 0) {
    if (Date.now() - startedAt > SYNC_TIME_BUDGET_MS) {
      summary.new_game_prices.skipped_over_budget = true;
      errors.push({
        stage: "new_game_prices",
        message: "時間預算（50 秒）已到，跳過新遊戲即時查價；下次 /api/refresh 輪到時再補價",
      });
    } else {
      const pricedGames = plan.newGames.slice(0, NEW_GAME_PRICE_CAP);
      summary.new_game_prices.skipped_over_cap =
        plan.newGames.length - pricedGames.length;
      // 每款新遊戲的（國家 → 編號）：JP 用 title_id，TW/HK 用本次掛上的編號。
      const idsByCountry = new Map<string, Map<string, string>>(); // country → titleId → slug
      for (const g of pricedGames) {
        if (g.title_id) {
          const m = idsByCountry.get("JP") ?? new Map();
          m.set(g.title_id, g.slug);
          idsByCountry.set("JP", m);
        }
      }
      for (const u of plan.regionIdUpserts) {
        if (!pricedGames.some((g) => g.slug === u.gameSlug)) continue;
        const m = idsByCountry.get(u.country) ?? new Map();
        if (!m.has(u.title_id)) m.set(u.title_id, u.gameSlug);
        idsByCountry.set(u.country, m);
      }
      const countries = [...idsByCountry.keys()].filter((c) =>
        PRICE_COUNTRIES.some((p) => p.code === c)
      );
      if (countries.length > 0) {
        let fx: Awaited<ReturnType<typeof fetchFxSnapshot>> | null = null;
        try {
          fx = await fetchFxSnapshot();
        } catch (err) {
          errors.push({
            stage: "new_game_prices",
            message: `匯率抓取失敗，新遊戲價格本次不寫：${err instanceof Error ? err.message : String(err)}`,
          });
        }
        if (fx) {
          const runAt = new Date().toISOString();
          type NewGamePriceRow = {
            game_id: string;
            country: string;
            country_name: string;
            currency: string;
            regular_raw: number | null;
            effective_raw: number | null;
            discount_pct: number | null;
            discount_raw: number | null;
            sale_end: string | null;
            price_twd: number | null;
            is_historical_low: boolean;
            /** 未確認標記：新匯入的外國價格（美洲 8 國／歐洲 20 國）先寫
             *  verified=false，探針驗證通過後才改 true（寫入端合約，見
             *  price-verified-migration-20261124.sql）。欄位未建時不帶此鍵
             *  （否則寫入報 42703）；TW／HK／JP／KR 維持已確認，不帶此鍵。 */
            verified?: boolean;
            updated_at: string;
          };
          // 價格列以 (game_id, country) 為鍵：商店前端價先寫入（新遊戲即時價），
          // 價格 API 查到同一國價時覆蓋它（價格 API 為準）；價格 API
          // 回 not_found 時商店前端價留著（例如 Switch 2 遊戲，價格 API v1
          // 查不到、JP 搜尋 API 有價）。同一鍵在一次 upsert 只能出現一次，
          // 所以用 Map 去重、不用陣列。
          const priceRowByKey = new Map<string, NewGamePriceRow>();
          const storefrontKeys = new Set<string>();
          const referenceBySlug = new Map(
            plan.referencePrices.map((r) => [r.gameSlug, r])
          );
          for (const sp of plan.storefrontPrices) {
            if (!pricedGames.some((g) => g.slug === sp.gameSlug)) continue;
            const gameId = slugToId.get(sp.gameSlug);
            const country = PRICE_COUNTRIES.find((p) => p.code === sp.country);
            if (!gameId || !country) continue;
            if (sp.effectiveRaw == null) continue;
            const fxRate = fx.ratesTwd.get(sp.currency);
            if (fxRate == null) continue;
            const regularRaw = sp.regularRaw ?? sp.effectiveRaw;
            const priceTwd = Math.round(sp.effectiveRaw * fxRate);
            const key = `${gameId}:${sp.country}`;
            const storefrontRow: NewGamePriceRow = {
              game_id: gameId,
              country: sp.country,
              country_name: country.name,
              currency: sp.currency,
              regular_raw: regularRaw,
              effective_raw: sp.effectiveRaw,
              discount_pct:
                regularRaw > 0
                  ? Math.round((1 - sp.effectiveRaw / regularRaw) * 100)
                  : null,
              discount_raw:
                regularRaw > sp.effectiveRaw ? regularRaw - sp.effectiveRaw : null,
              sale_end: sp.saleEnd ?? null,
              price_twd: priceTwd,
              is_historical_low: false,
              updated_at: runAt,
            };
            // 新匯入的外國價格先標未確認（欄位未建時不帶此鍵）。
            if (hasVerifiedColumn && FOREIGN_PRICE_COUNTRIES.has(sp.country)) {
              storefrontRow.verified = false;
            }
            priceRowByKey.set(key, storefrontRow);
            storefrontKeys.add(key);
          }
          const notFound: string[] = [];
          const lowBySlug = new Map<string, number>();
          const noteLow = (slug: string, priceTwd: number) => {
            const prev = lowBySlug.get(slug) ?? Infinity;
            lowBySlug.set(slug, Math.min(prev, priceTwd));
          };
          for (const code of countries) {
            if (Date.now() - startedAt > SYNC_TIME_BUDGET_MS) {
              summary.new_game_prices.skipped_over_budget = true;
              errors.push({
                stage: "new_game_prices",
                message: `時間預算（50 秒）已到，跳過剩餘國家的新遊戲查價；下次輪轉補價`,
              });
              break;
            }
            const country = PRICE_COUNTRIES.find((p) => p.code === code)!;
            const idToSlug = idsByCountry.get(code)!;
            let entries;
            try {
              entries = await fetchPricesForCountry(code, [...idToSlug.keys()]);
            } catch (err) {
              errors.push({
                stage: "new_game_prices",
                message: `${code} 查價失敗：${err instanceof Error ? err.message : String(err)}`,
              });
              continue;
            }
            summary.new_game_prices.attempted += idToSlug.size;
            for (const entry of entries) {
              const slug = idToSlug.get(String(entry.title_id));
              if (!slug) continue;
              const gameId = slugToId.get(slug);
              if (!gameId) continue;
              if (
                entry.sales_status !== "onsale" ||
                !entry.regular_price ||
                parseRawValue(entry.regular_price.raw_value) == null
              ) {
                notFound.push(`${slug}(${code})`);
                continue;
              }
              const regularRaw = parseRawValue(entry.regular_price.raw_value)!;
              const discountRawValue = entry.discount_price
                ? parseRawValue(entry.discount_price.raw_value)
                : null;
              const effectiveRaw = discountRawValue ?? regularRaw;
              const fxRate = fx.ratesTwd.get(entry.regular_price.currency);
              if (fxRate == null) continue;
              const priceTwd = Math.round(effectiveRaw * fxRate);
              // 價格 API 為準：同一 (game, country) 覆蓋先寫的商店前端價。
              const key = `${gameId}:${code}`;
              if (storefrontKeys.has(key)) storefrontKeys.delete(key);
              const apiRow: NewGamePriceRow = {
                game_id: gameId,
                country: code,
                country_name: country.name,
                currency: entry.regular_price.currency,
                regular_raw: regularRaw,
                effective_raw: effectiveRaw,
                discount_pct:
                  discountRawValue != null && regularRaw > 0
                    ? Math.round((1 - discountRawValue / regularRaw) * 100)
                    : null,
                discount_raw:
                  discountRawValue != null ? regularRaw - discountRawValue : null,
                sale_end: entry.discount_price?.end_datetime ?? null,
                price_twd: priceTwd,
                is_historical_low: false,
                updated_at: runAt,
              };
              // 新匯入的外國價格先標未確認（欄位未建時不帶此鍵）。
              if (hasVerifiedColumn && FOREIGN_PRICE_COUNTRIES.has(code)) {
                apiRow.verified = false;
              }
              priceRowByKey.set(key, apiRow);
              noteLow(slug, priceTwd);
              // 交叉驗證：EU Solr 參考價（GB）與價格 API 的 GB 價比對；
              // 差異超過 1%（且超過 0.5 幣別單位）時記錄，價格 API 勝出。
              const ref = referenceBySlug.get(slug);
              if (ref && code === ref.country && ref.effectiveRaw != null) {
                const diff = Math.abs(ref.effectiveRaw - effectiveRaw);
                if (diff > Math.max(0.5, 0.01 * effectiveRaw)) {
                  summary.reference_price_mismatches.push({
                    slug,
                    country: code,
                    solrEffective: ref.effectiveRaw,
                    apiEffective: effectiveRaw,
                    solrRegular: ref.regularRaw,
                    apiRegular: regularRaw,
                    source: ref.source,
                  });
                }
              }
            }
          }
          const priceRows = [...priceRowByKey.values()];
          summary.storefront_prices_written = storefrontKeys.size;
          if (priceRows.length > 0) {
            // 先算歷史低價旗標（新遊戲沒有舊歷史低價，本次最低價即歷史低價），
            // 再一次寫庫——旗標必須在 upsert 之前算好。
            // 低價只以「已確認」價格重算（商店前端價＋價格 API 兩邊都算，
            // 但 verified=false 的外國價不參與：未確認價不得壓低歷史低價，
            // 也不能把 is_historical_low 寫成 true；探針通過改 true 時再重算）。
            const slugByGameId = new Map(
              [...slugToId.entries()].map(([slug, id]) => [id, slug])
            );
            lowBySlug.clear();
            for (const row of priceRows) {
              const slug = slugByGameId.get(row.game_id);
              if (slug && row.price_twd != null && row.verified !== false)
                noteLow(slug, row.price_twd);
            }
            for (const row of priceRows) {
              const slug = slugByGameId.get(row.game_id);
              if (
                slug &&
                row.price_twd != null &&
                row.verified !== false &&
                row.price_twd === lowBySlug.get(slug)
              ) {
                row.is_historical_low = true;
              }
            }
            for (const batch of chunk(priceRows, PRICE_BATCH_SIZE)) {
              const { error } = await admin
                .from("prices")
                .upsert(batch, { onConflict: "game_id,country" });
              if (error) {
                errors.push({
                  stage: "new_game_prices",
                  message: `寫入新遊戲價格失敗：${error.message}`,
                });
                break;
              }
              summary.new_game_prices.priced += batch.length;
            }
            // 新遊戲沒有舊歷史低價：本次最低價就是歷史低價。
            for (const [slug, low] of lowBySlug) {
              const gameId = slugToId.get(slug);
              if (!gameId) continue;
              const { error } = await admin
                .from("games")
                .update({ historical_low_twd: low })
                .eq("id", gameId);
              if (error) {
                errors.push({
                  stage: "new_game_prices",
                  message: `${slug} 歷史低價寫入失敗：${error.message}`,
                });
              }
            }
          }
          summary.new_game_prices.price_not_found = notFound;
        }
      }
    }
  }

  summary.duration_ms = Date.now() - startedAt;
  return summary;
}
