#!/usr/bin/env node
/**
 * Generate read-only aggregate counts for a completed Nintendo price-range scan.
 * Does not classify individual products as DLC from ID alone.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error('Usage: node scripts/report-product-range-scan.mjs <scan-json> <report-json>');
const scan = JSON.parse(await readFile(input, 'utf8'));
if (!Number.isInteger(scan.total_batches) || scan.total_batches < 1 ||
    scan.scanned_batches !== scan.total_batches)
  throw new Error('Scan is incomplete; refusing to report partial data');
if (!scan.results || typeof scan.results !== 'object' || Array.isArray(scan.results))
  throw new Error('Invalid scan results');
const states = {};
const priced = [];
for (const [nsuid, item] of Object.entries(scan.results)) {
  if (!/^\d{14}$/.test(nsuid)) throw new Error('Invalid NSUID in scan: ' + nsuid);
  const status = String(item?.sales_status ?? 'unknown');
  states[status] = (states[status] ?? 0) + 1;
  if (status === 'onsale' && typeof item.effectiveRaw === 'number')
    priced.push({ nsuid, effectiveRaw: item.effectiveRaw, currency: item.currency ?? null });
}
const result = {
  purpose: 'DLC/upgrade candidate discovery only; no confirmed product types or game associations',
  country: scan.country, from: scan.from, to: scan.to,
  totalBatches: scan.total_batches, scannedBatches: scan.scanned_batches,
  statuses: states, onsaleWithPrice: priced.length,
  warning: 'Prices and NSUID alone cannot establish DLC name, edition or parent game. No Supabase writes.',
  priced,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log('Scan report:', output, 'onsaleWithPrice:', priced.length);
