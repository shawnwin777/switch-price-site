// 各區編號對照表管線驗證（開發用，不連 Supabase、不連網路）。
// 用法：node scripts/verify-region-ids.mjs
//
// 驗算內容（全部用本機 mock 資料）：
//   1. lib/region-ids.ts 的編號選取邏輯：region 優先、無對照時 fallback
//      用 games.title_id、兩者皆無為 none；同一編號撞號時先登記者勝出。
//   2. scripts/region-ids-input.mjs 的格式解析：新格式（twTitleId／
//      hkTitleId＋regionIds，兩種寫法衝突時以前者為準）、舊台港格式
//      （mapped／tw_only_games），以及真實檔案 data/tw-hk-title-ids.json
//     （24 款 mapped、149 款 tw_only_games）。
//   3. scripts/merge-region-prices.mjs 的合併邏輯（在 /tmp 的 mock 目錄
//      上跑，不碰真實 data/catalog-expanded.json）：只補缺口、已有價不覆蓋、
//      目錄無此遊戲不新建、重跑冪等（第二次新增 0 筆）、備份檔有產生、
//      cheapest／historicalLowTwd 有重算。
//
// 做法：把 lib/region-ids.ts 用 tsc 編譯到 /tmp 後 require（仿
// scripts/verify-refresh-slices.mjs）；merge 腳本以子進程跑在 mock
// 檔案上（它不連網、不連庫，可安全執行）。

import { execSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
}

// ---- 1. lib/region-ids.ts：編譯後驗算 ----
const outDir = mkdtempSync(join(tmpdir(), 'region-ids-check-'));
execSync(
  `npx tsc lib/region-ids.ts --outDir ${outDir} --module commonjs --target es2022 --skipLibCheck`,
  { cwd: ROOT, stdio: 'pipe' },
);
const R = require(join(outDir, 'region-ids.js'));

const mockRows = [
  { game_id: 'g-botw', country: 'TW', title_id: '70010000102734' },
  { game_id: 'g-botw', country: 'hk', title_id: '70010000009367' }, // 小寫國家碼應被正規化
  { game_id: 'g-botw', country: 'US', title_id: '70010000000025' },
  { game_id: 'g-totk', country: 'TW', title_id: '70010000063717' },
];
const index = R.buildRegionIdIndex(mockRows);
check('buildRegionIdIndex：小寫 hk 正規化為 HK', index.get('g-botw')?.get('HK') === '70010000009367');
check('buildRegionIdIndex：TW 對照正確', index.get('g-botw')?.get('TW') === '70010000102734');
check('buildRegionIdIndex：無列的遊戲不在索引裡', !index.has('g-none'));

const r1 = R.resolveGameCountryId('g-botw', '70010000000026', index, 'TW');
check('resolve：有對照編號時用 region', r1.titleId === '70010000102734' && r1.source === 'region');
const r2 = R.resolveGameCountryId('g-botw', '70010000000026', index, 'JP');
check('resolve：JP 無對照時 fallback 用 games.title_id', r2.titleId === '70010000000026' && r2.source === 'fallback');
const r3 = R.resolveGameCountryId('g-none', null, index, 'US');
check('resolve：兩者皆無為 none', r3.titleId === null && r3.source === 'none');
const r4 = R.resolveGameCountryId('g-totk', '70010000063713', index, 'US');
check('resolve：只有 TW 對照、查 US 時 fallback', r4.titleId === '70010000063713' && r4.source === 'fallback');

const mockGames = [
  { id: 'g-botw', slug: 'botw', title_id: '70010000000026' },
  { id: 'g-totk', slug: 'totk', title_id: '70010000063713' },
  { id: 'g-noid', slug: 'silksong', title_id: null },
];
const planTW = R.planCountryIds(mockGames, index, 'TW');
check('planCountryIds TW：2 region、0 fallback、1 skipped', planTW.usedRegion === 2 && planTW.usedFallback === 0 && planTW.skippedSlugs.length === 1 && planTW.skippedSlugs[0] === 'silksong');
const planUS = R.planCountryIds(mockGames, index, 'US');
check('planCountryIds US：1 region、1 fallback、1 skipped', planUS.usedRegion === 1 && planUS.usedFallback === 1 && planUS.skippedSlugs[0] === 'silksong');
const planJP = R.planCountryIds(mockGames, index, 'JP');
check('planCountryIds JP：0 region、2 fallback（現況行為）', planJP.usedRegion === 0 && planJP.usedFallback === 2);

