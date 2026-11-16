/**
 * Switch 遊戲比價 — 把舊種子檔的價格補回擴大目錄
 * ============================================================
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   node scripts/restore-seed-prices.mjs
 *
 * 背景：
 *   擴大目錄（data/catalog-expanded.json）的價格是任務 B 以「日本 NSUID」
 *   向價格 API 抓的；但 NSUID 是分區的（日本 ID 只在 JP 查得到價），
 *   所以 32 款舊遊戲在目錄裡只剩 JP 價（＋任務 A 合併的台港價），
 *   原本種子檔（seed/catalog-2026-11-15.json）裡 30 國的價格不見了。
 *   其中 5 款（ring-fit、pokemon-za、hades2、silksong、it-takes-two）
 *   甚至一筆價格都沒有（無 title ID 或 API 查不到）。
 *
 * 做法（只補缺口、不覆蓋）：
 *   對 32 款舊遊戲，逐一比對種子檔的價格列：目錄裡已有該國價格列的
 *   保留新抓的值；缺的國家，把種子檔 2026-11-15 快照的價格列原樣補回
 *   （幣別、原價、特價、sale_end、台幣價皆為當時快照值）。
 *   補完後重算 cheapest 與 historicalLowTwd（取全部價格列最低台幣價，
 *   與目錄其他遊戲同義）。
 *
 * 注意：
 *   - 這只是讓目錄檔本身完整（從空庫匯入時 32 款仍有 30 國價）。
 *     用 seed-expanded.mjs 匯入現有資料庫時，upsert 本來就不會刪除
 *     資料庫裡已有的舊價格列，所以即使不跑本腳本，線上價格也不會丟失。
 *   - 種子價是 2026-11-15 的快照，之後每日更新（日本 NSUID 只能更新 JP 價）
 *     不會刷新它們；真正要多國自動更新，需要各區 NSUID 對照表（另案）。
 *
 * 輸出：直接寫回 data/catalog-expanded.json（原地更新，status 加註
 * seedPricesRestored 摘要）。可重複執行（冪等：已補過的國家不再補）。
 * 需求：Node.js 18+，不需套件、不需金鑰。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = join(ROOT, 'data', 'catalog-expanded.json');
const SEED_PATH = join(ROOT, 'seed', 'catalog-2026-11-15.json');

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

function main() {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  const games = catalog?.data?.games;
  const seedGames = seed?.data?.games;
  if (!Array.isArray(games) || !Array.isArray(seedGames)) {
    throw new Error('目錄檔或種子檔沒有 games 陣列');
  }
  const bySlug = new Map(games.map((g) => [g.slug, g]));
  const seedStatus = seed?.data?.status ?? {};

  let restoredRows = 0;
  let restoredGames = 0;
  const perGame = {};
  for (const sg of seedGames) {
    const game = bySlug.get(sg.slug);
    if (!game) continue;
    const have = new Set((game.prices ?? []).map((p) => p.country));
    let added = 0;
    for (const p of sg.prices ?? []) {
      if (have.has(p.country)) continue;
      game.prices.push({
        country: p.country,
        countryName: p.countryName ?? null,
        currency: p.currency,
        regularRaw: p.regularRaw ?? null,
        effectiveRaw: p.effectiveRaw ?? null,
        discountPct: p.discountPct ?? null,
        discountRaw: p.discountRaw ?? null,
        saleEnd: p.saleEnd ?? null,
        priceTwd: p.priceTwd ?? null,
        isHistoricalLow: false,
      });
      have.add(p.country);
      added += 1;
    }
    if (added > 0) {
      recomputeCheapest(game);
      restoredRows += added;
      restoredGames += 1;
      perGame[sg.slug] = added;
    }
  }

  let totalPrices = 0;
  const countriesWithPrices = new Set();
  for (const g of games) {
    for (const p of g.prices ?? []) {
      countriesWithPrices.add(p.country);
      totalPrices += 1;
    }
  }

  const prev = catalog.data.status.seedPricesRestored ?? {};
  // 補回筆數改為「重算」而非累加（避免重跑時狀態被洗掉）：
  // 種子列若原樣出現在目錄裡即視為已補回；但 JP 列例外——有 title ID 且
  // 價格 API 驗證在售的遊戲，JP 列是任務 B 新抓的，不算補回；
  // 只有無 title ID 或 API 回 not_found 的遊戲，JP 列才是種子補回的。
  const titleIds = JSON.parse(readFileSync(join(ROOT, 'data', 'title-ids.json'), 'utf8'));
  const jpIsSeed = new Set([
    ...(titleIds.unmapped ?? []).map((u) => u.slug),
    ...Object.entries(titleIds.mapped ?? {})
      .filter(([, m]) => m.price_status === 'not_found')
      .map(([slug]) => slug),
  ]);
  const twhk = JSON.parse(readFileSync(join(ROOT, 'data', 'tw-hk-title-ids.json'), 'utf8'));
  const mappedSlugs = new Set(Object.keys(twhk.mapped ?? {}));
  const recomputedPerGame = {};
  for (const sg of seedGames) {
    const game = bySlug.get(sg.slug);
    if (!game) continue;
    const have = new Map(
      (game.prices ?? []).map((p) => [
        p.country,
        `${p.currency}|${p.regularRaw}|${p.effectiveRaw}|${p.saleEnd ?? ''}`,
      ]),
    );
    let n = 0;
    for (const p of sg.prices ?? []) {
      if (p.country === 'JP' && !jpIsSeed.has(sg.slug)) continue;
      // 台港列若是任務 A 對到的款，來自 A 的價格 API 實測，不是種子補回。
      if ((p.country === 'TW' || p.country === 'HK') && mappedSlugs.has(sg.slug)) continue;
      const key = `${p.currency}|${p.regularRaw}|${p.effectiveRaw}|${p.saleEnd ?? ''}`;
      if (have.get(p.country) === key) n += 1;
    }
    if (n > 0) recomputedPerGame[sg.slug] = n;
  }
  const totalRestoredRows = Object.values(recomputedPerGame).reduce((a, b) => a + b, 0);
  const totalRestoredGames = Object.keys(recomputedPerGame).length;

  catalog.data.status.seedPricesRestored = {
    restoredAt: prev.restoredAt ?? new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    seedDate: seedStatus.fxDateKey ?? '2026-11-15',
    seedLastPriceUpdate: seedStatus.lastPriceUpdate ?? null,
    restoredRows: totalRestoredRows,
    totalRestoredRows,
    restoredGames: totalRestoredGames,
    perGame: recomputedPerGame,
    note: '只補目錄缺的國家（新抓的 JP／台港價優先保留）；種子價為 2026-11-15 快照，日後不會被每日更新刷新（需各區 NSUID 對照表才可多國自動更新）。',
  };
  catalog.data.status.priceCountryCount = countriesWithPrices.size;
  catalog.data.status.totalPrices = totalPrices;

  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(
    `完成：${CATALOG_PATH}\n` +
      `  種子價補回 ${restoredRows} 筆（${restoredGames} 款）：${JSON.stringify(perGame)}\n` +
      `  有價國家數：${countriesWithPrices.size}，價格總筆數：${totalPrices}`,
  );
}

main();
