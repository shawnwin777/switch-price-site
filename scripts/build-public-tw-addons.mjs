#!/usr/bin/env node
/**
 * Convert today's VERIFIED Taiwan addon price lookup and HK TitleDB candidates
 * into an explicitly attributed, publishable, read-only catalog snapshot.
 *
 * Only a TW price=onsale establishes availability. TitleDB is metadata
 * evidence, NOT a TW store listing or a verified parent-game relationship.
 * No Supabase data, private information, inferred cross-region joins or images are copied.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const [,,pricePath='reports/tw-addons-current-status.json',
  evidencePath='reports/tw-addon-metadata-evidence.json',
  output='public/data/tw-addons.json']=process.argv;
const [status,evidence]=await Promise.all([
  readFile(pricePath,'utf8'),readFile(evidencePath,'utf8')
]).then(x=>x.map(JSON.parse));
if(status.mode!=='READ_ONLY'||status.scope!=='all_historically_priced_addon_ids'||
   !status.complete||!Array.isArray(status.entries))
  throw new Error('A complete official TW addon price scan is required');
if(evidence.mode!=='READ_ONLY_METADATA_EVIDENCE'||!evidence.complete||
   !Array.isArray(evidence.items)||evidence.twPriceCheckAt!==status.generatedAt)
  throw new Error('Addon metadata must correspond to the identical official TW price check');
const age=Date.now()-Date.parse(status.generatedAt);
if(!Number.isFinite(age)||age<0||age>48*3600_000)throw new Error('Addon price check is stale');
const priceById=new Map();
for(const p of status.entries){
  const nsuid=String(p.nsuid??'');
  if(!/^700[57]\d{10}$/.test(nsuid)||priceById.has(nsuid))
    throw new Error('Duplicate or invalid price NSUID '+nsuid);
  priceById.set(nsuid,p);
}
if(priceById.size!==status.requestedIds||evidence.items.length!==status.entries.length)
  throw new Error('Incomplete current-price/metadata evidence');
const items=[],seen=new Set(),counts={total:0,named:0,withImage:0,onsale:0,dlcCandidates:0,bundleCandidates:0};
for(const m of evidence.items){
  const nsuid=String(m.nsuid??'');
  const p=priceById.get(nsuid);
  if(!p||seen.has(nsuid))throw new Error('Metadata NSUID missing price or duplicated');
  seen.add(nsuid);
  if(p.sales_status!=='onsale')continue;
  const title=typeof m.title==='string' && m.title.trim() && m.title.length<500?m.title.trim():null;
  const url=typeof m.heroUrl==='string' ? m.heroUrl : null;
  let imageUrl=null;
  if(url){
    try{
      const x=new URL(url);
      if(x.protocol==='https:' && (x.hostname==='img-eshop.cdn.nintendo.net'||
          x.hostname==='images.ctfassets.net'||x.hostname.endsWith('.nintendo.net')))
        imageUrl=x.toString();
    }catch{}
  }
  const addonType=nsuid.startsWith('7005')?'dlc_candidate':'bundle_candidate';
  const money=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
  const item={
    nsuid,title,imageUrl,addonType,publisher:null,
    salesStatus:'onsale',regular:money(p.regularRaw),effective:money(p.effectiveRaw),
    currency:typeof p.currency==='string'?p.currency:null,
    saleEnd:typeof p.saleEnd==='string'?p.saleEnd:null,
    // Do not derive parent NSUID or assert the item is an upgrade pack.
    parentVerified:false,nameSource:title?'TitleDB HK.zh (third-party candidate)':null,
    imageSource:imageUrl?'Nintendo CDN via TitleDB':null,
  };
  items.push(item);
  counts.total++;counts.onsale++;
  if(title)counts.named++;
  if(imageUrl)counts.withImage++;
  counts[addonType==='dlc_candidate'?'dlcCandidates':'bundleCandidates']++;
}
if(seen.size!==priceById.size)throw new Error('Metadata did not cover all price NSUIDs');
if(items.length < 3000 || counts.named < 2000)
  throw new Error('Unusually low Taiwan addon coverage; refuse to publish partial catalog');
items.sort((a,b)=>a.nsuid.localeCompare(b.nsuid));
const result={
  schemaVersion:1,generatedAt:new Date().toISOString(),twPriceCheckedAt:status.generatedAt,
  scope:'historically_discovered_tw_addon_ids_rechecked_today',complete:true,counts,
  warning:'Taiwan availability verified by official TW price API for these known SKUs only. 7005 is a DLC candidate, 7007 is generally bundle-related; upgrades may use different IDs. Titles/images are supplementary TitleDB HK metadata; parent games NOT verified; not all TW eShop addons have been discovered.',
  sources:[
    {name:'Nintendo TW price API',url:'https://api.ec.nintendo.com/v1/price'},
    {name:'TitleDB HK.zh metadata (MIT)',url:'https://github.com/blawar/titledb'}
  ],
  items
};
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(result)+'\n','utf8');
console.log(JSON.stringify({output,counts,twPriceCheckedAt:status.generatedAt,mode:'SAFE_PUBLIC_SNAPSHOT'}));
