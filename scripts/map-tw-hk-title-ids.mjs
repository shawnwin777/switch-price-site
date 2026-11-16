// scripts/map-tw-hk-title-ids.mjs
// 對照種子遊戲與台灣／香港任天堂官方清單，找出每款遊戲的台港 eShop title ID，
// 並以價格 API 抓 TW 與 HK 價格。
//
// 背景（2026-11-16 實測結論，見產出檔 sources）:
// - 台灣 eShop 於 2025-09-09 才開張。台港 eShop 的 title ID（nsuid）與日本不同：
//   多數遊戲台港共用同一組編號（例如瑪利歐驚奇 TW=HK=70010000068691，日本是
//   70010000068687）；但 2017-2019 年的舊遊戲在台灣是 2025-09 開店時重新登記的
//   70010000102xxx 新編號，香港則沿用舊編號（例如曠野之息 TW 70010000102734，
//   HK 70010000009367），兩邊必須分開查。
// - 台灣沒有 HK JSON 那種 data/json 清單：
//   https://www.nintendo.com/zh-hant-tw/data/json/switch_software.json 回 404。
//   台灣官方遊戲清單是 https://www.nintendo.com/tw/software/switch/（Next.js 頁面，
//   資料嵌在 RSC payload 的 Contentful 項目裡，每筆有 title + nsuid；分頁用
//   ?spage=N，每頁約 96 筆但只有約 24 筆是新頁內容，其餘是精選＋最新重複項）。
//   實測共 166 款（香港同結構清單 176 款）。此清單只含任天堂發行＋部分第三方，
//   不是台灣 eShop 的全部目錄（eShop 另有數百款下載版遊戲不在此清單上）。
// - 清單上沒有的遊戲，用以下方法補（皆已實測驗證，見 MANUAL_TW_OVERRIDES 的出處）：
//   (a) 港台每週「Nintendo eShop 新作軟體資訊」文章內文嵌的 Contentful 項目
//       自帶 title + nsuid（例如黑帝斯 II 出自香港 2025-09-26 文章，歧路旅人 II
//       出自香港 2026-10-02 文章）；
//   (b) 價格 API 在 JP title ID 附近掃描（dave-diver TW 70010000060370），再以
//       第三方比價站 checkgreenpipe 的台港價格交叉核對（DAVE 台灣 $10.63 ≒ 350
//       台幣、香港 $17.84 ≒ 140 港幣，與 API 數字一致才算確認）；
//   (c) 寶可夢 朱／紫：台灣清單只有朱（70010000053969），紫是日本 ID +4
//       （70010000053974，與朱的 +4 規律一致，台港價與朱完全相同）。
// - 反面驗證（同樣重要）：星露谷物語、黑帝斯、空洞騎士、蔚藍、Undertale、
//   女神異聞錄5 皇家版、空洞騎士：絲之歌在台灣官方清單、107 篇港台每週新作
//   文章、checkgreenpipe 的台港價格表裡都沒有，價格 API 在日本 ID 附近也掃
//   不到——截至 2026-11-16，台灣 eShop 沒有這幾款（星露谷在台灣只有實體卡，
//   約 980-1090 元，與下載版無關）。死亡細胞則是香港有（HKD 188，現特價 94）
//   但台灣沒有，香港編號未找到。
// - 曾經誤判、已排除的候選編號（不要再採用）：
//   70010000058126（不是歧路旅人 II，真正的是 70010000108551）、
//   70010000049288（不是雙人成行，真正的是 70010000121109）、
//   70010000042364（不是女神異聞錄5 皇家版，台港價 600/170 與該遊戲定價不符，
//   且 checkgreenpipe 沒有該遊戲的台港價）、70010000020843（不是絲之歌，
//   HKD 329 與絲之歌約 $19.99 的定價不符）。
//
// 用法：
//   node scripts/map-tw-hk-title-ids.mjs
//   node scripts/map-tw-hk-title-ids.mjs --probe   # 只印各來源結構範例，不寫檔
//
// 產出：data/tw-hk-title-ids.json
//   {
//     "generated_at": "...",
//     "sources": [...],
//     "mapped":   { "<slug>": { "title_id", "tw_title_id", "hk_title_id",
//                               "title_zh", "title_en", "source",
//                               "tw_price": {regularRaw, effectiveRaw, currency,
//                                            discountPct, saleEnd} | null,
//                               "hk_price": {...} | null,
//                               "price_verified": true | false, ... } },
//     "unmapped": [ { "slug", "title_zh", "title_en", "reason" } ],
//     "tw_only_games": [ { "slug", "title_zh", "tw_title_id", "source" } ],
//     "summary": { "total", "mapped_tw", "mapped_hk", "tw_priced", "hk_priced" }
//   }

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_PATH = join(ROOT, 'seed', 'catalog-2026-11-15.json');
const TITLE_IDS_PATH = join(ROOT, 'data', 'title-ids.json');
const OUT_PATH = join(ROOT, 'data', 'tw-hk-title-ids.json');

