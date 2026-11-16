// scripts/map-title-ids.mjs
// 對照種子遊戲與任天堂公開清單，找出每款遊戲的 Nintendo title ID。
//
// title ID 是任天堂 eShop 價格 API
//   https://api.ec.nintendo.com/v1/price?country={country}&ids={titleIds}&lang={lang}
// 的查詢鍵（同款遊戲在各國共用同一個 title ID）。
//
// 來源（全部是任天堂公開資料，不需登入、不需金鑰）：
//   1. 日本官網 Switch 軟體清單 XML（主要來源）
//      https://www.nintendo.co.jp/data/software/xml/switch.xml
//      每筆 <TitleInfo> 的 <LinkURL> 形如 /titles/70010000000026，數字即 title ID。
//      注意：此清單最新發售日約為 2025-05-01，Switch 2 發售（2025-06-05）之後的
//      遊戲不在其中，須由來源 4（人工核對的官方 eShop 頁面）補。
//   2. 香港官網 Switch 軟體清單 JSON（僅作「存在性」輔助確認，不提供 title ID）
//      https://www.nintendo.com.hk/data/json/switch_software.json
//      實測注意：
//      - 此清單內容停在約 2022-06，2022 年中之後的遊戲（如王國之淚、斯普拉遁 3）
//        都不在裡面；
//      - thumb_img 檔名裡的數字（如 70010000009367）與 link 的
//        store.nintendo.com.hk/<數字> 都不是價格 API 的 title ID，
//        以價格 API 驗證一律回 not_found，不可採用。
//   3. 日本 eShop 特價搜尋 API（輔助來源）
//      https://ec.nintendo.com/api/JP/ja/search/sales
//      實測注意：截至 2026-11-15，此端點回 HTTP 404（任天堂換新版 eShop 後舊
//      搜尋 API 已下線）。腳本會嘗試抓取，失敗時只警告、不中斷。
//   4. 人工核對：官方 eShop 商品頁網址 https://ec.nintendo.com/HK/zh/titles/<id>
//      僅用於日本 XML 沒有的 Switch 2 遊戲，見下方 MANUAL_OVERRIDES，每筆都註明出處，
//      並一律經過價格 API 驗證（見 verifyAgainstPriceApi）。
//
// 用法：
//   node scripts/map-title-ids.mjs
//   node scripts/map-title-ids.mjs --probe   # 只印出各來源的原始結構範例，不寫檔
//
// 產出：data/title-ids.json
//   {
//     "generated_at": "...",
//     "sources": [...],
//     "mapped":   { "<slug>": { "title_id", "title", "source",
//                               "price_verified": true | false,
//                               "price_status": "onsale" | "not_found",
//                               "regular_price_jpy": 7678 | null,
//                               "seed_jp_price": 8678 | null } },
//     "unmapped": [ { "slug", "title_zh", "title_en", "reason" } ],
//     "summary": { "total", "mapped", "price_verified", "unmapped" }
//   }
//
// 對不到的遊戲會列在 unmapped，不會讓腳本失敗；每日更新路由
// （app/api/refresh/route.ts）會跳過沒有 title ID 的遊戲並保留舊價格，
// 價格 API 回 not_found 的遊戲同樣保留舊價格、標示為待確認。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_PATH = join(ROOT, 'seed', 'catalog-2026-11-15.json');
const OUT_PATH = join(ROOT, 'data', 'title-ids.json');

const JP_XML_URL = 'https://www.nintendo.co.jp/data/software/xml/switch.xml';
const HK_JSON_URL = 'https://www.nintendo.com.hk/data/json/switch_software.json';
const JP_SALES_API = 'https://ec.nintendo.com/api/JP/ja/search/sales?count=100&offset=';
const PRICE_API = 'https://api.ec.nintendo.com/v1/price?country=JP&ids=';

