#!/usr/bin/env node
/**
 * Fetch official Nintendo Taiwan software index exactly once per freshness window.
 * Runs in GitHub Actions without any Supabase credentials. Invalid/partial data fails closed.
 * Usage: node scripts/fetch-tw-official-index.mjs [output.json] [--fresh-hours=20] [--force]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CATALOG_SOURCE, catalogFromPages } from './lib/tw-official-catalog.mjs';

const argv = process.argv.slice(2);
const output = argv.find(x => !x.startsWith('--')) || 'data/.cache/tw-official-index.json';
const force = argv.includes('--force');
const freshArg = argv.find(x => x.startsWith('--fresh-hours='));
const freshHours = freshArg ? Number(freshArg.split('=')[1]) : 20;
if (!Number.isFinite(freshHours) || freshHours < 0 || freshHours > 168)
  throw new Error('Invalid cache freshness hours');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!force && freshHours > 0) {
  try {
    const old = JSON.parse(await readFile(output,'utf8'));
    const age = Date.now() - Date.parse(old.fetchedAt);
    if (old.complete && old.schemaVersion === 1 && old.source === CATALOG_SOURCE
      && old.pages === Math.ceil(old.officialTotal / 24)
      && Object.keys(old.records || {}).length > 0
      && age >= 0 && age < freshHours * 3600_000) {
      console.log(JSON.stringify({ status:'cache_hit', ageHours:Math.round(age / 3600_000 * 100) / 100,
        pages:old.pages, officialTotal:old.officialTotal, distinctNsuids:old.distinctNsuids }));
      process.exit(0);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.log('[cache] Invalid/missing cache; refreshing: ' + e.message);
  }
}

async function request(page) {
  const url = CATALOG_SOURCE + '&spage=' + page;
  let error;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {'Accept':'application/json', 'User-Agent':'switch-price-site-TW-readonly-catalog/1.0'},
        signal:AbortSignal.timeout(16000),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status + ' page ' + page);
      const data = await response.json();
      if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total))
        throw new Error('Official API JSON changed on page ' + page);
      return data;
    } catch (e) {
      error=e;
      if (attempt < 3) await sleep(Math.min(20000,1000*2**attempt));
    }
  }
  throw error;
}

const first = await request(1);
const totalPages = Math.ceil(first.total / 24);
if (totalPages < 1 || totalPages > 500) throw new Error('Unexpected TW catalog page count ' + totalPages);
const pages = Array(totalPages);
pages[0] = first;
let cursor = 2;
const concurrency = 4;
await Promise.all(Array.from({length:Math.min(concurrency,totalPages-1)},async()=>{
  while (cursor <= totalPages) {
    const page = cursor++;
    pages[page-1] = await request(page);
    await sleep(160);
  }
}));
const index = catalogFromPages(pages);
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(index,null,2)+'\n','utf8');
console.log(JSON.stringify({
  status:'refreshed', output, officialTotal:index.officialTotal,
  pages:index.pages, distinctNsuids:index.distinctNsuids,
  imageRows:index.imageRows, titleOrPlatformConflicts:Object.keys(index.conflicts).length,
  fetchedAt:index.fetchedAt, note:'Read-only official TW index; no prices or Supabase writes.',
}));
