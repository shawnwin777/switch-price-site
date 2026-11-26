import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  PRICE_COUNTRIES,
  fetchFxSnapshot,
  fetchPricesForCountry,
  parseRawValue,
  taipeiDateKey,
  type FxSnapshot,
} from "@/lib/nintendo";
import {
  DEFAULT_PAIR_BUDGET,
  REFRESH_CURSOR_SOURCE,
  REFRESH_GROUP_CURSOR_SOURCE,
  REFRESH_GROUP_NAMES,
  clampPairBudget,
  cursorCycleCompleteDateKey,
  cursorSlice,
  dayOfYearTaipei,
  pairsForGame,
  planWorkSlices,
  refreshGroupCountries,
  rotationWorkSlice,
  workCycleCompleteDateKey,
  workCycleDays,
  type RefreshGroupName,
} from "@/lib/refresh-slices";
import {
  buildRegionIdIndex,
  planCountryIds,
  type CountryPlan,
} from "@/lib/region-ids";
import {
  listAllGamesPaginated,
  listRegionIdsForCountries,
  probeTableColumn,
  readSyncCursors,
} from "@/lib/catalog-sync";
import { FOREIGN_PRICE_COUNTRIES } from "@/lib/catalog-sources";

// 每日更新：GET /api/refresh（Vercel Cron 用 GET）或 POST /api/refresh。
// 由 vercel.json 的 8 支 cron 每天打 8 次（UTC 20、23、02、05、08、11、14、17，
// 即台北 04、07、10、13、16、19、22、01，每 3 小時一次），
// 也可以用任何外部 cron 打同一支路由（見 SETUP.md）。
//
// 驗證：請求必須帶 Authorization: Bearer $CRON_SECRET，
// 不符回 401。Vercel Cron 在環境變數有設定 CRON_SECRET 時，
// 會自動用這個標頭打過來；外部 cron 請自己帶上標頭。
// 沒有設定 CRON_SECRET 時回 500（設定未完成，避免無保護的公開端點）。
//
// 流程：
//   1. 抓 ExchangeRate-API 匯率，換算成「1 外幣 = 多少台幣」，
//      以台北日期為 date_key 寫進 fx_rates。每天都更新（便宜）。
//      匯率抓不到 → 直接回 503，不動價格（沒有匯率就無法正確換算台幣價）。
//   2. 用官方價格 API 更新「本次切片」各國價格與特價結束時間，寫進 prices，
//      並只更新本次切片遊戲的 games.historical_low_twd。
//      查價編號按國家決定（見 lib/region-ids.ts）：game_region_ids 有該國
//      編號就用它；只有 JP 沒有對照編號時用 games.title_id 當 fallback，
//      其他國家沒編號就直接跳過（不發註定 not_found 的請求）。
//      對照表還沒建（migration 未跑）時 JP 照常、其他國家跳過。
//   3. 沒有任何編號的遊戲：跳過、保留舊價格，列在 pending_no_title_id。
//      價格 API 回 not_found 的遊戲／國家：保留舊價格，列在 price_not_found，
//      絕對不會讓整個更新失敗。單一國家抓價失敗（重試後仍失敗）只記進 errors，
//      不中斷其他國家。
//
// 切片與輪轉（遊戲太多、60 秒跑不完時；見 SETUP.md §8）：
//   - 按「(遊戲、國家) 對數」切片：每片固定約 12,000 對
//     （?pair_budget= 可調，1000～50000，或環境變數 REFRESH_PAIR_BUDGET）。
//     對數來源：全量輪轉用 games.price_countries（sync-catalog 維護）；
//     該欄位還沒建時以 35 計（舊行為）。分組輪轉用該組實際對數
//     （game_region_ids＋JP title_id 備援），所以組切片比全量小得多。
//     實測速率：400 款 × 35 國抓價約 22 秒；單國 12,000 對約 240 次
//     價格 API 呼叫、約 18–25 秒抓價。
//   - 不帶切片參數時用持久化游標輪轉：sync_state 表的 next_page 就是本次要
//     跑的片，跑完存下一片（見 lib/refresh-slices.ts cursorSlice）。
//     游標來源：全量輪轉用 'refresh-work'；分組輪轉各組獨立
//     （refresh-work:jp / :tw / :hk / :rest），互不干擾。
//     舊版時間取餘（globalIndex % slices）會因 slices 隨目錄成長變動而漏片
//     （2026-11-24 稽核：5,738 筆價格 8 天未刷新），現只在游標表未建時
//     退回時間輪轉。一輪 = slices 次執行，每天 runsPerDay 次
//     → ceil(slices / runsPerDay) 天跑完（全量例如 29 片 → 4 天）。
//   - 分組輪轉（2026-11-25）：?group=jp|tw|hk|rest，各組每天預設 2 次、
//     4 組共 8 次（與舊的全量 8 次相同）。JP 約 14,824 對→2 片（週期 1 天）、
//     TW 9,831→1 片、HK 10,660→1 片、其餘 32 國（含 KR）約 10,189→1 片
//     （週期各 0.5 天）；原全量輪轉約 10–12 天。cron 見 vercel.json。
//   - 手動指定一片：?slice=2&slices=8（0-based）。slices 只用來驗證 slice 範圍，
//     實際片數一律以當下對數與 pair_budget 推算；或 ?offset=800&limit=400。
//     手動模式不動游標（不干擾輪轉）。
//   - ?countries=JP,US,TW 保留，可與切片參數併用；恰好等於某組時歸到該組游標，
//     否則用 refresh-work:custom:<國家> 自訂游標，不污染各組游標。
//   - ?slice_size= 已退役（款數切片改為對數切片；explicit-offset 模式仍可用
//     它當 limit 的預設值）；調片大小請用 ?pair_budget=。
//
// 限制：export const maxDuration = 60（Vercel Hobby 上限；Pro 可調到 300）。
// 為了不超時，抓價階段有 45 秒軟預算：超過就不再開新國家、記進 errors 後
// 收尾回報（已抓到的照常寫入）；重試退避見 lib/nintendo.ts。
// 寫庫量注意：每片最多約 12,000 筆 prices upsert（200 筆一批、
// 4 批並行寫入，約 5～8 秒）；若上線後 duration_ms 常接近 60 秒，
// 先把 pair_budget 調小到 8000（見 SETUP.md §8.5）。
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COUNTRY_CONCURRENCY = 4;
const PRICE_BATCH_CONCURRENCY = 4;
const PRICE_BATCH_SIZE = 200;
/** 抓價階段軟預算（毫秒）：超過就不再開新國家，留時間寫庫與回應。 */
const PRICE_TIME_BUDGET_MS = 45_000;

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

