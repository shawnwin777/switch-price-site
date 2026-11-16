// scripts/probe-price-fields.mjs
// 第五輪：檢查 EU Solr / NA Algolia / 日本搜尋 API 的 payload 是否自帶價格欄位。
// + EU DLC 多段標題分類（5 段 × 20 筆，降低聚類偏差）。
// 只用任天堂官方端點；節流 250-400ms。
// 用法：node scripts/probe-price-fields.mjs

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { generated_at: new Date().toISOString(), euSolr: {}, naAlgolia: {}, jpSearch: {}, euDlcMulti: {} };

async function main() {
  // ---------- EU Solr：fl=* 看全部欄位（含價格） ----------
  console.log('== EU Solr 全欄位（曠野之息 /en/） ==');
  const solrDoc = async (locale, q) => {
    const url = `https://search.nintendo-europe.com/${locale}/select?q=${encodeURIComponent(q)}&fq=type%3AGAME&rows=1&wt=json&fl=*`;
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const j = await res.json();
    await sleep(300);
    return (j.response?.docs || [])[0] || null;
  };
  const botwEn = await solrDoc('en', 'Breath of the Wild');
  out.euSolr.botwEn = botwEn;
  console.log('en 欄位：', JSON.stringify(Object.keys(botwEn || {})));
  const priceFieldsEn = {};
  for (const [k, v] of Object.entries(botwEn || {})) if (/price|lowest|discount|eshop/i.test(k)) priceFieldsEn[k] = v;
  out.euSolr.botwEnPriceFields = priceFieldsEn;
  console.log('en 價格相關欄位：', JSON.stringify(priceFieldsEn));
  console.log('en nsuid/title：', botwEn?.nsuid_txt, '|', botwEn?.title);
  const botwDe = await solrDoc('de', 'Breath of the Wild');
  const priceFieldsDe = {};
  for (const [k, v] of Object.entries(botwDe || {})) if (/price|lowest|discount|eshop/i.test(k)) priceFieldsDe[k] = v;
  out.euSolr.botwDePriceFields = priceFieldsDe;
  console.log('de 價格相關欄位：', JSON.stringify(priceFieldsDe));
  console.log('de nsuid/title：', botwDe?.nsuid_txt, '|', botwDe?.title);
  // DLC 文件全欄位
  const dlcUrl = 'https://search.nintendo-europe.com/en/select?q=*%3A*&fq=type%3ADLC&fq=nsuid_txt%3A*&rows=1&start=3000&wt=json&fl=*';
  const dlcRes = await fetch(dlcUrl, { headers: UA, signal: AbortSignal.timeout(30000) });
  const dlcDoc = (await dlcRes.json()).response?.docs?.[0] || null;
  await sleep(300);
  out.euSolr.dlcDocFields = dlcDoc ? Object.keys(dlcDoc) : [];
  const dlcPrice = {};
  for (const [k, v] of Object.entries(dlcDoc || {})) if (/price|lowest|discount|eshop/i.test(k)) dlcPrice[k] = v;
  out.euSolr.dlcPriceFields = dlcPrice;
  console.log('DLC 欄位：', JSON.stringify(out.euSolr.dlcDocFields));
  console.log('DLC 價格相關欄位：', JSON.stringify(dlcPrice), '| title=', dlcDoc?.title);

  // ---------- NA Algolia：完整 hit（含 eshopDetails） ----------
  console.log('\n== NA Algolia 完整 hit ==');
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
    return data;
  };
  const botw = await algoliaQuery('store_all_products_en_us', 'query=Breath%20of%20the%20Wild&hitsPerPage=1');
  const hit = (botw.hits || [])[0] || null;
  out.naAlgolia.botwHitKeys = hit ? Object.keys(hit) : [];
  out.naAlgolia.botwHit = hit;
  console.log('hit 欄位：', JSON.stringify(out.naAlgolia.botwHitKeys));
  console.log('eshopDetails：', JSON.stringify(hit?.eshopDetails));
  console.log('price 相關頂層欄位：', JSON.stringify(Object.fromEntries(Object.entries(hit || {}).filter(([k]) => /price|sale|msrp|cost/i.test(k)))));
  // 再取一個正在特價的遊戲看 sale 欄位（查 Mario Kart World）
  const mkw = await algoliaQuery('store_all_products_en_us', 'query=Mario%20Kart%20World&hitsPerPage=1');
  const hit2 = (mkw.hits || [])[0] || null;
  out.naAlgolia.mkwEshopDetails = hit2?.eshopDetails || null;
  console.log('MKW eshopDetails：', JSON.stringify(hit2?.eshopDetails));
  console.log('MKW productType/nsuid/platform：', hit2?.productType, hit2?.nsuid, hit2?.platform);

  // ---------- JP 搜尋 API：價格欄位 ----------
  console.log('\n== JP 搜尋 API 價格欄位 ==');
  const jpProbe = async (params) => {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`https://search.nintendo.jp/nintendo_soft/search.json?${qs}`, { headers: UA, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    await sleep(300);
    return j;
  };
  const zelda = await jpProbe({ q: 'ゼルダの伝説 ブレス オブ ザ ワイルド', limit: '3', page: '1', opt_hard: '1_HAC' });
  const zItem = (zelda.result?.items || []).find((i) => i.nsuid === '70010000000026') || (zelda.result?.items || [])[0];
  const priceKeys = ['pprice', 'dprice', 'current_price', 'sprice', 'price', 'sale_flg', 'ssitu', 'sdate'];
  out.jpSearch.botwPriceFields = Object.fromEntries(priceKeys.map((k) => [k, zItem?.[k]]));
  out.jpSearch.botwTitle = zItem?.title;
  out.jpSearch.botwNsuid = zItem?.nsuid;
  console.log('BOTW JP：', JSON.stringify(out.jpSearch.botwPriceFields), '|', zItem?.title);
  // 找一個正在特價的項目看 dprice/current_price 差異：抓 HAC 隨機頁，取 sale_flg=1 且 current_price 非空者
  let saleExample = null;
  for (const p of [12, 55, 130]) {
    const j = await jpProbe({ q: '', limit: '150', page: String(p), opt_hard: '1_HAC' });
    saleExample = (j.result?.items || []).find((i) => i.sale_flg === '1' && i.current_price != null && i.pprice != null);
    if (saleExample) break;
  }
  if (saleExample) {
    out.jpSearch.saleExample = Object.fromEntries(priceKeys.map((k) => [k, saleExample[k]]));
    out.jpSearch.saleExampleTitle = saleExample.title;
    console.log('特價範例：', saleExample.title, JSON.stringify(out.jpSearch.saleExample));
  } else console.log('隨機 3 頁未找到 sale_flg=1 範例');
  // 一個 DLC 項目（7005）的價格欄位
  let dlcExample = null;
  for (const p of [12, 55]) {
    const j = await jpProbe({ q: '', limit: '150', page: String(p), opt_hard: '1_HAC' });
    dlcExample = (j.result?.items || []).find((i) => String(i.nsuid || '').startsWith('7005') && i.ssitu === 'onsale');
    if (dlcExample) break;
  }
  if (dlcExample) {
    out.jpSearch.dlcExample = Object.fromEntries(priceKeys.map((k) => [k, dlcExample[k]]));
    out.jpSearch.dlcExampleTitle = dlcExample.title;
    console.log('DLC 範例：', dlcExample.title, JSON.stringify(out.jpSearch.dlcExample));
  }

  // ---------- EU DLC 多段標題分類 ----------
  console.log('\n== EU DLC 多段標題分類（5 段 × 20） ==');
  const kw = (t) => {
    const s = (t || '').toLowerCase();
    if (/bundle|collection|complete edition|definitive edition|game of the year|goty/.test(s)) return 'bundle_like';
    if (/season pass|expansion pass|dlc pack|content pack|add-on|addon/.test(s)) return 'dlc_like';
    if (/edition|deluxe|ultimate|gold|platinum/.test(s)) return 'edition_like';
    return 'other';
  };
  const cls = {};
  let n = 0;
  for (const start of [0, 2500, 5000, 7500, 10000]) {
    const url = `https://search.nintendo-europe.com/en/select?q=*%3A*&fq=type%3ADLC&fq=nsuid_txt%3A*&rows=20&start=${start}&wt=json&fl=title`;
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const j = await res.json();
    await sleep(300);
    for (const d of j.response?.docs ?? []) { cls[kw(d.title)] = (cls[kw(d.title)] || 0) + 1; n++; }
    console.log(`  start=${start}: 累計 ${n}`);
  }
  out.euDlcMulti = { n, cls };
  console.log('DLC 多段分類：', JSON.stringify(cls), 'n=', n);

  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/price-fields.json', JSON.stringify(out, null, 2));
  console.log('\n已寫 /tmp/price-fields.json');
}

main().catch((err) => { console.error(err); process.exit(1); });
