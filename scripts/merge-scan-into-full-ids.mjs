// scripts/merge-scan-into-full-ids.mjs
// 把價格 API 全區間掃描結果（data/.cache/scan-TW.json / scan-HK.json）
// 與已知官方命名來源對照，產出完整的台港編號對照檔。
//
// 命名來源（優先順序）：
//   1. 擴大目錄 data/catalog-expanded.json：jpTitleId → slug／中文名／英文名
//      （掃出的台港編號若與日本編號相同，直接對上目錄；但實測台港編號
//      幾乎都與日本編號不同——3,924 個 TW 在售編號只有 2 個等於日本編號，
//      HK 10,008 個也只有 2 個——所以此來源實際貢獻極小）
//   2. 台港官方軟體清單（即時抓）：title＋nsuid
//      https://www.nintendo.com/tw/software/switch/（166 款）
//      https://www.nintendo.com/hk/software/switch/（176 款）
//   3. 現有對照檔 data/tw-hk-title-ids.json：24 款人工對照＋149 款台灣清單獨有
//   4. 香港 JSON https://www.nintendo.com.hk/data/json/switch_software.json：
//      544 筆（內容停在 2022-06），thumb_img 為 14 位數字＋.jpeg／.jpg 者
//      即香港 nsuid：59 列、53 個不重複編號（.jpeg 13 列＋.jpg 46 列；
//      舊文件稱 59 筆是此格式，指的就是這 59 列）。
//      其餘 thumb_img 是舊式英文檔名，不能當編號。
//   5. 每週新作文章 data/.cache/weekly-articles.json
//      （scripts/harvest-weekly-articles.mjs 產出）：港台每週
//      「Nintendo eShop 新作軟體資訊」文章內的 title＋nsuid。
//
// 配對規則：同一遊戲以 normalizeTitle（見 map-tw-hk-title-ids.mjs）
// 正規化後的標題合併台港編號；能對上目錄 slug 的用 slug 作 key，
// 其次用 jpTitleId，未知標題者以 tw/hk 編號本身作 key（tw-<id> / hk-<id>）。
//
// 限制（誠實揭露）：
// - 價格 API 不回標題；對不上任何命名來源的編號只能記「未知商品＋價格」。
// - 掃描列舉的是「全部在售 SKU」，包含 DLC／追加內容／同捆包／季票等，
//   不只是單一遊戲本體；日本 XML 與擴大目錄都無法區分 DLC，
//   本檔不假裝能分，game 欄位只代表「一個在售商品」。
// - 價格是掃描當下的快照；特價與否以 twPrice/hkPrice 的 discountPct 為準。
// - 星露谷物語（JP 70010000005423）若在掃描結果出現，代表先前
//   「台灣沒有上架」的結論被推翻，腳本會特別印出警告。
//
// 用法：node scripts/merge-scan-into-full-ids.mjs
// 產出：data/tw-hk-full-ids.json
//   { generated_at, sources: [...], scan: { tw, hk },
//     games: { "<slug|jpTitleId|tw-<id>|hk-<id>": {
//       titleZh, titleEn, jpTitleId, twTitleId, hkTitleId, source,
//       twPrice: {regularRaw, effectiveRaw, currency, discountPct, saleEnd, sales_status} | null,
//       hkPrice: {...} | null } },
//     unknown: [ { twTitleId|hkTitleId, ... } ]（與 games 內未知條目相同，另列方便檢查）,
//     summary: {...} }

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 與 scripts/map-tw-hk-title-ids.mjs 相同的正規化（此處內聯，
// 避免 import 該檔——它在頂層執行 main()，import 會重跑整支對照腳本）。
export function normalizeTitle(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'data', '.cache');
const OUT_PATH = join(ROOT, 'data', 'tw-hk-full-ids.json');