// 撞號：兩款遊戲在同國共用同一編號 → 先登記者勝出，後者列 collisions。
const dupRows = [
  { game_id: 'g-a', country: 'TW', title_id: '70010000000001' },
  { game_id: 'g-b', country: 'TW', title_id: '70010000000001' },
];
const dupIndex = R.buildRegionIdIndex(dupRows);
const dupPlan = R.planCountryIds(
  [
    { id: 'g-a', slug: 'game-a', title_id: null },
    { id: 'g-b', slug: 'game-b', title_id: null },
  ],
  dupIndex,
  'TW',
);
check('planCountryIds 撞號：只查先登記者、後者列 collisions', dupPlan.titleIds.length === 1 && dupPlan.collisions.length === 1 && dupPlan.collisions[0].droppedSlug === 'game-b');

// ---- 2. scripts/region-ids-input.mjs：格式解析 ----
const { parseRegionIdsData } = await import('./region-ids-input.mjs');

const newFormat = {
  generated_at: '2026-11-16T00:00:00Z',
  sources: [{ name: 'mock' }],
  games: {
    botw: {
      titleZh: '薩爾達傳說 曠野之息', titleEn: 'Breath of the Wild',
      jpTitleId: '70010000000026', twTitleId: '70010000102734',
      regionIds: { HK: '70010000009367', US: '70010000000025', TW: '70010000999999' },
    },
    '70010000063713': { titleZh: '王國之淚', jpTitleId: '70010000063713', regionIds: { TW: '70010000063717' } },
  },
};
const parsedNew = parseRegionIdsData(newFormat);
const botw = parsedNew.entries.find((e) => e.slug === 'botw');
check('新格式：twTitleId 優先於 regionIds.TW（衝突記警告）', botw?.ids.get('TW') === '70010000102734' && parsedNew.warnings.length === 1);
check('新格式：regionIds 的 HK／US 照常吃進', botw?.ids.get('HK') === '70010000009367' && botw?.ids.get('US') === '70010000000025');
check('新格式：JP 不進 ids（走 fallback）', !botw?.ids.has('JP'));
const byJpId = parsedNew.entries.find((e) => e.jpTitleId === '70010000063713');
check('新格式：純數字 key 視為 jpTitleId、slug 為 null', byJpId?.slug === null && byJpId?.ids.get('TW') === '70010000063717');

const legacyFormat = {
  mapped: {
    botw: { title_id: '70010000000026', tw_title_id: '70010000102734', hk_title_id: '70010000009367', source: 'tw-list' },
  },
  tw_only_games: [{ slug: 'tw-only-game', title_zh: '只有台灣的遊戲', tw_title_id: '70010000111111', source: 'tw-list' }],
  unmapped: [{ slug: 'silksong', reason: '未上架' }],
};
const parsedLegacy = parseRegionIdsData(legacyFormat);
check('舊格式：mapped 的台港編號解析正確', parsedLegacy.entries.find((e) => e.slug === 'botw')?.ids.get('HK') === '70010000009367');
check('舊格式：tw_only_games 只有 TW 一國', (() => {
  const e = parsedLegacy.entries.find((x) => x.slug === 'tw-only-game');
  return e?.ids.size === 1 && e.ids.get('TW') === '70010000111111';
})());
check('舊格式：unmapped 不產生條目', parsedLegacy.entries.length === 2);

let threw = false;
try {
  parseRegionIdsData({ foo: 1 });
} catch {
  threw = true;
}
check('格式不符時拋錯（不靜默當空檔）', threw);

// 真實台港對照檔：24 款 mapped、149 款 tw_only_games。
const realTwHk = JSON.parse(readFileSync(join(ROOT, 'data', 'tw-hk-title-ids.json'), 'utf8'));
const parsedReal = parseRegionIdsData(realTwHk);
const mappedCount = parsedReal.entries.filter((e) => e.ids.size > 0 && !realTwHk.tw_only_games.some((t) => t.slug === e.slug)).length;
check(
  '真實 tw-hk 檔：解析出 24 款 mapped＋149 款 tw_only',
  parsedReal.entries.length === 24 + 149 && mappedCount === 24,
  `entries=${parsedReal.entries.length}`,
);
const realBotw = parsedReal.entries.find((e) => e.slug === 'botw');
check('真實 tw-hk 檔：botw 台港編號正確', realBotw?.ids.get('TW') === '70010000102734' && realBotw?.ids.get('HK') === '70010000009367');

