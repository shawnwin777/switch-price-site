import test from 'node:test';
import assert from 'node:assert/strict';
import {
  officialImageUrl, parseTwOfficialItem, catalogFromPages, planTwExactBackfill,
} from '../scripts/lib/tw-official-catalog.mjs';

function id(n, prefix = '7001') { return prefix + String(n).padStart(10, '0'); }
const image = 'https://images.ctfassets.net/o5v89n4kg6h4/demo/cover.jpg?w=400&fm=webp';
function item(n, opts = {}) {
  return {nsuid:id(n),title:'測試遊戲 ' + n,hardwareCategory:'Nintendo Switch',
    imageHero:{url:image},...opts};
}
function pages() {
  const items=Array.from({length:26},(_,i)=>item(i+1));
  return [
    {total:26,items:items.slice(0,24)},
    {total:26,items:items.slice(24)},
  ];
}

test('accept only trusted official image domain and exact 14-digit NSUID',()=>{
  assert.equal(officialImageUrl(image),image);
  assert.equal(officialImageUrl('https://evil.example/image.jpg'),null);
  assert.equal(officialImageUrl('http://images.ctfassets.net/a.jpg'),null);
  assert.equal(parseTwOfficialItem(item(1)).nsuid,id(1));
  assert.equal(parseTwOfficialItem({...item(1),nsuid:'not-an-id'}),null);
});

test('reject incomplete pages and report title conflicts rather than overwriting',()=>{
  const p=pages();
  assert.throws(()=>catalogFromPages([p[0]]),/Incomplete/);
  const index=catalogFromPages(p);
  assert.equal(index.officialTotal,26);
  assert.equal(index.distinctNsuids,26);
  assert.equal(index.imageRows,26);
  const collision=pages();
  collision[1].items[0]={...item(1),title:'完全不同遊戲'};
  const disputed=catalogFromPages(collision);
  assert.equal(disputed.conflicts[id(1)].length,2);
});

test('only TW onsale exact-NSUID unnamed base records become candidates',()=>{
  const index=catalogFromPages(pages());
  const scan={
    generated_at:'2026-11-16T00:00:00Z',
    games:{
      first:{twTitleId:id(1),twPrice:{sales_status:'onsale'},titleZh:null,titleEn:null},
      named:{twTitleId:id(2),twPrice:{sales_status:'onsale'},titleZh:'既有名稱'},
      notSold:{twTitleId:id(3),twPrice:{sales_status:'not_found'},titleZh:null},
      unknown:{twTitleId:id(999),twPrice:{sales_status:'onsale'},titleZh:null},
      dlc:{twTitleId:id(1,'7005'),twPrice:{sales_status:'onsale'},titleZh:null},
      otherRegion:{hkTitleId:id(4),hkPrice:{sales_status:'onsale'},titleZh:null},
    },
  };
  const plan=planTwExactBackfill(scan,index);
  assert.equal(plan.mode,'READ_ONLY_NO_SUPABASE');
  assert.equal(plan.summary.exactNsuidUnnamedNameCandidates,1);
  assert.equal(plan.summary.exactNsuidNameAndImageCandidates,1);
  assert.equal(plan.summary.classifiedSeparately,1);
  assert.equal(plan.summary.alreadyNamed,1);
  assert.equal(plan.summary.absentFromOfficial,1);
  assert.equal(plan.candidates[0].nsuid,id(1));
  assert.equal(plan.candidates[0].officialImageUrl,image);
  assert.equal(plan.candidates[0].status,'exact_nsuid_pending_review');
  assert.throws(()=>planTwExactBackfill(scan,{complete:false}),/fully validated/);
});

test('conflicting exact NSUID is not suggested for automatic use',()=>{
  const p=pages();
  p[1].items[0]={...item(1),title:'其他版本'};
  const index=catalogFromPages(p);
  const scan={games:{a:{twTitleId:id(1),twPrice:{sales_status:'onsale'},titleZh:null}}};
  const plan=planTwExactBackfill(scan,index);
  assert.equal(plan.candidates.length,0);
  assert.equal(plan.conflicts.length,1);
});
