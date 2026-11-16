// scripts/probe-count-gaps3.mjs
// 第三輪：EU 系統 token 計數＋多段隨機抽樣；JP sform/05_BEE 拆解；NA nsuid 區間 filters。
// 只用任天堂官方端點；節流 250-400ms。
// 用法：node scripts/probe-count-gaps3.mjs

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

async function solr(pairs) {
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const res = await fetch(`https://search.nintendo-europe.com/en/select?${qs}`, { headers: UA, signal: AbortSignal.timeout(30000) });
  const j = await res.json();
  await sleep(300);
  return j;
}

async function main() {
  // ---------- EU：系統 token 計數 ----------
  console.log('== EU 系統 token 計數 ==');
  const count = async (label, fqPairs) => {
    const j = await solr([['q', '*:*'], ['rows', '0'], ['wt', 'json'], ...fqPairs.map((f) => ['fq', f])]);
    out.eu[label] = j.response?.numFound;
    console.log(`${label}: ${j.response?.numFound}`);
    return j.response?.numFound;
  };
  await count('GAME_nsuid_token_switch', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:switch']);
  await count('GAME_nsuid_token_2', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:2']);
  await count('GAME_nsuid_token_switch_NOT_2', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:switch', '-system_names_txt:2']);
  await count('GAME_nsuid_token_3ds', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:3ds']);
  await count('GAME_nsuid_NO_switch_token', ['type:GAME', 'nsuid_txt:*', '-system_names_txt:switch']);
  await count('DLC_nsuid_token_switch', ['type:DLC', 'nsuid_txt:*', 'system_names_txt:switch']);
  await count('DLC_nsuid_token_2', ['type:DLC', 'nsuid_txt:*', 'system_names_txt:2']);
  // 驗證 token:2 是否真是 Switch 2：抓瑪利歐賽車世界文件
  const mkw = await solr([['q', 'Mario Kart World'], ['rows', '3'], ['wt', 'json'], ['fq', 'type:GAME'], ['fl', 'title,nsuid_txt,system_names_txt']]);
  console.log('MKW 文件：', JSON.stringify(mkw.response?.docs));
  out.eu.mkwDocs = mkw.response?.docs;

  // EU 多段隨機抽樣：3 段 × 40 GAME + 1 段 × 40 DLC，查 5 國
  console.log('\n== EU 多段抽樣 ==');
  const total = 20217;
  const countries = ['GB', 'CZ', 'HU', 'CH', 'DK'];
  const allSamples = [];
  for (const start of [5000, 12000, 19000]) {
    const docs = await solr([['q', '*:*'], ['rows', '40'], ['start', String(start)], ['wt', 'json'], ['fq', 'type:GAME'], ['fq', 'nsuid_txt:*'], ['fl', 'title,nsuid_txt,system_names_txt']]);
    const sample = [];
    for (const d of docs.response?.docs ?? []) {
      const id = (d.nsuid_txt || []).find((x) => String(x).startsWith('7001'));
      if (id) sample.push({ title: d.title, nsuid: String(id), systems: d.system_names_txt || [] });
    }
    allSamples.push({ start, sample });
    console.log(`GAME start=${start}：抽到 ${sample.length} 款`);
  }
  // DLC 抽樣
  const dlcDocs = await solr([['q', '*:*'], ['rows', '40'], ['start', '5000'], ['wt', 'json'], ['fq', 'type:DLC'], ['fq', 'nsuid_txt:*'], ['fl', 'title,nsuid_txt,system_names_txt']]);
  const dlcSample = [];
  for (const d of dlcDocs.response?.docs ?? []) {
    const id = (d.nsuid_txt || []).find((x) => String(x).startsWith('7007') || String(x).startsWith('7005'));
    if (id) dlcSample.push({ title: d.title, nsuid: String(id), systems: d.system_names_txt || [] });
  }
  console.log(`DLC start=5000：抽到 ${dlcSample.length} 款`);
  const flatGame = allSamples.flatMap((s) => s.sample);
  const priceByCountry = {};
  for (const cc of countries) priceByCountry[cc] = await fetchPrices(cc, flatGame.map((s) => s.nsuid));
  out.eu.multiSample = { samples: allSamples, priceByCountry };
  for (const cc of countries) {
    const vals = Object.values(priceByCountry[cc]);
    console.log(`GAME 合計 n=${flatGame.length} ${cc}: onsale=${vals.filter((v) => v === 'onsale').length} not_found=${vals.filter((v) => v === 'not_found').length} other=${vals.filter((v) => v !== 'onsale' && v !== 'not_found').length} 未回傳=${flatGame.length - vals.length}`);
  }
  // 分段看
  for (const { start, sample } of allSamples) {
    console.log(`  [start=${start} n=${sample.length}] ` + countries.map((cc) => `${cc} ${sample.filter((s) => priceByCountry[cc][s.nsuid] === 'onsale').length}/${sample.length}`).join('  '));
  }
  // DLC 有價
  const dlcPrice = {};
  for (const cc of countries) dlcPrice[cc] = await fetchPrices(cc, dlcSample.map((s) => s.nsuid));
  out.eu.dlcSample = { sample: dlcSample, priceByCountry: dlcPrice };
  for (const cc of countries) {
    const vals = Object.values(dlcPrice[cc]);
    console.log(`DLC n=${dlcSample.length} ${cc}: onsale=${vals.filter((v) => v === 'onsale').length} not_found=${vals.filter((v) => v === 'not_found').length} other=${vals.filter((v) => v !== 'onsale' && v !== 'not_found').length} 未回傳=${dlcSample.length - vals.length}`);
  }

  // ---------- JP：sform 拆解 + 05_BEE 抽樣 ----------
  console.log('\n== JP sform / 05_BEE 拆解 ==');
  const jpProbe = async (params) => {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`https://search.nintendo.jp/nintendo_soft/search.json?${qs}`, { headers: UA, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    await sleep(300);
    return j;
  };
  // 1_HAC 隨機 6 頁，記 sform × prefix
  const clsHAC = { items: 0, byPrefixSform: {}, bySform: {}, ssitu: {}, sctg: {}, upgrade: {} };
  const pagesHAC = [...new Set(Array.from({ length: 6 }, () => 1 + Math.floor(Math.random() * 200)))];
  for (const p of pagesHAC) {
    const j = await jpProbe({ q: '', limit: '150', page: String(p), opt_hard: '1_HAC' });
    for (const it of j.result?.items || []) {
      clsHAC.items++;
      const pre = it.nsuid ? String(it.nsuid).slice(0, 4) : 'null';
      const key = `${pre}|${it.sform || 'null'}`;
      clsHAC.byPrefixSform[key] = (clsHAC.byPrefixSform[key] || 0) + 1;
      clsHAC.bySform[it.sform || 'null'] = (clsHAC.bySform[it.sform || 'null'] || 0) + 1;
      clsHAC.ssitu[it.ssitu] = (clsHAC.ssitu[it.ssitu] || 0) + 1;
      clsHAC.sctg[it.sctg || 'null'] = (clsHAC.sctg[it.sctg || 'null'] || 0) + 1;
      clsHAC.upgrade[String(it.upgrade)] = (clsHAC.upgrade[String(it.upgrade)] || 0) + 1;
    }
    console.log(`  HAC page ${p}: 累計 ${clsHAC.items}`);
  }
  out.jp.sformHAC = clsHAC;
  console.log('HAC byPrefix|sform:', JSON.stringify(clsHAC.byPrefixSform));
  console.log('HAC bySform:', JSON.stringify(clsHAC.bySform));
  console.log('HAC sctg:', JSON.stringify(clsHAC.sctg), 'upgrade:', JSON.stringify(clsHAC.upgrade));
  // 05_BEE 隨機 6 頁
  const totalBEE = 2181;
  const pagesBEE = Math.ceil(totalBEE / 150);
  const clsBEE = { items: 0, byPrefixSform: {}, bySform: {}, ssitu: {}, nsuidPrefix: {} };
  const randBEE = [...new Set(Array.from({ length: 6 }, () => 1 + Math.floor(Math.random() * pagesBEE)))];
  for (const p of randBEE) {
    const j = await jpProbe({ q: '', limit: '150', page: String(p), opt_hard: '05_BEE' });
    for (const it of j.result?.items || []) {
      clsBEE.items++;
      const pre = it.nsuid ? String(it.nsuid).slice(0, 4) : 'null';
      clsBEE.nsuidPrefix[pre] = (clsBEE.nsuidPrefix[pre] || 0) + 1;
      clsBEE.byPrefixSform[`${pre}|${it.sform || 'null'}`] = (clsBEE.byPrefixSform[`${pre}|${it.sform || 'null'}`] || 0) + 1;
      clsBEE.bySform[it.sform || 'null'] = (clsBEE.bySform[it.sform || 'null'] || 0) + 1;
      clsBEE.ssitu[it.ssitu] = (clsBEE.ssitu[it.ssitu] || 0) + 1;
    }
    console.log(`  BEE page ${p}/${pagesBEE}: 累計 ${clsBEE.items}`);
  }
  out.jp.sformBEE = clsBEE;
  console.log('BEE byPrefix|sform:', JSON.stringify(clsBEE.byPrefixSform));
  console.log('BEE ssitu:', JSON.stringify(clsBEE.ssitu));
  // 無 opt 隨機頁：hard 分佈（檢查 36,331 vs 各 hard 加總差 1,534）
  const clsAll = { items: 0, hard: {} };
  const randAll = [...new Set(Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 243)))];
  for (const p of randAll) {
    const j = await jpProbe({ q: '', limit: '150', page: String(p) });
    for (const it of j.result?.items || []) { clsAll.items++; clsAll.hard[it.hard || 'null'] = (clsAll.hard[it.hard || 'null'] || 0) + 1; }
  }
  out.jp.hardAll = clsAll;
  console.log('無 opt 隨機頁 hard 分佈:', JSON.stringify(clsAll.hard), 'n=', clsAll.items);

  // ---------- NA：nsuid 區間 filters ----------
  console.log('\n== NA nsuid 區間 filters ==');
  const AM_APP = 'U3B6GR4UA3';
  const AM_KEY = 'a29c6927638bfd8cee23993e51e721c9';
  const algoliaQuery = async (index, params) => {
    const res = await fetch(`https://${AM_APP}-dsn.algolia.net/1/indexes/${index}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': AM_APP, 'X-Algolia-API-Key': AM_KEY },
      body: JSON.stringify({ params }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    await sleep(300);
    return { status: res.status, data };
  };
  const rangeCount = async (loc, lo, hi) => {
    const params = new URLSearchParams({ query: '', hitsPerPage: '0', filters: `nsuid>=${lo} AND nsuid<${hi}` }).toString();
    const r = await algoliaQuery(`store_all_products_${loc}`, params);
    console.log(`${loc} nsuid [${lo},${hi}): HTTP ${r.status} nbHits=${r.data?.nbHits} ${r.data?.message || ''}`);
    return r.data?.nbHits;
  };
  out.na.range = {};
  for (const loc of ['en_us', 'en_ca']) {
    out.na.range[loc] = {
      '7001': await rangeCount(loc, 70010000000000, 70020000000000),
      '7005': await rangeCount(loc, 70050000000000, 70060000000000),
      '7007': await rangeCount(loc, 70070000000000, 70080000000000),
    };
  }
  // 7001 + productType=Games 的交集（filters 雙條件）
  for (const loc of ['en_us', 'en_ca']) {
    const params = new URLSearchParams({ query: '', hitsPerPage: '0', filters: 'nsuid>=70010000000000 AND nsuid<70020000000000 AND productType:Games' }).toString();
    const r = await algoliaQuery(`store_all_products_${loc}`, params);
    out.na.range[loc]['7001_Games'] = r.data?.nbHits;
    console.log(`${loc} 7001 AND productType:Games: nbHits=${r.data?.nbHits} ${r.data?.message || ''}`);
    const params2 = new URLSearchParams({ query: '', hitsPerPage: '0', filters: 'nsuid>=70070000000000 AND nsuid<70080000000000 AND productType:Games' }).toString();
    const r2 = await algoliaQuery(`store_all_products_${loc}`, params2);
    out.na.range[loc]['7007_Games'] = r2.data?.nbHits;
    console.log(`${loc} 7007 AND productType:Games: nbHits=${r2.data?.nbHits}`);
  }
  // 取 50 個 7001 Games nsuid 樣本（用 7001 區間 filter + hitsPerPage=1000 取第一頁，隨機抽）
  const params = new URLSearchParams({ query: '', hitsPerPage: '1000', page: '0', filters: 'nsuid>=70010000000000 AND nsuid<70020000000000 AND productType:Games' }).toString();
  const r = await algoliaQuery('store_all_products_en_us', params);
  const ids = (r.data?.hits ?? []).map((h) => String(h.nsuid)).filter(Boolean);
  console.log(`7001 Games 第一頁取回 ${ids.length} 個 nsuid（去重 ${new Set(ids).size}）`);
  const sampleNA = [...new Set(ids)].sort(() => Math.random() - 0.5).slice(0, 50);
  out.na.priceSample = sampleNA;
  const usP = await fetchPrices('US', sampleNA);
  const caP = await fetchPrices('CA', sampleNA);
  const tally = (m) => ({ onsale: Object.values(m).filter((v) => v === 'onsale').length, not_found: Object.values(m).filter((v) => v === 'not_found').length, other: Object.values(m).filter((v) => v !== 'onsale' && v !== 'not_found').length, missing: sampleNA.length - Object.keys(m).length });
  out.na.priceSampleResult = { US: tally(usP), CA: tally(caP), caOnlyOnsale: sampleNA.filter((id) => caP[id] === 'onsale' && usP[id] !== 'onsale').length, usOnlyOnsale: sampleNA.filter((id) => usP[id] === 'onsale' && caP[id] !== 'onsale').length };
  console.log('NA 抽 50 款 US:', JSON.stringify(out.na.priceSampleResult.US), 'CA:', JSON.stringify(out.na.priceSampleResult.CA));
  const caMissing = sampleNA.filter((id) => usP[id] === 'onsale' && caP[id] !== 'onsale').slice(0, 10);
  console.log('US 有價但 CA 無價範例：', JSON.stringify(caMissing.map((id) => ({ id, us: usP[id], ca: caP[id] }))));

  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/count-gaps3.json', JSON.stringify(out, null, 2));
  console.log('\n已寫 /tmp/count-gaps3.json');
}

main().catch((err) => { console.error(err); process.exit(1); });
