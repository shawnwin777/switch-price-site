/**
 * 外國價格匯入 — 本機 dry-run（唯讀，不寫庫）
 * ============================================================
 * 用法：node scripts/dry-run-foreign-ids.mjs
 *
 * 做法（計畫 §6.2）：
 *   1. live 抓 NA 人氣帶 0–2 ＋ EU page 0–2（fetchCatalogLists，官方清單）；
 *   2. anon 唯讀全量 games／game_region_ids（PostgREST 分頁讀）；
 *   3. 在記憶體跑 planCatalogSync（foreignImportEnabled=true，預覽模式）
 *      ＋ expandRegionIdUpserts，只把「會寫入哪些列」印成 /tmp scratch JSON；
 *   4. 比對指標：NA／EU 可接率、newFromNonJp、needsReview 抽樣 20 筆。
 *
 * 守衛：newFromNonJp 單窗口超過 500 款時印警告並以 exit 2 結束
 * （先停手人工看一眼，可能是某頁解析異常；JSON 照常寫出供檢查）。
 * 本腳本不連正式寫庫、不推檔；正式寫入走 /api/sync-catalog（需 CRON_SECRET）。
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SUPABASE_URL = 'https://gplklnhsplydxmyepbzx.supabase.co/rest/v1';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwbGtsbmhzcGx5ZHhteWVwYnp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3NzIzOTgsImV4cCI6MjExMDM0ODM5OH0.Osv8IjHyI9A-0uoqmPLBAe1urm5Fnya7sRN4BCidBUk';

// ---- 編譯 lib/catalog-sources.ts（零依賴）到暫存目錄再 import ----
const outDir = mkdtempSync(path.join(tmpdir(), 'foreign-dry-run-'));
execSync(
  `npx tsc lib/catalog-sources.ts --outDir ${outDir} --module commonjs --target es2022 --skipLibCheck`,
  { cwd: PROJECT_ROOT, stdio: 'pipe' },
);
const lib = await import(path.join(outDir, 'catalog-sources.js'));
const { fetchCatalogLists, planCatalogSync, expandRegionIdUpserts } = lib;

/** anon 唯讀分頁讀全表（PostgREST 單次上限 1000 列）。 */
async function readAll(table, select, order) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${SUPABASE_URL}/${table}?select=${select}&order=${order}&limit=1000&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`讀 ${table} 失敗：HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

function pct(n, d) {
  return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`;
}

console.log('== 1. live 抓清單：NA 人氣帶 0–2 ＋ EU page 0–2 ==');
const sourceResults = await fetchCatalogLists(['na-algolia', 'eu-solr'], {
  'na-algolia': { startPage: 0, pageCount: 3 },
  'eu-solr': { startPage: 0, pageCount: 3 },
});
for (const r of sourceResults) {
  console.log(`  ${r.source} (${r.country})：${r.status}，${r.entries.length} 筆${r.error ? `，錯誤：${r.error}` : ''}`);
}

console.log('== 2. anon 讀 DB 全量 games／game_region_ids ==');
const games = await readAll('games', 'id,slug,title_id,title_zh,title_en,cover_url', 'slug');
const regionIds = await readAll('game_region_ids', 'game_id,country,title_id', 'game_id');
console.log(`  games：${games.length} 款；game_region_ids：${regionIds.length} 列`);

function rateReport(label, results) {
  const plan = planCatalogSync(games, regionIds, results, { foreignImportEnabled: true });
  const gameEntries = plan.stats.listEntries - plan.stats.skippedNonGame;
  const matched =
    plan.stats.matchedByRegionId + plan.stats.matchedByTitle + plan.stats.matchedByTitleId;
  return {
    plan,
    summary: {
      listEntries: plan.stats.listEntries,
      gameEntries,
      skippedNonGame: plan.stats.skippedNonGame,
      matchedByRegionId: plan.stats.matchedByRegionId,
      matchedByTitle: plan.stats.matchedByTitle,
      matchedByTitleId: plan.stats.matchedByTitleId,
      matched,
      matchRate: gameEntries ? matched / gameEntries : null,
      matchedByTitlePlaceholderResolved: plan.stats.matchedByTitlePlaceholderResolved,
      needsReview: plan.needsReview.length,
      needsReviewRate: gameEntries ? plan.needsReview.length / gameEntries : null,
      newFromNonJp: plan.stats.newFromNonJp,
      newGames: plan.newGames.length,
      regionIdUpserts: plan.regionIdUpserts.length,
    },
  };
}

