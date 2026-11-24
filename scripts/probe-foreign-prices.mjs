/**
 * 外國價格匯入 — 價格探針（唯讀，只查官方價格 API，不寫庫）
 * ============================================================
 * 用法：node scripts/probe-foreign-prices.mjs [/tmp/dry-run-foreign-ids-*.json]
 *   未給路徑時自動取 /tmp 裡最新的 dry-run JSON。
 *
 * 做法（計畫 §6.3）：取 dry-run 產出的新 US 號 200 個、GB 號 200 個，
 * batch 50 查 https://api.ec.nintendo.com/v1/price：
 *   1. 錨點國（US／GB）onsale 率應 ≥85%，否則停手查原因；
 *   2. 分組成員抽查：NA 組 CL／CO／AR／PE、EU 組 PL／CZ／DK／FI／SE／NO
 *      （本次未實測的 6 國），各取 50 個號，onsale 率應 ≥90%；
 *      若某國大量 not_found → 該國不展開、列入待查；
 *   3. 跨組抽查 20 個號：美洲號查 GB、歐洲號查 US，應全 not_found
 *      （防展開邏輯誤跨組）。
 * 任一項不通過即 exit 1（停手、查原因、回報），全部通過 exit 0。
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const PRICE_API = 'https://api.ec.nintendo.com/v1/price';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function langForCountry(country) {
  if (country === 'JP') return 'ja';
  if (country === 'TW' || country === 'HK') return 'zh';
  return 'en';
}

/** 查一批 id 在某國的價格狀態：回 { onsale, notFound, missing, total }。 */
async function probeCountry(country, ids) {
  let onsale = 0;
  let notFound = 0;
  let missing = 0;
  const samples = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = `${PRICE_API}?country=${country}&ids=${chunk.join(',')}&lang=${langForCountry(country)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'shawn-game-studio/1.0 (foreign-import probe)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`價格 API HTTP ${res.status}（country=${country}）`);
    const data = await res.json();
    const byId = new Map((data?.prices ?? []).map((p) => [String(p.title_id), p]));
    for (const id of chunk) {
      const entry = byId.get(String(id));
      if (!entry) {
        missing++;
      } else if (entry.sales_status === 'onsale' && entry.regular_price) {
        onsale++;
        if (samples.length < 3) {
          samples.push({
            title_id: String(id),
            amount: entry.regular_price.amount,
            currency: entry.regular_price.currency,
            discount: entry.discount_price?.amount ?? null,
          });
        }
      } else {
        notFound++;
      }
    }
    await sleep(200);
  }
  return { country, total: ids.length, onsale, notFound, missing, samples };
}

function rate(r) {
  return r.total ? r.onsale / r.total : null;
}
function pct(r) {
  return r.total ? `${((r.onsale / r.total) * 100).toFixed(1)}%` : 'n/a';
}

// ---- 找 dry-run JSON ----
const argPath = process.argv[2];
let dryRunPath = argPath;
if (!dryRunPath) {
  const candidates = readdirSync('/tmp')
    .filter((f) => f.startsWith('dry-run-foreign-ids-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (candidates.length === 0) {
    console.error('找不到 /tmp/dry-run-foreign-ids-*.json：請先跑 node scripts/dry-run-foreign-ids.mjs');
    process.exit(2);
  }
  dryRunPath = `/tmp/${candidates[0]}`;
}
const dryRun = JSON.parse(readFileSync(dryRunPath, 'utf8'));
const usIds = (dryRun.newUsIds ?? []).slice(0, 200);
const gbIds = (dryRun.newGbIds ?? []).slice(0, 200);
console.log(`來源：${dryRunPath}`);
console.log(`新 US 號 ${usIds.length} 個、新 GB 號 ${gbIds.length} 個（各取前 200）`);
if (usIds.length < 50 || gbIds.length < 50) {
  console.error('號太少（<50），探針無意義：先檢查 dry-run 結果。');
  process.exit(2);
}

const results = {};
const failures = [];

// 1. 錨點國
console.log('\n== 1. 錨點國（門檻 ≥85%）==');
results.anchorUS = await probeCountry('US', usIds);
results.anchorGB = await probeCountry('GB', gbIds);
for (const r of [results.anchorUS, results.anchorGB]) {
  const ok = (rate(r) ?? 0) >= 0.85;
  console.log(`  ${r.country}：onsale ${r.onsale}/${r.total}（${pct(r)}），not_found ${r.notFound}，無回應 ${r.missing} ${ok ? '✓' : '✗ 未達 85%'}`);
  if (!ok) failures.push(`${r.country} 錨點 onsale 率 ${pct(r)} 未達 85%`);
  if (r.samples.length) console.log(`    例：${r.samples.map((s) => `${s.title_id} ${s.amount} ${s.currency}`).join('；')}`);
}

// 2. 分組成員抽查（各 50 個號，門檻 ≥90%）
console.log('\n== 2. 分組成員抽查（各 50 號，門檻 ≥90%）==');
const naMembers = ['CL', 'CO', 'AR', 'PE'];
const euMembers = ['PL', 'CZ', 'DK', 'FI', 'SE', 'NO'];
results.members = {};
for (const c of naMembers) {
  const r = await probeCountry(c, usIds.slice(0, 50));
  results.members[c] = r;
  const ok = (rate(r) ?? 0) >= 0.9;
  console.log(`  ${c}（美洲號）：onsale ${r.onsale}/${r.total}（${pct(r)}）${ok ? ' ✓' : ' ✗ 未達 90%'}`);
  if (!ok) failures.push(`${c} onsale 率 ${pct(r)} 未達 90%（該國不展開、列入待查）`);
}
for (const c of euMembers) {
  const r = await probeCountry(c, gbIds.slice(0, 50));
  results.members[c] = r;
  const ok = (rate(r) ?? 0) >= 0.9;
  console.log(`  ${c}（歐洲號）：onsale ${r.onsale}/${r.total}（${pct(r)}）${ok ? ' ✓' : ' ✗ 未達 90%'}`);
  if (!ok) failures.push(`${c} onsale 率 ${pct(r)} 未達 90%（該國不展開、列入待查）`);
}

// 3. 跨組抽查（美洲號查 GB、歐洲號查 US，各 10 個，應全 not_found）
console.log('\n== 3. 跨組抽查（應全 not_found）==');
results.crossUSinGB = await probeCountry('GB', usIds.slice(0, 10));
results.crossGBinUS = await probeCountry('US', gbIds.slice(0, 10));
for (const r of [results.crossUSinGB, results.crossGBinUS]) {
  const ok = r.onsale === 0;
  console.log(`  ${r.country} 查對組號：onsale ${r.onsale}/${r.total}，not_found ${r.notFound} ${ok ? '✓ 全 not_found' : '✗ 有價！展開邏輯可能誤跨組'}`);
  if (!ok) failures.push(`跨組抽查 ${r.country} 出現 ${r.onsale} 筆 onsale（應全 not_found）`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = `/tmp/probe-foreign-prices-${stamp}.json`;
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), dryRunPath, results, failures }, null, 2));
console.log(`\n寫出：${outPath}`);
if (failures.length > 0) {
  console.error(`\n✗ 探針未通過（${failures.length} 項）：`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error('停手、查原因、回報；不要上正式。');
  process.exit(1);
}
console.log('\n✓ 探針全部通過：錨點 ≥85%、分組成員 ≥90%、跨組全 not_found。');
console.log('下一步（等 shawn 跑完 price-verified-migration-20261124.sql 後）：');
console.log('  單窗口實跑 /api/sync-catalog?sources=na-algolia&pages=2（需 CRON_SECRET，見回報）。');
