// scripts/probe-tw-hk-storefront.mjs
// 台港 eShop 編號來源探測腳本：逐一實測每個候選來源，印出筆數與結論。
//
// 實測結論（2026-11-16，詳見 data/tw-hk-source-report.md）：
// - 可用、完整：價格 API 全區間掃描（見 scan-tw-hk-price-api.mjs）。
//   本腳本只做小範圍密度抽樣示範，不跑全掃描。
// - 可用、但不完整：台港官方軟體清單（TW 166／HK 176 款，精選＋部分第三方）。
// - 可用、但過期：香港 JSON（544 筆，內容停在 2022-06）。
// - 不可行：任務所提的 https://www.nintendo.com/zh-hant-tw/store/ 與
//   /zh-hant-hk/store/ 不存在（導向 /us/zh-hant-tw/store/ 回 404）；
//   ec.nintendo.com 的 TW/HK 商店前端沒有公開的瀏覽／搜尋路由
//   （/TW/zh/、/titles、/search、/games、/store 一律 404，只有
//   /titles/<nsuid> 商品頁本身回 200）；舊搜尋 API
//   ec.nintendo.com/api/{TW|HK}/zh/search/sales 已下線（404）；
//   商店前端的資料來自內部 Alps GraphQL（端點未公開於前端 JS，
//   /api/graphql 與 /graphql 皆 404），無法直接呼叫列舉。
// - 第三方比價站（checkgreenpipe、switch-games.com、遊戲盒子）
//   皆未公開列舉端點；其方法論只寫「每日向 Nintendo eShop 抓價」
//   （checkgreenpipe methodology 頁），推斷同樣用官方價格 API＋
//   自有編號表；依任務限制，本腳本不爬它們的資料。
//
// 用法：node scripts/probe-tw-hk-storefront.mjs
// 只做讀取探測，不寫檔。全部請求帶 User-Agent、重試與節流。

const UA = 'switch-price-site/1.0 (tw-hk storefront probe)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Connection: 'close' },
        signal: AbortSignal.timeout(60000),
      });
      return { status: r.status, text: await r.text(), finalUrl: r.url };
    } catch (e) { last = e; await sleep(1500); }
  }
  throw last;
}

async function fetchSoftwareList(baseUrl) {
  const byNsuid = new Map();
  const perPage = [];
  for (let page = 1; page <= 60; page++) {
    const { status, text } = await fetchText(`${baseUrl}?spage=${page}`);
    if (status !== 200) throw new Error(`清單 HTTP ${status}`);
    const un = text.replace(/\\"/g, '"').replace(/\\u0026/g, '&');
    const all = [...un.matchAll(/"title":"([^"]{1,120})","nsuid":"(\d+)"/g)];
    let fresh = 0;
    for (const m of all) if (!byNsuid.has(m[2])) { byNsuid.set(m[2], m[1].trim()); fresh++; }
    perPage.push({ page, raw: all.length, fresh, total: byNsuid.size });
    if (fresh === 0) break;
    await sleep(300);
  }
  return { entries: [...byNsuid.values()], perPage };
}

async function priceSample(country, start, count) {
  const ids = [];
  for (let i = 0; i < count; i++) ids.push(String(start + i));
  let onsale = 0;
  let answered = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await fetch(
      `https://api.ec.nintendo.com/v1/price?country=${country}&ids=${chunk.join(',')}&lang=zh`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) },
    );
    if (!r.ok) { console.log(`  [warn] 價格 API HTTP ${r.status}`); continue; }
    const data = await r.json();
    for (const p of data.prices ?? []) {
      answered++;
      if (p.sales_status === 'onsale') onsale++;
    }
    await sleep(200);
  }
  return { checked: count, answered, onsale };
}

