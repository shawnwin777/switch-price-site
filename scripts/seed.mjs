/**
 * Switch 遊戲比價 — 種子資料匯入腳本
 * ============================================================
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
 *   node scripts/seed.mjs
 *
 *   也可以先把兩個變數寫進專案根目錄的 .env.local 再執行：
 *     set -a; source .env.local; set +a
 *     node scripts/seed.mjs
 *   （.env.local 絕對不要 commit；本腳本不讀檔案形式的 key，只讀 process.env）
 *
 *   指定其他種子檔：node scripts/seed.mjs seed/另一個檔名.json
 *
 * 前置作業：先在 Supabase Dashboard → SQL Editor 執行 supabase/schema.sql。
 *
 * 行為：
 *   - 讀 seed/catalog-2026-11-15.json（2026-11-15 的快照：32 款遊戲、
 *     920 筆價格、32 個國家），upsert 進 games、prices、fx_rates。
 *   - 可重複執行：games 以 slug 為準、prices 以 (game_id, country) 為準、
 *     fx_rates 以 (date_key, currency) 為準，不會重複插入。
 *   - 封面：種子檔的 coverUrl 是 Muse artifact 的 blob 網址，匯不出來，
 *     一律改寫為本站路徑 /covers/<slug>.jpg（見 public/covers/）。
 *   - title_id：種子檔沒有任天堂 title ID，所以 upsert 時【不帶 title_id
 *     欄位】，絕不會覆蓋資料庫裡已經對照好的值。已經對照好的 28 款
 *     title ID 在 data/title-ids.json（登入組 scripts/map-title-ids.mjs
 *     產出），由該組或更新程式寫入；未來若種子檔本身帶了 title_id，
 *     腳本只在該遊戲的 title_id 目前為空時才回填，已有值一律保留
 *     （見下方「1b. title_id 回填」）。重跑本腳本不會洗掉 title_id。
 *   - 匯率：種子 JSON 沒有匯率表，只有快照時間戳（見下方 FX_SNAPSHOT），
 *     因此只寫入當時有記錄的 5 個幣別 + TWD 基準；每日更新程式必須
 *     另外向 ExchangeRate-API 抓完整匯率表（見 DATA_NOTES.md）。
 *
 * 連線：只用環境變數 NEXT_PUBLIC_SUPABASE_URL 與
 *       SUPABASE_SERVICE_ROLE_KEY，絕對不要把 key 寫死在程式碼裡。
 *       Service Role Key 會繞過 RLS，請只在伺服器端／本機執行，
 *       不要放進前端程式碼或公開倉庫。
 *
 * 需求：Node.js 18+（使用內建 fetch，不需安裝任何套件）。
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SEED_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(PROJECT_ROOT, 'seed', 'catalog-2026-11-15.json');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '缺少環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 再執行。\n' +
      '用法見本檔案開頭註解。',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 匯率快照（2026-11-15 台北時間 08:02，ExchangeRate-API）
// 來源：2026-11-15 原型站的匯率狀態列記錄；種子 JSON 本身沒有匯率表，
// 只有 data.status.fxAsOf = 2026-11-15T00:02:32.000Z（= 台北 08:02）與
// fxDateKey = 2026-11-15。當時有記錄下來的只有以下 5 個幣別，
// 其餘幣別的匯率沒有保留在種子檔裡——每日更新程式必須抓完整匯率表，
// 不可只用這 5 筆去換算其他幣別。
// rate 的意義：1 單位該幣別 = 多少台幣；TWD 為基準，rate = 1。
// ---------------------------------------------------------------------------
const FX_SNAPSHOT = [
  { currency: 'USD', rate: 32.93 },
  { currency: 'JPY', rate: 0.206 },
  { currency: 'HKD', rate: 4.196 },
  { currency: 'GBP', rate: 43.53 },
  { currency: 'EUR', rate: 36.39 },
  { currency: 'TWD', rate: 1 },
];

// has_demo 取值（種子檔實際分布：0 = 26 款、1 = 5 款、2 = 1 款）：
//   0 = 無試玩；1 = 免費 Demo；2 = NSO 限定試玩（僅 it-takes-two，
//   2 的確切含義待前端組依原型站確認，見 DATA_NOTES.md）。
// 本腳本原樣寫入，不做轉換。

async function postgrest(table, rows, onConflict) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`寫入 ${table} 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
  }
  return res.json();
}

async function getGameIds() {
  const url =
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/games` +
    `?select=id,slug&limit=1000`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`讀取 games 失敗（HTTP ${res.status}）：${(await res.text()).slice(0, 500)}`);
  }
  const rows = await res.json();
  return new Map(rows.map((r) => [r.slug, r.id]));
}

// 只在 title_id 目前為空時寫入；已有值時 WHERE 條件不命中，回傳 0 筆，
// 原值完整保留。回傳 true 表示有寫入，false 表示已有值、未更動。
async function patchTitleIdIfNull(slug, titleId) {
  const url =
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/games` +
    `?slug=eq.${encodeURIComponent(slug)}&title_id=is.null`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ title_id: titleId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`回填 title_id（${slug}）失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const raw = await readFile(SEED_PATH, 'utf8');
  const seed = JSON.parse(raw);
  const games = seed?.data?.games;
  const status = seed?.data?.status ?? {};
  if (!Array.isArray(games) || games.length === 0) {
    throw new Error(`種子檔沒有 games 陣列：${SEED_PATH}`);
  }
  console.log(
    `種子檔：${SEED_PATH}\n` +
      `  遊戲 ${games.length} 款，價格 ${games.reduce((n, g) => n + (g.prices?.length ?? 0), 0)} 筆\n` +
      `  最後價格更新：${status.lastPriceUpdate ?? '（未記錄）'}，匯率快照：${status.fxAsOf ?? '（未記錄）'}（date_key=${status.fxDateKey ?? '（未記錄）'}）`,
  );

  // 1. games（upsert by slug）
  const gameRows = games.map((g) => ({
    slug: g.slug,
    title_zh: g.titleZh,
    title_en: g.titleEn,
    genre: g.genre ?? null,
    publisher: g.publisher ?? null,
    platform: g.platform ?? null,
    product_type: g.productType ?? null,
    has_demo: typeof g.hasDemo === 'number' ? g.hasDemo : 0,
    // 種子檔的 blob 封面匯不出來，改用本站封面路徑
    cover_url: `/covers/${g.slug}.jpg`,
    youtube_id: g.youtubeId ?? null,
    // 種子檔沒有任天堂 title ID：upsert 刻意不帶 title_id 欄位，
    // 以免把資料庫裡已對照好的值洗回 NULL（見檔案開頭說明與下方 1b）。
    historical_low_twd: g.historicalLowTwd ?? null,
    is_manual: false,
  }));
  await postgrest('games', gameRows, 'slug');
  console.log(`games：upsert ${gameRows.length} 款`);

  // 1b. title_id 回填：只有該遊戲目前 title_id 為空時才寫入，已有值保留。
  // 目前的種子檔完全沒有 title_id，此步驟不寫入任何東西；它是給未來
  // 種子檔帶了 title_id 時的安全網。已對照好的值請見 data/title-ids.json，
  // 由登入組的 scripts/map-title-ids.mjs 產出、由更新程式寫入。
  const withTitleId = games
    .map((g) => ({ slug: g.slug, titleId: g.titleId ?? g.title_id ?? null }))
    .filter((g) => g.titleId != null && g.titleId !== '');
  let titleFilled = 0;
  let titleKept = 0;
  for (const g of withTitleId) {
    const filled = await patchTitleIdIfNull(g.slug, g.titleId);
    if (filled) titleFilled += 1;
    else titleKept += 1;
  }
  console.log(
    `title_id：回填 ${titleFilled} 款，已有值保留 ${titleKept} 款` +
      (withTitleId.length === 0 ? '（種子檔無 title_id，未寫入）' : ''),
  );

  // 2. prices（upsert by game_id + country）
  const idBySlug = await getGameIds();
  const missing = gameRows.filter((g) => !idBySlug.has(g.slug));
  if (missing.length > 0) {
    throw new Error(`以下遊戲寫入後查不到 id：${missing.map((g) => g.slug).join(', ')}`);
  }
  const priceRows = [];
  for (const g of games) {
    for (const p of g.prices ?? []) {
      priceRows.push({
        game_id: idBySlug.get(g.slug),
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
  for (const batch of chunk(priceRows, 200)) {
    await postgrest('prices', batch, 'game_id,country');
    priceCount += batch.length;
  }
  console.log(`prices：upsert ${priceCount} 筆`);

  // 3. fx_rates（upsert by date_key + currency；只有快照中有記錄的幣別）
  const dateKey = status.fxDateKey ?? '2026-11-15';
  const asOf = status.fxAsOf ?? '2026-11-15T00:02:32.000Z';
  const fxRows = FX_SNAPSHOT.map((f) => ({
    date_key: dateKey,
    currency: f.currency,
    rate: f.rate,
    as_of: asOf,
  }));
  await postgrest('fx_rates', fxRows, 'date_key,currency');
  console.log(`fx_rates：upsert ${fxRows.length} 筆（date_key=${dateKey}，僅含快照中有記錄的幣別）`);

  console.log('完成。可重複執行，再跑一次不會重複插入。');
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
