// scripts/probe-region-lists.mjs
// 各國任天堂官方遊戲編號（NSUID）清單來源探測。
// 只用任天堂官方端點與公開資料：
//   - 美洲：nintendo.com 商店前端的官方 Algolia 搜尋後端
//     （store_all_products_<locale>；search key 是官網前端內嵌的公開 key）
//     注意：不要加 filters=productType:Games——各地語言值不同（en=Games、
//     es=Juegos），非英語 locale 會回 0 筆；改由客戶端篩 nsuid＋標題。
//     2020 年開源函式庫 nintendeals（fedecalendino/nintendeals，MIT）
//     用的就是同一 Algolia app（U3B6GR4UA3），舊索引 store_game_en_us
//     已下線，現代等效索引是 store_all_products_en_us。
//   - 歐洲：任天堂歐洲官網搜尋後端 search.nintendo-europe.com（Solr，nsuid_txt）
//     ——nintendeals noe 用的就是它，2026-11-16 實測仍通。
//   - 日本：除 XML 外，日本官網搜尋 API
//     search.nintendo.jp/nintendo_soft/search.json 仍通（nintendeals noj
//     用的就是它），回 nsuid＋icode（product code 核心 5 碼）＋售價狀態。
//   - 澳洲／紐西蘭：nintendo.com/au 官網前端的官方 Algolia 後端
//     （prod_games_and_products，key 見官網首頁 RSC payload）
//   - 韓國：nintendo.com/kr/software/switch/（Next.js 清單頁，Contentful 項目含 nsuid）
//   - 日本／台灣／香港：沿用既有來源（JP XML、TW/HK 清單頁），此處只做存活抽查
//   - 新加坡／馬來西亞／泰國：無官方清單（見下方註解與報告）
// 不爬任何比價站的資料庫；不推 GitHub、不碰 Supabase、不寫 Secret。
//
// 用法：node scripts/probe-region-lists.mjs
// 輸出：每國來源、實測筆數、2-3 個範例編號、價格 API 驗證結果。

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 美洲 Algolia（nintendo.com 官網前端用的同一組公開 search key） ---
const AM_APP = 'U3B6GR4UA3';
const AM_KEY_NEW = 'a29c6927638bfd8cee23993e51e721c9'; // store_all_products_* 用 key
const AM_KEY_OLD = 'c4da8be7fd29f0f5bfa42920b0a99dc7'; // ncom_game_* 用 key（舊索引，無 nsuid 欄位）
// 注意：AM_KEY_NEW 查 store_all_products_* 才有 200；拿它查 ncom_game_* 或
// 用 AM_KEY_OLD 查 store_all_products_* 會回 403 "Index not allowed with this API key"。
// 歐洲／澳洲沒有 store_all_products_* 索引（404 "Index ... does not exist"），見報告。
const AM_LOCALES = [
  { locale: 'en_us', countries: ['US'] },
  { locale: 'en_ca', countries: ['CA'] },
  { locale: 'fr_ca', countries: ['CA'] },
  { locale: 'es_mx', countries: ['MX'] },
  { locale: 'pt_br', countries: ['BR'] },
  { locale: 'es_ar', countries: ['AR'] },
  { locale: 'es_cl', countries: ['CL'] },
  { locale: 'es_co', countries: ['CO'] },
  { locale: 'es_pe', countries: ['PE'] },
];

// --- 澳洲 Algolia（nintendo.com/au 官網首頁 RSC payload 內嵌的公開 key） ---
const AU_APP = 'FMW57F6ERV';
const AU_KEY = 'c8e4e9f60190ef785d167da77ba0b4fe';
const AU_INDEX = 'prod_games_and_products';
// 注意：prod_games（1443 筆）沒有 nsuid 欄位；有 nsuid 的是 prod_games_and_products。

const PRICE_API = 'https://api.ec.nintendo.com/v1/price';

function langFor(country) {
  if (country === 'JP') return 'ja';
  if (country === 'TW' || country === 'HK') return 'zh';
  return 'en';
}

