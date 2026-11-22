#!/usr/bin/env node
/**
 * Fail-closed audit of the exact PREVIEW report from a LIVE TW NSUID backfill.
 * Outputs the digest for a second guarded, compare-and-swap apply of the
 * identical changes. The verifier NEVER writes Supabase.
 */
import {readFileSync} from 'node:fs';
const file=process.argv[2]||'reports/tw-db-preview.json';
const digestOnly=process.argv.includes('--digest-only');
const p=JSON.parse(readFileSync(file,'utf8'));
const die=msg=>{throw new Error('TW automated backfill preflight rejected: '+msg);};
if(p.mode!=='PREVIEW'||p.error!==null||p.input?.liveIndexMode!==true)
  die('Not a successful live-ID-only preview');
if(!Number.isSafeInteger(p.eligibleChanges)||p.eligibleChanges<0||p.eligibleChanges>3000)
  die('Invalid or over-cap writes');
if(!Array.isArray(p.changes)||p.changes.length!==p.eligibleChanges||
   !Array.isArray(p.beforeSnapshots)||p.beforeSnapshots.length!==p.eligibleChanges)
  die('Inconsistent audit snapshots');
if(!Number.isSafeInteger(p.skippedCount)||p.skippedCount<0||p.skippedCount>100||
   !Array.isArray(p.skipped)||p.skipped.length!==p.skippedCount)
  die('Unexpected validation skip rate');
if(!Number.isSafeInteger(p.deferredCandidates)||p.deferredCandidates<0||
   p.totalReviewedCandidates!==p.batchReviewedCandidates+p.deferredCandidates||
   p.batchReviewedCandidates!==p.eligibleChanges+p.skippedCount)
  die('Incorrect batching summary');
if(!Number.isSafeInteger(p.databaseRows?.games)||p.databaseRows.games<1||
   !Number.isSafeInteger(p.databaseRows?.regionIds)||p.databaseRows.regionIds<1)
  die('Database index absent');
if(!/^[a-f0-9]{64}$/.test(p.approvalSha256??''))
  die('Missing digest');
for(const time of [p.generatedAt,p.input?.sourceAt,p.input?.priceAt]){
  const elapsed=Date.now()-Date.parse(time);
  if(!Number.isFinite(elapsed)||elapsed<0||elapsed>36*3600_000)die('Stale evidence');
}
const ids=new Set(),games=new Set();
for(let i=0;i<p.changes.length;i++){
  const c=p.changes[i],before=p.beforeSnapshots[i];
  const nsuid=String(c.nsuid??'');
  if(!/^7001\d{10}$/.test(nsuid)||ids.has(nsuid)||games.has(c.gameId)||
     !/^[a-f0-9-]{36}$/i.test(c.gameId??''))die('Invalid, duplicated, or unsafe game identity');
  ids.add(nsuid);games.add(c.gameId);
  if(before.gameId!==c.gameId||before.nsuid!==nsuid||before.slug!==c.slug)
    die('Before/after snapshot identities differ');
  const patch=c.patch;
  if(!patch||typeof patch!=='object')die('Missing patch');
  const allowed=['title_zh','title_en','is_unnamed','cover_url'];
  if(Object.keys(patch).some(k=>!allowed.includes(k)))die('Unauthorized column');
  if('cover_url' in patch){
    let u;
    try{u=new URL(patch.cover_url);}catch{die('Bad cover URL');}
    if(u.protocol!=='https:'||u.hostname!=='images.ctfassets.net')
      die('Non-official image');
    if(before.cover_url!==null&&before.cover_url!=='/covers/placeholder.svg')
      die('Would overwrite custom artwork');
  }
  if(patch.is_unnamed===false){
    if(before.is_unnamed!==true||!['tw-'+nsuid,'hk-'+nsuid].includes(c.slug))
      die('Would rename an existing named or differently identified product');
    if(typeof patch.title_zh!=='string'||!patch.title_zh.trim()||patch.title_zh.length>500)
      die('Missing official title');
    // Supabase games.title_en is NOT NULL. For placeholders, mirror the
    // exact same verified TW title; never introduce guessed English.
    if(patch.title_en!==undefined && patch.title_en!==patch.title_zh)
      die('English title may only mirror verified TW title for NOT NULL column');
    const oldTitle=String(before.title_zh??'').trim();
    if(oldTitle&&![
      '未命名商品 '+nsuid,'未命名遊戲 '+nsuid,'未知商品 '+nsuid,
      '未命名商品','未知商品'
    ].includes(oldTitle))die('Would overwrite a non-placeholder');
  }else{
    // Only cover-only patch on a confirmed named game.
    if(before.is_unnamed!==false || Object.keys(patch).length!==1 ||
       !('cover_url' in patch))die('Unsafe cover-only update');
  }
}
if(digestOnly){
  process.stdout.write(p.eligibleChanges===0?'NONE\n':p.approvalSha256+'\n');
}else{
  console.log(JSON.stringify({
    verified:true,eligibleChanges:p.eligibleChanges,
    deferredCandidates:p.deferredCandidates,skipped:p.skippedCount,
    digest:p.approvalSha256,mode:'SAFE_PREVIEW'
  }));
}
