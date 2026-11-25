#!/usr/bin/env node
/**
 * Mark the 789 TitleDB-named games with name_source='titledb'.
 *
 * Source: data/titledb-names-sale-unnamed-20261124.json (789 items, the same
 * review list scripts/write-titledb-names-sale.mjs wrote on 2026-11-24).
 * The write set title_zh = TitleDB name + is_unnamed=false; this script only
 * adds the name_source flag so GameCard / GameDetailClient / ranking show the
 * "名稱來源：TitleDB 候選名（非官方譯名）" disclaimer for these game rows too
 * (until now the disclaimer showed only for dlc/bundle).
 *
 * Safety:
 *   - Dry-run by default; --apply writes.
 *   - Only marks rows whose current title_zh still equals the TitleDB name
 *     in the list. A row renamed or merged since the write is skipped, never
 *     overwritten.
 *   - Only product_type=game rows (the list is games only; guard anyway).
 *   - Idempotent: rows already marked 'titledb' are counted, not rewritten.
 *   - Names only — NO cover writes.
 *
 * Requires the name_source column first:
 *   supabase/migrations/20261125_games_name_source.sql
 * (run it in Supabase SQL Editor before --apply, or the PATCH fails).
 *
 * Connection: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env
 * (same convention as write-titledb-names-sale.mjs; service key bypasses
 * RLS). The anon key CANNOT write games (verified 2026-11-24: PATCH returns
 * 200 [] — RLS blocks it), so this must run with the service key, on the
 * home PC.
 *
 * Usage (from the repo root, or 更新\scripts\ on the home PC):
 *   node scripts/mark-titledb-name-source.mjs            # dry-run
 *   node scripts/mark-titledb-name-source.mjs --apply    # write
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
    const url = `${BASE}/rest/v1/games?select=id,slug,title_zh,name_source,product_type&slug=in.(${chunk.map(encodeURIComponent).join(',')})`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`GET games failed HTTP ${res.status}: ${await res.text()}`);
    for (const r of await res.json()) out.set(r.slug, r);
  }
  return out;
}

async function patchRow(slug) {
  const url = `${BASE}/rest/v1/games?slug=eq.${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ name_source: 'titledb' }),
  });
  if (!res.ok) throw new Error(`PATCH ${slug} HTTP ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows.length;
}

const inputPath = path.join(__dirname, '..', 'data', 'titledb-names-sale-unnamed-20261124.json');
const data = JSON.parse(await readFile(inputPath, 'utf8'));
const items = data.items;
console.log(`對照檔：${inputPath}（產生時間 ${data.generated_at ?? '未記錄'}）`);
console.log(`  條目 ${items.length} 筆（2026-11-24 以 TitleDB 候選名寫入的遊戲）`);
console.log(`模式：${APPLY ? 'APPLY（寫入）' : 'DRY-RUN（只看不寫）'}`);

const slugs = items.map((x) => x.slug);
const rows = await getRows(slugs);
console.log(`\n資料庫查到 ${rows.size}/${items.length} 列`);

const stats = { marked: 0, alreadyMarked: 0, skippedTitleMismatch: 0, skippedNotGame: 0, notFound: 0, noChange: 0, errors: [] };
const samples = [];
for (const item of items) {
  const row = rows.get(item.slug);
  if (!row) { stats.notFound++; continue; }
  if (row.product_type !== 'game') { stats.skippedNotGame++; continue; }
  if (row.title_zh !== item.titledb_name) { stats.skippedTitleMismatch++; continue; }
  if (row.name_source === 'titledb') { stats.alreadyMarked++; continue; }
  if (samples.length < 5) samples.push({ slug: item.slug, title: row.title_zh });
  if (!APPLY) continue;
  try {
    const n = await patchRow(item.slug);
    if (n === 1) stats.marked++;
    else stats.noChange++;
  } catch (e) {
    stats.errors.push(`${item.slug}: ${String(e.message ?? e)}`);
  }
  if (stats.marked % 100 === 0 && stats.marked > 0) console.log(`  已標記 ${stats.marked} 筆…`);
}

console.log('\n[樣本（前 5 筆）]');
for (const s of samples) console.log(`  ${s.slug}: ${s.title}`);
console.log('\n[結果]');
console.log(`  標記：${stats.marked} 筆`);
console.log(`  已標記跳過：${stats.alreadyMarked} 筆`);
console.log(`  標題不符跳過：${stats.skippedTitleMismatch} 筆（寫入後被改名或合併，不覆蓋）`);
console.log(`  非 game 跳過：${stats.skippedNotGame} 筆`);
console.log(`  資料庫查無：${stats.notFound} 筆`);
console.log(`  寫入但無變化：${stats.noChange} 筆`);
if (stats.errors.length) {
  console.log(`  錯誤 ${stats.errors.length} 筆：`);
  for (const e of stats.errors.slice(0, 20)) console.log(`    ${e}`);
}
if (!APPLY) console.log('\nDRY-RUN 結束，未寫入。確認無誤後加 --apply 正式執行。');