const TW_LIST_URL = 'https://www.nintendo.com/tw/software/switch/';
const HK_LIST_URL = 'https://www.nintendo.com/hk/software/switch/';
const HK_JSON_URL = 'https://www.nintendo.com.hk/data/json/switch_software.json';
const UA = 'shawn-game-studio/1.0 (tw-hk full-ids merge)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      // Connection: close：避免重用已被伺服器／代理關閉的 keep-alive 連線
      // （undici 連線池的陳舊連線會以未捕捉異常中斷程式）。
      const r = await fetch(url, { headers: { 'User-Agent': UA, Connection: 'close' }, signal: AbortSignal.timeout(60000) });
      return { status: r.status, text: await r.text() };
    } catch (e) { last = e; await sleep(1500); }
  }
  throw last;
}

async function fetchSoftwareList(baseUrl) {
  const byNsuid = new Map();
  for (let page = 1; page <= 60; page++) {
    const { status, text } = await fetchText(`${baseUrl}?spage=${page}`);
    if (status !== 200) throw new Error(`清單 HTTP ${status}（${baseUrl}?spage=${page}）`);
    const unescaped = text.replace(/\\"/g, '"').replace(/\\u0026/g, '&');
    let fresh = 0;
    for (const m of unescaped.matchAll(/"title":"([^"]{1,120})","nsuid":"(\d+)"/g)) {
      if (!byNsuid.has(m[2])) { byNsuid.set(m[2], { title: m[1].trim(), nsuid: m[2] }); fresh++; }
    }
    if (fresh === 0) break;
    await sleep(300);
  }
  return [...byNsuid.values()];
}

function priceEntry(v) {
  if (!v) return null;
  return {
    sales_status: v.sales_status,
    regularRaw: v.regularRaw,
    effectiveRaw: v.effectiveRaw,
    currency: v.currency,
    discountPct: v.discountPct,
    saleEnd: v.saleEnd,
  };
}

