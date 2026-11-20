#!/usr/bin/env node
/**
 * Read-only TW/HK NSUID proximity audit.
 * Usage: node scripts/audit-region-id-candidates.mjs [data/tw-hk-full-ids.json]
 * Never merges products or writes to Supabase. Adjacent NSUIDs are NOT proof of identity.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const input = process.argv[2] ?? 'data/tw-hk-full-ids.json';
const output = process.argv[3] ?? 'data/.cache/region-id-candidates.json';
const maxDistance = Number(process.env.NSUID_MAX_DISTANCE ?? 3);
if (!Number.isSafeInteger(maxDistance) || maxDistance < 1 || maxDistance > 100)
  throw new Error('NSUID_MAX_DISTANCE must be an integer from 1 to 100');

const data = JSON.parse(await readFile(input, 'utf8'));
const entries = Object.entries(data.games ?? {});
const known = [];
const unknown = [];
for (const [key, g] of entries) {
  const named = Boolean(g.titleZh || g.titleEn);
  for (const [country, id, price] of [
    ['TW', g.twTitleId, g.twPrice],
    ['HK', g.hkTitleId, g.hkPrice],
    ['JP', g.jpTitleId, null],
  ]) {
    if (!id || !/^\d{14}$/.test(String(id))) continue;
    const rec = { key, country, nsuid: String(id), titleZh: g.titleZh ?? null,
      titleEn: g.titleEn ?? null, source: g.source ?? null,
      hasPrice: Boolean(price && price.sales_status === 'onsale') };
    (named ? known : unknown).push(rec);
  }
}
const byPrefix = new Map();
for (const r of known) {
  const prefix = r.nsuid.slice(0, 10);
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(r);
}
const candidates = [];
for (const u of unknown) {
  if (u.country !== 'TW' || !u.hasPrice) continue;
  const nearby = [];
  const n = BigInt(u.nsuid);
  const matches = byPrefix.get(u.nsuid.slice(0, 10)) ?? [];
  for (const k of matches) {
    if (k.country === 'TW' || k.key === u.key || k.nsuid.slice(0, 10) !== u.nsuid.slice(0, 10)) continue;
    const delta = n > BigInt(k.nsuid) ? n - BigInt(k.nsuid) : BigInt(k.nsuid) - n;
    if (delta === 0n || delta > BigInt(maxDistance)) continue;
    nearby.push({ candidateKey: k.key, candidateCountry: k.country,
      candidateNsuid: k.nsuid, distance: Number(delta),
      candidateTitleZh: k.titleZh, candidateTitleEn: k.titleEn,
      evidence: 'nsuid_proximity_only', status: 'manual_review_required' });
  }
  nearby.sort((a, b) => a.distance - b.distance);
  if (nearby.length) candidates.push({ twNsuid: u.nsuid, twKey: u.key, matches: nearby.slice(0, 15) });
}
const report = { generatedAt: new Date().toISOString(), input, maxDistance,
  warning: 'NSUID proximity is NOT evidence of same game. Do not auto-merge these candidates.',
  counts: { entries: entries.length, unknownTwPriced: unknown.filter(x => x.country === 'TW' && x.hasPrice).length,
    candidates: candidates.length }, candidates };
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, ...report.counts }, null, 2));
