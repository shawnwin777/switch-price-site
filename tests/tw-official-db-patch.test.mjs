import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTwBackfillChanges,PLACEHOLDER} from '../scripts/lib/tw-official-db-patch.mjs';
const id='70010000012345';
const photo='https://images.ctfassets.net/o5v89n4kg6h4/example/pic.jpg';
const plan={complete:true,mode:'READ_ONLY_NO_SUPABASE',candidates:[{
  nsuid:id,proposedTitleZh:'官方中文遊戲名稱',officialImageUrl:photo,
  status:'exact_nsuid_pending_review',source:'official'}]};
const games=[{id:'aaa',slug:'tw-'+id,title_zh:'未命名遊戲',cover_url:PLACEHOLDER,is_unnamed:true,product_type:'game'}];
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
