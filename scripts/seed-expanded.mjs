/**
 * Switch 遊戲比價 — 擴大目錄匯入腳本
 * ============================================================
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
 *   node scripts/seed-expanded.mjs
 *
 *   指定其他目錄檔：node scripts/seed-expanded.mjs data/另一個檔名.json
 *
 * 前置作業：先在 Supabase Dashboard → SQL Editor 執行 supabase/schema.sql。
 * 資料來源：scripts/build-expanded-catalog.mjs 產出的
 *   data/catalog-expanded.json（2026-11-16 快照：10,051 款遊戲、
 *   9,831 筆價格；見該檔 data.status）。
 *
 * 與 scripts/seed.mjs 的差異（刻意）：
 *   - 封面：cover_url 保留 JSON 裡的值（任天堂 CDN 遠端網址，或現有
 *     32 款的本地路徑 /covers/<slug>.jpg），絕不強制改寫。
 *   - title_id：games upsert 不帶 title_id 欄位；匯入後以
 *     PATCH ?slug=eq.<slug>&title_id=is.null 只在該遊戲 title_id
 *     目前為空時回填，已有值一律保留（照抄 seed.mjs 1b 的做法）。
 *     回填前先分頁讀取現有 title_id 狀態，已有值的不發 PATCH。
 *   - 分批：games 每批 200 款、prices 每批 500 筆；讀取 games id 時
 *     分頁（limit 1000＋offset），10,051 款一次 limit=1000 讀不完，
 *     不可沿用 seed.mjs 的單次讀取。
 *   - 匯率：目錄檔只有快照時間戳、沒有匯率表；匯入時直接向
 *     ExchangeRate-API 免 key 端點抓當日完整匯率表寫進 fx_rates，
 *     抓不到時改讀 data/.cache/fx.json（建置腳本的快取），再沒有就
 *     跳過 fx_rates 並警告，不中斷遊戲／價格匯入。
 *   - 可重複執行：games 以 slug 為準、prices 以 (game_id, country)
 *     為準、fx_rates 以 (date_key, currency) 為準，不會重複插入。
 *
 * 連線：只用環境變數 NEXT_PUBLIC_SUPABASE_URL 與
 *       SUPABASE_SERVICE_ROLE_KEY（不讀 .env.local、不把 key 寫進檔案）。
 *       Service Role Key 會繞過 RLS，請只在伺服器端／本機執行，
 *       不要放進前端程式碼或公開倉庫。
 *
 * 需求：Node.js 18+（使用內建 fetch，不需安裝任何套件）。
 * 注意：本腳本不連線測試——執行前請確認兩個環境變數已設定。
 *       預期耗時見執行時印出的估算（首次匯入約 5～10 分鐘，主要
 *       是 title_id 回填的逐款 PATCH；重複執行只剩 upsert，約 1～2 分鐘）。
 */

import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(PROJECT_ROOT, 'data', 'catalog-expanded.json');
const FX_CACHE_PATH = path.join(PROJECT_ROOT, 'data', '.cache', 'fx.json');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '缺少環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 再執行。\n' +
      '用法見本檔案開頭註解。',
  );
  process.exit(1);
}