const FETCH_TIMEOUT_MS = 60_000;
const HEADERS = { 'User-Agent': 'switch-price-site/1.0 (title-id mapping)' };

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// 正規化：比對標題時忽略大小寫、全半形、標點、空白。
// NFKD 會把全形數字／字母轉半形（如 ５→5、８→8），正則再去掉所有非文字數字。
// ---------------------------------------------------------------------------
export function normalizeTitle(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// 種子遊戲 slug → 日本官網清單上的日文標題（可能寫法）。
// 日文標題來自日本官網 XML 本身，人工逐一核對過；
// 腳本執行時會再以價格 API 驗證每個對到的 title ID 是否真的在售、
// 原價是否與種子檔日本價相符（不符會在輸出中標示，不視為失敗）。
const JA_TITLES = {
  'botw': ['ゼルダの伝説 ブレス オブ ザ ワイルド'],
  'totk': ['ゼルダの伝説 ティアーズ オブ ザ キングダム'],
  'mk8dx': ['マリオカート8 デラックス'],
  'smash': ['大乱闘スマッシュブラザーズ SPECIAL'],
  'acnh': ['あつまれ どうぶつの森'],
  'splatoon3': ['スプラトゥーン3'],
  'pokemon-sv': ['ポケットモンスター バイオレット'], // 種子檔只收 Violet 一版
  'kirby-fl': ['星のカービィ ディスカバリー'],
  'mario-odyssey': ['スーパーマリオ オデッセイ'],
  'mario-wonder': ['スーパーマリオブラザーズ ワンダー'],
  'luigi3': ['ルイージマンション3'],
  'fire-emblem-3h': ['ファイアーエムブレム 風花雪月'],
  'xenoblade3': ['Xenoblade3 (ゼノブレイド3)', 'ゼノブレイド3'],
  'hades': ['HADES'],
  'hollow-knight': ['Hollow Knight（ホロウナイト）', 'Hollow Knight'],
  'stardew': ['Stardew Valley'],
  'celeste': ['Celeste'],
  'balatro': ['Balatro'],
  'dave-diver': ['デイヴ・ザ・ダイバー'],
  'undertale': ['UNDERTALE'],
  'dead-cells': ['Dead Cells'],
  'ring-fit': ['リングフィット アドベンチャー'],
  'mario-party-j': ['スーパー マリオパーティ ジャンボリー'],
  'zelda-eow': ['ゼルダの伝説 知恵のかりもの'],
  'dk-bananza': ['ドンキーコング バナンザ'],
  'mk-world': ['マリオカート ワールド'],
  'pokemon-za': ['Pokémon LEGENDS Z-A', 'ポケットモンスター LEGENDS Z-A'],
  'hades2': ['Hades II'],
  'silksong': ['Hollow Knight: Silksong', 'ホロウナイト シルクソング'],
  'persona5r': ['ペルソナ5 ザ・ロイヤル'],
  'octopath2': ['オクトパストラベラー II'],
  'it-takes-two': ['It Takes Two'],
};

// 人工核對的官方 eShop 商品頁 ID（日本 XML 沒有的 Switch 2 遊戲）。
// 出處皆為任天堂官方 eShop 商品頁網址，ID 即網址最後一段；
// 仍會經過價格 API 驗證，驗證失敗會在輸出中標示 price_verified: false。
const MANUAL_OVERRIDES = {
  // 瑪利歐賽車世界：https://ec.nintendo.com/HK/zh/titles/70010000096808
  // （MarioWiki 引用之任天堂官方香港 eShop 商品頁）
  'mk-world': { title_id: '70010000096808', title: '瑪利歐賽車世界', source: 'eshop-title-page' },
  // 咚奇剛 蕉力全開：https://ec.nintendo.com/HK/zh/titles/70010000096812
  // （任天堂官方香港 eShop 商品頁）
  'dk-bananza': { title_id: '70010000096812', title: '咚奇剛 蕉力全開', source: 'eshop-title-page' },
};

// ---------------------------------------------------------------------------
// 來源 1：日本 XML。LinkURL /titles/<id> 即 title ID。
// ---------------------------------------------------------------------------
async function fetchJpXml() {
  const xml = await fetchText(JP_XML_URL);
  const entries = [];
  const re = /<TitleInfo>([\s\S]*?)<\/TitleInfo>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const name = /<TitleName>([\s\S]*?)<\/TitleName>/.exec(block)?.[1]?.trim() ?? '';
    const link = /<LinkURL>([\s\S]*?)<\/LinkURL>/.exec(block)?.[1]?.trim() ?? '';
    const id = /\/titles\/(\d+)/.exec(link)?.[1] ?? null;
    const date = /<SalesDate>([\s\S]*?)<\/SalesDate>/.exec(block)?.[1]?.trim() ?? '';
    if (name) entries.push({ title: name, title_id: id, link, sales_date: date });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 來源 2：香港 JSON。只取 title（繁體中文）作存在性比對；
// thumb_img / link 裡的數字經價格 API 驗證不是 title ID，一律不採用。
// ---------------------------------------------------------------------------
async function fetchHkJson() {
  const text = await fetchText(HK_JSON_URL);
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : (data?.software ?? data?.items ?? data?.list ?? []);
  return list.map((it) => ({ title: it.title ?? it.name ?? '' }));
}

// ---------------------------------------------------------------------------
// 來源 3：日本 eShop 特價搜尋 API。截至 2026-11-15 已回 404，僅嘗試、不強求。
// ---------------------------------------------------------------------------
async function fetchJpSales() {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`${JP_SALES_API}${offset}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const contents = data?.contents ?? [];
    for (const c of contents) {
      out.push({ title: c.formal_name ?? c.name ?? '', title_id: c.id ?? c.title_id ?? null });
    }
    const total = data?.total ?? contents.length;
    offset += contents.length;
    if (contents.length === 0 || offset >= total) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 驗證：以日本價格 API 一次查詢所有候選 title ID。
// 回傳 { [title_id]: { sales_status, regular_raw } }。
// sales_status === 'onsale' 且有 regular_price 才算驗證通過。
// ---------------------------------------------------------------------------
async function verifyAgainstPriceApi(titleIds) {
  const result = {};
  const chunked = [];
  for (let i = 0; i < titleIds.length; i += 50) chunked.push(titleIds.slice(i, i + 50));
  for (const chunk of chunked) {
    const res = await fetch(`${PRICE_API}${chunk.join(',')}&lang=ja`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`價格 API HTTP ${res.status}`);
    const data = await res.json();
    for (const p of data?.prices ?? []) {
      result[String(p.title_id)] = {
        sales_status: p.sales_status ?? 'unknown',
        regular_raw: p.regular_price ? Number(p.regular_price.raw_value) : null,
      };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
async function main() {
  const probe = process.argv.includes('--probe');
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  const games = seed.data.games;

  const [jpXml, hkJson, jpSales] = await Promise.allSettled([
    fetchJpXml(),
    fetchHkJson(),
    fetchJpSales(),
  ]);

  const sources = {
    jpXml: jpXml.status === 'fulfilled' ? jpXml.value : [],
    hkJson: hkJson.status === 'fulfilled' ? hkJson.value : [],
    jpSales: jpSales.status === 'fulfilled' ? jpSales.value : [],
  };
  for (const [k, v] of Object.entries({ jpXml, hkJson, jpSales })) {
    if (v.status === 'rejected') console.error(`[warn] ${k} 抓取失敗：${v.reason.message}`);
    else console.log(`[info] ${k}：${v.value.length} 筆`);
  }

  if (probe) {
    console.log('\n--- JP XML 前 2 筆 ---');
    console.log(JSON.stringify(sources.jpXml.slice(0, 2), null, 2));
    console.log('\n--- HK JSON 前 2 筆標題 ---');
    console.log(JSON.stringify(sources.hkJson.slice(0, 2), null, 2));
    console.log('\n--- JP sales API 前 2 筆 ---');
    console.log(JSON.stringify(sources.jpSales.slice(0, 2), null, 2));
    return;
  }

  // 日本 XML 索引：正規化日文標題 -> { title_id, title }
  const jpIndex = new Map();
  for (const e of sources.jpXml) {
    const key = normalizeTitle(e.title);
    if (key && e.title_id && !jpIndex.has(key)) jpIndex.set(key, e);
  }
  // 香港 JSON 索引：正規化繁中標題 -> 存在性（無 title ID）
  const hkIndex = new Set(sources.hkJson.map((e) => normalizeTitle(e.title)).filter(Boolean));

  const mapped = {};
  const unmapped = [];
  for (const game of games) {
    let hit = null;
    for (const cand of JA_TITLES[game.slug] ?? []) {
      if (jpIndex.has(normalizeTitle(cand))) { hit = { ...jpIndex.get(normalizeTitle(cand)), source: 'jp-xml' }; break; }
    }
    if (!hit && MANUAL_OVERRIDES[game.slug]) {
      hit = { ...MANUAL_OVERRIDES[game.slug] };
    }
    if (hit) {
      mapped[game.slug] = {
        title_id: hit.title_id,
        title: hit.title,
        source: hit.source,
        title_zh: game.titleZh,
        title_en: game.titleEn,
      };
    } else {
      const inJpXml = (JA_TITLES[game.slug] ?? []).some((c) => jpIndex.has(normalizeTitle(c)));
      const inHk = hkIndex.has(normalizeTitle(game.titleZh));
      unmapped.push({
        slug: game.slug,
        title_zh: game.titleZh,
        title_en: game.titleEn,
        reason: inJpXml || inHk
          ? '公開清單有此遊戲，但未提供可用的 title ID，需人工從官方 eShop 商品頁網址核對'
          : '日本 XML（最新約 2025-05）與香港 JSON（約停在 2022-06）都沒有此遊戲，需人工從官方 eShop 商品頁網址核對',
      });
    }
  }

  // 價格 API 驗證
  const ids = Object.values(mapped).map((m) => m.title_id);
  let verification = {};
  try {
    verification = await verifyAgainstPriceApi(ids);
    console.log(`[info] 價格 API 驗證完成：${Object.keys(verification).length} 個 ID`);
  } catch (err) {
    console.error(`[warn] 價格 API 驗證失敗：${err.message}（對照結果仍會寫出，price_verified 標為 null）`);
  }
  for (const game of games) {
    const m = mapped[game.slug];
    if (!m) continue;
    const seedJp = game.prices.find((p) => p.country === 'JP');
    const v = verification[m.title_id];
    m.seed_jp_price = seedJp ? seedJp.regularRaw : null;
    if (!v) {
      m.price_verified = null;
      m.price_status = 'unverified';
      m.regular_price_jpy = null;
    } else {
      m.price_status = v.sales_status;
      m.regular_price_jpy = v.regular_raw;
      m.price_verified = v.sales_status === 'onsale' && v.regular_raw != null;
      if (m.price_verified && m.seed_jp_price != null && v.regular_raw !== m.seed_jp_price) {
        m.price_note = `種子檔日本原價 ${m.seed_jp_price} 與目前官方原價 ${v.regular_raw} 不同（可能為 Switch 2 Edition 版定價或種子檔誤差）；更新路由採用此原版 title ID`;
      }
      if (!m.price_verified) {
        m.price_note = '價格 API 回 not_found：此 ID 目前查不到價格，更新路由會保留舊價格、標示待確認，不會讓整個更新失敗';
      }
    }
  }

  const mappedCount = Object.keys(mapped).length;
  const verifiedCount = Object.values(mapped).filter((m) => m.price_verified === true).length;
  const result = {
    generated_at: new Date().toISOString(),
    sources: [
      { name: 'jp-xml', url: JP_XML_URL, entries: sources.jpXml.length, note: '主要來源：LinkURL /titles/<id> 即 title ID；最新發售日約 2025-05-01，Switch 2 之後的遊戲不在其中' },
      { name: 'hk-json', url: HK_JSON_URL, entries: sources.hkJson.length, note: '僅作存在性輔助確認：內容約停在 2022-06；thumb_img / link 裡的數字經價格 API 驗證不是 title ID，不採用' },
      { name: 'jp-sales-api', url: 'https://ec.nintendo.com/api/JP/ja/search/sales', entries: sources.jpSales.length, note: '截至 2026-11-15 回 HTTP 404（舊搜尋 API 已下線），本次未取用' },
      { name: 'eshop-title-page', url: 'https://ec.nintendo.com/HK/zh/titles/<title_id>', entries: Object.keys(MANUAL_OVERRIDES).length, note: '人工核對：官方 eShop 商品頁網址末段即 title ID，僅用於日本 XML 沒有的 Switch 2 遊戲' },
    ],
    mapped,
    unmapped,
    summary: {
      total: games.length,
      mapped: mappedCount,
      price_verified: verifiedCount,
      unmapped: unmapped.length,
    },
  };

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8');

  console.log(`\n對照完成：${mappedCount}/${result.summary.total} 款對到 title ID（其中 ${verifiedCount} 款經價格 API 驗證在售），寫入 ${OUT_PATH}`);
  if (unmapped.length) {
    console.log('未對到：');
    for (const u of unmapped) console.log(`  - ${u.slug}（${u.title_zh} / ${u.title_en}）：${u.reason}`);
  }
  const notVerified = Object.entries(mapped).filter(([, m]) => m.price_verified !== true);
  if (notVerified.length) {
    console.log('已對到但價格 API 未驗證通過（更新時保留舊價）：');
    for (const [slug, m] of notVerified) console.log(`  - ${slug}：${m.title_id}（${m.price_status}）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
