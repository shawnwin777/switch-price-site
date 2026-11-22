#!/usr/bin/env node
/**
 * Build reviewable patch plan from an official TW catalog index and a TW price snapshot.
 * Read-only: writes a JSON report, never calls Supabase or modifies merged game data.
 * Usage: node scripts/plan-tw-official-backfill.mjs [snapshot.json] [index.json] [report.json]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { planTwExactBackfill } from './lib/tw-official-catalog.mjs';
const snapshotPath = process.argv[2] || 'data/tw-hk-full-ids.json';
const indexPath = process.argv[3] || 'data/.cache/tw-official-index.json';
const output = process.argv[4] || 'reports/tw-official-backfill-plan.json';
const [scan,index] = await Promise.all([readFile(snapshotPath,'utf8'),readFile(indexPath,'utf8')]).then(x=>x.map(JSON.parse));
const plan = planTwExactBackfill(scan,index);
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(plan,null,2)+'\n','utf8');
console.log(JSON.stringify({snapshotPath,indexPath,output,mode:plan.mode,summary:plan.summary},null,2));
