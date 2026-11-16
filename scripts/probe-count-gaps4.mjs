// scripts/probe-count-gaps4.mjs
// 第四輪：EU DLC 標題分類＋token 驗證；JP 無 opt 分頁硬體分佈＋2_CTR 拆解；NA browse 除錯＋prefix 查詢測試。
// 只用任天堂官方端點；節流 250-400ms。
// 用法：node scripts/probe-count-gaps4.mjs

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
  // ---------- EU ----------
  console.log('== EU token 驗證 ==');
  const count = async (label, fqPairs) => {
    const j = await solr([['q', '*:*'], ['rows', '0'], ['wt', 'json'], ...fqPairs.map((f) => ['fq', f])]);
    out.eu[label] = j.response?.numFound;
    console.log(`${label}: ${j.response?.numFound}`);
    return j.response?.numFound;
  };
  await count('GAME_nsuid_token_zzzzqqq', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:zzzzqqq']);
  await count('GAME_nsuid_token_wii', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:wii']);
  await count('GAME_nsuid_token_3ds_again', ['type:GAME', 'nsuid_txt:*', 'system_names_txt:3ds']);
  // 各 locale GAME 總數（與 GB App 24,314 對照）
  for (const loc of ['de', 'fr']) {
    const qs = `q=*%3A*&fq=type%3AGAME&rows=0&wt=json`;
    const res = await fetch(`https://search.nintendo-europe.com/${loc}/select?${qs}`, { headers: UA, signal: AbortSignal.timeout(30000) });
    const j = await res.json();
    await sleep(300);
    out.eu[`GAME_total_${loc}`] = j.response?.numFound;
    console.log(`/${loc}/ GAME total: ${j.response?.numFound}`);
  }
  // DLC 標題分類：100 個 DLC 標題，關鍵字分 bundle/collection/edition/pack/season pass/純 DLC
  console.log('\n== EU DLC 標題分類（n=100） ==');
  const dlcDocs = await solr([['q', '*:*'], ['rows', '100'], ['start', '3000'], ['wt', 'json'], ['fq', 'type:DLC'], ['fq', 'nsuid_txt:*'], ['fl', 'title,nsuid_txt']]);
  const kw = (t) => {
    const s = (t || '').toLowerCase();
    if (/bundle|collection|complete edition|definitive edition|game of the year|goty/.test(s)) return 'bundle_like';
    if (/season pass|expansion pass|dlc pack|content pack|add-on|addon/.test(s)) return 'dlc_like';
    if (/edition|deluxe|ultimate|gold|platinum/.test(s)) return 'edition_like';
    return 'other';
  };
  const dlcCls = {};
  const dlcEx = { bundle_like: [], other: [] };
  for (const d of dlcDocs.response?.docs ?? []) {
    const c = kw(d.title);
    dlcCls[c] = (dlcCls[c] || 0) + 1;
    if (dlcEx[c] && dlcEx[c].length < 5) dlcEx[c].push(d.title);
  }
  out.eu.dlcTitleClass = { n: (dlcDocs.response?.docs || []).length, cls: dlcCls, examples: dlcEx };
  console.log('DLC 標題分類：', JSON.stringify(dlcCls));
  console.log('bundle_like 範例：', JSON.stringify(dlcEx.bundle_like));
  console.log('other 範例：', JSON.stringify(dlcEx.other));

  // ---------- JP ----------
  console.log('\n== JP 無 opt 分頁硬體分佈（展開頁） ==');
  const jpProbe = async (params) => {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`https://search.nintendo.jp/nintendo_soft/search.json?${qs}`, { headers: UA, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    await sleep(300);
    return j;
  };
  const spread = [1, 40, 80, 120, 160, 200, 240];
  out.jp.spreadHard = {};
  for (const p of spread) {
    const j = await jpProbe({ q: '', limit: '150', page: String(p) });
    const hard = {};
    for (const it of j.result?.items || []) hard[it.hard || 'null'] = (hard[it.hard || 'null'] || 0) + 1;
    out.jp.spreadHard[`page_${p}`] = hard;
    console.log(`  page ${p}: ${JSON.stringify(hard)}`);
  }
  // 分頁穩定性：同一 HAC 頁抓兩次，比對 id 集合
  const h1 = await jpProbe({ q: '', limit: '150', page: '42', opt_hard: '1_HAC' });
  const h2 = await jpProbe({ q: '', limit: '150', page: '42', opt_hard: '1_HAC' });
  const ids1 = new Set((h1.result?.items || []).map((i) => i.id));
  const ids2 = new Set((h2.result?.items || []).map((i) => i.id));
  const inter = [...ids1].filter((x) => ids2.has(x)).length;
  out.jp.pageStability = { page: 42, n1: ids1.size, n2: ids2.size, overlap: inter };
  console.log(`HAC page 42 兩次抓取：n1=${ids1.size} n2=${ids2.size} 重疊=${inter}`);
  // 2_CTR 拆解：2 頁，記 prefix × sform
  const clsCTR = { items: 0, byPrefixSform: {}, ssitu: {} };
  for (const p of [1, 5]) {
    const j = await jpProbe({ q: '', limit: '150', page: String(p), opt_hard: '2_CTR' });
    for (const it of j.result?.items || []) {
      clsCTR.items++;
      const pre = it.nsuid ? String(it.nsuid).slice(0, 4) : 'null';
      clsCTR.byPrefixSform[`${pre}|${it.sform || 'null'}`] = (clsCTR.byPrefixSform[`${pre}|${it.sform || 'null'}`] || 0) + 1;
      clsCTR.ssitu[it.ssitu] = (clsCTR.ssitu[it.ssitu] || 0) + 1;
    }
    console.log(`  CTR page ${p}: 累計 ${clsCTR.items}`);
  }
  out.jp.ctr = clsCTR;
  console.log('CTR byPrefix|sform:', JSON.stringify(clsCTR.byPrefixSform), 'ssitu:', JSON.stringify(clsCTR.ssitu));
  // 4_WUP 拆解：1 頁
  const clsWUP = { items: 0, byPrefixSform: {}, ssitu: {} };
  const w = await jpProbe({ q: '', limit: '150', page: '1', opt_hard: '4_WUP' });
  for (const it of w.result?.items || []) {
    clsWUP.items++;
    const pre = it.nsuid ? String(it.nsuid).slice(0, 4) : 'null';
    clsWUP.byPrefixSform[`${pre}|${it.sform || 'null'}`] = (clsWUP.byPrefixSform[`${pre}|${it.sform || 'null'}`] || 0) + 1;
    clsWUP.ssitu[it.ssitu] = (clsWUP.ssitu[it.ssitu] || 0) + 1;
  }
  out.jp.wup = clsWUP;
  console.log('WUP byPrefix|sform:', JSON.stringify(clsWUP.byPrefixSform), 'ssitu:', JSON.stringify(clsWUP.ssitu));

  // ---------- NA ----------
  console.log('\n== NA browse 除錯 ==');
  const AM_APP = 'U3B6GR4UA3';
  const AM_KEY = 'a29c6927638bfd8cee23993e51e721c9';
  const browseRes = await fetch(`https://${AM_APP}-dsn.algolia.net/1/indexes/store_all_products_en_us/browse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': AM_APP, 'X-Algolia-API-Key': AM_KEY },
    body: JSON.stringify({ params: 'query=&hitsPerPage=1000' }),
    signal: AbortSignal.timeout(60000),
  });
  const browseText = await browseRes.text();
  console.log(`browse HTTP ${browseRes.status}，回傳前 500 字：${browseText.slice(0, 500)}`);
  out.na.browseDebug = { status: browseRes.status, head: browseText.slice(0, 500) };
  await sleep(300);

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
  // 用 query 測 prefix：nsuid 是否可全文檢索
  for (const q of ['7001', '7005', '7007']) {
    const r = await algoliaQuery('store_all_products_en_us', `query=${q}&hitsPerPage=0`);
    console.log(`query=${q}: nbHits=${r.data?.nbHits}`);
    out.na[`query_${q}`] = r.data?.nbHits;
  }
  // 第一頁 Games 命中 prefix 分佈（註明：僅前 1000 筆排序結果）
  const r = await algoliaQuery('store_all_products_en_us', 'query=&hitsPerPage=1000&page=0&filters=productType%3AGames');
  const hits = r.data?.hits ?? [];
  const pre = {};
  const ids7001 = [];
  for (const h of hits) {
    const p = h.nsuid ? String(h.nsuid).slice(0, 4) : 'null';
    pre[p] = (pre[p] || 0) + 1;
    if (String(h.nsuid || '').startsWith('7001')) ids7001.push(String(h.nsuid));
  }
  out.na.first1000GamesPrefix = pre;
  console.log(`前 1000 筆 Games：prefix 分佈 ${JSON.stringify(pre)}，7001 數=${ids7001.length}`);
  // CA vs US 抽查：從 7001 樣本隨機 50 款
  const sampleNA = [...new Set(ids7001)].sort(() => Math.random() - 0.5).slice(0, 50);
  out.na.priceSample = sampleNA;
  const usP = await fetchPrices('US', sampleNA);
  const caP = await fetchPrices('CA', sampleNA);
  const tally = (m) => ({ onsale: Object.values(m).filter((v) => v === 'onsale').length, not_found: Object.values(m).filter((v) => v === 'not_found').length, other: Object.values(m).filter((v) => v !== 'onsale' && v !== 'not_found').length, missing: sampleNA.length - Object.keys(m).length });
  out.na.priceSampleResult = { US: tally(usP), CA: tally(caP), caOnlyOnsale: sampleNA.filter((id) => caP[id] === 'onsale' && usP[id] !== 'onsale').length, usOnlyOnsale: sampleNA.filter((id) => usP[id] === 'onsale' && caP[id] !== 'onsale').length };
  console.log('NA 抽 50 款 US:', JSON.stringify(out.na.priceSampleResult.US), 'CA:', JSON.stringify(out.na.priceSampleResult.CA));
  const caMissing = sampleNA.filter((id) => usP[id] === 'onsale' && caP[id] !== 'onsale');
  console.log('US 有價但 CA 無價：', JSON.stringify(caMissing.map((id) => ({ id, us: usP[id], ca: caP[id] || '未回傳' }))));

  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/count-gaps4.json', JSON.stringify(out, null, 2));
  console.log('\n已寫 /tmp/count-gaps4.json');
}

main().catch((err) => { console.error(err); process.exit(1); });