console.log('== 3. 分來源跑 plan（算可接率）==');
const na = rateReport('NA', sourceResults.filter((r) => r.source === 'na-algolia'));
const eu = rateReport('EU', sourceResults.filter((r) => r.source === 'eu-solr'));
for (const [label, r] of [['NA', na], ['EU', eu]]) {
  const s = r.summary;
  console.log(`  ${label}：遊戲本體 ${s.gameEntries} 筆（清單 ${s.listEntries}、跳過非遊戲 ${s.skippedNonGame}）`);
  console.log(`    掛上編號 ${s.matched} 筆（編號命中 ${s.matchedByRegionId}、標題命中 ${s.matchedByTitle}、title_id 命中 ${s.matchedByTitleId}）→ 可接率 ${pct(s.matched, s.gameEntries)}`);
  console.log(`    其中佔位列排除後成功 ${s.matchedByTitlePlaceholderResolved} 筆；needsReview ${s.needsReview} 筆（${pct(s.needsReview, s.gameEntries)}）；新遊戲 ${s.newFromNonJp} 款`);
}

console.log('== 4. 合併跑 plan＋展開（算寫入量）==');
const combined = planCatalogSync(games, regionIds, sourceResults, { foreignImportEnabled: true });
const expansion = expandRegionIdUpserts(combined.regionIdUpserts, regionIds);
const upserts = expansion.upserts;
const byCountry = new Map();
for (const u of upserts) byCountry.set(u.country, (byCountry.get(u.country) ?? 0) + 1);
const newUsIds = [...new Set(upserts.filter((u) => u.country === 'US' && u.source === 'na-algolia').map((u) => u.title_id))];
const newGbIds = [...new Set(upserts.filter((u) => u.country === 'GB' && u.source === 'eu-solr').map((u) => u.title_id))];
console.log(`  展開前 upserts：${combined.regionIdUpserts.length} 列；展開後：${upserts.length} 列；conflicts：${expansion.conflicts.length}`);
console.log(`  各國列數：${[...byCountry.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join('、')}`);
console.log(`  新 US 號：${newUsIds.length} 個；新 GB 號：${newGbIds.length} 個；新遊戲合計：${combined.stats.newFromNonJp} 款`);

const needsReviewSample = combined.needsReview.slice(0, 20);
console.log('== 5. needsReview 抽樣 20 筆（人工看過）==');
for (const n of needsReviewSample) console.log(`  - ${n.title}：${n.reason}`);
if (combined.needsReview.length > 20) {
  console.log(`  …其餘 ${combined.needsReview.length - 20} 筆見 JSON`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = `/tmp/dry-run-foreign-ids-${stamp}.json`;
const out = {
  generatedAt: new Date().toISOString(),
  windows: { na: 'rank bands 0-2', eu: 'pages 0-2' },
  dbCounts: { games: games.length, gameRegionIds: regionIds.length },
  na: na.summary,
  eu: eu.summary,
  combined: {
    newFromNonJp: combined.stats.newFromNonJp,
    newGames: combined.newGames.length,
    needsReviewTotal: combined.needsReview.length,
    upsertsBeforeExpand: combined.regionIdUpserts.length,
    upsertsAfterExpand: upserts.length,
    conflicts: expansion.conflicts,
    byCountry: Object.fromEntries(byCountry),
  },
  newUsIds,
  newGbIds,
  needsReviewSample,
  needsReviewAll: combined.needsReview,
  // 完整寫入清單（展開後）：gameSlug／country／title_id／source
  upserts: upserts.map((u) => ({ gameSlug: u.gameSlug, country: u.country, title_id: u.title_id, source: u.source })),
};
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\n寫出：${outPath}`);

// 守衛：單窗口 newFromNonJp 超過 500 款先停手
const overLimit = combined.stats.newFromNonJp > 500;
if (overLimit) {
  console.error(`\n⚠️  newFromNonJp＝${combined.stats.newFromNonJp}，超過單窗口 500 款上限：先停手人工看一眼（可能是某頁解析異常），不要直接放行。`);
  process.exit(2);
}
console.log('\nDry-run 完成（唯讀，未寫庫）。下一步：node scripts/probe-foreign-prices.mjs ' + outPath);
