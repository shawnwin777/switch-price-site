import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTwBackfillChanges,planLiveTwBackfill,PLACEHOLDER} from '../scripts/lib/tw-official-db-patch.mjs';
const id='70010000012345';
const photo='https://images.ctfassets.net/o5v89n4kg6h4/example/pic.jpg';
const officialSource='https://www.nintendo.com/tw/api/software?sftab=all';
const plan={complete:true,mode:'READ_ONLY_NO_SUPABASE',candidates:[{
  nsuid:id,proposedTitleZh:'官方中文遊戲名稱',officialImageUrl:photo,
  status:'exact_nsuid_pending_review',source:officialSource}]};
const games=[{id:'aaa',slug:'tw-'+id,title_zh:'未命名商品 '+id,cover_url:PLACEHOLDER,is_unnamed:true,product_type:'game'}];
const region=[{game_id:'aaa',country:'TW',title_id:id}];
test('protects placeholder and creates an exact TW name+cover proposal',()=>{
  const result=buildTwBackfillChanges(plan,games,region);
  assert.equal(result.changes.length,1);
  assert.equal(result.changes[0].patch.title_zh,'官方中文遊戲名稱');
  assert.equal(result.changes[0].patch.cover_url,photo);
  assert.equal(result.changes[0].patch.is_unnamed,false);
});
test('does not change already named games, DLC, or ambiguous identifiers',()=>{
  assert.equal(buildTwBackfillChanges(plan,[{...games[0],is_unnamed:false}],region).changes.length,0);
  assert.equal(buildTwBackfillChanges(plan,[{...games[0],product_type:'dlc'}],region).changes.length,0);
  assert.equal(buildTwBackfillChanges(plan,games,[...region,{game_id:'bbb',country:'TW',title_id:id}]).changes.length,0);
});
test('does not overwrite existing custom art or accept nonofficial images',()=>{
  const rec=buildTwBackfillChanges(plan,[{...games[0],cover_url:'/covers/custom.jpg'}],region).changes[0];
  assert.equal('cover_url' in rec.patch,false);
  assert.equal(buildTwBackfillChanges({...plan,candidates:[{...plan.candidates[0],officialImageUrl:'https://untrusted.example/pic'}]},games,region).changes.length,0);
});
test('fails closed on invalid plan and explicit write cap',()=>{
  assert.throws(()=>buildTwBackfillChanges({...plan,complete:false},games,region),/complete/);
  assert.throws(()=>buildTwBackfillChanges(plan,games,region,0),/maxWrites/);
});

test('does not overwrite a non-placeholder even when flagged unnamed',()=>{
  const bad=[{...games[0],title_zh:'玩家自行輸入的遊戲名稱'}];
  const result=buildTwBackfillChanges(plan,bad,region);
  assert.equal(result.changes.length,0);
  assert.equal(result.skipped[0].reason,'existing_nonplaceholder_title');
});
test('converts placeholder English NSUID to empty, not duplicate Chinese translation',()=>{
  const current=[{...games[0],title_en:id}];
  const result=buildTwBackfillChanges(plan,current,region);
  assert.equal(result.changes[0].patch.title_en,null);
});
test('generates safe proposal from live TW IDs without old snapshot',()=>{
  const catalog={
    complete:true,schemaVersion:1,source:officialSource,
    fetchedAt:new Date().toISOString(),records:{[id]:{
      nsuid:id,title:'官方中文遊戲名稱',imageUrl:photo,
      hardwareCategory:'Nintendo Switch',publisher:'任天堂',
    }},conflicts:{}
  };
  const freshPrices={complete:true,scope:'full_official_catalog',
    generatedAt:new Date().toISOString(),prices:{[id]:{sales_status:'onsale'}}};
  const proposal=planLiveTwBackfill(catalog,freshPrices,games,region);
  assert.equal(proposal.candidates.length,1);
  assert.equal(proposal.candidates[0].nsuid,id);
  assert.equal(buildTwBackfillChanges(proposal,games,region,10,freshPrices).changes.length,1);
  assert.throws(()=>planLiveTwBackfill({...catalog,complete:false},freshPrices,games,region),/complete/);
  assert.equal(planLiveTwBackfill(catalog,{...freshPrices,prices:{[id]:{sales_status:'not_found'}}},games,region).candidates.length,0);
});

test('cover-only live proposal never changes existing named title',()=>{
  const catalog={
    complete:true,schemaVersion:1,source:officialSource,
    fetchedAt:new Date().toISOString(),records:{[id]:{
      nsuid:id,title:'官方中文遊戲名稱',imageUrl:photo,
      hardwareCategory:'Nintendo Switch',publisher:'任天堂',
    }},conflicts:{}
  };
  const freshPrices={complete:true,scope:'full_official_catalog',
    generatedAt:new Date().toISOString(),prices:{[id]:{sales_status:'onsale'}}};
  const named=[{...games[0],is_unnamed:false,title_zh:'已翻譯的繁體中文名稱',cover_url:null}];
  const plan=planLiveTwBackfill(catalog,freshPrices,named,region);
  assert.equal(plan.candidates[0].status,'exact_nsuid_cover_only_review');
  const patched=buildTwBackfillChanges(plan,named,region,10,freshPrices);
  assert.equal(patched.changes.length,1);
  assert.deepEqual(patched.changes[0].patch,{cover_url:photo});
  assert.equal(patched.changes[0].before.is_unnamed,false);
  const noOverwrite=planLiveTwBackfill(catalog,freshPrices,[{...named[0],cover_url:'/my/custom.png'}],region);
  assert.equal(noOverwrite.candidates.length,0);
});
test('named-only cover update rejected without trustworthy Nintendo image',()=>{
  const bad={
    complete:true,mode:'READ_ONLY_NO_SUPABASE',candidates:[{
      nsuid:id,proposedTitleZh:'官方中文遊戲名稱',officialImageUrl:'https://not-nintendo.example/x.jpg',
      status:'exact_nsuid_cover_only_review',source:officialSource
    }]
  };
  const named=[{...games[0],is_unnamed:false,title_zh:'既有名稱',cover_url:null}];
  assert.equal(buildTwBackfillChanges(bad,named,region).changes.length,0);
});
