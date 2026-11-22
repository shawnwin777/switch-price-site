#!/usr/bin/env node
/**
 * Collect authoritative TW product-name evidence by exact NSUID only.
 * Sources: TW /api/software?spage=N and legacy TW JSON thumbnails.
 * Read-only. This script NEVER changes games, price records, or Supabase.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const input=process.argv[2]??'data/tw-hk-full-ids.json';
const output=process.argv[3]??'reports/tw-name-evidence.json';
const source=JSON.parse(await readFile(input,'utf8'));
const knownPrices=new Map();
for(const [key,g] of Object.entries(source.games??{})){
  if(g.twTitleId && g.twPrice?.sales_status==='onsale'){
    const id=String(g.twTitleId);
    if(!knownPrices.has(id))knownPrices.set(id,[]);
    knownPrices.get(id).push({key,named:Boolean(g.titleZh||g.titleEn)});
  }
}
const byId=new Map(),failures=[],sourceCounts={apiPages:0,apiItems:0,apiReportedTotal:null,apiComplete:false,legacyItems:0};
const officialMediaById=new Map(), officialPrefixes={}, hardwareCategories={}, imageUrlHosts={};
const officialImageProbeSamples=[];
function mediaUrl(imageHero,imageHeroOrg){
  const candidates=[imageHero?.url, imageHeroOrg];
  for(const raw of candidates){
    if(typeof raw!=='string' || !raw.trim())continue;
    try {
      const u=new URL(raw,'https://www.nintendo.com/');
      if(u.protocol!=='https:')continue;
      const h=u.hostname.toLowerCase();
      if(!(h==='images.ctfassets.net'||h==='nintendo.com'||h.endsWith('.nintendo.com')||h.endsWith('.nintendo.net')||h.endsWith('.nintendo.co.jp')||h.endsWith('.nintendo-europe.com')))continue;
      return u.toString();
    } catch {}
  }
  return null;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function getJson(url){
  let error;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(16000)});
      if(!r.ok)throw new Error('HTTP '+r.status+' '+url);
      return await r.json();
    }catch(e){error=e;if(attempt<2)await sleep(1200*(attempt+1));}
  }
  throw error;
}
function add(id,title,publisher,sourceName){
  if(!/^7\d{13}$/.test(String(id)) || !title || typeof title!=='string')return;
  const key=String(id),t=title.trim();
  if(!t)return;
  if(!byId.has(key))byId.set(key,[]);
  if(!byId.get(key).some(e=>e.title===t&&e.source===sourceName))
    byId.get(key).push({title:t,publisher:publisher||null,source:sourceName});
}
function addOfficial(item){
  add(item.nsuid,item.title,item.publisher,'tw-api-software');
  const nsuid=String(item.nsuid??'');
  if(!/^7\d{13}$/.test(nsuid))return;
  const prefix=nsuid.slice(0,4);
  officialPrefixes[prefix]=(officialPrefixes[prefix]??0)+1;
  const hw=String(item.hardwareCategory??'unknown');
  hardwareCategories[hw]=(hardwareCategories[hw]??0)+1;
  const url=item.imageUrl || mediaUrl(item.imageHero,item.imageHeroOrg);
  if(url){
    officialMediaById.set(nsuid,{url,title:item.title??null,hardwareCategory:hw});
    try{const host=new URL(url).hostname;imageUrlHosts[host]=(imageUrlHosts[host]??0)+1;}catch{}
    if(officialImageProbeSamples.length<12)officialImageProbeSamples.push({nsuid,url});
  }
}
try{
  const cachedPath=process.env.TW_OFFICIAL_INDEX_PATH;
  if(cachedPath){
    const index=JSON.parse(await readFile(cachedPath,'utf8'));
    if(!index.complete || index.schemaVersion!==1 || !index.records ||
       !Number.isInteger(index.officialTotal) || index.pages!==Math.ceil(index.officialTotal/24))
      throw new Error('TW official cache incomplete or invalid');
    sourceCounts.apiPages=index.pages;
    sourceCounts.apiItems=index.rows;
    sourceCounts.apiReportedTotal=index.officialTotal;
    sourceCounts.apiComplete=true;
    for(const item of Object.values(index.records))addOfficial(item);
    for(const group of Object.values(index.conflicts??{}))for(const item of group)addOfficial(item);
    console.log('[cache] Reusing validated TW official catalog index without another 195-page fetch');
  }else{
    const seen=new Set();
    for(let page=1;page<=300;page++){
      const data=await getJson('https://www.nintendo.com/tw/api/software?sftab=all&spage='+page);
      const items=Array.isArray(data.items)?data.items:[];
      if(page===1)sourceCounts.apiReportedTotal=Number.isSafeInteger(data.total)?data.total:null;
      if(!items.length){sourceCounts.apiComplete=sourceCounts.apiReportedTotal!==null && sourceCounts.apiItems>=sourceCounts.apiReportedTotal;break;}
      const sig=items.map(x=>x.nsuid).join(',');
      if(seen.has(sig))break;
      seen.add(sig);
      sourceCounts.apiPages++;sourceCounts.apiItems+=items.length;
      for(const item of items)addOfficial(item);
      if(Number.isSafeInteger(data.total) && sourceCounts.apiItems>=data.total){sourceCounts.apiComplete=true;break;}
      await sleep(150);
    }
  }
}catch(err){failures.push({source:'tw-api-software',error:String(err)});}
try{
  const items=await getJson('https://www.nintendo.com/tw/data/json/switch_software.json');
  if(!Array.isArray(items))throw new Error('unexpected legacy JSON shape');
  sourceCounts.legacyItems=items.length;
  for(const x of items){
    const ids=[x.thumb_img,x.thumb_img_tw].map(y=>String(y??'').match(/^(7\d{13})\.(?:jpe?g|png)$/i)?.[1]).filter(Boolean);
    for(const id of ids)add(id,x.title,x.maker_publisher,'tw-legacy-json');
  }
}catch(err){failures.push({source:'tw-legacy-json',error:String(err)});}
const matched=[],conflicts=[],unmatchedNamed=0;
for(const [id,evidence] of byId){
  const priced=knownPrices.get(id);
  if(!priced)continue;
  const normalized=[...new Set(evidence.map(x=>x.title.normalize('NFKC').trim().toLowerCase()))];
  const record={nsuid:id,evidence,existingKeys:priced.map(x=>x.key),wasNamed:priced.some(x=>x.named),
    officialCoverUrl:officialMediaById.get(id)?.url??null};
  if(normalized.length>1)conflicts.push(record);
  else matched.push(record);
}
if(!sourceCounts.apiComplete)failures.push({source:'tw-api-software',error:'incomplete_catalog: report is partial; do not treat these counts as full coverage'});
const imageLiveChecks=[];
for(const sample of officialImageProbeSamples.slice(0,8)){
  try{
    const res=await fetch(sample.url,{method:'HEAD',signal:AbortSignal.timeout(12000)});
    imageLiveChecks.push({nsuid:sample.nsuid,status:res.status,contentType:res.headers.get('content-type'),isImage:res.ok && /^image\//i.test(res.headers.get('content-type')??'')});
  }catch(err){imageLiveChecks.push({nsuid:sample.nsuid,error:String(err),isImage:false});}
}
const report={generatedAt:new Date().toISOString(),snapshotGeneratedAt:source.generated_at??null,sourceCounts,
  pricedTwDistinctNsuid:knownPrices.size,officialDistinctNsuid:byId.size,
  safeExactNsuidNameMatches:matched.length,alreadyNamedMatches:matched.filter(x=>x.wasNamed).length,
  potentiallyNewNames:matched.filter(x=>!x.wasNamed).length,
  conflictingNameMatches:conflicts.length,failures,
  officialProductStats:{nsuidPrefixes:officialPrefixes,hardwareCategories,officialItemsWithAcceptedImageUrl:officialMediaById.size,imageUrlHosts,
    matchedPricedWithOfficialImage:matched.filter(x=>x.officialCoverUrl).length,
    potentialNewNameAndCover:matched.filter(x=>!x.wasNamed && x.officialCoverUrl).length,
    conflictingNameWithOfficialImage:conflicts.filter(x=>x.officialCoverUrl).length,
    imageUrlProbeSamples:officialImageProbeSamples,imageLiveChecks,imageLiveSuccess:imageLiveChecks.filter(x=>x.isImage).length},

  note:'Exact NSUID only; matching a name does NOT verify DLC/parent game or cross-region identity. No production writes.',
  matched,conflicts};
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceCounts,pricedTwDistinctNsuid:report.pricedTwDistinctNsuid,officialDistinctNsuid:report.officialDistinctNsuid,safeExactNsuidNameMatches:report.safeExactNsuidNameMatches,potentiallyNewNames:report.potentiallyNewNames,conflictingNameMatches:report.conflictingNameMatches,officialProductStats:report.officialProductStats,failures},null,2));
