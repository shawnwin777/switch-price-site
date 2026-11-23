#!/usr/bin/env node
/**
 * TW DLC (7005) and bundle (7007) recheck using known historically priced NSUIDs.
 * READ ONLY, no Supabase, no automatic product classification beyond observed prefix.
 * Re-checking historical IDs does not discover brand-new 7005/7007 SKUs.
 * Usage: node scripts/scan-tw-known-addons.mjs [snapshot.json] [output.json] [--limit=50]
 */
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
const [,,snapshotPath='data/tw-hk-full-ids.json',output='reports/tw-addons-current-status.json',...flags]=process.argv;
const limitText=flags.find(x=>x.startsWith('--limit='));
const limit=limitText?Number(limitText.slice('--limit='.length)):null;
if(limit!==null&&(!Number.isSafeInteger(limit)||limit<1||limit>20000))throw new Error('Invalid sample limit');
const snapshot=JSON.parse(await readFile(snapshotPath,'utf8'));
if(!snapshot?.games||typeof snapshot.games!=='object')throw new Error('Invalid historical snapshot');
const meta=new Map();
for(const [key,x] of Object.entries(snapshot.games)){
  const id=String(x.twTitleId??'');
  if(!/^700[57]\d{10}$/.test(id)||x.twPrice?.sales_status!=='onsale')continue;
  if(!meta.has(id))meta.set(id,{nsuid:id,range:id.startsWith('7005')?'7005_dlc_candidate':'7007_bundle_candidate',
    historicalKeys:[],historicalNamed:false});
  const row=meta.get(id);
  row.historicalKeys.push(key);
  if(x.titleZh||x.titleEn)row.historicalNamed=true;
}
const allIds=[...meta.keys()].sort();
const ids=limit===null?allIds:allIds.slice(0,limit);
const batches=[];
for(let i=0;i<ids.length;i+=50)batches.push(ids.slice(i,i+50));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const entries=[];
const statuses={};
let completed=0,error=null;
async function get(batch){
  const url='https://api.ec.nintendo.com/v1/price?country=TW&lang=zh&ids='+batch.join(',');
  let last;
  for(let k=0;k<3;k++){
    try{
      const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'shawn-game-studio-addons-readonly/1.0'},
        signal:AbortSignal.timeout(25000)});
      if(response.status===403)throw new Error('HTTP 403 blocked: do not bypass');
      if(!response.ok)throw new Error('HTTP '+response.status);
      const json=await response.json();
      if(!Array.isArray(json.prices))throw new Error('Unexpected API price response');
      return json.prices;
    }catch(e){
      last=e;
      if(String(e).includes('HTTP 403'))throw e;
      if(k<2)await sleep((k+1)*2500);
    }
  }
  throw last;
}
const money=v=>{
  if(v==null)return null;
  const n=Number(String(v).replace(/,/g,''));
  return Number.isFinite(n)?n:null;
};
for(const batch of batches){
  try{
    const list=await get(batch);
    const accepted=new Set(batch),seen=new Set();
    for(const x of list){
      const nsuid=String(x.title_id??'');
      if(!accepted.has(nsuid)||seen.has(nsuid))throw new Error('Invalid or duplicate returned DLC NSUID');
      seen.add(nsuid);
      const status=String(x.sales_status??'unknown');
      const regular=money(x.regular_price?.raw_value);
      const discounted=money(x.discount_price?.raw_value);
      const src=meta.get(nsuid);
      statuses[status]=(statuses[status]??0)+1;
      entries.push({
        nsuid,range:src.range,sales_status:status,
        regularRaw:regular,effectiveRaw:discounted??regular,
        currency:x.regular_price?.currency??x.discount_price?.currency??null,
        saleEnd:x.discount_price?.end_datetime??null,
        historicalNamed:src.historicalNamed,
        // Parent-game relation is unknown until verified from independent evidence.
        parentNsuid:null,parentVerified:false,
      });
    }
    if(seen.size!==batch.length)throw new Error('Incomplete DLC price batch '+completed+': '+seen.size+'/'+batch.length);
    completed++;
    await sleep(800);
  }catch(e){error=String(e);break;}
}
const countsByPrefix={};
for(const x of entries){
  const k=x.range;
  if(!countsByPrefix[k])countsByPrefix[k]={returned:0,onsale:0};
  countsByPrefix[k].returned++;
  if(x.sales_status==='onsale')countsByPrefix[k].onsale++;
}
const result={
  generatedAt:new Date().toISOString(),snapshotAt:snapshot.generated_at??null,
  mode:'READ_ONLY',scope:limit===null?'all_historically_priced_addon_ids':'limited_sample',
  historicalDistinctNsuids:allIds.length,requestedIds:ids.length,
  completedBatches:completed,totalBatches:batches.length,
  returnedItems:entries.length,complete:completed===batches.length&&!error,
  error,statuses,countsByPrefix,
  warning:'7005 is DLC candidate space; 7007 generally bundle space, not all Switch 2 upgrade packs. Historical IDs only, missing new SKUs. Never overwrite live prices without validation. Parent-game relations unverified. No DB writes.',
  entries,
};
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({mode:result.mode,scope:result.scope,historicalDistinctNsuids:allIds.length,requestedIds:ids.length,
  completedBatches:completed,totalBatches:batches.length,statuses,countsByPrefix,error,complete:result.complete},null,2));
if(!result.complete)process.exitCode=1;
