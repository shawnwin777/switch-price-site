/**
 * Switch 遊戲比價 — 把各區價格 patch 合併進擴大目錄
 * ============================================================
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   node scripts/merge-region-prices.mjs
 *   node scripts/merge-region-prices.mjs data/region-prices-patch.json
 *   node scripts/merge-region-prices.mjs data/region-prices-patch.json data/catalog-expanded.json
 *
 * 輸入：
 *   data/region-prices-patch.json（scripts/fetch-region-prices.mjs 產出）
 *   data/catalog-expanded.json    （擴大目錄，10,051 款）
 *
 * 做法（只補缺口、不覆蓋）：
 *   1. 合併前先把目錄原檔備份到 data/.backup/catalog-expanded-<台北時間>.json，
 *      備份失敗時直接退出、不動原檔。
 *   2. patch 裡每款遊戲（按 slug 找）：目錄裡沒有該 slug → 記為
 *      skipped_no_game，不新建遊戲（新遊戲由目錄匯入負責）。
 *   3. 每筆價格：該遊戲該國已有價格列 → 記為 skipped_existing、不覆蓋
 *      （舊價可能是種子價或先前 patch 的價；要以新價取代舊價時，請先刪
 *      該國舊列或等每日更新路由以對照編號刷新——合併腳本不做取代）。
 *      沒有才追加（只取目錄的 10 個欄位，patch 多帶的 titleId 會去掉）。
 *   4. 只有「有新增價格列」的遊戲才重算 cheapest、historicalLowTwd 與
 *      isHistoricalLow（取全部價格列的最低台幣價，與種子檔同義；
 *      historicalLowTwd 只取極值、不與舊值比較——與 merge-tw-hk 相同）。
 *   5. status 加註 regionPricesMerge 摘要（含備份檔名）。
 *
 * 輸出：直接寫回 data/catalog-expanded.json（原地更新，先寫暫存檔再
 *   rename，寫入中途失敗不會留半份檔案）。可重複執行（冪等：重跑一次
 *   應為新增 0 筆、其餘全部 skipped_existing；備份檔每次仍會產生一份）。
 *
 * 需求：Node.js 18+（不需套件，不連網）。
 */

import { readFile, writeFile, mkdir, rename, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PATCH_PATH = path.join(PROJECT_ROOT, 'data', 'region-prices-patch.json');
const DEFAULT_CATALOG_PATH = path.join(PROJECT_ROOT, 'data', 'catalog-expanded.json');
// 備份目錄：預設 data/.backup；驗證腳本可用 MERGE_BACKUP_DIR 指到 /tmp mock 目錄。
const BACKUP_DIR = process.env.MERGE_BACKUP_DIR
  ? path.resolve(process.env.MERGE_BACKUP_DIR)
  : path.join(PROJECT_ROOT, 'data', '.backup');

const CATALOG_PRICE_FIELDS = [
  'country',
  'countryName',
  'currency',
  'regularRaw',
  'effectiveRaw',
  'discountPct',
  'discountRaw',
  'saleEnd',
  'priceTwd',
  'isHistoricalLow',
];

function taipeiTimestamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}

function toCatalogPriceRow(p) {
  const row = {};
  for (const f of CATALOG_PRICE_FIELDS) row[f] = p[f] ?? null;
  row.isHistoricalLow = false; // 合併後按該遊戲全部價格重算
  return row;
}

/** 重算一款遊戲的 cheapest／historicalLowTwd／isHistoricalLow。 */
function recomputeCheapest(game) {
  const priced = (game.prices ?? []).filter((p) => typeof p.priceTwd === 'number');
  if (priced.length === 0) return;
  let min = Infinity;
  for (const p of priced) min = Math.min(min, p.priceTwd);
  game.historicalLowTwd = min;
  for (const p of game.prices) {
    p.isHistoricalLow = p.priceTwd === min;
  }
  const cheapestRow = priced.find((p) => p.priceTwd === min);
  game.cheapest = cheapestRow ? { ...cheapestRow } : game.cheapest ?? null;
}

async function main() {
  const patchPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_PATCH_PATH;
  const catalogPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_CATALOG_PATH;

  const patch = JSON.parse(await readFile(patchPath, 'utf8'));
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const games = catalog?.data?.games;
  if (!Array.isArray(games)) throw new Error(`目錄檔沒有 data.games 陣列：${catalogPath}`);
  if (!patch?.games || typeof patch.games !== 'object') {
    throw new Error(`patch 檔沒有 games 物件：${patchPath}（請先跑 node scripts/fetch-region-prices.mjs）`);
  }

  // 1. 備份原檔（備份失敗就不動原檔）。
  await mkdir(BACKUP_DIR, { recursive: true });
  const backupName = `catalog-expanded-${taipeiTimestamp()}.json`;
  const backupPath = path.join(BACKUP_DIR, backupName);
  await copyFile(catalogPath, backupPath);
  console.log(`備份：${backupPath}`);

  const bySlug = new Map(games.map((g) => [g.slug, g]));
  let priceRowsAdded = 0;
  let skippedExisting = 0;
  const skippedNoGame = [];
  const affectedSlugs = [];

  for (const [slug, entry] of Object.entries(patch.games)) {
    const game = bySlug.get(slug);
    if (!game) {
      skippedNoGame.push(slug);
      continue;
    }
    if (!Array.isArray(game.prices)) game.prices = [];
    const haveCountries = new Set(game.prices.map((p) => p.country));
    let addedForGame = 0;
    for (const p of entry.prices ?? []) {
      if (!p?.country) continue;
      if (haveCountries.has(p.country)) {
        skippedExisting += 1;
        continue;
      }
      game.prices.push(toCatalogPriceRow(p));
      haveCountries.add(p.country);
      priceRowsAdded += 1;
      addedForGame += 1;
    }
    if (addedForGame > 0) {
      recomputeCheapest(game);
      affectedSlugs.push(slug);
    }
  }

  catalog.data.status = catalog.data.status ?? {};
  catalog.data.status.regionPricesMerge = {
    mergedAt: new Date().toISOString(),
    patchGeneratedAt: patch.generated_at ?? null,
    patchFxDateKey: patch.fxDateKey ?? null,
    patchFile: patchPath,
    backupFile: backupPath,
    gamesAffected: affectedSlugs.length,
    priceRowsAdded,
    skippedExisting,
    skippedNoGame: skippedNoGame.length,
    note: '只補目錄缺的（遊戲、國家）價格列，已有價不覆蓋；有新增列的遊戲才重算 cheapest／historicalLowTwd。',
  };
  catalog.data.status.totalPrices = games.reduce((n, g) => n + (g.prices?.length ?? 0), 0);

  // 原子寫入：先寫暫存檔再 rename，避免中途失敗留半份檔案。
  const tmpPath = `${catalogPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  await rename(tmpPath, catalogPath);

  console.log(
    `完成：新增 ${priceRowsAdded} 筆價格（${affectedSlugs.length} 款遊戲），` +
      `已有價跳過 ${skippedExisting} 筆，目錄無此遊戲跳過 ${skippedNoGame.length} 款，` +
      `目錄現共 ${catalog.data.status.totalPrices} 筆價格。`,
  );
  if (skippedNoGame.length > 0) {
    console.log('目錄無此遊戲（未合併；新遊戲請先跑目錄匯入）：');
    for (const s of skippedNoGame.slice(0, 20)) console.log(`  - ${s}`);
    if (skippedNoGame.length > 20) console.log(`  ……共 ${skippedNoGame.length} 款，僅列前 20 款`);
  }
  console.log('可重複執行：再跑一次應為新增 0 筆（全部已有價跳過）。');
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
