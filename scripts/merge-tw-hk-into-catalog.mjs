/**
 * Switch 遊戲比價 — 把台港編號與價格合併進擴大目錄
 * ============================================================
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   node scripts/merge-tw-hk-into-catalog.mjs
 *
 * 輸入：
 *   data/catalog-expanded.json    （任務 B 產出：10,051 款，日本 NSUID 價格為主）
 *   data/tw-hk-title-ids.json     （任務 A 產出：32 款的台港編號＋台港價格）
 *   data/.cache/fx.json            （任務 B 的匯率快照，2026-11-16 08:02 台北時間；
 *                                   只取 HKD→TWD 匯率；若缺檔，改抓 ExchangeRate-API）
 *
 * 做法：
 *   1. 任務 A 已對到的 24 款：把 twTitleId / hkTitleId 寫進遊戲物件；
 *      以 A 的台港價格取代該遊戲原有的 TW / HK 價格列（B 靠香港 thumb_img
 *      補的 TW 6 筆、HK 10 筆中，屬於這 24 款的會被 A 的價格 API 實測值取代；
 *      不屬於這 24 款的 B 補價列原樣保留）。
 *      TW 價幣別 TWD，priceTwd = effectiveRaw；HK 價幣別 HKD，
 *      priceTwd = round(effectiveRaw × HKD 匯率)。
 *   2. 任務 A 的 tw_only_games（台灣清單有、現有 32 款以外）：
 *      只在中文名正規化後與目錄 titleZh 完全相符時才掛上 twTitleId
 *      （實測只對到 4 款）；其餘 145 款不強行併入（無價格、無日文／英文名，
 *      無法可靠對應到日本 NSUID），留在 tw-hk-title-ids.json 供日後
 *      各區 NSUID 對照專案使用。
 *   3. 每款重算 cheapest 與 historicalLowTwd（取全部價格列的最低台幣價，
 *      與種子檔同義），並重設 isHistoricalLow 標記。
 *
 * 輸出：直接寫回 data/catalog-expanded.json（原地更新，status 加註
 * twHkMerge 摘要）。可重複執行（冪等：先刪該遊戲的舊 TW/HK 列再寫入）。
 *
 * 注意：games 表目前只有 title_id 一欄（日本 NSUID），沒有 tw/hk 欄位，
 * 所以 twTitleId / hkTitleId 只存在 JSON 目錄裡，不會進資料庫；
 * 但 TW / HK 價格列會隨 seed-expanded.mjs 一起匯入。
 * 需求：Node.js 18+（內建 fetch，不需套件）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = join(ROOT, 'data', 'catalog-expanded.json');
const TWHK_PATH = join(ROOT, 'data', 'tw-hk-title-ids.json');
const FX_CACHE_PATH = join(ROOT, 'data', '.cache', 'fx.json');

const FX_ENDPOINTS = [
  'https://open.er-api.com/v6/latest/USD',
  'https://api.exchangerate-api.com/v4/latest/USD',
];

function normalizeTitle(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

async function loadHkdRate() {
  try {
    const fx = JSON.parse(readFileSync(FX_CACHE_PATH, 'utf8'));
    const rate = fx?.ratesTwd?.HKD;
    if (typeof rate === 'number' && rate > 0) {
      return { rate, source: `data/.cache/fx.json（${fx.fxAsOf ?? ''}）` };
    }
  } catch {
    // 缺檔或格式不對，改抓即時匯率。
  }
  let lastError = null;
  for (const endpoint of FX_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        headers: { 'User-Agent': 'shawn-game-studio/1.0 (tw-hk merge)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rates = data?.rates;
      if (!rates || typeof rates.TWD !== 'number' || typeof rates.HKD !== 'number') {
        throw new Error('匯率回應缺少 TWD 或 HKD');
      }
      return { rate: rates.TWD / rates.HKD, source: `${endpoint}（即時）` };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`拿不到 HKD 匯率：${lastError?.message ?? '未知錯誤'}`);
}

function priceRow(country, countryName, price, hkdRate) {
  if (!price || price.effectiveRaw == null) return null;
  const regularRaw = price.regularRaw ?? price.effectiveRaw;
  const effectiveRaw = price.effectiveRaw;
  return {
    country,
    countryName,
    currency: price.currency,
    regularRaw,
    effectiveRaw,
    discountPct: price.discountPct ?? null,
    discountRaw:
      price.discountPct != null && regularRaw > effectiveRaw
        ? regularRaw - effectiveRaw
        : null,
    saleEnd: price.saleEnd ?? null,
    priceTwd:
      country === 'TW'
        ? Math.round(effectiveRaw)
        : Math.round(effectiveRaw * hkdRate),
    isHistoricalLow: false, // 重算 cheapest 時再補
  };
}

function recomputeCheapest(game) {
  let cheapest = null;
  for (const p of game.prices ?? []) {
    if (p.priceTwd == null) continue;
    if (cheapest == null || p.priceTwd < cheapest.priceTwd) cheapest = p;
  }
  for (const p of game.prices ?? []) p.isHistoricalLow = false;
  if (cheapest) {
    cheapest.isHistoricalLow = true;
    game.cheapest = { ...cheapest };
    game.historicalLowTwd = cheapest.priceTwd;
  } else {
    game.cheapest = null;
    game.historicalLowTwd = null;
  }
}

async function main() {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  const twhk = JSON.parse(readFileSync(TWHK_PATH, 'utf8'));
  const games = catalog?.data?.games;
  if (!Array.isArray(games) || games.length === 0) {
    throw new Error(`目錄檔沒有 games 陣列：${CATALOG_PATH}`);
  }
  const { rate: hkdRate, source: hkdSource } = await loadHkdRate();
  console.log(`HKD→TWD 匯率：${hkdRate}（來源：${hkdSource}）`);

  const bySlug = new Map(games.map((g) => [g.slug, g]));
  const mapped = twhk.mapped ?? {};

  let twRowsAdded = 0;
  let hkRowsAdded = 0;
  let twRowsReplaced = 0;
  let hkRowsReplaced = 0;
  let idsAttached = 0;

  for (const [slug, m] of Object.entries(mapped)) {
    const game = bySlug.get(slug);
    if (!game) {
      console.log(`  警告：${slug} 不在擴大目錄裡，跳過`);
      continue;
    }
    if (m.tw_title_id) game.twTitleId = m.tw_title_id;
    if (m.hk_title_id) game.hkTitleId = m.hk_title_id;
    idsAttached += 1;

    // 先刪該遊戲舊的 TW / HK 列（B 的 thumb 補價），再寫入 A 的實測值。
    const kept = [];
    for (const p of game.prices ?? []) {
      if (p.country === 'TW') twRowsReplaced += 1;
      else if (p.country === 'HK') hkRowsReplaced += 1;
      else kept.push(p);
    }
    game.prices = kept;
    const twRow = priceRow('TW', '台灣', m.tw_price, hkdRate);
    const hkRow = priceRow('HK', '香港', m.hk_price, hkdRate);
    if (twRow) {
      game.prices.push(twRow);
      twRowsAdded += 1;
    }
    if (hkRow) {
      game.prices.push(hkRow);
      hkRowsAdded += 1;
    }
    recomputeCheapest(game);
  }

  // tw_only_games：只在中文名正規化後與目錄 titleZh 完全相符時掛 twTitleId。
  const byNormZh = new Map();
  for (const g of games) {
    const key = normalizeTitle(g.titleZh);
    if (key && !byNormZh.has(key)) byNormZh.set(key, g);
  }
  let twOnlyMatched = 0;
  let twOnlyNewlyAttached = 0;
  for (const t of twhk.tw_only_games ?? []) {
    const game = byNormZh.get(normalizeTitle(t.title_zh));
    if (!game) continue;
    twOnlyMatched += 1;
    if (!game.twTitleId) {
      game.twTitleId = t.tw_title_id;
      twOnlyNewlyAttached += 1;
    }
  }
  const twOnlyTotal = (twhk.tw_only_games ?? []).length;

  // 全目錄統計
  const countriesWithPrices = new Set();
  let twGames = 0;
  let hkGames = 0;
  let totalPrices = 0;
  for (const g of games) {
    let hasTw = false;
    let hasHk = false;
    for (const p of g.prices ?? []) {
      countriesWithPrices.add(p.country);
      totalPrices += 1;
      if (p.country === 'TW') hasTw = true;
      if (p.country === 'HK') hasHk = true;
    }
    if (hasTw) twGames += 1;
    if (hasHk) hkGames += 1;
  }

  catalog.data.status.twHkMerge = {
    mergedAt: new Date().toISOString(),
    fxHkdRate: hkdRate,
    fxSource: hkdSource,
    gamesWithTwTitleId: idsAttached + twOnlyMatched,
    gamesWithHkTitleId: idsAttached,
    twPriceRowsAdded: twRowsAdded,
    hkPriceRowsAdded: hkRowsAdded,
    twPriceRowsReplaced: twRowsReplaced,
    hkPriceRowsReplaced: hkRowsReplaced,
    gamesWithTwPrice: twGames,
    gamesWithHkPrice: hkGames,
    twOnlyMatched,
    twOnlyUnmatched: twOnlyTotal - twOnlyMatched,
    note: '台港編號以任務 A 的價格 API 實測為準；tw_only 其餘款因無日文／英文名、無法可靠對應日本 NSUID，未併入目錄，留在 tw-hk-title-ids.json。',
  };
  catalog.data.status.priceCountryCount = countriesWithPrices.size;
  catalog.data.status.totalPrices = totalPrices;

  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(
    `完成：${CATALOG_PATH}\n` +
      `  台港編號掛上：${idsAttached} 款（tw_only 中文名對到再加 ${twOnlyMatched} 款，未對到 ${twOnlyTotal - twOnlyMatched} 款）\n` +
      `  TW 價格列新增 ${twRowsAdded} 筆（取代舊列 ${twRowsReplaced} 筆），全目錄有 TW 價：${twGames} 款\n` +
      `  HK 價格列新增 ${hkRowsAdded} 筆（取代舊列 ${hkRowsReplaced} 筆），全目錄有 HK 價：${hkGames} 款\n` +
      `  有價國家數：${countriesWithPrices.size}，價格總筆數：${totalPrices}`,
  );
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
