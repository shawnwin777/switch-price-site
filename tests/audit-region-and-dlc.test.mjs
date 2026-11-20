import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], {
  cwd: process.cwd(), encoding: 'utf8',
});

test('DLC range report counts priced products without writing to DB', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dlc-report-'));
  try {
    const scan = path.join(dir, 'scan.json');
    const report = path.join(dir, 'report.json');
    await writeFile(scan, JSON.stringify({
      country: 'TW', from: 70050000000000, to: 70050000000002,
      scanned_batches: 1, total_batches: 1,
      results: {
        '70050000000000': { sales_status: 'onsale', effectiveRaw: 88, currency: 'TWD' },
        '70050000000001': { sales_status: 'preorder' },
      },
    }));
    const p = run('scripts/report-product-range-scan.mjs', scan, report);
    assert.equal(p.status, 0, p.stderr);
    const result = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(result.onsaleWithPrice, 1);
    assert.equal(result.priced[0].nsuid, '70050000000000');
    assert.equal(result.statuses.preorder, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Reject incomplete DLC scan', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dlc-partial-'));
  try {
    const scan = path.join(dir, 'scan.json');
    await writeFile(scan, JSON.stringify({
      country: 'HK', scanned_batches: 0, total_batches: 1, results: {},
    }));
    assert.notEqual(run('scripts/report-product-range-scan.mjs', scan, path.join(dir, 'out.json')).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Cross-region proximity makes candidate only and does not merge', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nsuid-audit-'));
  try {
    const input = path.join(dir, 'in.json');
    const output = path.join(dir, 'out.json');
    await writeFile(input, JSON.stringify({ games: {
      'tw-70010000000123': { twTitleId: '70010000000123', twPrice: { sales_status: 'onsale' }, titleZh: null },
      'known-hk': { hkTitleId: '70010000000124', titleZh: '測試遊戲', hkPrice: { sales_status: 'onsale' } },
    } }));
    const p = run('scripts/audit-region-id-candidates.mjs', input, output);
    assert.equal(p.status, 0, p.stderr);
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(result.counts.candidates, 1);
    assert.equal(result.candidates[0].matches[0].distance, 1);
    assert.equal(result.candidates[0].matches[0].status, 'manual_review_required');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