// ---- 3. merge-region-prices.mjs：在 /tmp mock 目錄上跑 ----
const mockDir = mkdtempSync(join(tmpdir(), 'merge-region-check-'));
const mockCatalog = {
  ok: true,
  data: {
    games: [
      {
        slug: 'botw', titleZh: '曠野之息', titleEn: 'Breath of the Wild',
        historicalLowTwd: 1599,
        cheapest: { country: 'TW', countryName: '台灣', currency: 'TWD', regularRaw: 1599, effectiveRaw: 1599, discountPct: null, discountRaw: null, saleEnd: null, priceTwd: 1599, isHistoricalLow: true },
        prices: [
          { country: 'JP', countryName: '日本', currency: 'JPY', regularRaw: 7678, effectiveRaw: 7678, discountPct: null, discountRaw: null, saleEnd: null, priceTwd: 1581, isHistoricalLow: false },
          { country: 'TW', countryName: '台灣', currency: 'TWD', regularRaw: 1599, effectiveRaw: 1599, discountPct: null, discountRaw: null, saleEnd: null, priceTwd: 1599, isHistoricalLow: true },
        ],
      },
      { slug: 'totk', titleZh: '王國之淚', titleEn: 'Tears of the Kingdom', historicalLowTwd: null, cheapest: null, prices: [] },
    ],
    status: { gameCount: 2 },
  },
};
const mockPatch = {
  generated_at: '2026-11-16T00:00:00Z',
  fxDateKey: '2026-11-16',
  games: {
    botw: {
      titleZh: '曠野之息', titleEn: 'Breath of the Wild',
      prices: [
        // TW 已有價 → 不覆蓋；US 是缺口 → 補上（59.99 USD × 32.92 ≈ 1975）
        { country: 'TW', countryName: '台灣', currency: 'TWD', regularRaw: 1599, effectiveRaw: 1599, discountPct: null, discountRaw: null, saleEnd: null, priceTwd: 1599, isHistoricalLow: false, titleId: '70010000102734' },
        { country: 'US', countryName: '美國', currency: 'USD', regularRaw: 59.99, effectiveRaw: 59.99, discountPct: null, discountRaw: null, saleEnd: null, priceTwd: 1975, isHistoricalLow: false, titleId: '70010000000025' },
      ],
    },
    totk: {
      titleZh: '王國之淚', titleEn: 'Tears of the Kingdom',
      prices: [
        { country: 'US', countryName: '美國', currency: 'USD', regularRaw: 69.99, effectiveRaw: 69.99, discountPct: null, discountRaw: null, saleEnd: null, priceTwd: 2304, isHistoricalLow: false, titleId: '70010000063714' },
      ],
    },
    'ghost-game': {
      titleZh: '目錄沒有的遊戲', titleEn: 'Ghost',
      prices: [
        { country: 'US', countryName: '美國', currency: 'USD', regularRaw: 10, effectiveRaw: 10, discountPct: null, discountRaw: null, saleEnd: null, priceTwd: 329, isHistoricalLow: false, titleId: '70010000000099' },
      ],
    },
  },
  summary: { gamesWithPrices: 3, priceRows: 4 },
};
const mockCatalogPath = join(mockDir, 'catalog.json');
const mockPatchPath = join(mockDir, 'patch.json');
const mockBackupDir = join(mockDir, 'backup');
writeFileSync(mockCatalogPath, JSON.stringify(mockCatalog, null, 2), 'utf8');
writeFileSync(mockPatchPath, JSON.stringify(mockPatch, null, 2), 'utf8');

function runMerge() {
  return execFileSync(
    'node',
    [join(ROOT, 'scripts', 'merge-region-prices.mjs'), mockPatchPath, mockCatalogPath],
    { encoding: 'utf8', env: { ...process.env, MERGE_BACKUP_DIR: mockBackupDir } },
  );
}
const out1 = runMerge();
const after1 = JSON.parse(readFileSync(mockCatalogPath, 'utf8'));
const botwAfter = after1.data.games.find((g) => g.slug === 'botw');
const totkAfter = after1.data.games.find((g) => g.slug === 'totk');
check('merge：US 缺口補上、TW 已有價不覆蓋', botwAfter.prices.length === 3 && botwAfter.prices.find((p) => p.country === 'TW')?.priceTwd === 1599 && botwAfter.prices.find((p) => p.country === 'US')?.priceTwd === 1975);
check('merge：patch 多帶的 titleId 已去掉', botwAfter.prices.every((p) => !('titleId' in p)));
check('merge：cheapest／historicalLowTwd 重算為最低價', botwAfter.historicalLowTwd === 1581 && botwAfter.cheapest.country === 'JP');
check('merge：totk 補上 US 價、historicalLowTwd 建立', totkAfter.prices.length === 1 && totkAfter.historicalLowTwd === 2304);
check('merge：目錄無此遊戲不新建', after1.data.games.length === 2);
check('merge：status 記下合併摘要', after1.data.status.regionPricesMerge?.priceRowsAdded === 2);
check('merge：備份檔已產生在 mock 備份目錄', existsSync(mockBackupDir) && readdirSync(mockBackupDir).some((f) => f.startsWith('catalog-expanded-')));

const out2 = runMerge();
const after2 = JSON.parse(readFileSync(mockCatalogPath, 'utf8'));
check('merge 冪等：重跑新增 0 筆', after2.data.status.regionPricesMerge?.priceRowsAdded === 0 && after2.data.games.find((g) => g.slug === 'botw').prices.length === 3, out2.trim().split('\n')[0]);

console.log(failures === 0 ? '\n全部通過。' : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