async function main() {
  console.log('=== 1. 任務所提的商店前端網址 ===');
  for (const u of [
    'https://www.nintendo.com/zh-hant-tw/store/',
    'https://www.nintendo.com/zh-hant-hk/store/',
  ]) {
    const { status, finalUrl } = await fetchText(u);
    console.log(`  ${u}\n    → HTTP ${status}（最終網址 ${finalUrl}）：不存在，見報告 §1`);
    await sleep(400);
  }

  console.log('=== 2. ec.nintendo.com TW/HK 商店前端路由 ===');
  for (const u of [
    'https://ec.nintendo.com/TW/zh/',
    'https://ec.nintendo.com/TW/zh/titles',
    'https://ec.nintendo.com/TW/zh/search',
    'https://ec.nintendo.com/TW/zh/games',
    'https://ec.nintendo.com/TW/zh/titles/70010000068691',
    'https://ec.nintendo.com/api/TW/zh/search/sales?q=mario',
    'https://ec.nintendo.com/api/client-config',
  ]) {
    const { status, text } = await fetchText(u);
    const note =
      u.endsWith('70010000068691') ? '（商品頁本身 200，但 HTML 是 JS 殼，無商品資料）'
      : u.endsWith('client-config') ? '（200，但只含 myNintendo／帳號／付款網址，無目錄端點）'
      : '（404：無此路由）';
    console.log(`  ${u} → HTTP ${status}${note}（內容 ${text.length} 字元）`);
    await sleep(400);
  }

  console.log('=== 3. 台港官方軟體清單（分頁跑到底） ===');
  for (const [name, url] of [
    ['TW', 'https://www.nintendo.com/tw/software/switch/'],
    ['HK', 'https://www.nintendo.com/hk/software/switch/'],
  ]) {
    const { entries, perPage } = await fetchSoftwareList(url);
    console.log(`  ${name}：共 ${entries.length} 款（每頁 raw 約 96、fresh 約 24，其餘為精選重複）`);
    for (const p of perPage) console.log(`    spage=${p.page}：raw=${p.raw} fresh=${p.fresh} 累計=${p.total}`);
  }

  console.log('=== 4. JSON 清單端點 ===');
  for (const u of [
    'https://www.nintendo.com/zh-hant-tw/data/json/switch_software.json',
    'https://www.nintendo.com.hk/data/json/switch_software.json',
  ]) {
    const { status, text } = await fetchText(u);
    if (status !== 200) { console.log(`  ${u} → HTTP ${status}（台灣無此端點）`); continue; }
    const data = JSON.parse(text);
    const dates = data.map((d) => d.release_date).filter(Boolean).sort();
    const thumbs = new Set(data.map((d) => (String(d.thumb_img ?? '').match(/^(\d{14})\.(jpeg|jpg)$/) || [])[1]).filter(Boolean));
    console.log(`  ${u} → HTTP 200，${data.length} 筆；發售日 ${dates[0]}～${dates[dates.length - 1]}（內容停在 2022-06）；thumb_img 為 14 位編號者 ${thumbs.size} 個不重複編號`);
    await sleep(400);
  }

  console.log('=== 5. 價格 API 密度抽樣（每窗 200 個 ID，示範掃描法可行） ===');
  const windows = [
    ['TW 70010000005000 區（星露谷 5423 附近）', 'TW', 70010000005000],
    ['TW 70010000102000 區（台灣重登記區）', 'TW', 70010000102000],
    ['HK 70010000010000 區（香港早期遊戲）', 'HK', 70010000010000],
  ];
  for (const [label, cc, start] of windows) {
    const r = await priceSample(cc, start, 200);
    console.log(`  ${label}：查 ${r.checked} 個 → 回應 ${r.answered} 筆，在售 ${r.onsale} 筆`);
  }
  console.log('\n結論：完整列舉請跑 node scripts/scan-tw-hk-price-api.mjs --country TW（再跑 HK），');
  console.log('再以 node scripts/merge-scan-into-full-ids.mjs 合併命名，產出 data/tw-hk-full-ids.json。');
}

main().catch((err) => { console.error(err); process.exit(1); });
