#!/usr/bin/env node
/**
 * Inspect third-party TitleDB HK.zh metadata against TW on-sale price NSUIDs.
 * Read-only: do not use as a Taiwan market listing or write to Supabase.
 * Usage: node scripts/audit-titledb-hk-tw.mjs [historical_snapshot] [tw_official_report] [output]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const sourcePath=process.argv[2]??'data/tw-hk-full-ids.json';
const officialPath=process.argv[3]??'reports/tw-name-evidence.json';
const out=process.argv[4]??'reports/titledb-hk-tw.json';
const [snapshot,official]=await Promise.all([
  readFile(sourcePath,'utf8').then(JSON.parse),
  readFile(officialPath,'utf8').then(JSON.parse),
]);
const twPriced=new Map();
for(const [key,g] of Object.entries(snapshot.games??{})){
  const id=String(g.twTitleId??'');
  if(!/^7\d{13}$/.test(id)||g.twPrice?.sales_status!=='onsale')continue;
  const x=twPriced.get(id)??[];
  x.push({key,named:Boolean(g.titleZh||g.titleEn)});
  twPriced.set(id,x);
}
const officialKnown=new Set([...(official.matched??[]),...(official.conflicts??[])].map(x=>String(x.nsuid)));
const url='https://raw.githubusercontent.com/blawar/titledb/master/HK.zh.json';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchJson(){
  let failure;
  for(let i=0;i<3;i++){
    try{
      const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const len=Number(response.headers.get('content-length')??0);
      if(len>100_000_000)throw new Error('Unexpectedly large dataset');
      const text=await response.text();
      if(text.length>110_000_000)throw new Error('Dataset too large');
      const data=JSON.parse(text);
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Unexpected TitleDB shape');
      return data;
    }catch(e){failure=e;if(i<2)await sleep(1500*(i+1));}
  }
  throw failure;
}
function safeUrl(value){
  if(typeof value!=='string')return null;
  try{
    const u=new URL(value);
    if(u.protocol!=='https:')return null;
    const h=u.hostname.toLowerCase();
    if(!(h.endsWith('.nintendo.net')||h.endsWith('.nintendo.com')||h==='images.ctfassets.net'))return null;
    return u.toString();
  }catch{return null;}
}
let dataset=null,error=null;
try{dataset=await fetchJson();}catch(e){error=String(e);}
const stats={source:url,entries:dataset?Object.keys(dataset).length:0,twPricedDistinctNsuids:twPriced.size,
  matchedTwPriced:0,matchedTwPricedWithName:0,matchedTwPricedWithIcon:0,
  candidatesNotInTwOfficial:0,candidatesNotInTwOfficialWithIcon:0,
  candidatesUnnamedNotInTwOfficial:0,candidatesUnnamedNotInTwOfficialWithIcon:0,
  iconHosts:{},error,warning:'TitleDB HK metadata is third party. Candidate only; never infer TW availability, same SKU edition, license or current pricing. No database writes.'};
const candidates=[];
for(const [id,rows] of twPriced){
  const d=dataset?.[id];
  if(!d || typeof d!=='object')continue;
  stats.matchedTwPriced++;
  const name=typeof d.name==='string'&&d.name.trim()?d.name.trim():null;
  const icon=safeUrl(d.iconUrl);
  if(name)stats.matchedTwPricedWithName++;
  if(icon){
    stats.matchedTwPricedWithIcon++;
    const host=new URL(icon).hostname;
    stats.iconHosts[host]=(stats.iconHosts[host]??0)+1;
  }
  if(officialKnown.has(id))continue;
  stats.candidatesNotInTwOfficial++;
  if(icon)stats.candidatesNotInTwOfficialWithIcon++;
  if(rows.some(r=>r.named))continue;
  stats.candidatesUnnamedNotInTwOfficial++;
  if(icon)stats.candidatesUnnamedNotInTwOfficialWithIcon++;
  if(name||icon)candidates.push({nsuid:id,title:name,iconUrl:icon,publisher:d.publisher??null,existingKeys:rows.map(r=>r.key),
    reviewStatus:'third_party_hk_candidate_only'});
}
const report={generatedAt:new Date().toISOString(),snapshotAt:snapshot.generated_at??null,stats,
  evidenceSource:'TitleDB HK.zh.json; metadata only; unofficial',
  candidates};
await mkdir(path.dirname(out),{recursive:true});
await writeFile(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
if(error)process.exitCode=1;
