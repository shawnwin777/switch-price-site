#!/usr/bin/env node
/**
 * Protected preview/apply for TW official name+cover on EXISTING unnamed game rows.
 * No creates, deletes, slug edits, region mapping edits, DLC associations, or price writes.
 * Requires fresh full TW price confirmation.
 *
 * Usage:
 *  node scripts/guarded-tw-backfill.mjs --plan=reports/tw-official-backfill-plan.json \
 *    --prices=reports/tw-official-prices.json --report=reports/tw-db-preview.json
 *  TW_BACKFILL_WRITE_APPROVED=YES node scripts/guarded-tw-backfill.mjs [same args] \
 *    --apply --approval=<sha256-from-dry-run>
 *
 * All requests go to the configured project URL with service role on server only.
 * Never print credentials; generated report includes rollback snapshots of altered rows.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildTwBackfillChanges, planLiveTwBackfill } from './lib/tw-official-db-patch.mjs';

const arg = (key, fallback=null) => process.argv.find(x=>x.startsWith(key+'='))?.slice(key.length+1) ?? fallback;
const apply=process.argv.includes('--apply');
const indexPath=arg('--index');
const planPath=arg('--plan','reports/tw-official-backfill-plan.json');
const pricePath=arg('--prices','reports/tw-official-prices.json');
const output=arg('--report','reports/tw-db-preview.json');
const approval=arg('--approval');
const maxWrites=Number(arg('--max-writes','3000'));
const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!SUPABASE_URL || !SERVICE_ROLE_KEY)throw new Error('Supabase server credentials required for read-only preview or protected apply');
if(!/^https:\/\/[a-zA-Z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL))
  throw new Error('Unexpected Supabase project URL');
if(apply && (process.env.TW_BACKFILL_WRITE_APPROVED!=='YES'||!(/^[a-f0-9]{64}$/.test(approval??''))))
  throw new Error('Production apply requires TW_BACKFILL_WRITE_APPROVED=YES and exact --approval SHA256');
const base=SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/';
const headers={apikey:SERVICE_ROLE_KEY,Authorization:'Bearer '+SERVICE_ROLE_KEY};
async function request(table,query,method='GET',body){
  const res=await fetch(base+table+'?'+query,{
    method,headers:{...headers,...(body?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000),
  });
  if(!res.ok)throw new Error('Database request failed '+table+': HTTP '+res.status+' '+(await res.text()).slice(0,160));
  return res.json();
}
async function readAll(table,columns){
  const rows=[];
  for(let offset=0;offset<500000;offset+=1000){
    const page=await request(table,'select='+encodeURIComponent(columns)+'&order=id.asc&limit=1000&offset='+offset);
    if(!Array.isArray(page))throw new Error('Unexpected DB response');
    rows.push(...page);
    if(page.length<1000)break;
  }
  if (rows.length && new Set(rows.map(row=>row.id)).size!==rows.length)
    throw new Error('Duplicate database row IDs during paginated read');
  return rows;
}
const [planOrIndex,currentPrices]=await Promise.all([
  readFile(indexPath??planPath,'utf8'),readFile(pricePath,'utf8'),
]).then(x=>x.map(JSON.parse));
const [games,regionIds]=await Promise.all([
  readAll('games','id,slug,title_zh,title_en,cover_url,is_unnamed,product_type,platform'),
  readAll('game_region_ids','id,game_id,country,title_id'),
]);
const fullPlan=indexPath?planLiveTwBackfill(planOrIndex,currentPrices,games,regionIds):planOrIndex;
// Keep the hard 3000-write limit. The live plan may contain more than 3000
// verified changes; process a bounded batch, name-first and cover-only second.
// Remaining candidates are NOT lost: next run rebuilds the plan from live DB.
const priority={exact_nsuid_pending_review:0,exact_nsuid_cover_only_review:1};
const ordered=[...fullPlan.candidates].sort((a,b)=>
  (priority[a.status]??9)-(priority[b.status]??9) ||
  String(a.nsuid).localeCompare(String(b.nsuid)));
const plan=indexPath?{...fullPlan,candidates:ordered.slice(0,maxWrites)}:fullPlan;
const deferredCandidates=fullPlan.candidates.length-plan.candidates.length;
const {changes,skipped}=buildTwBackfillChanges(plan,games,regionIds,maxWrites,currentPrices);
const digest=createHash('sha256').update(JSON.stringify(changes)).digest('hex');
const report={
  generatedAt:new Date().toISOString(),mode:apply?'APPLY':'PREVIEW',
  input:{plan:indexPath??planPath,liveIndexMode:Boolean(indexPath),prices:pricePath,sourceAt:plan.officialFetchedAt,priceAt:currentPrices.generatedAt},
  databaseRows:{games:games.length,regionIds:regionIds.length},
  approvalSha256:digest,totalReviewedCandidates:fullPlan.candidates.length,
  batchReviewedCandidates:plan.candidates.length,deferredCandidates,
  eligibleChanges:changes.length,skippedCount:skipped.length,skipped,
  beforeSnapshots:changes.map(({gameId,nsuid,slug,before})=>({gameId,nsuid,slug,...before})),
  changes:changes.map(({gameId,nsuid,slug,patch})=>({gameId,nsuid,slug,patch})),
  completed:0,appliedIds:[],error:null,
  note:'Only protected existing TW 7001 placeholders plus named rows missing covers. No create/delete/price change/cross-region match. Rollback snapshots exported.',
};
async function writeReport(){
  await mkdir(path.dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
}
await writeReport();
console.log(JSON.stringify({mode:report.mode,eligibleChanges:changes.length,
  skipped:skipped.length,deferredCandidates,approvalSha256:digest,output}));
if(!apply)process.exit(0);
if(digest!==approval)throw new Error('Approval SHA256 mismatch; dry-run preview must be reviewed and accepted first');
for(const c of changes){
  const q=new URLSearchParams();
  q.set('id','eq.'+c.gameId);
  q.set('slug','eq.'+c.slug);
  q.set('is_unnamed',c.before.is_unnamed?'eq.true':'eq.false');
  q.set('title_zh',c.before.title_zh===null?'is.null':'eq.'+c.before.title_zh);
  if('cover_url' in c.patch)q.set('cover_url',c.before.cover_url===null?'is.null':'eq.'+c.before.cover_url);
  if('title_en' in c.patch)q.set('title_en',c.before.title_en===null?'is.null':'eq.'+c.before.title_en);
  if('platform' in c.patch)q.set('platform',c.before.platform===null?'is.null':'eq.'+c.before.platform);
  try{
    const updated=await request('games',q.toString(),'PATCH',c.patch);
    if(!Array.isArray(updated)||updated.length!==1||updated[0].id!==c.gameId)
      throw new Error('Conditional write rejected or unexpected row count for '+c.nsuid);
    report.completed++;
    report.appliedIds.push(c.gameId);
    if(report.completed%25===0)await writeReport();
  }catch(e){
    report.error=String(e);
    await writeReport();
    throw e;
  }
}
await writeReport();
console.log(JSON.stringify({applied:report.completed,eligibleChanges:changes.length,output}));
