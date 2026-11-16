// scripts/probe-count-gaps2.mjs
// 第二輪：修正第一輪的工具問題（Solr 多值參數、Algolia 分頁上限 1000、JP 欄位檢查）。
// 只用任天堂官方端點；節流 250-400ms。
// 用法：node scripts/probe-count-gaps2.mjs

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRICE_API = 'https://api.ec.nintendo.com/v1/price';
const out = { generated_at: new Date().toISOString(), eu: {}, jp: {}, na: {} };

function langFor(c) { if (c === 'JP') return 'ja'; if (c === 'TW' || c === 'HK') return 'zh'; return 'en'; }

async function fetchPrices(country, ids) {
  const resMap = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    let data = null;
    for (let a = 0; a < 3 && !data; a++) {
      try {
        const res = await fetch(`${PRICE_API}?country=${country}&ids=${chunk.join(',')}&lang=${langFor(country)}`, { headers: { 'User-Agent': 'switch-price-site/1.0 (count-gap probe)' }, signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch { await sleep(1200); }
    }
    if (!data) continue;
    for (const p of data?.prices ?? []) resMap[String(p.title_id)] = p.sales_status;
    await sleep(300);
  }
  return resMap;
}

// Solr：手動組 query string，支援重複 fq / facet.field
async function solr(pairs) {
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`https://search.nintendo-europe.com/en/select?${qs}`, { headers: UA, signal: AbortSignal.timeout(30000) });
  const j = await res.json();
  await sleep(300);
  return j;
}
const toObj = (arr) => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };

async function main() {
  // ---------- 1. EU Solr ----------
  console.log('== EU Solr type / system facet ==');
  const facet = await solr([['q', '*:*'], ['rows', '0'], ['wt', 'json'], ['facet', 'true'], ['facet.field', 'type'], ['facet.field', 'system_names_txt'], ['facet.field', 'eshop_removed_b'], ['facet.limit', '60']]);
  out.eu.typeFacet = toObj(facet.facet_counts?.facet_fields?.type);
  out.eu.systemFacet = toObj(facet.facet_counts?.facet_fields?.system_names_txt);
  out.eu.removedFacet = toObj(facet.facet_counts?.facet_fields?.eshop_removed_b);
  console.log('type:', JSON.stringify(out.eu.typeFacet));
  console.log('system:', JSON.stringify(out.eu.systemFacet));
  console.log('eshop_removed:', JSON.stringify(out.eu.removedFacet));

  const count = async (label, fqPairs) => {
    const j = await solr([['q', '*:*'], ['rows', '0'], ['wt', 'json'], ...fqPairs.map((f) => ['fq', f])]);
    out.eu[label] = j.response?.numFound;
    console.log(`${label}: ${j.response?.numFound}`);
    return j.response?.numFound;
  };
  await count('GAME_total', ['type:GAME']);
  await count('GAME_with_nsuid', ['type:GAME', 'nsuid_txt:*']);
  await count('GAME_no_nsuid', ['type:GAME', '-nsuid_txt:*']);
  await count('DLC_total', ['type:DLC']);
  await count('DLC_with_nsuid', ['type:DLC', 'nsuid_txt:*']);
  await count('GAME_with_nsuid_not_removed', ['type:GAME', 'nsuid_txt:*', '-eshop_removed_b:true']);
  await count('GAME_with_nsuid_removed', ['type:GAME', 'nsuid_txt:*', 'eshop_removed_b:true']);
  await count('GAME_with_nsuid_Switch', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:"Nintendo Switch"']);
  await count('GAME_with_nsuid_Switch2', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:"Nintendo Switch 2"']);
  await count('GAME_with_nsuid_Switch_only_not_S2', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:"Nintendo Switch"', '-system_names_txt:"Nintendo Switch 2"']);
  await count('GAME_with_nsuid_S2_only_not_S1', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:"Nintendo Switch 2"', '-system_names_txt:"Nintendo Switch"']);
  await count('DLC_with_nsuid_not_removed', ['type:DLC', 'nsuid_txt:*', '-eshop_removed_b:true']);

  // 抽樣：隨機 start 取 40 個 GAME nsuid（含系統資訊），查 5 國有價
  console.log('\n== EU 抽樣 40 款查 GB/CZ/HU/CH/DK ==');
  const total = out.eu.GAME_with_nsuid;
  const start = Math.floor(Math.random() * (total - 100));
  const docs = await solr([['q', '*:*'], ['rows', '40'], ['start', String(start)], ['wt', 'json'], ['fq', 'type:GAME'], ['fq', 'nsuid_txt:*'], ['fl', 'title,nsuid_txt,system_names_txt,eshop_removed_b']]);
  const sample = [];
  for (const d of docs.response?.docs ?? []) {
    const id = (d.nsuid_txt || []).find((x) => String(x).startsWith('7001'));
    if (id) sample.push({ title: d.title, nsuid: String(id), systems: d.system_names_txt || [], removed: !!d.eshop_removed_b });
  }
  out.eu.sampleStart = start;
  out.eu.sample = sample;
  console.log(`start=${start}，抽到 ${sample.length} 款`);
  const countries = ['GB', 'CZ', 'HU', 'CH', 'DK'];
  const priceByCountry = {};
  for (const cc of countries) priceByCountry[cc] = await fetchPrices(cc, sample.map((s) => s.nsuid));
  out.eu.priceByCountry = priceByCountry;
  for (const cc of countries) {
    const vals = Object.values(priceByCountry[cc]);
    console.log(`${cc}: onsale=${vals.filter((v) => v === 'onsale').length} not_found=${vals.filter((v) => v === 'not_found').length} other=${vals.filter((v) => v !== 'onsale' && v !== 'not_found').length} 未回傳=${sample.length - vals.length} / ${sample.length}`);
  }
  for (const [label, pred] of [
    ['Switch 2（含）', (s) => s.systems.includes('Nintendo Switch 2')],
    ['僅 Switch 1', (s) => !s.systems.includes('Nintendo Switch 2')],
    ['eshop_removed', (s) => s.removed],
  ]) {
    const sub = sample.filter(pred);
    if (!sub.length) continue;
    console.log(`  [${label} n=${sub.length}] ` + countries.map((cc) => `${cc} ${sub.filter((s) => priceByCountry[cc][s.nsuid] === 'onsale').length}/${sub.length}`).join('  '));
  }
  // 逐款明細：哪些在 HU/CH/DK 缺價
  const missingInLow = sample.filter((s) => priceByCountry.GB[s.nsuid] === 'onsale' && (priceByCountry.HU[s.nsuid] !== 'onsale' || priceByCountry.CH[s.nsuid] !== 'onsale' || priceByCountry.DK[s.nsuid] !== 'onsale'));
  out.eu.gbOnsaleButMissingInLowCount = missingInLow.length;
  console.log(`GB 有價但 HU/CH/DK 至少一國缺價：${missingInLow.length} 款`);
  for (const s of missingInLow.slice(0, 15)) console.log(`  - ${s.title} ${s.nsuid} [${s.systems.join('/')}] GB=${priceByCountry.GB[s.nsuid]} CZ=${priceByCountry.CZ[s.nsuid]} HU=${priceByCountry.HU[s.nsuid]} CH=${priceByCountry.CH[s.nsuid]} DK=${priceByCountry.DK[s.nsuid]}`);

  // ---------- 2. JP：欄位檢查 + 無偏抽樣 ----------
  console.log('\n== JP 搜尋 API 欄位檢查 ==');
  const jpProbe = async (params) => {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`https://search.nintendo.jp/nintendo_soft/search.json?${qs}`, { headers: UA, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    await sleep(300);
    return j;
  };
  const one = await jpProbe({ q: '', limit: '3', page: '1' });
  const item0 = (one.result?.items || [])[0];
  out.jp.itemFields = item0 ? Object.keys(item0) : [];
  out.jp.itemExample = item0;
  console.log('item 欄位：', JSON.stringify(out.jp.itemFields));
  console.log('item 範例：', JSON.stringify(item0));
  // 各 hard 總數
  for (const opt of ['1_HAC', '05_BEE', '2_CTR', '4_WUP']) {
    const j = await jpProbe({ q: '', limit: '1', page: '1', opt_hard: opt });
    out.jp[`total_opt_${opt}`] = j.result?.total;
    console.log(`total opt_hard=${opt}: ${j.result?.total}`);
  }
  const totalNoOpt = (await jpProbe({ q: '', limit: '1', page: '1' })).result?.total;
  out.jp.total_no_opt = totalNoOpt;
  console.log('total 無 opt:', totalNoOpt);
  // 無偏抽樣：opt_hard=1_HAC，隨機 10 頁 × 150
  const totalHAC = out.jp.total_opt_1_HAC;
  const pagesHAC = Math.ceil(totalHAC / 150);
  const randPages = [...new Set(Array.from({ length: 10 }, () => 1 + Math.floor(Math.random() * pagesHAC)))];
  const cls = { items: 0, uniqueNsuid: new Set(), nullNsuid: 0, dupNsuid: 0, ssitu: {}, hard: {}, nsuidPrefix: {} };
  const seen = new Set();
  const ex = { nullNsuid: [], dup: [], notOnsale: [] };
  for (const p of randPages) {
    const j = await jpProbe({ q: '', limit: '150', page: String(p), opt_hard: '1_HAC' });
    for (const it of j.result?.items || []) {
      cls.items++;
      cls.ssitu[it.ssitu] = (cls.ssitu[it.ssitu] || 0) + 1;
      cls.hard[it.hard] = (cls.hard[it.hard] || 0) + 1;
      if (it.nsuid) cls.nsuidPrefix[String(it.nsuid).slice(0, 4)] = (cls.nsuidPrefix[String(it.nsuid).slice(0, 4)] || 0) + 1;
      if (!it.nsuid) { cls.nullNsuid++; if (ex.nullNsuid.length < 5) ex.nullNsuid.push({ id: it.id, title: it.title, ssitu: it.ssitu }); }
      else if (seen.has(String(it.nsuid))) { cls.dupNsuid++; if (ex.dup.length < 5) ex.dup.push({ id: it.id, title: it.title, nsuid: it.nsuid }); }
      else { seen.add(String(it.nsuid)); cls.uniqueNsuid.add(String(it.nsuid)); }
      if (it.ssitu !== 'onsale' && ex.notOnsale.length < 8) ex.notOnsale.push({ id: it.id, title: it.title, nsuid: it.nsuid, ssitu: it.ssitu });
    }
    console.log(`  HAC page ${p}/${pagesHAC}: 累計 ${cls.items}`);
  }
  out.jp.sampleHAC = { pages: randPages, items: cls.items, uniqueNsuid: cls.uniqueNsuid.size, nullNsuid: cls.nullNsuid, dupNsuid: cls.dupNsuid, ssitu: cls.ssitu, hard: cls.hard, nsuidPrefix: cls.nsuidPrefix, examples: ex };
  console.log('JP HAC 抽樣:', JSON.stringify(out.jp.sampleHAC));

  // ---------- 3. NA Algolia：browse 全量列舉 ----------
  console.log('\n== NA Algolia browse 全量 ==');
  const AM_APP = 'U3B6GR4UA3';
  const AM_KEY = 'a29c6927638bfd8cee23993e51e721c9';
  const algoliaBrowse = async (index, params, cursor) => {
    const body = { params };
    if (cursor) body.cursor = cursor;
    const res = await fetch(`https://${AM_APP}-dsn.algolia.net/1/indexes/${index}/browse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': AM_APP, 'X-Algolia-API-Key': AM_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    await sleep(300);
    return { status: res.status, data };
  };
  const counts = { productType: {}, nsuidPrefix: {}, platform: {}, total: 0, withNsuid: 0, noNsuid: 0 };
  const gameNsuids = [];
  let cursor = undefined;
  let pageN = 0;
  do {
    const r = await algoliaBrowse('store_all_products_en_us', 'query=&hitsPerPage=1000', cursor);
    const hits = r.data?.hits ?? [];
    pageN++;
    for (const h of hits) {
      counts.total++;
      counts.productType[h.productType] = (counts.productType[h.productType] || 0) + 1;
      if (h.platform) counts.platform[h.platform] = (counts.platform[h.platform] || 0) + 1;
      if (h.nsuid) {
        counts.withNsuid++;
        counts.nsuidPrefix[String(h.nsuid).slice(0, 4)] = (counts.nsuidPrefix[String(h.nsuid).slice(0, 4)] || 0) + 1;
        if (String(h.nsuid).startsWith('7001') && h.productType === 'Games') gameNsuids.push(String(h.nsuid));
      } else counts.noNsuid++;
    }
    cursor = r.data?.cursor;
    if (pageN % 10 === 0 || !cursor) console.log(`  browse page ${pageN}: 累計 ${counts.total}，cursor=${cursor ? '有' : '無'}`);
    if (pageN > 60) { console.log('  超過 60 頁，中止'); break; }
  } while (cursor);
  out.na.browse = { counts, gameNsuids7001Games: gameNsuids.length, pages: pageN };
  console.log('NA productType:', JSON.stringify(counts.productType));
  console.log('NA nsuidPrefix:', JSON.stringify(counts.nsuidPrefix));
  console.log('NA platform:', JSON.stringify(counts.platform));
  console.log('NA 7001+Games nsuid 數=', gameNsuids.length, '去重後=', new Set(gameNsuids).size);
  // en_ca 的 productType facet（nbHits 級，不用全量）
  const algoliaQuery = async (index, params) => {
    const res = await fetch(`https://${AM_APP}-dsn.algolia.net/1/indexes/${index}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': AM_APP, 'X-Algolia-API-Key': AM_KEY },
      body: JSON.stringify({ params }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    await sleep(300);
    return data;
  };
  for (const loc of ['en_us', 'en_ca', 'es_mx', 'pt_br']) {
    const d = await algoliaQuery(`store_all_products_${loc}`, 'query=&hitsPerPage=0&facets=productType');
    out.na[`facet_${loc}`] = { nbHits: d.nbHits, facets: d.facets?.productType };
    console.log(`${loc}: nbHits=${d.nbHits} productType facet=${JSON.stringify(d.facets?.productType)}`);
  }
  // CA vs US 抽 50 款
  const sampleNA = [...new Set(gameNsuids)].sort(() => Math.random() - 0.5).slice(0, 50);
  out.na.priceSample = sampleNA;
  const usP = await fetchPrices('US', sampleNA);
  const caP = await fetchPrices('CA', sampleNA);
  const tally = (m) => ({ onsale: Object.values(m).filter((v) => v === 'onsale').length, not_found: Object.values(m).filter((v) => v === 'not_found').length, other: Object.values(m).filter((v) => v !== 'onsale' && v !== 'not_found').length, missing: sampleNA.length - Object.keys(m).length });
  out.na.priceSampleResult = { US: tally(usP), CA: tally(caP), caOnlyOnsale: sampleNA.filter((id) => caP[id] === 'onsale' && usP[id] !== 'onsale').length, usOnlyOnsale: sampleNA.filter((id) => usP[id] === 'onsale' && caP[id] !== 'onsale').length };
  console.log('NA 抽 50 款 US:', JSON.stringify(out.na.priceSampleResult.US), 'CA:', JSON.stringify(out.na.priceSampleResult.CA), `CA獨有=${out.na.priceSampleResult.caOnlyOnsale} US獨有=${out.na.priceSampleResult.usOnlyOnsale}`);

  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/count-gaps2.json', JSON.stringify(out, null, 2));
  console.log('\n已寫 /tmp/count-gaps2.json');
}

main().catch((err) => { console.error(err); process.exit(1); });
