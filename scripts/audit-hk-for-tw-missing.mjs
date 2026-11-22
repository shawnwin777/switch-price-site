#!/usr/bin/env node
/**
 * Read-only HK official catalog supplementary evidence for a TW-priced snapshot.
 * HK listing does NOT prove Taiwan listing. Never creates or updates Supabase rows.
 * Usage: node scripts/audit-hk-for-tw-missing.mjs [tw-hk-full-ids.json] [tw-name-evidence.json] [output.json]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const src=process.argv[2]??'data/tw-hk-full-ids.json';
const twEvidencePath=process.argv[3]??'reports/tw-name-evidence.json';
const output=process.argv[4]??'reports/hk-supplement-for-tw.json';
const [snapshot,twEvidence]=await Promise.all([readFile(src,'utf8'),readFile(twEvidencePath,'utf8')]).then(x=>x.map(JSON.parse));
const priced=new Map();
for(const [key,g] of Object.entries(snapshot.games??{})){
  const id=String(g.twTitleId??'');
  if(!/^7\d{13}$/.test(id)||g.twPrice?.sales_status!=='onsale')continue;
  const vals=priced.get(id)??[];
  vals.push({key,named:Boolean(g.titleZh||g.titleEn)});
  priced.set(id,vals);
}
const twOfficialPriced=new Set([
  ...(twEvidence.matched??[]),
  ...(twEvidence.conflicts??[]),
].map(x=>String(x.nsuid)));
const hkMap=new Map(),stats={pages:0,items:0,total:null,complete:false};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let error=null;
async function json(url){
  let last;
  for(let i=0;i<3;i++){
    try{
      const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(18000)});
      if(!r.ok)throw new Error('HTTP '+r.status);
      return await r.json();
    }catch(e){last=e;if(i<2)await wait(1500*(i+1));}
  }
  throw last;
}
try{
  const pageSignatures=new Set();
  for(let page=1;page<=600;page++){
    const response=await json('https://www.nintendo.com/hk/api/software?sftab=all&spage='+page);
    const items=Array.isArray(response.items)?response.items:[];
    if(page===1)stats.total=Number.isInteger(response.total)?response.total:null;
    if(!items.length)break;
    const signature=items.map(x=>x.nsuid).join('|');
    if(pageSignatures.has(signature))break;
    pageSignatures.add(signature);
    stats.pages++;stats.items+=items.length;
    for(const x of items){
      const nsuid=String(x.nsuid??'');
      if(!/^7\d{13}$/.test(nsuid)||typeof x.title!=='string'||!x.title.trim())continue;
      if(!hkMap.has(nsuid))hkMap.set(nsuid,{
        nsuid,title:x.title.trim(),publisher:typeof x.publisher==='string'?x.publisher:null,
        hardwareCategory:typeof x.hardwareCategory==='string'?x.hardwareCategory:null,
        imageUrl:typeof x.imageHero?.url==='string' && /^https:\/\/images\.ctfassets\.net\//.test(x.imageHero.url)?x.imageHero.url:null,
      });
    }
    if(stats.total!==null&&stats.items>=stats.total){stats.complete=true;break;}
    await wait(150);
  }
}catch(e){error=String(e);}
const candidates=[],knownWithTw=[],matchedNamed=[];
for(const [id,rec] of priced){
  const hk=hkMap.get(id);
  if(!hk)continue;
  if(twOfficialPriced.has(id)){knownWithTw.push(id);continue;}
  if(rec.some(x=>x.named)){matchedNamed.push(id);continue;}
  candidates.push({...hk,existingKeys:rec.map(x=>x.key),evidenceStatus:'hk_same_nsuid_tw_price_present_manual_review'});
}
const report={generatedAt:new Date().toISOString(),snapshotAt:snapshot.generated_at??null,
  hkApi:stats,source:'https://www.nintendo.com/hk/api/software?sftab=all',
  twPricedDistinctNsuids:priced.size,hkOfficialDistinctNsuids:hkMap.size,
  hkMatchesWithTwOfficialEvidence:knownWithTw.length,
  hkOnlyMatchesAlreadyNamed:matchedNamed.length,
  hkOnlyCandidatesForUnnamedTw:candidates.length,
  hkOnlyCandidatesWithImage:candidates.filter(x=>x.imageUrl).length,
  error,warning:'HK names/images are secondary candidates only. A HK listing alone does not establish TW availability or same edition. TW onsale price is required; no Supabase writes.',
  candidates};
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({hkApi:stats,twPricedDistinctNsuids:priced.size,hkOfficialDistinctNsuids:hkMap.size,hkMatchesWithTwOfficialEvidence:knownWithTw.length,hkOnlyMatchesAlreadyNamed:matchedNamed.length,hkOnlyCandidatesForUnnamedTw:candidates.length,hkOnlyCandidatesWithImage:report.hkOnlyCandidatesWithImage,error},null,2));
if(!stats.complete)process.exitCode=1;
