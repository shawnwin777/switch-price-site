#!/usr/bin/env node
/**
 * Probe official Taiwan catalog URLs without assuming they expose the entire eShop.
 * Read only; records HTTP failures separately instead of inventing coverage.
 * Usage: node scripts/probe-tw-official-catalog.mjs [output.json]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output=process.argv[2]??'reports/tw-official-sources.json';
const endpoints=[
  'https://www.nintendo.com/tw/software/switch/?spage=1',
  'https://www.nintendo.com/tw/api/software',
  'https://www.nintendo.com/tw/api/search',
  'https://www.nintendo.com/tw/data/json/switch_software.json',
  'https://www.nintendo.com/hk/data/json/switch_software.json',
];
const results=[];
for(const url of endpoints) {
  try{
    const res=await fetch(url,{headers:{'Accept':'application/json,text/html;q=0.8','User-Agent':'Mozilla/5.0 (compatible; catalog-coverage-audit/1.0)'},signal:AbortSignal.timeout(15000)});
    const txt=(await res.text()).slice(0,2_000_000);
    const nsuids=[...new Set([...txt.matchAll(/\b7\d{13}\b/g)].map(m=>m[0]))];
    const record={url,status:res.status,ok:res.ok,contentType:res.headers.get('content-type'),sampleBytes:txt.length,distinctNsuidsInSample:nsuids.length,nsuidSample:nsuids.slice(0,10)};
    if((res.headers.get('content-type')||'').includes('json')){
      try {
        const json=JSON.parse(txt);
        record.jsonTopLevelKind=Array.isArray(json)?'array':typeof json;
        record.jsonTopLevelKeys=Array.isArray(json)?[]:Object.keys(json).slice(0,30);
        record.jsonTopLevelLength=Array.isArray(json)?json.length:null;
        const item=Array.isArray(json)?json[0]:Object.values(json).find(v=>Array.isArray(v))?.[0];
        record.firstItemKeys=item && typeof item==='object'?Object.keys(item).slice(0,40):[];
        record.publicSample=item && typeof item==='object'?Object.fromEntries(Object.entries(item).filter(([k,v])=>/title|name|nsuid|product|id|code|thumb/i.test(k)&&['string','number'].includes(typeof v)).slice(0,12)):null;
      }catch{record.jsonParse='unavailable_or_truncated';}
    }
    results.push(record);
  }catch(e){results.push({url,ok:false,error:String(e)});}
}
const report={generatedAt:new Date().toISOString(),note:'Probe only: endpoint existence or sample NSUID count does not establish a complete Taiwan catalog. No production writes.',results};
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2)+'\n');
for(const x of results) console.log(JSON.stringify({url:x.url,status:x.status,error:x.error,distinctNsuidsInSample:x.distinctNsuidsInSample,jsonTopLevelLength:x.jsonTopLevelLength,jsonTopLevelKeys:x.jsonTopLevelKeys,firstItemKeys:x.firstItemKeys,publicSample:x.publicSample}));