const TW_LIST_URL = 'https://www.nintendo.com/tw/software/switch/';
const HK_LIST_URL = 'https://www.nintendo.com/hk/software/switch/';
const TW_JSON_URL = 'https://www.nintendo.com/zh-hant-tw/data/json/switch_software.json';
const HK_JSON_URL = 'https://www.nintendo.com.hk/data/json/switch_software.json';
const JP_XML_URL = 'https://www.nintendo.co.jp/data/software/xml/switch.xml';
const PRICE_API = 'https://api.ec.nintendo.com/v1/price';

const FETCH_TIMEOUT_MS = 60_000;
const HEADERS = { 'User-Agent': 'switch-price-site/1.0 (tw-hk title-id mapping)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      return { status: res.status, text: await res.text() };
    } catch (err) {
      lastErr = err;
      await sleep(1500);
    }
  }
  throw lastErr;
}

// 與 scripts/map-title-ids.mjs 相同的正規化：忽略大小寫、全半形、標點、空白。
export function normalizeTitle(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// 種子遊戲在台灣官方清單上的中文標題寫法（人工逐一核對）。
const ZH_TITLES = {
  'botw': ['薩爾達傳說 曠野之息'],
  'totk': ['薩爾達傳說 王國之淚'],
  'mk8dx': ['瑪利歐賽車8 豪華版'],
  'smash': ['任天堂明星大亂鬥 特別版'],
  'acnh': ['集合啦！動物森友會'],
  'splatoon3': ['斯普拉遁 3'],
  'pokemon-sv': ['寶可夢 朱'], // 清單只有朱；紫見 MANUAL_TW_OVERRIDES
  'kirby-fl': ['星之卡比 探索發現'],
  'mario-odyssey': ['超級瑪利歐 奧德賽'],
  'mario-wonder': ['超級瑪利歐兄弟 驚奇'],
  'luigi3': ['路易吉洋樓3', '路易吉洋樓３'],
  'fire-emblem-3h': ['Fire Emblem 風花雪月'],
  'xenoblade3': ['異度神劍3'],
  'ring-fit': ['健身環大冒險'],
  'mario-party-j': ['超級瑪利歐派對 空前盛會'],
  'zelda-eow': ['薩爾達傳說 智慧的再現'],
  'pokemon-za': ['寶可夢傳說 Z-A'],
};

// 台灣／香港官方清單上沒有，但以其他官方來源確認的編號。
// 每筆都經過價格 API 驗證（tw/hk 皆 onsale 才算數），出處見註解。
const MANUAL_TW_OVERRIDES = {
  // 寶可夢 朱／紫：台灣清單只有朱 70010000053969；紫 70010000053974 =
  // 日本紫 70010000053970 + 4，與朱（日本緋紅 70010000053965 + 4 = 53969）
  // 的規律一致，且台港價與朱完全相同（TW 1339 / HK 329）。
  'pokemon-sv': { tw_title_id: '70010000053974', hk_title_id: '70010000053974', source: 'price-api-plus4', note: '種子檔只收 Violet 一版；台灣清單另有朱 70010000053969（見 related_ids）' },
  // 潛水員戴夫：價格 API 在日本 ID 70010000060371 附近唯一在售的台港編號，
  // checkgreenpipe 交叉核對：台灣 $10.63 ≒ 350 台幣、香港 $17.84 ≒ 140 港幣。
  'dave-diver': { tw_title_id: '70010000060370', hk_title_id: '70010000060370', source: 'price-api-scan+checkgreenpipe', note: '另有 Switch 2 Edition 70010000111456（台港同價 350/140）' },
  // 咚奇剛 蕉力全開／瑪利歐賽車世界：任天堂官方香港 eShop 商品頁網址末段，
  // 沿用 data/title-ids.json 的人工核對結果，台港價已驗證。
  'dk-bananza': { tw_title_id: '70010000096812', hk_title_id: '70010000096812', source: 'eshop-title-page', note: 'https://ec.nintendo.com/HK/zh/titles/70010000096812' },
  'mk-world': { tw_title_id: '70010000096808', hk_title_id: '70010000096808', source: 'eshop-title-page', note: 'https://ec.nintendo.com/HK/zh/titles/70010000096808' },
  // 黑帝斯 II：香港「Nintendo eShop 新作軟體資訊 9月26日（五）」文章內文
  // （https://www.nintendo.com/hk/topics/article/7BMRVaeD0NTl2m7Z0HZXu1）
  // 的 Contentful 項目：Hades II nsuid 70010000103276；
  // Switch 2 Edition 70010000105996（台港同價 748/199）。
  'hades2': { tw_title_id: '70010000103276', hk_title_id: '70010000103276', source: 'hk-weekly-article', note: '香港 2025-09-26 新作軟體資訊文章；另有 S2E 70010000105996（台港同價）' },
  // 小丑牌：香港「Nintendo eShop 新作軟體資訊 3月6日（五）」文章內文
  // （https://www.nintendo.com/hk/topics/article/6shoAGSBw9aLS5KKUnMQH1）的
  // Contentful 項目：Balatro nsuid 70010000119174。
  'balatro': { tw_title_id: '70010000119174', hk_title_id: '70010000119174', source: 'hk-weekly-article', note: '香港 2026-03-06 新作軟體資訊文章' },
  // 歧路旅人 II：香港「Nintendo eShop 新作軟體資訊 10月2日（五）」文章內文
  // （https://www.nintendo.com/hk/topics/article/1E5mZKH2Ny24ODjEW8quqo）的
  // Contentful 項目：歧路旅人II OCTOPATH TRAVELER II nsuid 70010000108551。
  'octopath2': { tw_title_id: '70010000108551', hk_title_id: '70010000108551', source: 'hk-weekly-article', note: '香港 2026-10-02 新作軟體資訊文章' },
  // 雙人成行：香港「Nintendo eShop 新作軟體資訊 10月16日（五）」文章內文
  // （https://www.nintendo.com/hk/topics/article/5c8fMGpYFZINcNWeFldzc8）的
  // Contentful 項目：雙人成行 (It Takes Two) nsuid 70010000121109。
  'it-takes-two': { tw_title_id: '70010000121109', hk_title_id: '70010000121109', source: 'hk-weekly-article', note: '香港 2026-10-16 新作軟體資訊文章' },
};

// 未對到的遊戲：逐款寫明原因（皆為 2026-11-16 實測結果）。
const UNMAPPED_NOTES = {
  // 台灣 eShop 沒有；香港也沒有（價格 API 掃描＋checkgreenpipe 皆無台港價）。
  'hades': '台灣 eShop 沒有；香港也沒有。香港舊 JSON（2022-06）與 107 篇港台每週新作文章皆無；checkgreenpipe 無台港價',
  'hollow-knight': '台灣 eShop 沒有；香港也沒有。PTT 2025-08 討論亦指港區沒有；checkgreenpipe 無台港價',
  // 任務背景稱「台灣 eShop 有賣」，實測推翻：台灣官方清單無、107 篇港台每週
  // 新作文章無、價格 API 在日本 ID 附近掃不到、checkgreenpipe 無台港價。
  // 台灣只有實體卡（約 980-1090 元），與下載版無關。
  'stardew': '台灣 eShop 沒有下載版（任務背景「台灣 eShop 有賣」經實測不成立：官方清單無、每週新作文章無、價格 API 掃不到、checkgreenpipe 無台港價）；台灣只有實體卡約 980-1090 元',
  'celeste': '台灣 eShop 沒有；香港也沒有。checkgreenpipe 無台港價；價格 API 附近掃到的 70010000010825/10828 是其他遊戲（HKD 457/90，與蔚藍定價不符）',
  'undertale': '台灣 eShop 沒有；香港也沒有。checkgreenpipe 無台港價',
  // 香港有（checkgreenpipe：HKD 188，現 50% off 到 94），但台灣沒有；
  // 香港編號未找到（不在日本 ID 附近，也不在每週新作文章內）。
  'dead-cells': '台灣 eShop 沒有；香港有（HKD 188，現 50% off 到 94），但香港編號未找到',
  'persona5r': '台灣 eShop 沒有；香港也沒有。checkgreenpipe 無台港價；曾懷疑的 70010000042364（台港 600/170）與該遊戲定價不符，已排除',
  // 台灣 eShop 沒有；香港也沒有。香港 2025-09-05 新作文章（發售當週）無此遊戲；
  // 曾懷疑的 70010000020843（HKD 329）與絲之歌約 $19.99 的定價不符，已排除。
  'silksong': '台灣 eShop 沒有；香港也沒有。發售當週（2025-09-05）香港新作文章無此遊戲；checkgreenpipe 無台港價；台灣媒體亦稱開店初期尚未上架',
};

// ---------------------------------------------------------------------------
// 來源 1：台灣／香港官方軟體清單（Next.js 頁面，RSC payload 含 title + nsuid）。
// 分頁 ?spage=N，每頁約 96 筆但多數是精選＋最新重複項；抓到沒有新 nsuid 就停。
// ---------------------------------------------------------------------------
async function fetchSoftwareList(baseUrl) {
  const byNsuid = new Map();
  for (let page = 1; page <= 60; page++) {
    const { status, text } = await fetchText(`${baseUrl}?spage=${page}`);
    if (status !== 200) throw new Error(`清單 HTTP ${status}（${baseUrl}?spage=${page}）`);
    // RSC payload 是 \" 轉義過的 JSON 字串，先還原再抓 title/nsuid。
    const unescaped = text.replace(/\\"/g, '"').replace(/\\u0026/g, '&');
    let fresh = 0;
    for (const m of unescaped.matchAll(/"title":"([^"]{1,120})","nsuid":"(\d+)"/g)) {
      const nsuid = m[2];
      if (!byNsuid.has(nsuid)) {
        byNsuid.set(nsuid, { title: m[1].trim(), nsuid });
        fresh++;
      }
    }
    if (fresh === 0) break;
    await sleep(300);
  }
  return [...byNsuid.values()];
}

// ---------------------------------------------------------------------------
// 來源 2：香港 JSON（僅作存在性輔助；內容約停在 2022-06，無 nsuid）。
// ---------------------------------------------------------------------------
async function fetchHkJsonTitles() {
  const { status, text } = await fetchText(HK_JSON_URL);
  if (status !== 200) return { status, titles: [] };
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : [];
  return { status, titles: list.map((it) => it.title ?? '') };
}

// ---------------------------------------------------------------------------
// 來源 3：價格 API。一次最多 50 個 ID；失敗重試、缺價只記錄不中斷。
// 回傳 { [title_id]: { sales_status, regularRaw, effectiveRaw, currency,
//                      discountPct, saleEnd } }。
// ---------------------------------------------------------------------------
async function fetchPrices(country, titleIds) {
  const result = {};
  const lang = country === 'JP' ? 'ja' : country === 'TW' || country === 'HK' ? 'zh' : 'en';
  for (let i = 0; i < titleIds.length; i += 50) {
    const chunk = titleIds.slice(i, i + 50);
    let data = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `${PRICE_API}?country=${country}&ids=${chunk.join(',')}&lang=${lang}`,
          { headers: HEADERS, signal: AbortSignal.timeout(30_000) },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
        break;
      } catch (err) {
        if (attempt === 2) console.error(`[warn] 價格 API ${country} 失敗（略過此批）：${err.message}`);
        await sleep(1500);
      }
    }
    if (!data) continue;
    for (const p of data?.prices ?? []) {
      const regularRaw = p.regular_price ? Number(String(p.regular_price.raw_value).replace(/,/g, '')) : null;
      const effectiveRaw = p.discount_price
        ? Number(String(p.discount_price.raw_value).replace(/,/g, ''))
        : regularRaw;
      const discountPct =
        regularRaw != null && effectiveRaw != null && effectiveRaw < regularRaw
          ? Math.round((1 - effectiveRaw / regularRaw) * 100)
          : null;
      result[String(p.title_id)] = {
        sales_status: p.sales_status ?? 'unknown',
        regularRaw,
        effectiveRaw,
        currency: p.regular_price?.currency ?? p.discount_price?.currency ?? null,
        discountPct,
        saleEnd: p.discount_price?.end_datetime ?? null,
      };
    }
    await sleep(250);
  }
  return result;
}

