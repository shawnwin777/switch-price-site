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

// 每日更新：GET /api/refresh（Vercel Cron 用 GET）或 POST /api/refresh。
// 由 vercel.json 的 cron 每天 00:00 UTC（= 台北時間 08:00）觸發，
// 也可以用任何外部 cron 打同一支路由（見 SETUP.md）。
//
// 驗證：請求必須帶 Authorization: Bearer $CRON_SECRET，
// 不符回 401。Vercel Cron 在環境變數有設定 CRON_SECRET 時，
// 會自動用這個標頭打過來；外部 cron 請自己帶上標頭。
// 沒有設定 CRON_SECRET 時回 500（設定未完成，避免無保護的公開端點）。
//
// 流程：
//   1. 抓 ExchangeRate-API 匯率，換算成「1 外幣 = 多少台幣」，
//      以台北日期為 date_key 寫進 fx_rates。
//      匯率抓不到 → 直接回 503，不動價格（沒有匯率就無法正確換算台幣價）。
//   2. 用官方價格 API 更新各國價格與特價結束時間，寫進 prices，
//      並更新 games.historical_low_twd。
//   3. 沒有 title ID 的遊戲：跳過、保留舊價格，列在 pending_no_title_id。
//      價格 API 回 not_found 的遊戲／國家：保留舊價格，列在 price_not_found，
//      絕對不會讓整個更新失敗。
//
// 限制：export const maxDuration = 60（Vercel Hobby 上限；Pro 可調到 300）。
// 若日後國家或遊戲變多導致超時，可用 ?countries=JP,US,TW 把國家拆成多次打。
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COUNTRY_CONCURRENCY = 4;

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
  updated_at: string;
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
  const wanted = request.nextUrl.searchParams.get("countries");
  const countries = wanted
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

  const admin = createSupabaseAdminClient();
  const dateKey = taipeiDateKey();
  const runAt = new Date().toISOString();

  // ---- 1. 匯率 ----
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

  // ---- 2. 讀遊戲與 title ID ----
  const { data: games, error: gamesError } = await admin
    .from("games")
    .select("id, slug, title_id, historical_low_twd")
    .order("slug");
  if (gamesError || !games) {
    return NextResponse.json(
      { ok: false, error: `讀取 games 失敗：${gamesError?.message ?? "未知錯誤"}` },
      { status: 500 }
    );
  }
  const gameRows = games as GameRow[];
  const pendingNoTitleId = gameRows
    .filter((g) => !g.title_id)
    .map((g) => g.slug);
  const withTitleId = gameRows.filter(
    (g): g is GameRow & { title_id: string } => Boolean(g.title_id)
  );
  const titleIdToGame = new Map(withTitleId.map((g) => [g.title_id, g]));
  const titleIds = withTitleId.map((g) => g.title_id);

  // ---- 3. 逐國抓價格（先全部收進記憶體，再一次算歷史低價、一次寫入）----
  const priceRows: PriceUpsert[] = [];
  const notFound: { slug: string; title_id: string; countries: string[] }[] =
    [];
  const notFoundByGame = new Map<string, string[]>();
  const errors: { country: string; message: string }[] = [];
  const missingFxCurrencies = new Set<string>();

  async function refreshCountry(country: (typeof PRICE_COUNTRIES)[number]) {
    let entries;
    try {
      entries = await fetchPricesForCountry(country.code, titleIds);
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
        // not_found / 下架 / 無價格：保留舊價格，只記錄
        const list = notFoundByGame.get(game.slug) ?? [];
        list.push(country.code);
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

  for (let i = 0; i < countries.length; i += COUNTRY_CONCURRENCY) {
    await Promise.all(countries.slice(i, i + COUNTRY_CONCURRENCY).map(refreshCountry));
  }
  for (const [slug, list] of notFoundByGame) {
    const game = withTitleId.find((g) => g.slug === slug);
    if (game) {
      notFound.push({ slug, title_id: game.title_id, countries: list });
    }
  }

  // ---- 4. 歷史低價：新低 = min（舊歷史低價，本次各國最低價）----
  const newLowByGame = new Map<string, number>();
  for (const row of priceRows) {
    if (row.price_twd == null) continue;
    const prev = newLowByGame.get(row.game_id) ?? Infinity;
    newLowByGame.set(row.game_id, Math.min(prev, row.price_twd));
  }
  const gamesWithNewLow: string[] = [];
  for (const row of priceRows) {
    const game = withTitleId.find((g) => g.id === row.game_id);
    const oldLow = game?.historical_low_twd ?? null;
    const newLow = newLowByGame.get(row.game_id);
    const finalLow =
      newLow == null ? oldLow : oldLow == null ? newLow : Math.min(oldLow, newLow);
    if (row.price_twd != null && finalLow != null && row.price_twd <= finalLow) {
      row.is_historical_low = true;
    }
  }

  // ---- 5. 寫入 prices + 更新 games.historical_low_twd ----
  let pricesUpdated = 0;
  if (priceRows.length > 0) {
    for (let i = 0; i < priceRows.length; i += 200) {
      const batch = priceRows.slice(i, i + 200);
      const { error } = await admin
        .from("prices")
        .upsert(batch, { onConflict: "game_id,country" });
      if (error) {
        return NextResponse.json(
          { ok: false, error: `寫入 prices 失敗：${error.message}` },
          { status: 500 }
        );
      }
      pricesUpdated += batch.length;
    }
  }
  for (const [gameId, minNew] of newLowByGame) {
    const game = withTitleId.find((g) => g.id === gameId);
    if (!game) continue;
    const oldLow = game.historical_low_twd;
    const finalLow = oldLow == null ? minNew : Math.min(oldLow, minNew);
    if (oldLow == null || minNew < oldLow) {
      gamesWithNewLow.push(game.slug);
      const { error } = await admin
        .from("games")
        .update({ historical_low_twd: finalLow })
        .eq("id", gameId);
      if (error) {
        errors.push({ country: "-", message: `更新 ${game.slug} 歷史低價失敗：${error.message}` });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    date_key: dateKey,
    fx_as_of: fx.asOf,
    fx_source: fx.source,
    fx_currencies: fxRows.length,
    countries_attempted: countries.map((c) => c.code),
    prices_updated: pricesUpdated,
    games_with_new_low: gamesWithNewLow,
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
