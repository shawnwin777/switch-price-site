// 探測台港商店前端資料端點：ec.nintendo.com 的 Alps / Savanna GraphQL
// 用法：node scripts/probe-savanna-graphql.mjs
// 做法（與瀏覽器一致，不含任何寫死的金鑰）：
//   1. 抓台灣商品頁 HTML，從 RSC payload 讀出 GraphQL URL 與
//      X-Nintendo-Savanna-Client-Id（公開頁面內嵌的 client 識別碼，
//      每次執行時現取，不寫死在檔案內）；
//   2. 以 persisted-query miss:true 方式送全文查詢（伺服器只接受
//      已登記的 persisted query，hash 須由真實瀏覽器觀察取得；
//      本腳本用 graphql-js print 印出 chunk 內抽出的查詢文件再算 hash，
//      僅供驗證，未打通的查詢會如實印出伺服器回應）；
//   3. Country 查詢（國家／商店資訊）已打通；ItemUserPrices（價格）
//      目前仍被伺服器以 INVALID_PARAM（errorCode 1802）擋在 $nsUids
//      變數上（詳見 data/tw-hk-source-report.md §14），腳本會印出
//      實測結果，不偽裝成功。
// 限制：不要把 client-id 寫死進檔案；不要用此腳本大量掃描（價格查詢
//   每次最多帶一小批 nsUid；列舉仍請用 scripts/scan-tw-hk-price-api.mjs）。

const TITLE_URL = 'https://ec.nintendo.com/TW/zh/titles/70010000068691'; // 瑪利歐驚奇 TW 商品頁
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Connection: 'close', ...opts.headers }, signal: AbortSignal.timeout(30000), ...opts });
      return await r.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(800);
    }
  }
}

function sha256hex(s) {
  return import('node:crypto').then((c) => c.createHash('sha256').update(s).digest('hex'));
}

// 從商品頁 chunk 抽出的查詢文件（見 /tmp/twhk/*.graphql；本腳本內嵌
// Country 全文；ItemUserPrices 全文見 data/tw-hk-source-report.md §14.1）。
const COUNTRY_QUERY = `query Country($shopId: Int!, $country: CountryCode!, $language: LanguageCode!) @inContext(shopId: $shopId, country: $country, language: $language) {
  country {
    isoCode
    regionCode
    isKakaopayAvailable
    isTaxExcludedCountry
    isTaxFreeCountry
    isPaypalAvailable
    isPrepaidCardAvailable
    defaultLanguage { isoCode }
    availableLanguages { isoCode }
    priceFormat { formats { patternId formats { digit format } } positivePrefix positiveSuffix negativePrefix negativeSuffix }
    balanceLimit { formattedValue rawValue }
    replenishAmounts { formattedValue rawValue }
    goldPointExchangeRate
    minimumCurrencyUnit
    isCreditCardAvailable
    shopStatuses { offdevice { shopOpenStatus } }
  }
}`;

const PRICES_QUERY = `query ItemUserPrices($shopId: Int!, $country: CountryCode!, $language: LanguageCode!, $idToken: String, $nsUids: [NsUid!]!) @inContext(shopId: $shopId, country: $country, language: $language) {
  prices(nsUids: $nsUids, idToken: $idToken) {
    nsUid
    right { isSelfOwned ownedItems { isSelfOwned isScheduledOrdered } }
    regularPrice { id formattedValue rawValue currency }
    preOrderInfoV2 { isDownloadReady }
    discountPrice { __typename id formattedValue rawValue endDatetime currency }
    itemStatuses { hac { salesStatus } offdevice { salesStatus } bee { salesStatus } }
    purchaseTimeLimitV2 { limitCount remainingCount endDatetime }
    monthlyPrice { formattedValue }
    tradeDiscountRates { id ticketItemGroupId unitMinutes value }
  }
}`;

async function gql(url, clientId, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json', Connection: 'close', 'X-Nintendo-Savanna-Client-Id': clientId },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return { status: r.status, json: await r.json() };
}

async function main() {
  console.log('=== 1. 抓台灣商品頁，取 GraphQL URL 與 client-id（執行時現取）===');
  const html = await fetchText(TITLE_URL);
  const urlM = html.match(/https:\/\/wb\.lp1\.savanna\.srv\.nintendo\.net\/graphql/);
  const idM = html.match(/X-Nintendo-Savanna-Client-Id.{0,8}([0-9a-f]{64})/);
  if (!urlM || !idM) { console.log('商品頁內找不到 GraphQL URL 或 client-id，商店前端可能已改版'); process.exit(1); }
  const gqlUrl = urlM[0];
  const clientId = idM[1];
  console.log('GraphQL URL:', gqlUrl);
  console.log('client-id 長度:', clientId.length, '（值不印出；每次執行自商品頁現取）');
  console.log('商品頁含價格／標題資料？', /1339|formattedValue|Wonder/.test(html) ? '有' : '無（JS 殼，資料全走 GraphQL）');

  console.log('\n=== 2. Country 查詢（shopId 3，TW／HK）===');
  const chash = await sha256hex(COUNTRY_QUERY);
  for (const [shopId, country] of [[3, 'TW'], [3, 'HK'], [5, 'TW']]) {
    const res = await gql(gqlUrl, clientId, { query: COUNTRY_QUERY, operationName: 'Country', variables: { shopId, country, language: 'zh' }, extensions: { persistedQuery: { version: 1, sha256Hash: chash, miss: true } } });
    const c = res.json.data?.country;
    console.log(`shopId ${shopId} ${country}:`, c ? `OK iso=${c.isoCode} region=${c.regionCode} paypal=${c.isPaypalAvailable} cc=${c.isCreditCardAvailable}` : `失敗 ${JSON.stringify(res.json.errors?.[0]?.extensions)}`);
    await sleep(400);
  }

  console.log('\n=== 3. ItemUserPrices 價格查詢（目前未打通，印出伺服器實測回應）===');
  const phash = await sha256hex(PRICES_QUERY);
  const res = await gql(gqlUrl, clientId, { query: PRICES_QUERY, operationName: 'ItemUserPrices', variables: { shopId: 3, country: 'TW', language: 'zh', nsUids: ['70010000068691'] }, extensions: { persistedQuery: { version: 1, sha256Hash: phash, miss: true } } });
  console.log('status:', res.status);
  console.log(JSON.stringify(res.json).slice(0, 600));
  console.log('\n（2026-11-16 實測：伺服器以 INVALID_PARAM / 1802 擋在 $nsUids 變數上；'
    + '已試 hash 四種算法、idToken 有無／String／String!、nsUids 四種型別、變數改名、shopId 1–12、'
    + '有無 client-id header，皆未通過。需以真實瀏覽器觀察商品頁實際請求取得正確 hash／文件，詳見報告 §14。）');
}

main().catch((e) => { console.error('探測失敗:', e.message); process.exit(1); });
