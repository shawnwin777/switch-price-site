#!/usr/bin/env node
/**
 * Write TitleDB candidate names for the on-sale unnamed placeholders.
 *
 * Source: data/titledb-names-sale-unnamed-20261124.json (789 items, review list
 * generated 2026-11-24 from TitleDB HK.zh.json keyed by NSUID).
 *
 * Write shape (same as import-tw-addons.mjs for named DLC):
 *   title_zh = TitleDB name, title_en = TitleDB name, is_unnamed = false.
 * Names only — NO cover writes (covers from TitleDB bannerUrl are a separate
 * step, not approved yet).
 *
 * Safety:
 *   - Dry-run by default; --apply writes.
 *   - Only updates rows that are still unnamed (is_unnamed=true); already-named
 *     rows are skipped, never overwritten (weekly ingest may have named some).
 *   - Only product_type=game rows (the list is games only; guard anyway).
 *   - The TitleDB disclaimer ("名稱來源：TitleDB 候選名（非官方譯名）")
 *     shows for these rows via games.name_source='titledb' (marked by
 *     scripts/mark-titledb-name-source.mjs; see migration
 *     20261125_games_name_source.sql). DLC/bundle rows show it by
 *     product_type in GameCard/GameDetailClient.
 *
 * Connection: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env
 * (same convention as import-tw-addons.mjs; service key bypasses RLS).
 * The anon key CANNOT write games (verified 2026-11-24: PATCH returns 200 []
 * — RLS blocks it), so this must run with the service key, on the home PC.
 *
 * Usage (from the repo root, or 更新\scripts\ on the home PC):
 *   node scripts/write-titledb-names-sale.mjs            # dry-run
 *   node scripts/write-titledb-names-sale.mjs --apply    # write
 *
 * Requires Node.js 18+ (built-in fetch, no dependencies).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env');
}

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function getRows(slugs) {
  // Chunked IN query: ?slug=in.(a,b,...)
  const out = new Map();
  for (let i = 0; i < slugs.length; i += 100) {
    const chunk = slugs.slice(i, i + 100);
    const url = `${BASE}/rest/v1/games?select=id,slug,title_zh,is_unnamed,product_type&slug=in.(${chunk.map(encodeURIComponent).join(',')})`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`GET games failed HTTP ${res.status}: ${await res.text()}`);
    for (const r of await res.json()) out.set(r.slug, r);
  }
  return out;
}

async function patchRow(slug, name) {
  const url = `${BASE}/rest/v1/games?slug=eq.${encodeURIComponent(slug)}&is_unnamed=eq.true`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ title_zh: name, title_en: name, is_unnamed: false }),
  });
  if (!res.ok) throw new Error(`PATCH ${slug} HTTP ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows.length;
}

const inputPath = path.join(__dirname, '..', 'data', 'titledb-names-sale-unnamed-20261124.json');
const data = JSON.parse(await readFile(inputPath, 'utf8'));
const items = data.items;
console.log(`對照檔：${inputPath}（產生時間 ${data.generatedAt ?? '未記錄'}）`);
console.log(`  條目 ${items.length} 筆（特價中未命名佔位遊戲，TitleDB 有名字）`);
console.log(`  其中 ≥50% off：${data.ge50} 筆`);
console.log(`模式：${APPLY ? 'APPLY（寫入）' : 'DRY-RUN（只看不寫）'}`);

const slugs = items.map((x) => x.slug);
const rows = await getRows(slugs);
console.log(`\n資料庫查到 ${rows.size}/${items.length} 列`);

const stats = { written: 0, skippedNamed: 0, skippedNotGame: 0, notFound: 0, noChange: 0, errors: [] };
const samples = [];
for (const item of items) {
  const row = rows.get(item.slug);
  if (!row) { stats.notFound++; continue; }
  if (row.product_type !== 'game') { stats.skippedNotGame++; continue; }
  if (!row.is_unnamed) { stats.skippedNamed++; continue; }
  if (samples.length < 5) samples.push({ slug: item.slug, from: row.title_zh, to: item.titledb_name });
  if (!APPLY) continue;
  try {
    const n = await patchRow(item.slug, item.titledb_name);
    if (n === 1) stats.written++;
    else stats.noChange++;
  } catch (e) {
    stats.errors.push(`${item.slug}: ${String(e.message ?? e)}`);
  }
  if (stats.written % 100 === 0 && stats.written > 0) console.log(`  已寫入 ${stats.written} 筆…`);
}

console.log('\n[樣本（前 5 筆）]');
for (const s of samples) console.log(`  ${s.slug}: ${s.from} → ${s.to}`);
console.log('\n[結果]');
console.log(`  寫入：${stats.written} 筆`);
console.log(`  已具名跳過：${stats.skippedNamed} 筆（每週 ingest 或別處已補名，不覆蓋）`);
console.log(`  非 game 跳過：${stats.skippedNotGame} 筆`);
console.log(`  資料庫查無：${stats.notFound} 筆`);
console.log(`  寫入但無變化：${stats.noChange} 筆`);
if (stats.errors.length) {
  console.log(`  錯誤 ${stats.errors.length} 筆：`);
  for (const e of stats.errors.slice(0, 20)) console.log(`    ${e}`);
}
if (!APPLY) console.log('\nDRY-RUN 結束，未寫入。確認無誤後加 --apply 正式執行。');
