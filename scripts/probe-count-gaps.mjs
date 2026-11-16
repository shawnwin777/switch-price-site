// scripts/probe-count-gaps.mjs
// 驗證 App 各國數量 vs 官方來源數量的差距成因（2026-11-16）。
// 只用任天堂官方端點；不爬任何比價站資料庫；節流 250-400ms。
// 用法：node scripts/probe-count-gaps.mjs
// 輸出：/tmp/count-gaps.json（原始統計）＋終端摘要

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

async function solr(params) {
  const url = 'https://search.nintendo-europe.com/en/select?' + new URLSearchParams({ wt: 'json', ...params }).toString();
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  const j = await res.json();
  await sleep(300);
  return j;
}

async function main() {
  // ---------- 1. EU Solr：type facet + 各類數量 ----------
  console.log('== EU Solr type 分佈 ==');
  const facet = await solr({ q: '*:*', rows: '0', facet: 'true', 'facet.field': ['type', 'system_names_txt'], 'facet.limit': '50' });
  const typeFacet = facet.facet_counts?.facet_fields?.type ?? [];
  const sysFacet = facet.facet_counts?.facet_fields?.system_names_txt ?? [];
  const toObj = (arr) => { const o = {}; for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
  out.eu.typeFacet = toObj(typeFacet);
  out.eu.systemFacet = toObj(sysFacet);
  console.log('type:', JSON.stringify(out.eu.typeFacet));
  console.log('system_names:', JSON.stringify(out.eu.systemFacet));

  for (const t of ['GAME', 'DLC', 'BUNDLE']) {
    const j = await solr({ q: '*:*', 'fq': [`type:${t}`, 'nsuid_txt:*'], rows: '0' });
    const j2 = await solr({ q: '*:*', 'fq': `type:${t}`, rows: '0' });
    out.eu[`count_${t}_with_nsuid`] = j.response?.numFound;
    out.eu[`count_${t}_total`] = j2.response?.numFound;
    console.log(`${t}: total=${j2.response?.numFound} with_nsuid=${j.response?.numFound}`);
  }
  // GAME 且 Switch 系統（Switch / Switch 2）
  for (const [label, fq] of [
    ['GAME Switch1 only', 'type:GAME AND system_names_txt:"Nintendo Switch"'],
    ['GAME Switch2', 'type:GAME AND system_names_txt:"Nintendo Switch 2"'],
  ]) {
    const j = await solr({ q: '*:*', 'fq': [fq, 'nsuid_txt:*'], rows: '0' });
    out.eu[label] = j.response?.numFound;
    console.log(`${label}: ${j.response?.numFound}`);
  }

  // ---------- 2. EU 內部差距：抽 30 個 Solr GAME nsuid，查 5 國有價 ----------
  console.log('\n== EU 抽樣 30 款查 HU/CH/DK/CZ/GB 有價 ==');
  const docs = await solr({ q: '*:*', 'fq': ['type:GAME', 'nsuid_txt:*'], rows: '30', start: '10000', fl: 'title,nsuid_txt,system_names_txt,eshop_removed_b' });
  const sample = [];
  for (const d of docs.response?.docs ?? []) {
    const id = (d.nsuid_txt || []).find((x) => String(x).startsWith('7001'));
    if (id) sample.push({ title: d.title, nsuid: String(id), systems: d.system_names_txt || [], removed: !!d.eshop_removed_b });
  }
  out.eu.sample = sample;
  console.log(`抽到 ${sample.length} 款（start=10000）`);
  const countries = ['GB', 'CZ', 'HU', 'CH', 'DK'];
  const priceByCountry = {};
  for (const cc of countries) priceByCountry[cc] = await fetchPrices(cc, sample.map((s) => s.nsuid));
  out.eu.priceByCountry = priceByCountry;
  for (const cc of countries) {
    const vals = Object.values(priceByCountry[cc]);
    const onsale = vals.filter((v) => v === 'onsale').length;
    const notFound = vals.filter((v) => v === 'not_found').length;
    const other = vals.filter((v) => v !== 'onsale' && v !== 'not_found').length;
    const missing = sample.length - vals.length; // 價格 API 沒回該 id（通常=not_found 但未列出）
    console.log(`${cc}: onsale=${onsale} not_found=${notFound} other=${other} 未回傳=${missing} / ${sample.length}`);
  }
  // 按系統拆：Switch 2 vs Switch 1 的各國 onsale 率
  for (const sysLabel of ['Switch 2', 'Switch 1 only']) {
    const subset = sample.filter((s) => sysLabel === 'Switch 2' ? s.systems.includes('Nintendo Switch 2') : !s.systems.includes('Nintendo Switch 2'));
    if (!subset.length) continue;
    const line = countries.map((cc) => {
      const on = subset.filter((s) => priceByCountry[cc][s.nsuid] === 'onsale').length;
      return `${cc} ${on}/${subset.length}`;
    }).join('  ');
    console.log(`  [${sysLabel} n=${subset.length}] ${line}`);
  }

  // ---------- 3. JP 搜尋 API：構成拆解 ----------
  console.log('\n== JP 搜尋 API 構成 ==');
  const jpProbe = async (params) => {
    const url = 'https://search.nintendo.jp/nintendo_soft/search.json?' + new URLSearchParams(params).toString();
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    await sleep(300);
    return j;
  };
  const jpEmpty = await jpProbe({ q: '', limit: '1', page: '1' });
  out.jp.total_no_opt = jpEmpty.result?.total;
  console.log('total（無 opt_hard）=', jpEmpty.result?.total);
  for (const opt of ['1_HAC', '05_BEE']) {
    const j = await jpProbe({ q: '', limit: '1', page: '1', opt_hard: opt });
    out.jp[`total_opt_${opt}`] = j.result?.total;
    console.log(`total opt_hard=${opt}:`, j.result?.total);
  }
  // limit 上限測試
  const jpBig = await jpProbe({ q: '', limit: '1000', page: '1' });
  const bigN = (jpBig.result?.items || []).length;
  console.log('limit=1000 實回筆數=', bigN, 'total=', jpBig.result?.total);
  out.jp.limit1000_returned = bigN;
  // 抽樣分類：用最大可用 limit 掃若干頁（均勻取頁）
  const limit = bigN >= 500 ? 1000 : 150;
  const total = jpEmpty.result?.total || 0;
  const pages = Math.ceil(total / limit);
  const samplePages = [...new Set([1, 2, 3, Math.floor(pages / 4), Math.floor(pages / 2), Math.floor((3 * pages) / 4), pages - 1, pages])].filter((p) => p >= 1 && p <= pages);
  const cls = { items: 0, uniqueNsuid: new Set(), nullNsuid: 0, dupNsuid: 0, hard: {}, ssitu: {}, idWithUnderscore: 0, noIdUnderscore: 0 };
  const seen = new Set();
  const examples = { nullNsuid: [], dup: [], underscore: [] };
  for (const p of samplePages) {
    const j = await jpProbe({ q: '', limit: String(limit), page: String(p) });
    for (const it of j.result?.items || []) {
      cls.items++;
      cls.hard[it.hard] = (cls.hard[it.hard] || 0) + 1;
      cls.ssitu[it.ssitu] = (cls.ssitu[it.ssitu] || 0) + 1;
      if (String(it.id || '').includes('_')) { cls.idWithUnderscore++; if (examples.underscore.length < 5) examples.underscore.push({ id: it.id, title: it.title, nsuid: it.nsuid, hard: it.hard, ssitu: it.ssitu }); }
      else cls.noIdUnderscore++;
      if (!it.nsuid) { cls.nullNsuid++; if (examples.nullNsuid.length < 5) examples.nullNsuid.push({ id: it.id, title: it.title, hard: it.hard, ssitu: it.ssitu }); }
      else if (seen.has(String(it.nsuid))) { cls.dupNsuid++; if (examples.dup.length < 5) examples.dup.push({ id: it.id, title: it.title, nsuid: it.nsuid }); }
      else { seen.add(String(it.nsuid)); cls.uniqueNsuid.add(String(it.nsuid)); }
    }
    console.log(`  page ${p}/${pages}: 累計 items=${cls.items}`);
  }
  out.jp.sample = { pages: samplePages, limit, items: cls.items, uniqueNsuid: cls.uniqueNsuid.size, nullNsuid: cls.nullNsuid, dupNsuid: cls.dupNsuid, hard: cls.hard, ssitu: cls.ssitu, idWithUnderscore: cls.idWithUnderscore, noIdUnderscore: cls.noIdUnderscore, examples };
  console.log('JP 抽樣:', JSON.stringify(out.jp.sample, null, 1).slice(0, 3000));

  // ---------- 4. NA Algolia：全量列舉分類 ----------
  console.log('\n== NA Algolia 全量列舉 ==');
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
  const first = await algoliaQuery('store_all_products_en_us', 'query=&hitsPerPage=1&page=0');
  const nbHits = first.data?.nbHits;
  out.na.nbHits_en_us = nbHits;
  console.log('en_us nbHits=', nbHits);
  const counts = { productType: {}, nsuidPrefix: {}, platform: {}, total: 0, withNsuid: 0, noNsuid: 0 };
  const gameNsuids = [];
  const totalPages = Math.ceil(nbHits / 1000);
  for (let p = 0; p < totalPages; p++) {
    const r = await algoliaQuery('store_all_products_en_us', `query=&hitsPerPage=1000&page=${p}`);
    for (const h of r.data?.hits ?? []) {
      counts.total++;
      counts.productType[h.productType] = (counts.productType[h.productType] || 0) + 1;
      if (h.platform) counts.platform[h.platform] = (counts.platform[h.platform] || 0) + 1;
      if (h.nsuid) {
        counts.withNsuid++;
        const pre = String(h.nsuid).slice(0, 4);
        counts.nsuidPrefix[pre] = (counts.nsuidPrefix[pre] || 0) + 1;
        if (String(h.nsuid).startsWith('7001') && h.productType === 'Games') gameNsuids.push(String(h.nsuid));
      } else counts.noNsuid++;
    }
    if (p % 10 === 0 || p === totalPages - 1) console.log(`  page ${p + 1}/${totalPages}: 累計 ${counts.total}`);
  }
  out.na.counts = counts;
  out.na.gameNsuids_7001_Games = gameNsuids.length;
  console.log('NA productType:', JSON.stringify(counts.productType));
  console.log('NA nsuidPrefix:', JSON.stringify(counts.nsuidPrefix));
  console.log('NA platform(前10):', JSON.stringify(Object.entries(counts.platform).sort((a, b) => b[1] - a[1]).slice(0, 10)));
  console.log('NA 7001+Games nsuid 數=', gameNsuids.length);
  // CA vs US：隨機抽 50 個 7001 Games nsuid 查價
  const sampleNA = [...gameNsuids].sort(() => Math.random() - 0.5).slice(0, 50);
  out.na.priceSample = sampleNA;
  const usP = await fetchPrices('US', sampleNA);
  const caP = await fetchPrices('CA', sampleNA);
  const tally = (m) => ({ onsale: Object.values(m).filter((v) => v === 'onsale').length, not_found: Object.values(m).filter((v) => v === 'not_found').length, other: Object.values(m).filter((v) => v !== 'onsale' && v !== 'not_found').length, missing: sampleNA.length - Object.keys(m).length });
  out.na.priceSampleResult = { US: tally(usP), CA: tally(caP) };
  console.log('NA 抽 50 款 US:', JSON.stringify(out.na.priceSampleResult.US), 'CA:', JSON.stringify(out.na.priceSampleResult.CA));
  // CA 有價但 US 無價 / 反之
  const caOnly = sampleNA.filter((id) => caP[id] === 'onsale' && usP[id] !== 'onsale');
  const usOnly = sampleNA.filter((id) => usP[id] === 'onsale' && caP[id] !== 'onsale');
  out.na.priceSampleResult.caOnlyOnsale = caOnly.length;
  out.na.priceSampleResult.usOnlyOnsale = usOnly.length;
  console.log(`CA 獨有 onsale=${caOnly.length}，US 獨有 onsale=${usOnly.length}`);

  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/count-gaps.json', JSON.stringify(out, null, 2));
  console.log('\n已寫 /tmp/count-gaps.json');
}

main().catch((err) => { console.error(err); process.exit(1); });
