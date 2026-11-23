// scripts/build-region-title-ids.mjs
// 為 32 款種子遊戲建立各區 NSUID 對照表（部分覆蓋），全部來自任天堂官方端點：
//   - NA（US/CA/MX/BR 等 8 國共用一組編號）：nintendo.com 官網 Algolia
//     store_all_products_<locale>（en_us / en_ca / es_mx / pt_br 各查一次）
//   - EU（GB/DE/FR/ES/IT/NL…＋AU/NZ/ZA 共 20 國共用一組編號）：
//     search.nintendo-europe.com/en/select（Solr，nsuid_txt＋product_code_txt）
//   - AU：nintendo.com/au 官網 Algolia prod_games_and_products（與 EU 編號相同，獨立驗證）
//   - JP：data/title-ids.json（日本 XML）＋日本搜尋 API
//     search.nintendo.jp/nintendo_soft/search.json（補絲之歌等 XML 缺口）
//   - TW/HK：data/tw-hk-title-ids.json（台灣／香港官方清單＋每週新作文章，已驗證）
//   - KR：nintendo.com/kr/software/switch/ 清單頁（僅精選＋新作，非完整目錄）
// 每個編號都以官方價格 API（api.ec.nintendo.com/v1/price）驗證是否在該國 onsale。
// 共享群組（2026-11-16 價格 API 12 個探測編號 × 35 國實測矩陣，見報告）：
//   NA=[US,CA,MX,BR,CL,CO,AR,PE]；EU=[GB,IE,DE,FR,ES,IT,NL,BE,AT,CH,PT,PL,CZ,DK,FI,SE,NO,AU,NZ,ZA]；
//   JP=[JP]；TW=[TW]；HK=[HK]；KR=[KR]（部分舊遊戲與 HK 共用編號，如曠野之息 70010000009367）。
// SG/MY/TH：無官方清單，12 個探測編號皆 not_found，BOTW 編號 ±60 掃描無在售——
//   本檔不含這三國，見報告。
// 不爬任何比價站資料庫；不推 GitHub、不碰 Supabase、不寫 Secret。
//
// 用法：node scripts/build-region-title-ids.mjs
// 產出：data/region-title-ids-partial.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_PATH = join(ROOT, 'seed', 'catalog-2026-11-15.json');
const JP_IDS_PATH = join(ROOT, 'data', 'title-ids.json');
const TW_HK_PATH = join(ROOT, 'data', 'tw-hk-title-ids.json');
const OUT_PATH = join(ROOT, 'data', 'region-title-ids-partial.json');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRICE_API = 'https://api.ec.nintendo.com/v1/price';

// 美洲 Algolia（nintendo.com 官網前端用的公開 search key；見 probe-region-lists.mjs）
const AM_APP = 'U3B6GR4UA3';
const AM_KEY = 'a29c6927638bfd8cee23993e51e721c9';
// 澳洲 Algolia（nintendo.com/au 首頁 RSC payload 內嵌的公開 key）
const AU_APP = 'FMW57F6ERV';
const AU_KEY = 'c8e4e9f60190ef785d167da77ba0b4fe';

function langFor(country) {
  if (country === 'JP') return 'ja';
  if (country === 'TW' || country === 'HK') return 'zh';
  return 'en';
}