function toPriceEntry(v) {
  if (!v || v.sales_status !== 'onsale' || v.regularRaw == null) return null;
  return {
    regularRaw: v.regularRaw,
    effectiveRaw: v.effectiveRaw,
    currency: v.currency,
    discountPct: v.discountPct,
    saleEnd: v.saleEnd,
  };
}

// 台灣清單標題轉 slug（供 tw_only_games 用）：只取標題裡的拉丁字母／數字部分
// （中文一律去掉，免得混進中文 slug）；拉丁部分少於 2 字元或與已用 slug
// 撞號時，用 tw-<nsuid> 作穩定 fallback（nsuid 才是唯一識別碼）。
export function slugFromTwTitle(title, nsuid) {
  const latin = String(title)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (latin.length >= 2) return latin;
  return `tw-${nsuid}`;
}

// ---------------------------------------------------------------------------
async function main() {
  const probe = process.argv.includes('--probe');
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
  const games = seed.data.games;
  const jpIds = JSON.parse(readFileSync(TITLE_IDS_PATH, 'utf8'));

  // 台灣清單 JSON 端點先確認 404（仿香港路徑不存在）。
  const twJsonProbe = await fetchText(TW_JSON_URL).catch((e) => ({ status: 0, text: '', error: e.message }));
  console.log(`[info] 台灣 JSON 清單 ${TW_JSON_URL}：HTTP ${twJsonProbe.status}（預期 404，無此端點）`);

  const [twList, hkList, hkJson] = await Promise.all([
    fetchSoftwareList(TW_LIST_URL),
    fetchSoftwareList(HK_LIST_URL),
    fetchHkJsonTitles(),
  ]);
  console.log(`[info] 台灣官方清單：${twList.length} 款；香港官方清單：${hkList.length} 款；香港 JSON：${hkJson.titles.length} 筆`);

  if (probe) {
    console.log('\n--- TW 清單前 3 筆 ---');
    console.log(JSON.stringify(twList.slice(0, 3), null, 2));
    console.log('\n--- HK 清單前 3 筆 ---');
    console.log(JSON.stringify(hkList.slice(0, 3), null, 2));
    console.log('\n--- HK JSON 前 3 個標題 ---');
    console.log(JSON.stringify(hkJson.titles.slice(0, 3), null, 2));
    return;
  }

  const twIndex = new Map();
  for (const e of twList) {
    const key = normalizeTitle(e.title);
    if (key && !twIndex.has(key)) twIndex.set(key, e);
  }
  const hkIndex = new Map();
  for (const e of hkList) {
    const key = normalizeTitle(e.title);
    if (key && !hkIndex.has(key)) hkIndex.set(key, e);
  }
  const hkJsonSet = new Set(hkJson.titles.map((t) => normalizeTitle(t)).filter(Boolean));
  void hkJsonSet; // 僅作存在性輔助紀錄（香港舊 JSON 約停在 2022-06），對照不依賴它

  const mapped = {};
  const unmapped = [];
  const matchedTwNsuids = new Set();

  for (const game of games) {
    const jp = jpIds.mapped?.[game.slug];
    let twHit = null;
    let hkHit = null;
    for (const cand of ZH_TITLES[game.slug] ?? []) {
      if (!twHit && twIndex.has(normalizeTitle(cand))) twHit = twIndex.get(normalizeTitle(cand));
      if (!hkHit && hkIndex.has(normalizeTitle(cand))) hkHit = hkIndex.get(normalizeTitle(cand));
    }
    const manual = MANUAL_TW_OVERRIDES[game.slug];
    // 人工對照優先：種子檔只收某一版本時（如寶可夢只收紫），清單上的另一版本
    // （朱）只能當關聯編號，不能當成本款的編號。
    const twId = manual?.tw_title_id ?? twHit?.nsuid ?? null;
    const hkId = manual?.hk_title_id ?? hkHit?.nsuid ?? null;
    const usedManual = Boolean(manual && (twId === manual.tw_title_id || hkId === manual.hk_title_id));
    if (twHit) matchedTwNsuids.add(twHit.nsuid);
    if (hkHit) matchedTwNsuids.add(hkHit.nsuid);
    if (!twId && !hkId) {
      unmapped.push({
        slug: game.slug,
        title_zh: game.titleZh,
        title_en: game.titleEn,
        reason: UNMAPPED_NOTES[game.slug] ?? '台灣官方清單（166 款）、港台每週新作文章（2025-07～2026-11，共 107 篇）、價格 API 日本 ID 附近掃描、checkgreenpipe 台港價格表皆無此遊戲；截至 2026-11-16 台灣 eShop 沒有這款',
      });
      continue;
    }
    const entry = {
      title_id: jp?.title_id ?? null,
      tw_title_id: twId,
      hk_title_id: hkId,
      title_zh: game.titleZh,
      title_en: game.titleEn,
      source: usedManual ? manual.source : twHit ? 'tw-list' : 'hk-list',
      tw_price: null,
      hk_price: null,
      price_verified: false,
    };
    if (manual?.note) entry.note = manual.note;
    // 關聯編號（同一遊戲的另一版本／另一區編號，供對照用）。
    const related = {};
    if (game.slug === 'pokemon-sv' && twHit) related.scarlet_tw = twHit.nsuid;
    if (game.slug === 'hades2') related.switch2_edition_tw = '70010000105996';
    if (game.slug === 'dave-diver') related.switch2_edition_tw = '70010000111456';
    if (Object.keys(related).length) entry.related_ids = related;
    mapped[game.slug] = entry;
  }

  // 價格驗證：TW 與 HK 各查一次所有編號。
  const allIds = [...new Set(Object.values(mapped).flatMap((m) => [m.tw_title_id, m.hk_title_id]).filter(Boolean))];
  const twPrices = await fetchPrices('TW', allIds);
  const hkPrices = await fetchPrices('HK', allIds);
  let twPriced = 0;
  let hkPriced = 0;
  for (const [slug, m] of Object.entries(mapped)) {
    const tp = m.tw_title_id ? twPrices[m.tw_title_id] : undefined;
    const hp = m.hk_title_id ? hkPrices[m.hk_title_id] : undefined;
    m.tw_price = toPriceEntry(tp);
    m.hk_price = toPriceEntry(hp);
    if (m.tw_price) twPriced++;
    if (m.hk_price) hkPriced++;
    m.price_verified = m.tw_price != null;
    if (!m.price_verified) {
      const st = tp?.sales_status ?? hp?.sales_status ?? 'not_found';
      m.price_note =
        slug === 'ring-fit'
          ? '編號來自台灣官方清單，但價格 API 回 TW not_found / HK sales_termination：下載版已停售（健身環以盒裝＋環同捆為主），故無台港價'
          : `價格 API 未回在售價（TW：${tp?.sales_status ?? 'not_found'}；HK：${hp?.sales_status ?? 'not_found'}），狀態 ${st}`;
    }
  }

  // 台灣清單獨有遊戲（不在 32 款內），供擴目錄合併用；slug 撞號時改用 tw-<nsuid>。
  const usedSlugs = new Set();
  const twOnly = twList
    .filter((e) => !matchedTwNsuids.has(e.nsuid))
    .map((e) => {
      let slug = slugFromTwTitle(e.title, e.nsuid);
      if (usedSlugs.has(slug)) slug = `tw-${e.nsuid}`;
      usedSlugs.add(slug);
      return { slug, title_zh: e.title, tw_title_id: e.nsuid, source: 'tw-list' };
    });
  // 若有人工對照到的遊戲也在清單外（例如寶可夢 紫），它不在 twList 內，不列入此處。

  const mappedTw = Object.values(mapped).filter((m) => m.tw_title_id).length;
  const mappedHk = Object.values(mapped).filter((m) => m.hk_title_id).length;
  const result = {
    generated_at: new Date().toISOString(),
    sources: [
      { name: 'tw-list', url: TW_LIST_URL, status: 200, entries: twList.length, note: '台灣官方遊戲清單（Next.js 頁面，RSC payload 的 Contentful 項目含 title + nsuid；?spage=N 分頁）；166 款，只含任天堂發行＋部分第三方，非 eShop 全部目錄' },
      { name: 'hk-list', url: HK_LIST_URL, status: 200, entries: hkList.length, note: '香港官方遊戲清單（同結構）；176 款。台港多數遊戲共用同一 nsuid，但 2017-2019 舊遊戲台灣用 2025-09 新登記的 70010000102xxx 編號，香港用舊編號，須分開查' },
      { name: 'tw-json', url: TW_JSON_URL, status: twJsonProbe.status ?? 0, entries: 0, note: '仿香港路徑的台灣 JSON 清單不存在（404）；台灣沒有 data/json 清單端點' },
      { name: 'hk-json', url: HK_JSON_URL, status: hkJson.status, entries: hkJson.titles.length, note: '僅作存在性輔助：內容約停在 2022-06；thumb_img / link 裡的數字不是 title ID，不採用' },
      { name: 'jp-xml', url: JP_XML_URL, status: 200, entries: 10045, note: '日本官網清單，僅用來提供 title_id（日本／全球編號）對照；台港編號與日本不同，不能直接套用' },
      { name: 'hk-weekly-articles', url: 'https://www.nintendo.com/hk/topics/?p=', status: 200, entries: 107, note: '港台每週「Nintendo eShop 新作軟體資訊」文章共 107 篇（香港 2025-07～2026-11、台灣 2026-01～2026-11），內文 Contentful 項目自帶 title + nsuid；黑帝斯 II、小丑牌、歧路旅人 II、雙人成行的台港編號出自此處' },
      { name: 'price-api', url: 'https://api.ec.nintendo.com/v1/price?country={TW,HK}&ids={ids}&lang=zh', status: 200, note: '官方價格 API；lang 對 TW/HK 用 zh；一次最多 50 個 ID；失敗重試、缺價不中斷' },
      { name: 'checkgreenpipe', url: 'https://checkgreenpipe.com/game/dave-the-diver', status: 200, note: '第三方比價站交叉核對：DAVE 台灣 $10.63 ≒ 350 台幣、香港 $17.84 ≒ 140 港幣，與價格 API 一致；同站亦證實星露谷／黑帝斯／空洞騎士／蔚藍／Undertale／女神異聞錄5 皇家版／絲之歌沒有台港價，死亡細胞只有香港價（HKD 188）' },
    ],
    mapped,
    unmapped,
    tw_only_games: twOnly,
    summary: {
      total: games.length,
      mapped_tw: mappedTw,
      mapped_hk: mappedHk,
      tw_priced: twPriced,
      hk_priced: hkPriced,
      unmapped: unmapped.length,
      tw_only_games: twOnly.length,
    },
  };

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8');

  console.log(`\n對照完成：${mappedTw}/32 款有台灣編號（其中 ${twPriced} 款拿到台灣價）、${mappedHk}/32 款有香港編號（其中 ${hkPriced} 款拿到香港價），寫入 ${OUT_PATH}`);
  console.log(`台灣清單獨有遊戲（供擴目錄）：${twOnly.length} 款`);
  if (unmapped.length) {
    console.log('未對到（台灣 eShop 目前沒有）：');
    for (const u of unmapped) console.log(`  - ${u.slug}（${u.title_zh}）`);
  }
  for (const [slug, m] of Object.entries(mapped)) {
    if (!m.price_verified) console.log(`  ! ${slug}：有編號但無台灣價（TW ${m.tw_title_id}）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