async function main() {
  // 合併主區間＋額外區間（ext1：70010000130000–150000；ext2：700700000xxxxx；
  // ext3：700500000xxxxx DLC 空間）
  function loadScan(country) {
    const combined = { results: {}, scanned_batches: 0, total_batches: 0, ranges: [] };
    for (const tag of ['', '-ext1', '-ext2', '-ext3']) {
      const p = join(CACHE_DIR, `scan-${country}${tag}.json`);
      if (!existsSync(p)) continue;
      const s = JSON.parse(readFileSync(p, 'utf8'));
      if (s.scanned_batches < s.total_batches) {
        throw new Error(`掃描未完成：${p} ${s.scanned_batches}/${s.total_batches}，請先跑完 scripts/scan-tw-hk-price-api.mjs`);
      }
      Object.assign(combined.results, s.results);
      combined.scanned_batches += s.scanned_batches;
      combined.total_batches += s.total_batches;
      combined.ranges.push({ from: s.from, to: s.to, batches: s.total_batches, updated_at: s.updated_at });
    }
    if (!combined.ranges.length) throw new Error(`找不到掃描結果：data/.cache/scan-${country}*.json`);
    return combined;
  }
  const scanTw = loadScan('TW');
  const scanHk = loadScan('HK');
  const onsaleTw = Object.entries(scanTw.results).filter(([, v]) => v.sales_status === 'onsale');
  const onsaleHk = Object.entries(scanHk.results).filter(([, v]) => v.sales_status === 'onsale');
  console.log(`[info] 掃描結果：TW 在售 ${onsaleTw.length} 筆、HK 在售 ${onsaleHk.length} 筆（另有 TW 非在售 ${Object.keys(scanTw.results).length - onsaleTw.length} 筆、HK ${Object.keys(scanHk.results).length - onsaleHk.length} 筆）`);

  // 星露谷檢查：JP 70010000005423 及其鄰近是否在台港在售
  const STARDEW_JP = '70010000005423';
  for (const [cc, scan] of [['TW', scanTw], ['HK', scanHk]]) {
    const hit = scan.results[STARDEW_JP];
    console.log(`[stardew] ${cc} 的 JP 編號 ${STARDEW_JP}：${hit ? JSON.stringify(hit) : 'not_found（無）'}`);
    if (hit?.sales_status === 'onsale') console.log(`!!! 警告：星露谷物語在${cc} eShop 在售，先前「台灣沒有上架」的結論被推翻`);
  }

  // 命名來源 1：擴大目錄（jpTitleId → slug／標題）
  const catalog = JSON.parse(readFileSync(join(ROOT, 'data', 'catalog-expanded.json'), 'utf8'));
  const byJpId = new Map();
  for (const g of catalog.data.games) {
    if (g.titleId) byJpId.set(String(g.titleId), g);
  }
  console.log(`[info] 擴大目錄：${catalog.data.games.length} 款，${byJpId.size} 個 jpTitleId`);

  // 命名來源 2：台港官方清單（即時抓）
  const [twList, hkList] = await Promise.all([fetchSoftwareList(TW_LIST_URL), fetchSoftwareList(HK_LIST_URL)]);
  console.log(`[info] 官方清單：TW ${twList.length} 款、HK ${hkList.length} 款`);
  const twListById = new Map(twList.map((e) => [e.nsuid, e.title]));
  const hkListById = new Map(hkList.map((e) => [e.nsuid, e.title]));

  // 命名來源 3：現有台港對照檔
  const prev = JSON.parse(readFileSync(join(ROOT, 'data', 'tw-hk-title-ids.json'), 'utf8'));
  const prevByTwId = new Map();
  const prevByHkId = new Map();
  for (const [slug, m] of Object.entries(prev.mapped)) {
    if (m.tw_title_id) prevByTwId.set(m.tw_title_id, { slug, ...m });
    if (m.hk_title_id) prevByHkId.set(m.hk_title_id, { slug, ...m });
  }
  const prevTwOnlyById = new Map((prev.tw_only_games ?? []).map((e) => [e.tw_title_id, e]));

  // 命名來源 4：香港 JSON（thumb_img 14 位數字者）
  const hkJsonRes = await fetchText(HK_JSON_URL);
  let hkJsonByThumb = new Map();
  let hkJsonCount = 0;
  if (hkJsonRes.status === 200) {
    const data = JSON.parse(hkJsonRes.text);
    hkJsonCount = data.length;
    for (const it of data) {
      const m = String(it.thumb_img ?? '').match(/^(\d{14})\.(jpeg|jpg)$/);
      if (m) hkJsonByThumb.set(m[1], it.title);
    }
  }
  console.log(`[info] 香港 JSON：${hkJsonCount} 筆，其中 thumb_img 為 14 位編號者 ${hkJsonByThumb.size} 筆`);

  // 命名來源 5：每週新作文章（scripts/harvest-weekly-articles.mjs 產出）
  let weeklyByNsuid = new Map();
  let weeklyCount = 0;
  const weeklyPath = join(CACHE_DIR, 'weekly-articles.json');
  if (existsSync(weeklyPath)) {
    const w = JSON.parse(readFileSync(weeklyPath, 'utf8'));
    weeklyByNsuid = new Map(Object.entries(w.by_nsuid ?? {}));
    weeklyCount = w.counts?.weekly_articles ?? 0;
    console.log(`[info] 每週新作文章：${weeklyCount} 篇，共 ${weeklyByNsuid.size} 個編號`);
  } else {
    console.log('[info] 每週新作文章快取不存在（先跑 node scripts/harvest-weekly-articles.mjs），跳過此命名來源');
  }

  // 以標題正規化合併：先為每個在售編號找名字，再以名字合併台港。
  function nameFor(id, cc) {
    if (byJpId.has(id)) {
      const g = byJpId.get(id);
      return { titleZh: g.titleZh ?? null, titleEn: g.titleEn ?? null, jpTitleId: id, slug: g.slug, source: 'jp-catalog' };
    }
    if (cc === 'TW' && twListById.has(id)) return { titleZh: twListById.get(id), titleEn: null, jpTitleId: null, slug: null, source: 'tw-list' };
    if (cc === 'HK' && hkListById.has(id)) return { titleZh: hkListById.get(id), titleEn: null, jpTitleId: null, slug: null, source: 'hk-list' };
    if (cc === 'TW' && prevByTwId.has(id)) {
      const m = prevByTwId.get(id);
      return { titleZh: m.title_zh, titleEn: m.title_en, jpTitleId: m.title_id, slug: m.slug, source: m.source };
    }
    if (cc === 'HK' && prevByHkId.has(id)) {
      const m = prevByHkId.get(id);
      return { titleZh: m.title_zh, titleEn: m.title_en, jpTitleId: m.title_id, slug: m.slug, source: m.source };
    }
    if (cc === 'TW' && prevTwOnlyById.has(id)) {
      const e = prevTwOnlyById.get(id);
      return { titleZh: e.title_zh, titleEn: null, jpTitleId: null, slug: e.slug, source: 'tw-list' };
    }
    if (cc === 'HK' && hkJsonByThumb.has(id)) return { titleZh: hkJsonByThumb.get(id), titleEn: null, jpTitleId: null, slug: null, source: 'hk-json-thumb' };
    if (weeklyByNsuid.has(id)) return { titleZh: weeklyByNsuid.get(id), titleEn: null, jpTitleId: null, slug: null, source: 'weekly-article' };
    // 跨區清單互查：台港多數共用編號，另一區清單的標題也可作名字
    if (twListById.has(id)) return { titleZh: twListById.get(id), titleEn: null, jpTitleId: null, slug: null, source: 'tw-list' };
    if (hkListById.has(id)) return { titleZh: hkListById.get(id), titleEn: null, jpTitleId: null, slug: null, source: 'hk-list' };
    return null;
  }

  const games = new Map(); // key → entry
  const unknown = [];
  function keyFor(n, id, cc) {
    if (n?.slug) return n.slug;
    if (n?.jpTitleId) return n.jpTitleId;
    return `${cc.toLowerCase()}-${id}`;
  }
  function upsert(id, cc, price) {
    const n = nameFor(id, cc);
    const key = keyFor(n, id, cc);
    let e = games.get(key);
    if (!e) {
      e = {
        titleZh: n?.titleZh ?? null,
        titleEn: n?.titleEn ?? null,
        jpTitleId: n?.jpTitleId ?? null,
        twTitleId: null,
        hkTitleId: null,
        source: n?.source ?? 'price-api-scan',
        twPrice: null,
        hkPrice: null,
      };
      games.set(key, e);
    }
    if (cc === 'TW') { e.twTitleId = id; e.twPrice = priceEntry(price); }
    else { e.hkTitleId = id; e.hkPrice = priceEntry(price); }
    if (!n) unknown.push({ key, [`${cc.toLowerCase()}TitleId`]: id, price: priceEntry(price) });
    return e;
  }
  for (const [id, v] of onsaleTw) upsert(id, 'TW', v);
  for (const [id, v] of onsaleHk) upsert(id, 'HK', v);

  // 同名但不同 key 的合併（例如 TW 用 102xxx 重登記號、HK 用舊號，且兩邊
  // 都對不上目錄 slug）：以正規化標題再合併一次。
  const byNormTitle = new Map();
  for (const [key, e] of [...games.entries()]) {
    const norm = normalizeTitle(e.titleZh ?? '') || normalizeTitle(e.titleEn ?? '');
    if (!norm || e.titleZh == null) continue;
    if (!byNormTitle.has(norm)) { byNormTitle.set(norm, key); continue; }
    const keepKey = byNormTitle.get(norm);
    if (keepKey === key) continue;
    const keep = games.get(keepKey);
    if (!keep.twTitleId && e.twTitleId) { keep.twTitleId = e.twTitleId; keep.twPrice = e.twPrice; }
    if (!keep.hkTitleId && e.hkTitleId) { keep.hkTitleId = e.hkTitleId; keep.hkPrice = e.hkPrice; }
    if (!keep.jpTitleId && e.jpTitleId) keep.jpTitleId = e.jpTitleId;
    if (!keep.titleEn && e.titleEn) keep.titleEn = e.titleEn;
    games.delete(key);
  }

  const named = [...games.values()].filter((e) => e.titleZh != null).length;
  const both = [...games.values()].filter((e) => e.twTitleId && e.hkTitleId).length;
  const twOnly = [...games.values()].filter((e) => e.twTitleId && !e.hkTitleId).length;
  const hkOnly = [...games.values()].filter((e) => e.hkTitleId && !e.twTitleId).length;
  const result = {
    generated_at: new Date().toISOString(),
    sources: [
      { name: 'price-api-scan-tw', url: 'https://api.ec.nintendo.com/v1/price?country=TW&ids={ids}&lang=zh', note: `全區間掃描 ${scanTw.ranges.map((r) => `${r.from}–${r.to}`).join('、')}（${scanTw.total_batches} 批），TW 在售 ${onsaleTw.length} 筆；見 scripts/scan-tw-hk-price-api.mjs` },
      { name: 'price-api-scan-hk', url: 'https://api.ec.nintendo.com/v1/price?country=HK&ids={ids}&lang=zh', note: `全區間掃描 ${scanHk.ranges.map((r) => `${r.from}–${r.to}`).join('、')}（${scanHk.total_batches} 批），HK 在售 ${onsaleHk.length} 筆` },
      { name: 'jp-catalog', url: 'data/catalog-expanded.json', note: `擴大目錄 ${catalog.data.games.length} 款（jpTitleId 對照命名；實測台港編號幾乎不等於日本編號，此來源貢獻極小）` },
      { name: 'tw-list', url: TW_LIST_URL, note: `台灣官方遊戲清單，${twList.length} 款` },
      { name: 'hk-list', url: HK_LIST_URL, note: `香港官方遊戲清單，${hkList.length} 款` },
      { name: 'tw-hk-title-ids', url: 'data/tw-hk-title-ids.json', note: '2026-11-16 人工對照檔：24 款＋149 款台灣清單獨有' },
      { name: 'hk-json', url: HK_JSON_URL, note: `香港 JSON ${hkJsonCount} 筆（內容停在 2022-06），thumb_img 為 14 位編號者 ${hkJsonByThumb.size} 筆` },
      { name: 'weekly-articles', url: 'data/.cache/weekly-articles.json', note: `港台每週新作軟體資訊 ${weeklyCount} 篇，共 ${weeklyByNsuid.size} 個編號` },
    ],
    scan: {
      tw: { ranges: scanTw.ranges, batches: scanTw.total_batches, onsale: onsaleTw.length, non_onsale: Object.keys(scanTw.results).length - onsaleTw.length },
      hk: { ranges: scanHk.ranges, batches: scanHk.total_batches, onsale: onsaleHk.length, non_onsale: Object.keys(scanHk.results).length - onsaleHk.length },
    },
    games: Object.fromEntries(games),
    unknown,
    summary: {
      total_games: games.size,
      named: named,
      unnamed: games.size - named,
      tw_priced: twOnly + both,
      hk_priced: hkOnly + both,
      both_regions: both,
      tw_only: twOnly,
      hk_only: hkOnly,
      stardew_tw_onsale: Boolean(scanTw.results[STARDEW_JP]?.sales_status === 'onsale'),
      stardew_hk_onsale: Boolean(scanHk.results[STARDEW_JP]?.sales_status === 'onsale'),
    },
  };

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`\n合併完成：${games.size} 個商品（具名 ${named}、未具名 ${games.size - named}）`);
  console.log(`  TW 有價 ${twOnly + both}（僅 TW ${twOnly}）、HK 有價 ${hkOnly + both}（僅 HK ${hkOnly}）、兩區皆有 ${both}`);
  console.log(`  星露谷 TW 在售：${result.summary.stardew_tw_onsale}；HK 在售：${result.summary.stardew_hk_onsale}`);
  console.log(`  寫入 ${OUT_PATH}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