export function normalizeTitle(s) {
  if (!s) return '';
  // 先去掉 ™®© 等符號：NFKD 會把 ™ 展開成 "TM"，導致
  // "Mario Kart™ 8 Deluxe" 正規化後多出 tm 而比對失敗（2026-11-16 實測教訓）。
  return String(s)
    .replace(/[™®©℠]/g, '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const EXCLUDE_RE = /upgrade pack|expansion pass|\bdlc\b|bundle|demo|trial|soundtrack|amiibo/i;

// 標題是否同一款：正規化後相等，或去掉 "The Legend of Zelda:" 等前綴後相等。
function titleMatches(storeTitle, seedTitle) {
  const a = normalizeTitle(storeTitle);
  const b = normalizeTitle(seedTitle);
  if (!a || !b) return false;
  if (a === b) return true;
  // 去掉常見前綴後再比（種子檔 titleEn 如 "Breath of the Wild" 省略了前綴）
  const prefixes = ['thelegendofzelda', 'superMario'.toLowerCase()];
  for (const p of prefixes) {
    if (a.startsWith(p) && a.slice(p.length) === b) return true;
  }
  return false;
}

// 從候選清單挑一款：7001 開頭的本體編號、標題相符、排除升級包／DLC／組合包。
// Switch 1 種子遊戲排除 "Nintendo Switch 2 Edition"；Switch 2 種子遊戲優先 Switch 2 平台。
function pickCandidate(cands, game) {
  const ok = cands.filter((c) => {
    if (!c.nsuid || !String(c.nsuid).startsWith('7001')) return false;
    if (EXCLUDE_RE.test(c.title || '')) return false;
    if (!titleMatches(c.title, game.titleEn)) return false;
    return true;
  });
  if (!ok.length) return null;
  const isS2 = game.platform === 'Switch 2';
  const scored = ok.map((c) => {
    let s = 0;
    const t = (c.title || '').toLowerCase();
    const plat = (c.platform || '').toLowerCase();
    if (isS2) {
      if (t.includes('nintendo switch 2')) s += 2;
      if (plat.includes('switch 2')) s += 2;
    } else {
      if (t.includes('nintendo switch 2 edition')) s -= 5;
      if (plat === 'nintendo switch') s += 1;
    }
    if (c.objectType === 'game') s += 1;
    return { c, s };
  });
  scored.sort((x, y) => y.s - x.s);
  return scored[0].c;
}

async function algoliaQuery(app, key, index, params) {
  const res = await fetch(`https://${app}-dsn.algolia.net/1/indexes/${index}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Algolia-Application-Id': app, 'X-Algolia-API-Key': key },
    body: JSON.stringify({ params }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Algolia ${index} HTTP ${res.status}`);
  return res.json();
}

// 美洲：不加 productType filter（各地語言值不同：en=Games、es=Juegos，
// 用 Games 會讓非英語 locale 回 0 筆——2026-11-16 實測）；改由客戶端篩 nsuid＋標題。
async function queryAmericas(locale, game) {
  const d = await algoliaQuery(AM_APP, AM_KEY, `store_all_products_${locale}`, `query=${encodeURIComponent(game.titleEn)}&hitsPerPage=10`);
  return (d.hits || []).map((h) => ({ title: h.title, nsuid: h.nsuid, platform: h.platform }));
}

async function queryAustralia(game) {
  const d = await algoliaQuery(AU_APP, AU_KEY, 'prod_games_and_products', `query=${encodeURIComponent(game.titleEn)}&hitsPerPage=10`);
  return (d.hits || []).map((h) => ({ title: h.title, nsuid: h.nsuid, platform: h.console, objectType: h.objectType }));
}

async function queryEurope(game) {
  const url = `https://search.nintendo-europe.com/en/select?q=${encodeURIComponent(game.titleEn)}&fq=type%3AGAME&rows=10&wt=json&fl=title,nsuid_txt,product_code_txt,system_names_txt`;
  const res = await fetch(url, { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`EU Solr HTTP ${res.status}`);
  const d = await res.json();
  return (d.response?.docs || []).flatMap((doc) => {
    const nsuids = (doc.nsuid_txt || []).filter((n) => String(n).startsWith('7001'));
    const pc = (doc.product_code_txt || []).find((p) => /^HAC/.test(p)) || null;
    return nsuids.map((nsuid) => ({
      title: doc.title, nsuid,
      platform: (doc.system_names_txt || []).join('/'),
      productCode: pc,
    }));
  });
}

// 日本搜尋 API：補 XML 沒有的新作（絲之歌等）與檔案誤植的編號
// （dk-bananza／mk-world 在 title-ids.json 的「JP 編號」實為台港編號，
//  價格 API 查 JP 為 not_found，見報告）。
// 查詢不加 opt_hard：Switch 2 遊戲是 hard=05_BEE，加 opt_hard=1_HAC 會查不到。
const JP_JA_QUERIES = {
  silksong: { q: 'シルクソング', pick: (t) => String(t.title || '').includes('シルクソング') && !String(t.title || '').includes('Nintendo Switch 2 Edition') },
  'hollow-knight': { q: 'ホロウナイト', pick: (t) => String(t.title || '') === 'Hollow Knight（ホロウナイト）' },
  'pokemon-za': { q: 'レジェンズ Z-A', pick: (t) => String(t.title || '') === 'Pokémon LEGENDS Z-A' },
  hades2: { q: 'ハデスII', pick: (t) => String(t.title || '') === 'HADES II' },
  'ring-fit': { q: 'リングフィット', pick: (t) => String(t.title || '').includes('リングフィット') },
  'dk-bananza': { q: 'ドンキーコングバナンザ', pick: (t) => String(t.title || '') === 'ドンキーコング バナンザ' },
  'mk-world': { q: 'マリオカートワールド', pick: (t) => String(t.title || '') === 'マリオカート ワールド' },
};
async function queryJapanSearch(game) {
  const spec = JP_JA_QUERIES[game.slug];
  if (!spec) return null;
  // 先加 opt_hard=1_HAC（Switch 1）：結果少而準（絲之歌取原版、Z-A 取原版）；
  // 查不到再不加 opt_hard（Switch 2 遊戲 hard=05_BEE，如瑪利歐賽車世界／咚奇剛）。
  for (const opt of ['1_HAC', null]) {
    const url = `https://search.nintendo.jp/nintendo_soft/search.json?q=${encodeURIComponent(spec.q)}&limit=10&page=1${opt ? `&opt_hard=${opt}` : ''}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const d = await res.json();
    const items = (d.result?.items || []).filter((it) => it.nsuid && String(it.nsuid).startsWith('7001'));
    const hit = items.find((it) => spec.pick(it));
    if (hit) return { nsuid: String(hit.nsuid), icode: hit.icode || null, ssitu: hit.ssitu || null, source: 'jp-search-api' };
    await sleep(300);
  }
  return null;
}

// 韓國清單頁（單頁精選＋新作）：以標題裡的拉丁字母比對。
async function fetchKrList() {
  const res = await fetch('https://www.nintendo.com/kr/software/switch/', {
    headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000),
  });
  const text = (await res.text()).replace(/\\"/g, '"');
  const items = [...text.matchAll(/"title":"([^"]{1,120})","nsuid":"(70010000\d{6})"/g)]
    .map((m) => ({ title: m[1], nsuid: m[2] }));
  return items;
}

function latinOf(s) {
  return String(s).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function fetchPrices(country, titleIds) {
  const result = {};
  for (let i = 0; i < titleIds.length; i += 50) {
    const chunk = titleIds.slice(i, i + 50);
    let data = null;
    for (let a = 0; a < 3 && !data; a++) {
      try {
        const res = await fetch(`${PRICE_API}?country=${country}&ids=${chunk.join(',')}&lang=${langFor(country)}`, {
          headers: { 'User-Agent': 'shawn-game-studio/1.0 (region mapping)' },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch { await sleep(1200); }
    }
    if (!data) continue;
    for (const p of data?.prices ?? []) {
      result[String(p.title_id)] = {
        sales_status: p.sales_status ?? 'unknown',
        regular: p.regular_price ? `${p.regular_price.amount} ${p.regular_price.currency}` : null,
      };
    }
    await sleep(250);
  }
  return result;
}

async function main() {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  const games = seed.data.games;
  const jpIds = JSON.parse(readFileSync(JP_IDS_PATH, 'utf8'));
  const twHk = JSON.parse(readFileSync(TW_HK_PATH, 'utf8'));

  // 已驗證的 KR 編號（價格 API 實測，見報告 §KR；非清單頁比對）：
  const KR_VERIFIED = {
    totk: '70010000063716', // KR 價 onsale；JP 63713／US 63714／EU 63715／TW·HK 63717 各不相同
    botw: '70010000009367', // 與 HK 共用；TW 102734 在 KR not_found
  };

  const krList = await fetchKrList();
  console.log(`[info] KR 清單頁 nsuid 項目：${krList.length}（單頁精選＋新作，非完整目錄）`);

  // 人工備註（價格 API／來源交叉核對後的手動結論）
  const GAME_NOTES = {
    'it-takes-two': 'EU 70010000121107 與 TW/HK 70010000121109 是 Switch 2 Edition（Solr system=Nintendo Switch 2；US/AU/JP 原版 49281/49282/49280 在當地已 sales_termination／not_found）；Switch 1 原版 EU 編號不在 Solr 前 10 筆，49283 猜測經價格 API 證偽（GB/TW/HK 皆 not_found）',
    'ring-fit': '下載版已停售：JP 搜尋 API 回 nsuid=null／not_found，TW not_found、HK sales_termination、AU 70010000004565 在 AU 查無價；僅盒裝＋環同捆在售',
  };

  const outGames = {};
  const stats = { total: games.length, na: 0, eu: 0, au: 0, jp: 0, tw: 0, hk: 0, kr: 0 };

  for (const game of games) {
    const entry = {
      titleZh: game.titleZh, titleEn: game.titleEn, slug: game.slug,
      jpTitleId: jpIds.mapped?.[game.slug]?.title_id ?? twHk.mapped?.[game.slug]?.title_id ?? null,
      regionIds: {}, groups: {}, productCodes: {}, priceVerified: {}, notes: [],
    };
    if (GAME_NOTES[game.slug]) entry.notes.push(GAME_NOTES[game.slug]);
    // --- JP：檔案編號＋日本搜尋 API 交叉核對。搜尋 API 命中且 ssitu=onsale 時
    // 優先採用（修正 title-ids.json 誤把台港編號當 JP 編號的兩款：dk-bananza／mk-world；
    // 也補上 pokemon-za／hades2／silksong 等檔案缺口）。
    if (JP_JA_QUERIES[game.slug]) {
      try {
        const hit = await queryJapanSearch(game);
        if (hit && hit.ssitu === 'onsale') {
          if (entry.jpTitleId && entry.jpTitleId !== hit.nsuid) {
            entry.notes.push(`JP 編號修正：檔案值 ${entry.jpTitleId} 實為台港編號（查 JP 為 not_found），改用日本搜尋 API 的 ${hit.nsuid}（icode=${hit.icode}）`);
          } else if (!entry.jpTitleId) {
            entry.notes.push(`JP 編號來自日本搜尋 API（${hit.source}），icode=${hit.icode}，待價格 API 驗證`);
          }
          entry.jpTitleId = hit.nsuid;
        } else if (!entry.jpTitleId) {
          entry.notes.push('JP 搜尋 API 無在售命中（如下載版已停售，見 ring-fit）');
        }
        await sleep(400);
      } catch (e) { entry.notes.push(`JP 搜尋 API 失敗：${e.message}`); }
    }
    // --- TW / HK：沿用已驗證對照檔 ---
    const th = twHk.mapped?.[game.slug];
    if (th?.tw_title_id) entry.regionIds.TW = th.tw_title_id;
    if (th?.hk_title_id) entry.regionIds.HK = th.hk_title_id;
    // --- KR：清單頁拉丁比對＋已驗證編號 ---
    if (KR_VERIFIED[game.slug]) entry.regionIds.KR = KR_VERIFIED[game.slug];
    else {
      const want = latinOf(game.titleEn);
      const hit = krList.find((it) => {
        const lat = latinOf(it.title);
        return lat && (lat === want || lat.startsWith(want) || want.startsWith(lat));
      });
      if (hit) entry.regionIds.KR = hit.nsuid;
    }
    // --- NA：en_us / en_ca / es_mx / pt_br 各查 ---
    const naLocales = { US: 'en_us', CA: 'en_ca', MX: 'es_mx', BR: 'pt_br' };
    for (const [cc, locale] of Object.entries(naLocales)) {
      try {
        const cands = await queryAmericas(locale, game);
        const pick = pickCandidate(cands, game);
        if (pick) entry.regionIds[cc] = pick.nsuid;
        await sleep(250);
      } catch (e) { entry.notes.push(`NA ${cc}（${locale}）查詢失敗：${e.message}`); }
    }
    // --- EU：Solr ---
    try {
      const cands = await queryEurope(game);
      const pick = pickCandidate(cands, game);
      if (pick) {
        entry.regionIds.GB = pick.nsuid;
        entry.regionIds.DE = pick.nsuid;
        entry.regionIds.FR = pick.nsuid;
        if (pick.productCode) entry.productCodes.EU = pick.productCode;
      }
      await sleep(250);
    } catch (e) { entry.notes.push(`EU Solr 查詢失敗：${e.message}`); }
    // --- AU：Algolia（與 EU 編號相同時仍獨立記錄 AU 來源編號） ---
    try {
      const cands = await queryAustralia(game);
      const pick = pickCandidate(cands, game);
      if (pick) entry.regionIds.AU = pick.nsuid;
      await sleep(250);
    } catch (e) { entry.notes.push(`AU Algolia 查詢失敗：${e.message}`); }

    // 共享群組標記（價格 API 矩陣實測，見報告 §0）
    if (entry.regionIds.US) entry.groups.NA = ['US', 'CA', 'MX', 'BR', 'CL', 'CO', 'AR', 'PE'];
    if (entry.regionIds.GB) entry.groups.EU = ['GB', 'IE', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'CH', 'PT', 'PL', 'CZ', 'DK', 'FI', 'SE', 'NO', 'AU', 'NZ', 'ZA'];
    if (entry.jpTitleId) entry.groups.JP = ['JP'];
    if (entry.regionIds.TW) entry.groups.TW = ['TW'];
    if (entry.regionIds.HK) entry.groups.HK = ['HK'];
    if (entry.regionIds.KR) entry.groups.KR = ['KR'];

    const key = entry.jpTitleId || game.slug;
    outGames[key] = entry;
    if (entry.regionIds.US) stats.na++;
    if (entry.regionIds.GB) stats.eu++;
    if (entry.regionIds.AU) stats.au++;
    if (entry.jpTitleId) stats.jp++;
    if (entry.regionIds.TW) stats.tw++;
    if (entry.regionIds.HK) stats.hk++;
    if (entry.regionIds.KR) stats.kr++;
    console.log(`[info] ${game.slug}：JP=${entry.jpTitleId ?? '-'} US=${entry.regionIds.US ?? '-'} GB=${entry.regionIds.GB ?? '-'} AU=${entry.regionIds.AU ?? '-'} TW=${entry.regionIds.TW ?? '-'} HK=${entry.regionIds.HK ?? '-'} KR=${entry.regionIds.KR ?? '-'}`);
  }

  // --- 價格驗證：每國一次查全部編號（≤50 個） ---
  const verifyCountries = ['US', 'CA', 'MX', 'BR', 'GB', 'DE', 'FR', 'AU', 'NZ', 'ZA', 'JP', 'TW', 'HK', 'KR'];
  for (const cc of verifyCountries) {
    const ids = [...new Set(Object.values(outGames).flatMap((g) => {
      if (cc === 'JP') return g.jpTitleId ? [g.jpTitleId] : [];
      return g.regionIds[cc] ? [g.regionIds[cc]] : [];
    }))];
    if (!ids.length) continue;
    const res = await fetchPrices(cc, ids);
    for (const g of Object.values(outGames)) {
      const id = cc === 'JP' ? g.jpTitleId : g.regionIds[cc];
      if (!id || !res[id]) continue;
      g.priceVerified[cc] = res[id].sales_status === 'onsale' ? `onsale ${res[id].regular ?? ''}`.trim() : res[id].sales_status;
    }
    console.log(`[info] 價格驗證 ${cc}：${ids.length} 個編號`);
  }
  // EU 群組成員國抽查（ES/IT/NL 以 GB 編號驗證共用）
  for (const cc of ['ES', 'IT', 'NL']) {
    const ids = [...new Set(Object.values(outGames).map((g) => g.regionIds.GB).filter(Boolean))];
    const res = await fetchPrices(cc, ids);
    let ok = 0;
    for (const g of Object.values(outGames)) {
      if (g.regionIds.GB && res[g.regionIds.GB]?.sales_status === 'onsale') { g.priceVerified[cc] = `onsale ${res[g.regionIds.GB].regular ?? ''}`.trim(); ok++; }
    }
    console.log(`[info] 價格驗證 ${cc}（EU 編號共用抽查）：${ok}/${ids.length} onsale`);
  }

  const result = {
    generated_at: new Date().toISOString(),
    sources: [
      { name: 'na-algolia', url: 'https://U3B6GR4UA3-dsn.algolia.net/1/indexes/store_all_products_{en_us,en_ca,es_mx,pt_br}/query', note: 'nintendo.com 官網 Algolia（公開 search key）；不加 productType filter（各地語言值不同），客戶端篩 nsuid＋標題' },
      { name: 'eu-solr', url: 'https://search.nintendo-europe.com/en/select?q={title}&fq=type:GAME&rows=10&wt=json&fl=title,nsuid_txt,product_code_txt,system_names_txt', note: '任天堂歐洲官網 Solr；20,217 筆 GAME 有 nsuid；product_code_txt 僅部分遊戲有（Switch 2 新作多無）' },
      { name: 'au-algolia', url: 'https://FMW57F6ERV-dsn.algolia.net/1/indexes/prod_games_and_products/query', note: 'nintendo.com/au 官網 Algolia（公開 search key）；1,707 筆；編號與 EU 相同，獨立驗證' },
      { name: 'jp-xml', url: 'https://www.nintendo.co.jp/data/software/xml/switch.xml', note: '日本官網 XML，10,045 個 title ID；最新約 2025-05-01；<InitialCode> 即 product code' },
      { name: 'jp-search-api', url: 'https://search.nintendo.jp/nintendo_soft/search.json?q={q}&limit=5&page=1&opt_hard=1_HAC', note: '日本官網搜尋 API（nintendeals noj 曾用，已驗證仍通）；total 約 29,995 筆 Switch 軟體；回 nsuid＋icode（product code 核心 5 碼）＋ssitu＋價格' },
      { name: 'tw-hk-lists', url: 'https://www.nintendo.com/{tw,hk}/software/switch/', note: '台港官方清單（Next.js RSC payload，title＋nsuid）；沿用 data/tw-hk-title-ids.json 已驗證對照' },
      { name: 'kr-list', url: 'https://www.nintendo.com/kr/software/switch/', note: '韓國官方清單頁（單頁精選＋新作，僅 13-17 個 nsuid 項目，非完整目錄）；另 2 款以價格 API 驗證編號補上（見報告）' },
      { name: 'price-api', url: 'https://api.ec.nintendo.com/v1/price?country={cc}&ids={ids}&lang={lang}', note: '官方價格 API；一次最多 50 個 ID；lang：JP=ja、TW/HK=zh、其餘 en' },
    ],
    sharingGroups: {
      NA: ['US', 'CA', 'MX', 'BR', 'CL', 'CO', 'AR', 'PE'],
      EU: ['GB', 'IE', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'CH', 'PT', 'PL', 'CZ', 'DK', 'FI', 'SE', 'NO', 'AU', 'NZ', 'ZA'],
      JP: ['JP'], TW: ['TW'], HK: ['HK'], KR: ['KR'],
      evidence: '2026-11-16 價格 API 矩陣：12 個探測編號（NA/EU/JP/TW/HK/KR 各 2-3 個）× 35 國；SG/MY/TH 全部 not_found',
      note: '每款遊戲最多只需 6 組編號（NA／EU／JP／TW／HK／KR），不必 35 個；TW 與 HK 多數共用，KR 部分舊遊戲與 HK 共用',
    },
    games: outGames,
    summary: stats,
  };

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`\n完成：NA ${stats.na}/32、EU ${stats.eu}/32、AU ${stats.au}/32、JP ${stats.jp}/32、TW ${stats.tw}/32、HK ${stats.hk}/32、KR ${stats.kr}/32，寫入 ${OUT_PATH}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
