#!/usr/bin/env node
/**
 * READ-ONLY diagnosis of live homepage game counts after official TW backfill.
 * Queries exact HEAD counts; never retrieves customer records, writes data,
 * modifies production state or logs credentials.
 */
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url??'')||!key)
 throw new Error('Missing expected Supabase URL/service-role secret');
const origin=url.replace(/\/$/,'')+'/rest/v1';
const checks=[
 ['all_games','games',{}],
 ['named_games','games',{is_unnamed:'eq.false'}],
 ['unnamed_games','games',{is_unnamed:'eq.true'}],
 ['named_game_products','games',{is_unnamed:'eq.false',product_type:'eq.game'}],
 ['named_null_product_type','games',{is_unnamed:'eq.false',product_type:'is.null'}],
 ['named_tw_slug_games','games',{is_unnamed:'eq.false',slug:'like.tw-*'}],
 ['unnamed_tw_slug_games','games',{is_unnamed:'eq.true',slug:'like.tw-*'}],
 ['named_hk_slug_games','games',{is_unnamed:'eq.false',slug:'like.hk-*'}],
 ['named_games_with_art','games',{is_unnamed:'eq.false',cover_url:'not.is.null'}],
 ['view_named_games','games_with_price_stats',{is_unnamed:'eq.false'}],
 ['view_named_tw_price','games_with_price_stats',{is_unnamed:'eq.false',price_country_list:'cs.{TW}'}],
 ['view_tw_price_all_names','games_with_price_stats',{price_country_list:'cs.{TW}'}],
 ['tw_region_id_rows','game_region_ids',{country:'eq.TW'}],
 ['tw_price_rows','prices',{country:'eq.TW'}],
];
async function count(role, name, table, filters){
 const qs=new URLSearchParams({select:'id',limit:'1',...filters}).toString();
 const headers={apikey:role,Authorization:'Bearer '+role,Prefer:'count=exact'};
 const r=await fetch(origin+'/'+table+'?'+qs,{method:'HEAD',headers,signal:AbortSignal.timeout(40000)});
 if(!r.ok)throw new Error(name+' HTTP '+r.status);
 const range=r.headers.get('content-range');
 const total=Number(range?.split('/').pop());
 if(!range||!Number.isSafeInteger(total))throw new Error(name+' invalid count response');
 return total;
}
const output={generatedAt:new Date().toISOString(),mode:'READ_ONLY',counts:{},errors:{},anonymousCounts:null};
for(const [name,table,filters] of checks){
 try{output.counts[name]=await count(key,name,table,filters);}
 catch(e){output.errors[name]=String(e);}
}
if(anon){
 output.anonymousCounts={};
 for(const [name,table,filters] of checks.filter(([name])=>['named_games','view_named_games','view_named_tw_price'].includes(name))){
  try{output.anonymousCounts[name]=await count(anon,name,table,filters);}
  catch(e){output.anonymousCounts[name]='ERROR: '+String(e);}
 }
}
const errors=Object.keys(output.errors);
console.log(JSON.stringify(output,null,2));
if(errors.length)process.exitCode=1;
