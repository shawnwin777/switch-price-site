#!/usr/bin/env node
/**
 * Fast targeted TW price probe from Nintendo's complete official catalog.
 * READ-ONLY: no Supabase secrets, inserts, deploys or inferred cross-region matches.
 * Daily use requires a freshly verified catalog. An official-catalog scan does NOT
 * replace independent unknown-SKU/7005/7007 inventory discovery.
 * Usage: node scripts/scan-tw-official-prices.mjs [index.json] [output.json] [--limit=50]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { NSUID_PATTERN } from './lib/tw-official-catalog.mjs';

const args=process.argv.slice(2);
const positionals=args.filter(x=>!x.startsWith('--'));
const indexPath=positionals[0]||'data/.cache/tw-official-index.json';
const output=positionals[1]||'reports/tw-official-prices.json';
const argLimit=args.find(x=>x.startsWith('--limit='));
const limit=argLimit?Number(argLimit.split('=')[1]):null;
if(limit!==null&&(!Number.isSafeInteger(limit)||limit<1||limit>20000))
  throw new Error('Invalid --limit');
const index=JSON.parse(await readFile(indexPath,'utf8'));
if(!index.complete||index.schemaVersion!==1||!index.records||index.source!=='https://www.nintendo.com/tw/api/software?sftab=all')
  throw new Error('Validated official TW index is required');
const ageMs=Date.now()-Date.parse(index.fetchedAt);
if(!Number.isFinite(ageMs)||ageMs<0||ageMs>48*3600_000)
  throw new Error('TW official index too old (>48 hours); refresh it before price probe');
const known=Object.keys(index.records).filter(x=>NSUID_PATTERN.test(x)).sort();
if(!known.length)throw new Error('Empty verified official NSUID list');
const ids=limit===null?known:known.slice(0,limit);
const completeScope=limit===null || limit>=known.length;
const batches=[];
for(let i=0;i<ids.length;i+=50)batches.push(ids.slice(i,i+50));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const statusCounts={};
const priced={};
let finished=0,error=null;
async function query(batch){
  const url='https://api.ec.nintendo.com/v1/price?country=TW&ids='+batch.join(',')+'&lang=zh';
  let last;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'switch-price-site-TW-readonly-prices/1.0'},
        signal:AbortSignal.timeout(20000)});
      if(r.status===403)throw new Error('HTTP 403: price API access denied; stop, do not bypass');
      if(!r.ok)throw new Error('HTTP '+r.status);
      const body=await r.json();
      if(!Array.isArray(body.prices))throw new Error('Unexpected price API response');
      return body.prices;
    }catch(e){
      last=e;
      if(String(e).includes('HTTP 403'))throw e;
      if(attempt<2)await sleep(3000*2**attempt);
    }
  }
  throw last;
}
function priceNumber(v){
  if(v==null)return null;
  const n=Number(String(v).replace(/,/g,''));
  return Number.isFinite(n)?n:null;
}
for(const batch of batches){
  try{
    const rows=await query(batch);
    const batchIds=new Set(batch);
    for(const row of rows){
      const nsuid=String(row?.title_id??'');
      if(!batchIds.has(nsuid))throw new Error('Price API response contains unexpected NSUID');
      const status=typeof row.sales_status==='string'?row.sales_status:'unknown';
      statusCounts[status]=(statusCounts[status]??0)+1;
      const regular=priceNumber(row.regular_price?.raw_value);
      const discount=priceNumber(row.discount_price?.raw_value);
      priced[nsuid]={
        sales_status:status,regularRaw:regular,effectiveRaw:discount??regular,
        currency:row.discount_price?.currency??row.regular_price?.currency??null,
        saleEnd:row.discount_price?.end_datetime??null,
      };
    }
    finished++;
  }catch(e){error=String(e);break;}
  await sleep(800);
}
const report={
  generatedAt:new Date().toISOString(),catalogFetchedAt:index.fetchedAt,
  source:'https://api.ec.nintendo.com/v1/price?country=TW&ids={nsuids}&lang=zh',
  mode:'READ_ONLY',scope:completeScope?'full_official_catalog':'limited_sample',
  officialCatalogIds:known.length,requestedIds:ids.length,requestedBatches:batches.length,
  completedBatches:finished,complete:!error&&finished===batches.length,
  statusCounts,returnedItems:Object.keys(priced).length,error,
  warning:'Official list only; not the full Taiwanese eShop. No 7005 DLC discovery or inferred parent-game relationships. Limited sample is not a current total.',
  prices:priced,
};
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,scope:report.scope,requestedIds:report.requestedIds,
  completedBatches:finished,totalBatches:batches.length,returnedItems:report.returnedItems,
  statusCounts,error,complete:report.complete},null,2));
if(!report.complete)process.exitCode=1;