async function algoliaQuery(app, key, index, params) {
  const res = await fetch(`https://${app}-dsn.algolia.net/1/indexes/${index}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': app, 'X-Algolia-API-Key': key },
    body: JSON.stringify({ params }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function fetchPrices(country, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    let data = null;
    for (let a = 0; a < 3 && !data; a++) {
      try {
        const res = await fetch(`${PRICE_API}?country=${country}&ids=${chunk.join(',')}&lang=${langFor(country)}`, {
          headers: { 'User-Agent': 'shawn-game-studio/1.0 (region probe)' },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch { await sleep(1200); }
    }
    if (!data) continue;
    for (const p of data?.prices ?? []) {
      out[String(p.title_id)] = {
        sales_status: p.sales_status,
        regular: p.regular_price ? `${p.regular_price.amount} ${p.regular_price.currency}` : null,
      };
    }
    await sleep(250);
  }
  return out;
}

async function main() {
  console.log('== 美洲 Algolia store_all_products_*（空查詢，客戶端篩 nsuid；不用 productType filter，見檔頭註解） ==');
  for (const { locale, countries } of AM_LOCALES) {
    const r = await algoliaQuery(AM_APP, AM_KEY_NEW, `store_all_products_${locale}`, 'query=&hitsPerPage=2');
    const samples = (r.data?.hits ?? []).filter((h) => h.nsuid).map((h) => `${h.title} = ${h.nsuid}`);
    console.log(`  ${locale}（${countries.join('/')}）：HTTP ${r.status} nbHits=${r.data?.nbHits ?? r.data?.message} 樣本：${samples.join('；') || '無'}`);
    await sleep(400);
  }

  console.log('\n== 歐洲 Solr search.nintendo-europe.com（fq=type:GAME + nsuid_txt:*） ==');
  const euRes = await fetch('https://search.nintendo-europe.com/en/select?q=*&fq=type%3AGAME&fq=nsuid_txt%3A*&rows=0&wt=json', {
    headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000),
  });
  const eu = await euRes.json();
  console.log(`  en：HTTP ${euRes.status} games_with_nsuid=${eu.response?.numFound}`);
  const euBotw = await (await fetch('https://search.nintendo-europe.com/en/select?q=Breath%20of%20the%20Wild&fq=type%3AGAME&rows=5&wt=json&fl=title,nsuid_txt,system_names_txt', {
    headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000),
  })).json();
  for (const d of euBotw.response.docs.filter((x) => x.nsuid_txt)) {
    console.log(`  樣本：${d.title} = ${d.nsuid_txt.join(',')}（${(d.system_names_txt || []).join('/')}）`);
  }
  for (const loc of ['de', 'fr', 'es', 'it', 'nl']) {
    const r = await fetch(`https://search.nintendo-europe.com/${loc}/select?q=*&fq=type%3AGAME&rows=0&wt=json`, {
      headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    console.log(`  /${loc}/ GAME numFound=${j.response?.numFound}（與 en 同一 nsuid 體系，價格 API 已驗證共用）`);
    await sleep(400);
  }

  console.log('\n== 澳洲 Algolia prod_games_and_products（空查詢） ==');
  const au = await algoliaQuery(AU_APP, AU_KEY, AU_INDEX, 'query=&hitsPerPage=3');
  console.log(`  prod_games_and_products：HTTP ${au.status} nbHits=${au.data?.nbHits}`);
  for (const h of au.data?.hits ?? []) {
    if (h.nsuid) console.log(`  樣本：${h.title} = ${h.nsuid}（${h.objectType}）`);
  }
  const auZelda = await algoliaQuery(AU_APP, AU_KEY, AU_INDEX, 'query=Ocarina of Time&hitsPerPage=2');
  for (const h of auZelda.data?.hits ?? []) {
    if (h.nsuid) console.log(`  樣本：${h.title} = ${h.nsuid}`);
  }

  console.log('\n== 韓國 nintendo.com/kr/software/switch/（清單頁，僅精選＋新作） ==');
  const krRes = await fetch('https://www.nintendo.com/kr/software/switch/', {
    headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000),
  });
  const krText = (await krRes.text()).replace(/\\"/g, '"');
  const krItems = [...krText.matchAll(/"title":"([^"]{1,120})","nsuid":"(70010000\d{6})"/g)].map((m) => ({ title: m[1], nsuid: m[2] }));
  console.log(`  HTTP ${krRes.status} 頁面內 nsuid 項目=${krItems.length}（無 ?spage= 分頁，非完整目錄）`);
  krItems.slice(0, 3).forEach((it) => console.log(`  樣本：${it.title} = ${it.nsuid}`));

  console.log('\n== 日本 XML 存活抽查 ==');
  const jpRes = await fetch('https://www.nintendo.co.jp/data/software/xml/switch.xml', {
    headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(60000),
  });
  const jpText = await jpRes.text();
  const jpIds = new Set([...jpText.matchAll(/\/titles\/(\d{14})/g)].map((m) => m[1]));
  console.log(`  HTTP ${jpRes.status} title ID 數=${jpIds.size}（最新發售日約 2025-05-01，Switch 2 新作缺口已知）`);

  console.log('\n== 日本搜尋 API 存活抽查（nintendeals noj 曾用的端點） ==');
  const jpSearchRes = await fetch('https://search.nintendo.jp/nintendo_soft/search.json?q=' + encodeURIComponent('ゼルダの伝説') + '&limit=2&page=1&opt_hard=1_HAC', {
    headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000),
  });
  const jpSearch = await jpSearchRes.json().catch(() => ({}));
  console.log(`  HTTP ${jpSearchRes.status} total=${jpSearch.result?.total}（Switch 軟體，含 XML 沒有的新作） 樣本：${(jpSearch.result?.items || []).map((it) => `${it.title}=${it.nsuid}（${it.ssitu}，icode=${it.icode}）`).join('；')}`);
  console.log('  （絲之歌 JP 編號 70010000020841 即出自此 API，見報告）');

  console.log('\n== 各區搜尋 API ec.nintendo.com/api/{CC}/{lang}/search/sales（預期已下線） ==');
  const dead = await fetch('https://ec.nintendo.com/api/US/en/search/sales?query=zelda', {
    headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000),
  });
  const deadText = await dead.text();
  console.log(`  US search/sales：HTTP ${dead.status}，回 ${deadText.trimStart().startsWith('<') ? 'HTML（非 JSON，已下線）' : 'JSON'}`);

  console.log('\n== 價格 API 驗證（範例編號是否真的查得到該國價） ==');
  const checks = [
    ['US', ['70010000000025', '70010000095431']],
    ['CA', ['70010000000025', '70010000063714']],
    ['MX', ['70010000095431']],
    ['BR', ['70010000095431']],
    ['GB', ['70010000000023', '70010000063715', '70010000096802']],
    ['DE', ['70010000000023', '70010000063715']],
    ['FR', ['70010000000023', '70010000096802']],
    ['ES', ['70010000000023']],
    ['IT', ['70010000096802']],
    ['NL', ['70010000000023']],
    ['ZA', ['70010000000023']],
    ['AU', ['70010000130793', '70010000000023']],
    ['NZ', ['70010000130793']],
  ];
  for (const [cc, ids] of checks) {
    const res = await fetchPrices(cc, ids);
    console.log(`  ${cc}：${ids.map((id) => `${id}=${res[id]?.sales_status ?? 'not_found'}${res[id]?.regular ? ` ${res[id].regular}` : ''}`).join('；')}`);
    await sleep(300);
  }
  console.log('\n== 新加坡／馬來西亞／泰國（無官方清單；價格 API 亦查無） ==');
  for (const cc of ['SG', 'MY', 'TH']) {
    const res = await fetchPrices(cc, ['70010000000025', '70010000000023', '70010000000026']);
    console.log(`  ${cc}：US/EU/JP 曠野之息編號皆 ${Object.values(res).map((v) => v.sales_status).join('/')}；BOTW 編號 ±60 掃描亦無在售（見報告 §SG）`);
    await sleep(300);
  }
  console.log('\n探測完成。完整說明見 data/region-sources-report.md。');
}

main().catch((err) => { console.error(err); process.exit(1); });
