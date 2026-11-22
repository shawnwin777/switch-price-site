#!/usr/bin/env node
/**
 * Read-only Taiwan catalog coverage audit.
 * Count priced SKU records, not games: 7001 also contains DLC/bundles.
 * Usage: node scripts/audit-tw-coverage.mjs [input.json] [report.json]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const input=process.argv[2] || 'data/tw-hk-full-ids.json';
const output=process.argv[3] || 'reports/tw-coverage.json';
const data=JSON.parse(await readFile(input,'utf8'));
if (!data.games || typeof data.games !== 'object') throw new Error('Expected games object');
const summary={
  sourceGeneratedAt:data.generated_at ?? null,
  records:0, twPricedRecords:0, hkPricedRecords:0,
  twNamed:0, twUnnamed:0, twWithHkSameNsuid:0,
  twWithHkDifferentNsuid:0, twWithoutHk:0,
  twByNsuidPrefix:{}, unknownTwSamples:[],
  warning:'These are SKU records from a committed snapshot, not a complete count of Taiwan games. 7001 can contain DLC/bundles. No product classification or automatic cross-region merge is performed.'
};
for (const [key,g] of Object.entries(data.games)) {
  summary.records++;
  const tw=g.twPrice?.sales_status==='onsale' && !!g.twTitleId;
  const hk=g.hkPrice?.sales_status==='onsale' && !!g.hkTitleId;
  if (hk) summary.hkPricedRecords++;
  if (!tw) continue;
  summary.twPricedRecords++;
  const named=Boolean(g.titleZh || g.titleEn);
  if (named) summary.twNamed++; else {
    summary.twUnnamed++;
    if (summary.unknownTwSamples.length < 25) summary.unknownTwSamples.push({key,nsuid:g.twTitleId});
  }
  const prefix=String(g.twTitleId).slice(0,4);
  summary.twByNsuidPrefix[prefix]=(summary.twByNsuidPrefix[prefix]||0)+1;
  if (!hk) summary.twWithoutHk++;
  else if (String(g.twTitleId)===String(g.hkTitleId)) summary.twWithHkSameNsuid++;
  else summary.twWithHkDifferentNsuid++;
}
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({sourceGeneratedAt:summary.sourceGeneratedAt,records:summary.records,twPricedRecords:summary.twPricedRecords,twNamed:summary.twNamed,twUnnamed:summary.twUnnamed,twWithHkSameNsuid:summary.twWithHkSameNsuid,twWithHkDifferentNsuid:summary.twWithHkDifferentNsuid,twWithoutHk:summary.twWithoutHk,twByNsuidPrefix:summary.twByNsuidPrefix},null,2));