const FX_ENDPOINTS = [
  'https://open.er-api.com/v6/latest/USD',
  'https://api.exchangerate-api.com/v4/latest/USD',
];
const GAMES_BATCH = 200;
const PRICES_BATCH = 500;
const TITLE_PATCH_CONCURRENCY = 8;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 有上限的並行池。 */
async function pool(items, size, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

function restHeaders(json = true) {
  const h = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function postgrest(table, rows, onConflict) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...restHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`寫入 ${table} 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
  }
  return res.json();
}

/** 分頁讀取 games 的 id / slug / title_id（10,051 款，單次 limit=1000 讀不完）。 */
async function getGamesIndex() {
  const bySlug = new Map();
  let offset = 0;
  for (;;) {
    const url =
      `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/games` +
      `?select=id,slug,title_id&limit=1000&offset=${offset}`;
    const res = await fetch(url, { headers: restHeaders(false) });
    if (!res.ok) {
      throw new Error(`讀取 games 失敗（HTTP ${res.status}）：${(await res.text()).slice(0, 500)}`);
    }
    const rows = await res.json();
    for (const r of rows) bySlug.set(r.slug, { id: r.id, titleId: r.title_id ?? null });
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  return bySlug;
}

// 只在 title_id 目前為空時寫入；已有值時 WHERE 條件不命中，回傳 0 筆，
// 原值完整保留。回傳 true 表示有寫入，false 表示已有值、未更動。
// （照抄 scripts/seed.mjs 的 patchTitleIdIfNull。）
async function patchTitleIdIfNull(slug, titleId) {
  const url =
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/games` +
    `?slug=eq.${encodeURIComponent(slug)}&title_id=is.null`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...restHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ title_id: titleId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`回填 title_id（${slug}）失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

/** 抓當日完整匯率表（1 單位外幣 = 多少台幣；TWD = 1）。失敗回 null。 */
async function fetchFxRates() {
  for (const endpoint of FX_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        headers: { 'User-Agent': 'switch-price-site/1.0 (seed-expanded)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rates = data?.rates;
      if (!rates || typeof rates.TWD !== 'number' || rates.TWD <= 0) throw new Error('回應缺少 TWD');
      const out = { TWD: 1 };
      for (const [cur, perUsd] of Object.entries(rates)) {
        if (typeof perUsd === 'number' && perUsd > 0) out[cur] = rates.TWD / perUsd;
      }
      return { ratesTwd: out, asOf: data?.time_last_update_utc ?? data?.date ?? new Date().toISOString(), source: endpoint };
    } catch { /* 換下一個端點 */ }
  }
  return null;
}

async function main() {
  const raw = await readFile(CATALOG_PATH, 'utf8');
  const catalog = JSON.parse(raw);
  const games = catalog?.data?.games;
  const status = catalog?.data?.status ?? {};
  if (!Array.isArray(games) || games.length === 0) {
    throw new Error(`目錄檔沒有 games 陣列：${CATALOG_PATH}`);
  }
  const totalPrices = games.reduce((n, g) => n + (g.prices?.length ?? 0), 0);
  const withTitleId = games.filter((g) => g.titleId != null && g.titleId !== '');
  console.log(
    `目錄檔：${CATALOG_PATH}\n` +
      `  遊戲 ${games.length} 款，價格 ${totalPrices} 筆，帶 title_id ${withTitleId.length} 款\n` +
      `  最後價格更新：${status.lastPriceUpdate ?? '（未記錄）'}，匯率快照：${status.fxAsOf ?? '（未記錄）'}（date_key=${status.fxDateKey ?? '（未記錄）'}）`,
  );
  // 預期耗時估算（假設：每批 PostgREST upsert 約 0.6 秒；title_id 回填
  // 每款 PATCH 約 0.15 秒、8 路並行；首次匯入 title_id 全空為最久情況，
  // 重複執行時已有 title_id 的不發 PATCH、只剩 upsert）。
  const gamesBatches = Math.ceil(games.length / GAMES_BATCH);
  const priceBatches = Math.ceil(totalPrices / PRICES_BATCH);
  const estSeconds =
    gamesBatches * 0.6 + priceBatches * 0.6 + (withTitleId.length * 0.15) / TITLE_PATCH_CONCURRENCY + 5;
  console.log(
    `預期耗時估算：約 ${(estSeconds / 60).toFixed(1)} 分鐘` +
      `（games ${gamesBatches} 批 × 0.6s ＋ prices ${priceBatches} 批 × 0.6s ＋ ` +
      `title_id 回填最多 ${withTitleId.length} 款 × 0.15s / ${TITLE_PATCH_CONCURRENCY} 並行 ＋ 讀取；` +
      `首次匯入最久，重複執行因已有 title_id 不重發 PATCH、約 1～2 分鐘。` +
      `實際時間視網路與 Supabase 方案而定，僅供參考。）`,
  );

  // 1. games（upsert by slug；不帶 title_id，以免洗掉已對照好的值）
  const gameRows = games.map((g) => ({
    slug: g.slug,
    title_zh: g.titleZh,
    title_en: g.titleEn,
    genre: g.genre ?? null,
    publisher: g.publisher ?? null,
    platform: g.platform ?? null,
    product_type: g.productType ?? null,
    has_demo: typeof g.hasDemo === 'number' ? g.hasDemo : 0,
    // 擴大目錄的 cover_url 直接採用：新遊戲是任天堂 CDN 遠端網址，
    // 現有 32 款是本地路徑 /covers/<slug>.jpg；不要強制改寫。
    cover_url: g.coverUrl ?? null,
    youtube_id: g.youtubeId ?? null,
    historical_low_twd: g.historicalLowTwd ?? null,
    is_manual: false,
  }));
  for (const batch of chunk(gameRows, GAMES_BATCH)) {
    await postgrest('games', batch, 'slug');
  }
  console.log(`games：upsert ${gameRows.length} 款（${gamesBatches} 批，cover_url 原值保留）`);

  // 1b. title_id 回填：先讀現有狀態，只有目前為空的才發 PATCH，已有值保留。
  const index = await getGamesIndex();
  const missing = gameRows.filter((g) => !index.has(g.slug));
  if (missing.length > 0) {
    throw new Error(`以下遊戲寫入後查不到 id：${missing.map((g) => g.slug).join(', ')}`);
  }
  const toFill = withTitleId.filter((g) => index.get(g.slug)?.titleId == null);
  console.log(
    `title_id：${withTitleId.length} 款有 ID，其中 ${withTitleId.length - toFill.length} 款已有值保留、` +
      `${toFill.length} 款待回填（重複執行時待回填為 0）`,
  );
  let titleFilled = 0;
  const titleErrors = [];
  await pool(toFill, TITLE_PATCH_CONCURRENCY, async (g) => {
    try {
      const filled = await patchTitleIdIfNull(g.slug, g.titleId);
      if (filled) titleFilled += 1;
    } catch (err) {
      titleErrors.push(`${g.slug}：${err.message}`);
    }
  });
  if (titleErrors.length > 0) {
    console.error(`title_id 回填失敗 ${titleErrors.length} 款（其餘已完成，不中斷匯入）：\n  ${titleErrors.slice(0, 10).join('\n  ')}`);
  }
  console.log(`title_id：回填 ${titleFilled} 款`);

  // 2. prices（upsert by game_id + country，每批 500 筆）
  const priceRows = [];
  for (const g of games) {
    const gameId = index.get(g.slug)?.id;
    if (!gameId) continue;
    for (const p of g.prices ?? []) {
      priceRows.push({
        game_id: gameId,
        country: p.country,
        country_name: p.countryName ?? null,
        currency: p.currency,
        regular_raw: p.regularRaw ?? null,
        effective_raw: p.effectiveRaw ?? null,
        discount_pct: p.discountPct ?? null,
        discount_raw: p.discountRaw ?? null,
        sale_end: p.saleEnd ?? null,
        price_twd: p.priceTwd ?? null,
        is_historical_low: p.isHistoricalLow ?? false,
        updated_at: status.lastPriceUpdate ?? new Date().toISOString(),
      });
    }
  }
  let priceCount = 0;
  for (const batch of chunk(priceRows, PRICES_BATCH)) {
    await postgrest('prices', batch, 'game_id,country');
    priceCount += batch.length;
  }
  console.log(`prices：upsert ${priceCount} 筆（${Math.ceil(priceRows.length / PRICES_BATCH)} 批）`);

  // 3. fx_rates（upsert by date_key + currency；當日完整匯率表）
  const dateKey = status.fxDateKey ?? new Date().toISOString().slice(0, 10);
  const asOf = status.fxAsOf ?? new Date().toISOString();
  let fx = await fetchFxRates();
  if (!fx) {
    try {
      await access(FX_CACHE_PATH);
      const cached = JSON.parse(await readFile(FX_CACHE_PATH, 'utf8'));
      if (cached?.ratesTwd) {
        fx = { ratesTwd: cached.ratesTwd, asOf: cached.fxAsOf ?? asOf, source: `快取 ${FX_CACHE_PATH}` };
        console.log('[fx] 線上抓取失敗，改用建置快取的匯率表');
      }
    } catch { /* 無快取 */ }
  }
  if (!fx) {
    console.error('[fx] 警告：匯率抓取失敗且無快取，跳過 fx_rates（遊戲與價格已寫入，不中斷）。');
  } else {
    const fxRows = Object.entries(fx.ratesTwd).map(([currency, rate]) => ({
      date_key: dateKey,
      currency,
      rate,
      as_of: fx.asOf,
    }));
    await postgrest('fx_rates', fxRows, 'date_key,currency');
    console.log(`fx_rates：upsert ${fxRows.length} 筆（date_key=${dateKey}，來源 ${fx.source}）`);
  }

  console.log('完成。可重複執行，再跑一次不會重複插入。');
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