interface GameRow {
  id: string;
  slug: string;
  title_id: string | null;
  historical_low_twd: number | null;
  /** 可查價國家數（games.price_countries；欄位未建時為 null，以 35 計）。 */
  price_countries: number | null;
}

interface PriceUpsert {
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
  /** 未確認標記：新匯入的外國價格（美洲 8 國／歐洲 20 國）先寫 verified=false，
   *  探針驗證通過後才改 true（寫入端合約，見 price-verified-migration-20261124.sql）。
   *  欄位未建時不帶此鍵（否則寫入報 42703）；已在庫的列不帶此鍵——PostgREST
   *  upsert 只更新 payload 內的欄位，既有 verified 值不會被蓋掉。 */
  verified?: boolean;
  updated_at: string;
}

function parseIntParam(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

async function handleRefresh(request: NextRequest) {
  const startedAt = Date.now();

  // ---- 驗證 CRON_SECRET ----
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "伺服器未設定 CRON_SECRET" },
      { status: 500 }
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  if (!token || !timingSafeCompare(token, cronSecret)) {
    return NextResponse.json({ ok: false, error: "未授權" }, { status: 401 });
  }

  // ---- 限定國家（?countries=JP,US，預設全部）----
  // 分組輪轉（?group=jp|tw|hk|rest；2026-11-25）：各組有自己的國家清單、游標與
  // 切片。?group= 優先於 ?countries=；?countries= 若恰好等於某組的國家清單，
  // 也歸到該組（游標共用）；否則用自訂游標鍵，不污染各組游標。
  const params = request.nextUrl.searchParams;
  const wanted = params.get("countries");
  let countries = wanted
    ? PRICE_COUNTRIES.filter((c) =>
        wanted
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .includes(c.code)
      )
    : PRICE_COUNTRIES;
  if (countries.length === 0) {
    return NextResponse.json(
      { ok: false, error: "countries 參數沒有對到任何國家" },
      { status: 400 }
    );
  }
  const allCountryCodes = PRICE_COUNTRIES.map((c) => c.code);
  let groupName: RefreshGroupName | null = null;
  let cursorSource = REFRESH_CURSOR_SOURCE;
  const groupParam = params.get("group")?.trim().toLowerCase() ?? null;
  if (groupParam != null) {
    if (!(REFRESH_GROUP_NAMES as readonly string[]).includes(groupParam)) {
      return NextResponse.json(
        {
          ok: false,
          error: `group 參數不正確：${groupParam}（請用 jp / tw / hk / rest）`,
        },
        { status: 400 }
      );
    }
    groupName = groupParam as RefreshGroupName;
    const groupCodes = refreshGroupCountries(groupName, allCountryCodes);
    countries = PRICE_COUNTRIES.filter((c) => groupCodes.includes(c.code));
    cursorSource = REFRESH_GROUP_CURSOR_SOURCE[groupName];
  } else if (wanted) {
    const sorted = [...countries.map((c) => c.code)].sort();
    const matched = (
      REFRESH_GROUP_NAMES as readonly RefreshGroupName[]
    ).find(
      (g) =>
        JSON.stringify(
          refreshGroupCountries(g, allCountryCodes).slice().sort()
        ) === JSON.stringify(sorted)
    );
    if (matched) {
      groupName = matched;
      cursorSource = REFRESH_GROUP_CURSOR_SOURCE[matched];
    } else {
      cursorSource = `refresh-work:custom:${sorted.join(",")}`;
    }
  }

  // ---- 片大小：?pair_budget= 優先，其次環境變數，預設 12,000 對（夾在 1000～50000）----
  // ?slice_size= 已退役（款數切片改為對數切片）；explicit-offset 模式仍可用
  // 它當 limit 省略時的預設值（見下），其餘模式忽略。
  const envPairBudget = parseIntParam(process.env.REFRESH_PAIR_BUDGET ?? null);
  const pairBudget = clampPairBudget(
    parseIntParam(params.get("pair_budget")) ?? envPairBudget ?? DEFAULT_PAIR_BUDGET
  );
  const legacySliceSize = parseIntParam(params.get("slice_size")) ?? null;
  // 每天跑幾次（環境變數 REFRESH_RUNS_PER_DAY；?runs_per_day= 可覆蓋，供手動測試）。
  // 預設：分組輪轉每天 2 次（每組 2 次、4 組共 8 次，與舊的全量 8 次相同），
  // 全量輪轉預設 8 次（每 3 小時一次）。slot＝台北小時所在的時段。
  const runsPerDay = Math.max(
    1,
    Math.min(
      24,
      parseIntParam(params.get("runs_per_day")) ??
        parseIntParam(process.env.REFRESH_RUNS_PER_DAY ?? null) ??
        (groupName != null ? 2 : 8)
    )
  );

  const admin = createSupabaseAdminClient();
  const dateKey = taipeiDateKey();
  const runAt = new Date().toISOString();

  // ---- 1. 匯率（每天都更新，與切片無關）----
  let fx: FxSnapshot;
  try {
    fx = await fetchFxSnapshot();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `匯率抓取失敗，價格未更新：${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 503 }
    );
  }
  const fxRows = [...fx.ratesTwd.entries()].map(([currency, rate]) => ({
    date_key: dateKey,
    currency,
    rate,
    as_of: fx.asOf,
  }));
  const { error: fxError } = await admin
    .from("fx_rates")
    .upsert(fxRows, { onConflict: "date_key,currency" });
  if (fxError) {
    return NextResponse.json(
      { ok: false, error: `寫入 fx_rates 失敗：${fxError.message}` },
      { status: 500 }
    );
  }

  // ---- 2. 讀全部遊戲（按 slug 排序），再切出本次切片 ----
  // 遊戲清單本身很小（id/slug/title_id/歷史低價/國家數五欄，數千筆也只有幾百 KB），
  // 全讀再切片比資料庫分頁簡單且決定性相同；切片邊界只取決於 slug 排序。
  // 注意：PostgREST 單次最多回 1000 列，10,051 款必須分頁讀（否則輪轉
  // 永遠只覆蓋前 1000 款）；listAllGamesPaginated 用 .range() 分頁讀完。
  // price_countries 欄位還沒建（migration 未跑）時選取會失敗，退回不含該欄
  // 的讀取（對數以 35 計＝舊行為，見 pairsForGame）。
  let allGames: GameRow[];
  // ExistingGameLite 沒有 price_countries 欄位（欄位由 migration 追加），
  // 讀取時另外標型別。
  type GameRowWithCounts = {
    id: string;
    slug: string;
    title_id: string | null;
    historical_low_twd: number | null;
    price_countries?: number | null;
  };
  try {
    const rows = (await listAllGamesPaginated(
      admin,
      "id, slug, title_id, historical_low_twd, price_countries"
    )) as unknown as GameRowWithCounts[];
    allGames = rows.map((g) => ({
      id: g.id,
      slug: g.slug,
      title_id: g.title_id,
      historical_low_twd: g.historical_low_twd ?? null,
      price_countries: g.price_countries ?? null,
    }));
  } catch {
    try {
      const rows = await listAllGamesPaginated(admin);
      allGames = rows.map((g) => ({
        id: g.id,
        slug: g.slug,
        title_id: g.title_id,
        historical_low_twd: g.historical_low_twd ?? null,
        price_countries: null,
      }));
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: `讀取 games 失敗：${err instanceof Error ? err.message : "未知錯誤"}` },
        { status: 500 }
      );
    }
  }
  const totalGames = allGames.length;
  // ---- 分組對數：組輪轉時以該組實際對數切片（區編號＋JP title_id 備援），
  // 不用 games.price_countries（那是全 35 國的對數，會把組切片得跟全量一樣大、
  // 週期一樣長）。全量輪轉（無 group）維持舊行為。
  // 組對照表先讀整組（分頁），後面 2b 直接沿用，不再按 game_id 大 IN 清單重讀。
  let pairCounts: number[];
  let groupRegionIndex: Map<string, Map<string, string>> | null = null;
  if (groupName != null) {
    const groupCodes = refreshGroupCountries(groupName, allCountryCodes);
    const { rows: groupRegionRows, tableMissing } =
      await listRegionIdsForCountries(admin, groupCodes);
    if (!tableMissing) {
      groupRegionIndex = buildRegionIdIndex(
        groupRegionRows as { game_id: string; country: string; title_id: string }[]
      );
      const countsByGame = new Map<string, number>();
      for (const row of groupRegionRows) {
        countsByGame.set(
          row.game_id,
          (countsByGame.get(row.game_id) ?? 0) + 1
        );
      }
      pairCounts = allGames.map((g) => {
        const regionCount = countsByGame.get(g.id) ?? 0;
        if (groupName === "jp") {
          // JP 每款最多 1 對：有區編號用區編號，否則有 title_id 就用備援。
          return regionCount > 0 || g.title_id ? 1 : 0;
        }
        return regionCount;
      });
    } else {
      // 對照表未建：退回全量對數切片（本輪仍可跑，只是組週期不會變短）。
      pairCounts = allGames.map((g) => pairsForGame(g.price_countries));
    }
  } else {
    pairCounts = allGames.map((g) => pairsForGame(g.price_countries));
  }
  const workSlices = planWorkSlices(pairCounts, pairBudget);
  const slices = workSlices.length;
  const pairsTotal = pairCounts.reduce((a, b) => a + b, 0);

  // 模式：明確 ?slice= > 明確 ?offset=&limit= > 預設輪轉（持久化游標）。
  const sliceParam = parseIntParam(params.get("slice"));
  const offsetParam = parseIntParam(params.get("offset"));
  const limitParam = parseIntParam(params.get("limit"));
  let mode: "rotation" | "explicit-slice" | "explicit-offset";
  let slice: number;
  let slot = 0;
  // 持久化游標狀態（只在 rotation 模式用；手動模式不動游標）。
  let cursorMode: "persistent" | "time-fallback" = "persistent";
  let cursorNext = 0;
  let cursorNote: string | null = null;
  if (sliceParam != null) {
    const slicesParam = parseIntParam(params.get("slices"));
    const effectiveSlices =
      slicesParam != null && slicesParam >= 1 ? slicesParam : slices;
    if (sliceParam < 0 || sliceParam >= effectiveSlices) {
      return NextResponse.json(
        {
          ok: false,
          error: `slice 參數超出範圍：slice=${sliceParam}，slices=${effectiveSlices}（0-based，請用 0～${effectiveSlices - 1}）`,
        },
        { status: 400 }
      );
    }
    mode = "explicit-slice";
    slice = sliceParam;
  } else if (offsetParam != null || limitParam != null) {
    if (offsetParam == null || offsetParam < 0) {
      return NextResponse.json(
        { ok: false, error: "offset 需 ≥ 0（例如 ?offset=800&limit=400）" },
        { status: 400 }
      );
    }
    const limit = limitParam ?? legacySliceSize ?? 400;
    if (limit < 1) {
      return NextResponse.json(
        { ok: false, error: "limit 需 ≥ 1（例如 ?offset=800&limit=400）" },
        { status: 400 }
      );
    }
    mode = "explicit-offset";
    slice =
      workSlices.findIndex(
        (s) => offsetParam >= s.offset && offsetParam < s.offset + s.count
      ) ?? 0;
    if (slice < 0) slice = 0;
  } else {
    mode = "rotation";
    // 持久化游標（sync_state，source=cursorSource；分組時各組獨立來源，
    // 互不干擾）：上次存的 next_page 就是本次要跑的片；片數隨目錄成長變動時
    // 以取餘收斂，不再像舊的時間取餘輪轉那樣因 slices 變動而漏片。
    // 表未建／讀不到時退回時間輪轉。
    const { cursors, tableMissing: syncStateMissing } = await readSyncCursors(admin);
    if (syncStateMissing) {
      cursorMode = "time-fallback";
      const rot = rotationWorkSlice(new Date(), slices, runsPerDay);
      slice = rot.slice;
      slot = rot.slot;
      cursorNote =
        "sync_state 表未建（請執行 supabase/migrations/20261117_catalog_sync_state.sql），本次用時間輪轉（舊行為）；游標未持久化";
    } else {
      const stored = cursors.get(cursorSource)?.nextPage ?? null;
      if (stored == null) {
        cursorNote = `首次持久化輪轉（sync_state 尚無 ${cursorSource} 游標），從第 0 片開始`;
      }
      const cur = cursorSlice(stored, slices);
      slice = cur.slice;
      cursorNext = cur.next;
    }
  }
  const { offset, count } =
    mode === "explicit-offset"
      ? {
          offset: offsetParam!,
          count: Math.max(
            0,
            Math.min(limitParam ?? legacySliceSize ?? 400, totalGames - offsetParam!)
          ),
        }
      : workSlices[slice];
  const sliceGames = allGames.slice(offset, offset + count);
  const pairsInSlice = pairCounts
    .slice(offset, offset + count)
    .reduce((a, b) => a + b, 0);
  const gameById = new Map(sliceGames.map((g) => [g.id, g]));

  // ---- 2b. 讀本次切片遊戲的各區編號對照（game_region_ids）----
  // 對照表是逐步補齊的：讀不到表（migration 還沒跑）時不讓更新失敗，
  // JP 照常查價、其他國家跳過，並在回報裡標明。
  // 某國無對照編號的遊戲：只有 JP 用 games.title_id 當 fallback，
  // 其他國家直接跳過、保留舊價（見 lib/region-ids.ts）。
  let regionIndex = buildRegionIdIndex([]);
  let regionTableStatus: "ok" | "missing" | "empty" = "empty";
  const regionReadErrors: { country: string; message: string }[] = [];
  if (groupRegionIndex != null) {
    // 組輪轉：對照表已在切片前整組讀好，直接沿用（是整組的、不限本片；
    // planCountryIds 只會用到本片遊戲，所以沿用是正確的）。
    regionIndex = groupRegionIndex;
    regionTableStatus = groupRegionIndex.size > 0 ? "ok" : "empty";
  } else if (sliceGames.length > 0) {
    const { data: regionRows, error: regionError } = await admin
      .from("game_region_ids")
      .select("game_id, country, title_id")
      .in(
        "game_id",
        sliceGames.map((g) => g.id)
      );
    if (regionError) {
      regionTableStatus = "missing";
      regionReadErrors.push({
        country: "-",
        message: `讀取 game_region_ids 失敗（${regionError.message}），本次 JP 改用 games.title_id 查價、其他國家跳過；請執行 supabase/migrations/20261116_game_region_ids.sql 後再跑 seed-region-ids.mjs`,
      });
    } else if (regionRows && regionRows.length > 0) {
      regionIndex = buildRegionIdIndex(
        regionRows as { game_id: string; country: string; title_id: string }[]
      );
      regionTableStatus = "ok";
    }
  }

  const withTitleId = sliceGames.filter(
    (g): g is GameRow & { title_id: string } => Boolean(g.title_id)
  );
  // 完全無編號的遊戲：games.title_id 沒有、對照表裡也沒有任何一國編號。
  const pendingNoTitleId = sliceGames
    .filter((g) => !g.title_id && !regionIndex.has(g.id))
    .map((g) => g.slug);

  // 每國一份查價計畫（該國編號 → 遊戲）：同一款遊戲在不同國家可能用
  // 不同編號查價，所以不能再像舊版共用一份 titleIds。
  // fallback 只開給 JP：JP 編號查非 JP 國家幾乎必回 not_found，
  // 30,000 款規模下是純浪費；其他國家沒對照編號就直接跳過、保留舊價。
  const countryPlans = new Map<string, CountryPlan>();
  for (const country of countries) {
    countryPlans.set(
      country.code,
      planCountryIds(sliceGames, regionIndex, country.code, country.code === "JP")
    );
  }
  for (const [code, plan] of countryPlans) {
    for (const c of plan.collisions) {
      regionReadErrors.push({
        country: code,
        message: `編號衝突：${c.titleId} 同時對到 ${c.keptSlug} 與 ${c.droppedSlug}，本次只查 ${c.keptSlug}；請檢查 game_region_ids`,
      });
    }
  }

  // ---- 3. 逐國抓價格（先全部收進記憶體，再一次算歷史低價、一次寫入）----
  // 只處理本次切片的遊戲；歷史低價也只針對切片遊戲更新。
  const priceRows: PriceUpsert[] = [];
  const notFound: {
    slug: string;
    title_id: string | null;
    countries: string[];
    by_country: Record<string, { title_id: string; source: string }>;
  }[] = [];
  const notFoundByGame = new Map<
    string,
    { country: string; title_id: string; source: string }[]
  >();
  const errors: { country: string; message: string }[] = [
    ...(cursorNote ? [{ country: "-", message: cursorNote }] : []),
    ...regionReadErrors,
  ];
  const missingFxCurrencies = new Set<string>();

  async function refreshCountry(country: (typeof PRICE_COUNTRIES)[number]) {
    const plan = countryPlans.get(country.code)!;
    const titleIdToGame = plan.titleIdToGame;
    let entries;
    try {
      entries = await fetchPricesForCountry(country.code, plan.titleIds);
    } catch (err) {
      errors.push({
        country: country.code,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const entry of entries) {
      const game = titleIdToGame.get(String(entry.title_id));
      if (!game) continue; // API 回了不在清單裡的 ID，忽略
      if (
        entry.sales_status !== "onsale" ||
        !entry.regular_price ||
        parseRawValue(entry.regular_price.raw_value) == null
      ) {
        // not_found / 下架 / 無價格：保留舊價格，只記錄（附上本次實際
        // 查價用的編號與來源：region 或 fallback）。
        const list = notFoundByGame.get(game.slug) ?? [];
        list.push({
          country: country.code,
          title_id: String(entry.title_id),
          source:
            regionIndex.get(game.id)?.get(country.code) != null
              ? "region"
              : "fallback",
        });
        notFoundByGame.set(game.slug, list);
        continue;
      }
      const regularRaw = parseRawValue(entry.regular_price.raw_value)!;
      const discountRawValue = entry.discount_price
        ? parseRawValue(entry.discount_price.raw_value)
        : null;
      const effectiveRaw = discountRawValue ?? regularRaw;
      const currency = entry.regular_price.currency;
      const fxRate = fx.ratesTwd.get(currency);
      if (fxRate == null) {
        missingFxCurrencies.add(currency);
        continue; // 沒有該幣別匯率就保留舊價格，不亂換算
      }
      const discountPct =
        discountRawValue != null && regularRaw > 0
          ? Math.round((1 - discountRawValue / regularRaw) * 100)
          : null;
      priceRows.push({
        game_id: game.id,
        country: country.code,
        country_name: country.name,
        currency,
        regular_raw: regularRaw,
        effective_raw: effectiveRaw,
        discount_pct: discountPct,
        discount_raw:
          discountRawValue != null ? regularRaw - discountRawValue : null,
        sale_end: entry.discount_price?.end_datetime ?? null,
        price_twd: Math.round(effectiveRaw * fxRate),
        is_historical_low: false, // 第二階段算出歷史低價後再補
        updated_at: runAt,
      });
    }
  }

  let countriesSkippedForBudget = 0;
  for (let i = 0; i < countries.length; i += COUNTRY_CONCURRENCY) {
    if (Date.now() - startedAt > PRICE_TIME_BUDGET_MS) {
      countriesSkippedForBudget = countries.length - i;
      errors.push({
        country: "-",
        message: `時間預算（${PRICE_TIME_BUDGET_MS / 1000} 秒）已到，跳過剩餘 ${countriesSkippedForBudget} 國，下次輪到本片時再補；已抓到的價格照常寫入`,
      });
      break;
    }
    await Promise.all(countries.slice(i, i + COUNTRY_CONCURRENCY).map(refreshCountry));
  }
  for (const [slug, list] of notFoundByGame) {
    const game = sliceGames.find((g) => g.slug === slug);
    if (game) {
      const byCountry: Record<string, { title_id: string; source: string }> =
        {};
      for (const item of list) {
        byCountry[item.country] = {
          title_id: item.title_id,
          source: item.source,
        };
      }
      notFound.push({
        slug,
        // title_id 欄位維持舊語義（games.title_id，可能為 null）；
        // 本次實際查價用的各國編號見 by_country。
        title_id: game.title_id,
        countries: list.map((item) => item.country),
        by_country: byCountry,
      });
    }
  }

  // ---- 3b. 未確認價格標記（外國匯入寫入端合約）----
  // prices.verified 欄位存在時才標記；不存在時不帶 verified 鍵（否則寫入報 42703）。
  // 只標「新出現」的外國價格列：先查既有 (game_id, country) 鍵，已在庫的列不帶
  // verified 鍵（upsert 不動既有值，探針通過後改成的 true 不會被蓋回 false）；
  // 新列才帶 verified=false。TW／HK／JP／KR 維持已確認，不標記。
  let hasVerifiedColumn = false;
  let unverifiedPricesWritten = 0;
  if (priceRows.length > 0) {
    hasVerifiedColumn = await probeTableColumn(admin, "prices", "verified");
  }
  if (hasVerifiedColumn) {
    const foreignRows = priceRows.filter((r) =>
      FOREIGN_PRICE_COUNTRIES.has(r.country)
    );
    const foreignGameIds = [...new Set(foreignRows.map((r) => r.game_id))];
    const existingKeys = new Set<string>();
    let lookupFailed = false;
    for (let i = 0; i < foreignGameIds.length; i += 200) {
      const { data, error: existError } = await admin
        .from("prices")
        .select("game_id, country")
        .in("game_id", foreignGameIds.slice(i, i + 200));
      if (existError) {
        lookupFailed = true;
        errors.push({
          country: "-",
          message: `讀取既有外國價格列失敗（${existError.message}）：本次外國新價未標未確認（以已確認寫入），請檢查後重跑本片`,
        });
        break;
      }
      for (const row of (data ?? []) as { game_id: string; country: string }[]) {
        existingKeys.add(`${row.game_id}:${row.country}`);
      }
    }
    if (!lookupFailed) {
      for (const row of foreignRows) {
        if (!existingKeys.has(`${row.game_id}:${row.country}`)) {
          row.verified = false;
          unverifiedPricesWritten++;
        }
      }
    }
  }

  // 本次各國用了幾個對照編號、幾個 fallback、幾個遊戲該國無編號。
  const regionIdsUsed: {
    table: "ok" | "missing" | "empty";
    total_region: number;
    total_fallback: number;
    by_country: Record<
      string,
      { region: number; fallback: number; skipped: number }
    >;
  } = {
    table: regionTableStatus,
    total_region: 0,
    total_fallback: 0,
    by_country: {},
  };
  for (const country of countries) {
    const plan = countryPlans.get(country.code)!;
    regionIdsUsed.by_country[country.code] = {
      region: plan.usedRegion,
      fallback: plan.usedFallback,
      skipped: plan.skippedSlugs.length,
    };
    regionIdsUsed.total_region += plan.usedRegion;
    regionIdsUsed.total_fallback += plan.usedFallback;
  }

  // ---- 4. 歷史低價（只針對本次切片）：新低 = min（舊歷史低價，本次各國最低價）----
  // 只用「已確認」價格算：verified=false 的外國新價不參與（不得壓低歷史低價，
  // 也不得把 is_historical_low 寫成 true；探針通過改 true 的同時再重算）。
  const newLowByGame = new Map<string, number>();
  for (const row of priceRows) {
    if (row.price_twd == null) continue;
    if (row.verified === false) continue;
    const prev = newLowByGame.get(row.game_id) ?? Infinity;
    newLowByGame.set(row.game_id, Math.min(prev, row.price_twd));
  }
  const gamesWithNewLow: string[] = [];
  for (const row of priceRows) {
    const game = gameById.get(row.game_id);
    const oldLow = game?.historical_low_twd ?? null;
    const newLow = newLowByGame.get(row.game_id);
    const finalLow =
      newLow == null ? oldLow : oldLow == null ? newLow : Math.min(oldLow, newLow);
    if (
      row.price_twd != null &&
      row.verified !== false &&
      finalLow != null &&
      row.price_twd <= finalLow
    ) {
      row.is_historical_low = true;
    }
  }

  // ---- 5. 寫入 prices + 更新 games.historical_low_twd（只針對切片遊戲）----
  let pricesUpdated = 0;
  if (priceRows.length > 0) {
    const batches: PriceUpsert[][] = [];
    for (let i = 0; i < priceRows.length; i += PRICE_BATCH_SIZE) {
      batches.push(priceRows.slice(i, i + PRICE_BATCH_SIZE));
    }
    for (let i = 0; i < batches.length; i += PRICE_BATCH_CONCURRENCY) {
      const results = await Promise.all(
        batches.slice(i, i + PRICE_BATCH_CONCURRENCY).map((batch) =>
          admin.from("prices").upsert(batch, { onConflict: "game_id,country" })
        )
      );
      for (const { error } of results) {
        if (error) {
          return NextResponse.json(
            { ok: false, error: `寫入 prices 失敗：${error.message}` },
            { status: 500 }
          );
        }
      }
      pricesUpdated += batches
        .slice(i, i + PRICE_BATCH_CONCURRENCY)
        .reduce((n, b) => n + b.length, 0);
    }
  }
  // 歷史低價寫回 games：原本是逐款 await 循序更新，1000 筆價格若有數百款
  // 新低就要數百次來回（每趟約 50～100ms），很容易把 60 秒吃光、函式被殺
  // 在游標推進之前（2026-11-26 09:54 HK 實測：1000 筆價格已寫入，但函式
  // 仍 FUNCTION_INVOCATION_TIMEOUT、游標沒推進）。改成 10 並行批次更新。
  const lowUpdates: { id: string; historical_low_twd: number }[] = [];
  for (const [gameId, minNew] of newLowByGame) {
    const game = gameById.get(gameId);
    if (!game) continue;
    const oldLow = game.historical_low_twd;
    const finalLow = oldLow == null ? minNew : Math.min(oldLow, minNew);
    if (oldLow == null || minNew < oldLow) {
      gamesWithNewLow.push(game.slug);
      lowUpdates.push({ id: gameId, historical_low_twd: finalLow });
    }
  }
  const LOW_UPDATE_CONCURRENCY = 10;
  for (let i = 0; i < lowUpdates.length; i += LOW_UPDATE_CONCURRENCY) {
    const chunk = lowUpdates.slice(i, i + LOW_UPDATE_CONCURRENCY);
    const results = await Promise.all(
      chunk.map((u) =>
        admin
          .from("games")
          .update({ historical_low_twd: u.historical_low_twd })
          .eq("id", u.id)
          .then(
            (r) => ({ slug: gameById.get(u.id)?.slug ?? u.id, error: r.error }),
            (e) => ({
              slug: gameById.get(u.id)?.slug ?? u.id,
              error: e as { message: string },
            })
          )
      )
    );
    for (const r of results) {
      if (r.error) {
        errors.push({
          country: "-",
          message: `更新 ${r.slug} 歷史低價失敗：${r.error.message}`,
        });
      }
    }
  }

  // ---- 6. 推進持久化游標（輪轉模式＋持久化成功時才推進；寫入失敗
  // 回 500 的路徑不走到這裡，下次重跑同一片——冪等，安全。手動模式不動游標。）----
  if (mode === "rotation" && cursorMode === "persistent") {
    const { error: cursorError } = await admin.from("sync_state").upsert(
      {
        source: cursorSource,
        next_page: cursorNext,
        total_pages: slices,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source" }
    );
    if (cursorError) {
      errors.push({
        country: "-",
        message: `游標推進失敗（${cursorError.message}），下次仍跑第 ${slice} 片（重跑安全，價格照常寫入）`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    date_key: dateKey,
    fx_as_of: fx.asOf,
    fx_source: fx.source,
    fx_currencies: fxRows.length,
    mode,
    group: groupName ?? "all",
    cursor_source: cursorSource,
    slice,
    slices,
    pair_budget: pairBudget,
    pairs_total: pairsTotal,
    pairs_in_slice: pairsInSlice,
    runs_per_day: runsPerDay,
    slot,
    cycle_days: workCycleDays(slices, runsPerDay),
    total_games: totalGames,
    games_in_slice: sliceGames.length,
    games_with_title_id: withTitleId.length,
    next_slice: (slice + 1) % slices,
    rotation_cursor: {
      mode: cursorMode,
      slice,
      next: cursorMode === "persistent" ? cursorNext : (slice + 1) % slices,
      slices,
      note: cursorNote,
    },
    rotation_day_of_year: dayOfYearTaipei(new Date()),
    cycle_complete_date:
      cursorMode === "persistent"
        ? cursorCycleCompleteDateKey(new Date(), slice, slices, runsPerDay)
        : workCycleCompleteDateKey(new Date(), slices, runsPerDay),
    countries_attempted: countries.map((c) => c.code),
    countries_skipped_for_budget: countriesSkippedForBudget,
    prices_updated: pricesUpdated,
    verified_column: hasVerifiedColumn,
    unverified_prices_written: unverifiedPricesWritten,
    games_with_new_low: gamesWithNewLow,
    region_ids_used: regionIdsUsed,
    pending_no_title_id: pendingNoTitleId,
    price_not_found: notFound,
    missing_fx_currencies: [...missingFxCurrencies],
    errors,
    duration_ms: Date.now() - startedAt,
  });
}

export async function GET(request: NextRequest) {
  return handleRefresh(request);
}

export async function POST(request: NextRequest) {
  return handleRefresh(request);
}
