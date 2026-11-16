/**
 * Switch 遊戲比價 — 商店前端端點「價格欄位」探測腳本
 * ============================================================
 * 用法：node scripts/probe-storefront-prices.mjs
 * （唯讀探測，不寫庫、不寫檔；請求間隔 300ms 節流。）
 *
 * 背景：NA Algolia、EU Solr、日本搜尋 API 是各區 eShop 商店前端自己在
 *   用的公開端點（見 data/region-sources-report.md）。價格欄位已於
 *   2026-11-16 由數量差距驗證員實測確認（見 data/region-count-gaps.md
 *   §5、探測腳本 scripts/probe-price-fields.mjs，結果寫入
 *   DATA_NOTES.md §12.6）：
 *     NA Algolia eshopDetails（regularPrice／discountPrice／
 *       discountPriceEndTimestamp／currency／productType）＋頂層 price，
 *       MKW $79.99 與價格 API 一致——目錄＋價格一站解決；
 *     JP 搜尋 API pprice／dprice／sprice／current_price／sale_flg，
 *       BOTW 7,678 與價格 API 一致——目錄＋價格一站解決；
 *     EU Solr price_regular_f／price_lowest_f／price_has_discount_b／
 *       price_discount_percentage_f，每 locale 一個價（en≈GB、de≈DE），
 *       星露谷 en 10.99／de 13.99 與價格 API 一致，但 BOTW de 三欄
 *       皆 89.98（與價格 API €69.99 不符）——只當參考價、需交叉驗證。
 *   本腳本保留作「欄位變更時重測」之用（例如任天堂改版後價格欄位
 *   消失或改名時，先跑本腳本再決定是否改 lib/catalog-sources.ts
 *   的解析器）；日常更新不跑它。
 *
 * 注意：Algolia app／key 是任天堂官網前端內嵌的公開 search key
 *   （不是使用者憑證，同值已在 scripts/probe-region-lists.mjs；
 *   任天堂輪換 key 時改這裡或用環境變數 NA_ALGOLIA_API_KEY／
 *   AU_ALGOLIA_API_KEY 覆蓋）。
 *
 * 需求：Node.js 18+（內建 fetch，不需套件）。
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 300;

const NA_APP = 'U3B6GR4UA3';
const NA_KEY = process.env.NA_ALGOLIA_API_KEY ?? 'a29c6927638bfd8cee23993e51e721c9';
const AU_APP = 'FMW57F6ERV';
const AU_KEY = process.env.AU_ALGOLIA_API_KEY ?? 'c8e4e9f60190ef785d167da77ba0b4fe';

async function getJson(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'switch-price-site/1.0 (storefront price probe)', ...(opts.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
    ...opts,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function algoliaQuery(app, key, index, params) {
  return getJson(`https://${app}-dsn.algolia.net/1/indexes/${index}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Algolia-Application-Id': app,
      'X-Algolia-API-Key': key,
    },
    body: JSON.stringify({ params }),
  });
}

/** 只印價格相關欄位（其餘欄位只印 key 名，避免洗版）。 */
function priceShape(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const keys = Object.keys(obj);
  const priceKeys = keys.filter((k) => /price|sale|discount|currenc|amount|eshop/i.test(k));
  const out = { __all_keys: keys };
  for (const k of priceKeys) out[k] = obj[k];
  return out;
}

async function main() {
  console.log('商店前端端點價格欄位探測（唯讀；每步間隔 300ms）\n');

  // 1. NA Algolia：eshopDetails 到底長什麼樣子？
  console.log('== 1. NA Algolia store_all_products_en_us（曠野之息） ==');
  try {
    const na = await algoliaQuery(NA_APP, NA_KEY, 'store_all_products_en_us',
      'query=The Legend of Zelda: Breath of the Wild&hitsPerPage=2');
    for (const h of (na.hits ?? []).filter((x) => x.nsuid)) {
      console.log(`  ${h.title} = ${h.nsuid}`);
      console.log(`  價格相關欄位：${JSON.stringify(priceShape(h), null, 2).split('\n').join('\n  ')}`);
    }
    if (!na.hits?.length) console.log('  （無命中）');
  } catch (err) {
    console.log(`  失敗：${err.message}`);
  }
  await sleep(THROTTLE_MS);

  // 2. EU Solr：price_lowest_f 是什麼幣別、哪一國的價？有無特價／結束日？
  console.log('\n== 2. EU Solr /en/（曠野之息，fl=* 全欄位） ==');
  try {
    const eu = await getJson(
      'https://search.nintendo-europe.com/en/select?q=Breath%20of%20the%20Wild&fq=type%3AGAME&rows=2&wt=json&fl=*',
    );
    for (const d of eu.response?.docs ?? []) {
      console.log(`  ${d.title} = ${(d.nsuid_txt ?? []).join(',')}`);
      console.log(`  價格相關欄位：${JSON.stringify(priceShape(d), null, 2).split('\n').join('\n  ')}`);
    }
  } catch (err) {
    console.log(`  失敗：${err.message}`);
  }
  await sleep(THROTTLE_MS);

  // 3. JP 搜尋 API：pprice／current_price 的值與幣別（瑪利歐賽車世界，價格 API 查不到的 Switch 2 遊戲）
  console.log('\n== 3. JP 搜尋 API（マリオカートワールド，價格 API v1 查不到、搜尋 API 應有 ¥8,980） ==');
  try {
    const jp = await getJson(
      'https://search.nintendo.jp/nintendo_soft/search.json?q=' +
        encodeURIComponent('マリオカートワールド') + '&limit=2&page=1',
    );
    for (const it of jp.result?.items ?? []) {
      console.log(`  ${it.title} = ${it.nsuid}（${it.ssitu}，hard=${it.hard}）`);
      console.log(`  價格相關欄位：${JSON.stringify(priceShape(it), null, 2).split('\n').join('\n  ')}`);
    }
  } catch (err) {
    console.log(`  失敗：${err.message}`);
  }
  await sleep(THROTTLE_MS);

  // 4. AU Algolia：到底有沒有價格欄位？
  console.log('\n== 4. AU Algolia prod_games_and_products（Ocarina of Time） ==');
  try {
    const au = await algoliaQuery(AU_APP, AU_KEY, 'prod_games_and_products',
      'query=Ocarina of Time&hitsPerPage=2');
    for (const h of (au.hits ?? []).filter((x) => x.nsuid)) {
      console.log(`  ${h.title} = ${h.nsuid}`);
      console.log(`  價格相關欄位：${JSON.stringify(priceShape(h), null, 2).split('\n').join('\n  ')}`);
    }
    if (!au.hits?.length) console.log('  （無命中）');
  } catch (err) {
    console.log(`  失敗：${err.message}`);
  }

  console.log(
    '\n判讀方式：對照 DATA_NOTES.md §12.6 的四項判斷標準。\n' +
      '重點看：(1) 數字是否與價格 API 一致（MK World JP ¥8,980、BOTW US $59.99／GB £59.99）；\n' +
      '(2) 幣別是否明確；(3) 有無特價結束時間；(4) EU 的 price_lowest_f 是單一數值還是分國價格。',
  );
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
