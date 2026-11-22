#!/usr/bin/env node
/** Discover which documented-looking pagination parameters TW software API honors.
 * Read-only and bounded (7 requests); no prices, no database. */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const base='https://www.nintendo.com/tw/api/software';
const qs=['','?page=2','?spage=2','?page=2&limit=50','?offset=50&limit=50','?page=2&per_page=50','?limit=100','?sftab=all','?sftab=all&spage=2','?sftab=all&spage=10'];
const results=[];
for(const q of qs){
  try{
    const resp=await fetch(base+q,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
    const json=await resp.json();
    const items=Array.isArray(json.items)?json.items:[];
    results.push({query:q||'(default)',status:resp.status,total:json.total??null,itemCount:items.length,firstNsuid:items[0]?.nsuid??null,lastNsuid:items.at(-1)?.nsuid??null,uniqueNsuids:new Set(items.map(x=>x.nsuid)).size});
  }catch(err){results.push({query:q||'(default)',error:String(err)});}
}
await mkdir('reports',{recursive:true});
await writeFile('reports/tw-api-pagination.json',JSON.stringify({results,note:'Probe only, not a guarantee of entire eShop coverage'},null,2)+'\n');
for(const r of results)console.log(JSON.stringify(r));
