#!/usr/bin/env node
/**
 * Enrich current TW-priced DLC/bundle NSUIDs with THIRD-PARTY HK TitleDB evidence.
 * Never infer TW availability from HK; source price scan proves TW status.
 * Never set parentVerified true. Missing ID after 2025 is a known TitleDB limitation.
 * READ ONLY. Output is review evidence, not approved publish/DB input.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const statusPath=process.argv[2]??'reports/tw-addons-current-status.json';
const output=process.argv[3]??'reports/tw-addon-metadata-evidence.json';
const status=JSON.parse(await readFile(statusPath,'utf8'));
if(!status.complete || status.scope!=='all_historically_priced_addon_ids' || !Array.isArray(status.entries))
  throw new Error('Complete current TW DLC/bundle recheck is required');
const age=Date.now()-Date.parse(status.generatedAt);
if(!Number.isFinite(age)||age<0||age>48*3600_000)throw new Error('TW DLC price status report stale');
const datasetUrl='https://raw.githubusercontent.com/blawar/titledb/master/HK.zh.json';
async function fetchDb(){
  const res=await fetch(datasetUrl,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(120000)});
  if(!res.ok)throw new Error('TitleDB HK request HTTP '+res.status);
  const raw=await res.text();
  if(raw.length>110_000_000)throw new Error('TitleDB file too large');
  const parsed=JSON.parse(raw);
  if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw new Error('Unexpected TitleDB structure');
  return parsed;
}
function artwork(v){
  if(typeof v!=='string')return null;
  try{
    const u=new URL(v);
    const host=u.hostname.toLowerCase();
    if(u.protocol!=='https:' || !(host==='img-eshop.cdn.nintendo.net' || host==='images.ctfassets.net' ||
      host.endsWith('.nintendo.net')))return null;
    return u.toString();
  }catch{return null;}
}
function validTitleId(v){
  return typeof v==='string'&&/^0[0-9a-f]{15}$/i.test(v)?v.toUpperCase():null;
}
const db=await fetchDb();
const baseByTitleId=new Map();
for(const [key,d] of Object.entries(db)){
  if(!key.startsWith('7001') || !d || typeof d!=='object')continue;
  const id=validTitleId(d.id);
  if(!id)continue;
  if(!baseByTitleId.has(id))baseByTitleId.set(id,new Set());
  baseByTitleId.get(id).add(key);
}
const enriched=[],stats={source:datasetUrl,sourceRows:Object.keys(db).length,twPricedAddons:status.entries.length,
  twCurrentlyOnsale:0,withHkTitleDb:0,withName:0,withIcon:0,withBanner:0,
  explicitParentTitleId:0,uniqueParentCandidate:0,unknownParent:0,
  byPrefix:{},imageLiveChecks:[],warning:'HK TitleDB names and images are unverified supplemental candidates. DLC parentId is not reliable for recent releases. Never auto-join to TW base game or write production DB.'};
for(const item of status.entries){
  const id=item.nsuid,raw=db[id];
  const data=raw && typeof raw==='object'?raw:null;
  const named=data&&typeof data.name==='string'&&data.name.trim()?data.name.trim():null;
  const icon=artwork(data?.iconUrl);
  const banner=artwork(data?.bannerUrl);
  const parentTitleId=validTitleId(data?.parentId);
  const parents=parentTitleId?baseByTitleId.get(parentTitleId):null;
  const parentCandidate=item.range==='7005_dlc_candidate'&&parents?.size===1?[...parents][0]:null;
  const prefix=id.slice(0,4);
  stats.byPrefix[prefix]??={total:0,onsale:0,withName:0,withIcon:0,parentCandidates:0};
  const g=stats.byPrefix[prefix];
  g.total++;if(item.sales_status==='onsale'){stats.twCurrentlyOnsale++;g.onsale++;}
  if(data)stats.withHkTitleDb++;
  if(named){stats.withName++;g.withName++;}
  if(icon){stats.withIcon++;g.withIcon++;}
  if(banner)stats.withBanner++;
  if(parentTitleId)stats.explicitParentTitleId++;
  if(parentCandidate){stats.uniqueParentCandidate++;g.parentCandidates++;}
  else if(prefix==='7005')stats.unknownParent++;
  enriched.push({
    nsuid:id,productRange:prefix==='7005'?'dlc_candidate':'bundle_candidate',
    title:named,heroUrl:banner??icon,iconUrl:icon,
    nameSource:named?'TitleDB HK.zh':null,
    imageSource:icon||banner?'TitleDB HK.zh':null,
    currentSalesStatus:item.sales_status,currentPriceRaw:item.effectiveRaw,
    regularPriceRaw:item.regularRaw,currency:item.currency,saleEnd:item.saleEnd,
    checkedAt:status.generatedAt,
    parentNsuidCandidate:parentCandidate,parentVerified:false,
    relationshipSource:parentCandidate?'TitleDB parentId -> unique HK base Title ID (review required)':null,
  });
}
for(const x of enriched.filter(x=>x.heroUrl).slice(0,8)){
  try{
    const r=await fetch(x.heroUrl,{method:'HEAD',signal:AbortSignal.timeout(10000)});
    stats.imageLiveChecks.push({nsuid:x.nsuid,http:r.status,contentType:r.headers.get('content-type'),ok:r.ok && /^image\//.test(r.headers.get('content-type')??'')});
  }catch(e){stats.imageLiveChecks.push({nsuid:x.nsuid,error:String(e),ok:false});}
}
const result={generatedAt:new Date().toISOString(),twPriceCheckAt:status.generatedAt,
  complete:status.complete,mode:'READ_ONLY_METADATA_EVIDENCE',
  stats,items:enriched};
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
