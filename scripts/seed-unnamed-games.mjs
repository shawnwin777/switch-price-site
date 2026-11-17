/**
 * Switch 遊戲比價 — 未具名台港韓商品建檔＋命名合併腳本
 * ============================================================
 * 背景（2026-11-17 主代理決定，見 DATA_NOTES.md §12.8）：
 *   價格 API 全區間掃描會掃出大量「只有編號＋價格、沒有標題」的在售商品
 *   （2026-11-16 對照檔：29,237 筆中 26,890 筆未具名）。決定：編號＋價格
 *   先行建檔進目錄（slug tw-<nsuid>／hk-<nsuid>／kr-<nsuid>），之後命名
 *   來源找到標題時再合併改名。未具名期間不出現在首頁遊戲牆／搜尋結果
 *   與接近歷史低價（games.is_unnamed，見 migration
 *   20261118_unnamed_games.sql）。
 *
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   node scripts/seed-unnamed-games.mjs --dry-run
 *     只讀對照檔、不寫資料庫、不需環境變數：印出預計建檔／跳過的數量
 *     與 5 筆樣本列（slug 碰撞以本機 data/catalog-expanded.json 比對，
 *     資料庫現有 23,251 款以即時查詢為準，見下方 live 模式說明）。
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
 *   node scripts/seed-unnamed-games.mjs
 *     正式寫入（冪等：重跑只更新、不重複建檔）。
 *   指定其他對照檔：node scripts/seed-unnamed-games.mjs data/tw-hk-full-ids.json
 *   不吃韓國掃描：node scripts/seed-unnamed-games.mjs --no-kr
 *
 * 前置作業：
 *   1. 先在 Supabase Dashboard → SQL Editor 執行
 *      supabase/migrations/20261118_unnamed_games.sql（只需一次）。
 *      沒跑時本腳本寫入 is_unnamed 會報 42703 失敗（fail fast，不寫半套）。
 *   2. 對照檔 data/tw-hk-full-ids.json 由
 *      scripts/merge-scan-into-full-ids.mjs 產出（每週 GitHub Actions 跑，
 *      見 .github/workflows/weekly-tw-hk-kr-scan.yml）。
 *   3. 韓國掃描 data/.cache/scan-KR.json 由
 *      scripts/scan-tw-hk-price-api.mjs --country KR 產出（同上）。
 *
 * 輸入形狀：
 *   data/tw-hk-full-ids.json 的 games：
 *     { "<slug|tw-<id>|hk-<id>>": { titleZh, titleEn, jpTitleId,
 *       twTitleId, hkTitleId, twPrice, hkPrice } }
 *     twPrice／hkPrice = { sales_status, regularRaw, effectiveRaw,
 *       currency, discountPct, saleEnd }（只收 sales_status=onsale）。
 *   data/.cache/scan-KR.json 的 results：
 *     { "<nsuid>": { sales_status, regularRaw, effectiveRaw,
 *       currency, discountPct, saleEnd } }（只收 onsale）。
 *
 * 規則（誠實揭露，見 DATA_NOTES.md §12.8）：
 *   - 同一編號在台港兩區都出現時是同一商品：未具名筆以 nsuid 去重後
 *     只建一款（slug 優先 tw-<nsuid>），兩區編號＋價格都掛上去。
 *   - 疑似 DLC／升級包／組合包跳過不建：編號前綴 7005（DLC／追加內容
 *     空間）與 7007（Switch 2 Edition／升級包空間）——見
 *     DATA_NOTES.md §12.8 與 scripts/scan-tw-hk-price-api.mjs 的區間
 *     說明。只對「未具名」筆跳過；已具名筆是真實命名商品，照常建檔。
 *     跳過者記進 summary.skipped_dlc（印出前 20 筆），不靜默丟失。
 *     注意：7001 空間內的 DLC 仍無法只憑編號區分（需標題或商品頁資訊），
 *     這批先建檔、待命名後再由人工／合併流程處理。
 *   - 具名筆：已有遊戲（按 slug 或 jpTitleId 對到）就不建；對不到時
 *     建一款具名遊戲（slug＝對照檔 key；純數字 key 用 game-<jpTitleId>）。
 *   - 命名合併：具名筆對到的 TW／HK 編號若已有未具名佔位遊戲
 *     （slug tw-<nsuid>／hk-<nsuid>），佔位遊戲改名（標題、slug、
 *     title_id、is_unnamed=false）或併入既有具名遊戲（編號＋價格搬過去、
 *     佔位列刪除，prices／game_region_ids 有 on delete cascade）。
 *     絕不以佔位標題覆蓋具名遊戲：slug 已是具名遊戲時，跳過並記錄。
 *   - 韓國筆：先看 nsuid 是否等於某遊戲的 title_id（JP 編號相同即同一
 *     商品），再看是否已有 tw-／hk- 佔位遊戲（同編號即同一商品），
 *     都沒有才建 kr-<nsuid> 佔位遊戲。
 *   - 價格：只寫 onsale 筆；price_twd 以即時匯率換算（失敗改讀
 *     data/.cache/fx.json；兩者皆無時報錯退出、不寫半套價），
 *     is_historical_low=false、historical_low_twd 留給每日更新維護。
 *   - games.price_countries 隨建檔／合併一起寫（title_id 有值算 1 國＋
 *     對照表 distinct 國家數；供 /api/refresh 切片用，見 migration
 *     20261117_game_price_countries.sql）。
 *   - 可重複執行：重跑一次應為新增 0 款、其餘全部更新或跳過。
 *
 * 連線：只用環境變數 NEXT_PUBLIC_SUPABASE_URL 與
 *       SUPABASE_SERVICE_ROLE_KEY（不讀 .env.local、不把 key 寫進檔案）。
 *       Service Role Key 會繞過 RLS，請只在伺服器端／本機／GitHub Actions
 *       執行，不要放進前端程式碼或公開倉庫。
 *
 * 需求：Node.js 18+（使用內建 fetch，不需安裝任何套件）。
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FX_ENDPOINTS = [
  'https://open.er-api.com/v6/latest/USD',
  'https://api.exchangerate-api.com/v4/latest/USD',
];
const FX_CACHE_PATH = path.join(PROJECT_ROOT, 'data', '.cache', 'fx.json');
const CATALOG_PATH = path.join(PROJECT_ROOT, 'data', 'catalog-expanded.json');

const COUNTRY_NAMES = { TW: '台灣', HK: '香港', KR: '韓國' };

const BATCH_GAMES = 500;
const BATCH_REGION_IDS = 500;
const BATCH_PRICES = 200;

// 7005＝DLC／追加內容編號空間；7007＝Switch 2 Edition／升級包編號空間
// （見 DATA_NOTES.md §12.8 與 scan-tw-hk-price-api.mjs 區間說明）。
const SUSPECT_PREFIXES = ['7005', '7007'];

function parseArgs(argv) {
  const out = { dryRun: false, input: null, krScan: null, noKr: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-kr') out.noKr = true;
    else if (a.startsWith('--kr-scan=')) out.krScan = path.resolve(a.slice('--kr-scan='.length));
    else if (!a.startsWith('--')) out.input = path.resolve(a);
    else throw new Error(`未知參數：${a}（可用：--dry-run、--no-kr、--kr-scan=<路徑>）`);
  }
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isSuspectNsuid(nsuid) {
  return SUSPECT_PREFIXES.some((p) => String(nsuid).startsWith(p));
}

function isRegionSlugKey(key) {
  return /^(tw|hk|kr)-\d+$/.test(String(key));
}

function isNumericKey(key) {
  return /^\d+$/.test(String(key).trim());
}

/** 佔位標題：title 欄位先放編號，等命名來源找到真名再合併改名。 */
function placeholderTitles(nsuid) {
  return { titleZh: `未命名商品 ${nsuid}`, titleEn: String(nsuid) };
}

function priceEntryToRow(gameId, country, p, fxRate) {
  const regularRaw = p.regularRaw ?? null;
  const effectiveRaw = p.effectiveRaw ?? regularRaw;
  return {
    game_id: gameId,
    country,
    country_name: COUNTRY_NAMES[country] ?? country,
    currency: p.currency ?? null,
    regular_raw: regularRaw,
    effective_raw: effectiveRaw,
    discount_pct: p.discountPct ?? null,
    discount_raw:
      regularRaw != null && effectiveRaw != null && effectiveRaw < regularRaw
        ? regularRaw - effectiveRaw
        : null,
    sale_end: p.saleEnd ?? null,
    price_twd:
      effectiveRaw != null && fxRate != null ? Math.round(effectiveRaw * fxRate) : null,
    is_historical_low: false,
    updated_at: new Date().toISOString(),
  };
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/** 匯率（與 fetch-region-prices.mjs 相同邏輯：先抓即時，失敗改讀快取）。 */
async function loadFx() {
  for (const endpoint of FX_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        headers: { 'User-Agent': 'switch-price-site/1.0 (seed-unnamed-games)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rates = data?.rates;
      if (!rates || typeof rates.TWD !== 'number' || rates.TWD <= 0) {
        throw new Error('回應缺少 TWD');
      }
      const out = { TWD: 1 };
      for (const [cur, perUsd] of Object.entries(rates)) {
        if (typeof perUsd === 'number' && perUsd > 0) out[cur] = rates.TWD / perUsd;
      }
      return { ratesTwd: out, source: endpoint };
    } catch { /* 換下一個端點 */ }
  }
  try {
    const cached = JSON.parse(await readFile(FX_CACHE_PATH, 'utf8'));
    if (cached?.ratesTwd && typeof cached.ratesTwd === 'object') {
      return { ratesTwd: cached.ratesTwd, source: `快取 ${FX_CACHE_PATH}` };
    }
  } catch { /* 無快取 */ }
  return null;
}

// ============================================================================
// 對照檔解析（純函式，不碰 DB；dry-run 與 live 共用）
// ============================================================================

/**
 * 解析 tw-hk-full-ids.json → { named, unnamedByNsuid, stats }。
 *   named：具名條目（titleZh != null），保留原 key 與全部欄位。
 *   unnamedByNsuid：未具名條目以 nsuid 去重後的 Map：
 *     nsuid → { slug, countries: Map<cc, { titleId, price }>, source }。
 *   stats：分類計數（dry-run 與 live 報告共用）。
 */
function parseFullIds(data) {
  const gamesObj = data.games ?? {};
  const named = [];
  const unnamedByNsuid = new Map();
  const stats = {
    totalEntries: 0,
    namedEntries: 0,
    unnamedEntries: 0,
    skippedDlc: [], // { nsuid, country, prefix }
    unnamedNoPrice: [],
  };
  for (const [key, e] of Object.entries(gamesObj)) {
    if (!e || typeof e !== 'object') continue;
    stats.totalEntries += 1;
    if (e.titleZh != null) {
      named.push({ key, ...e });
      stats.namedEntries += 1;
      continue;
    }
    stats.unnamedEntries += 1;
    // 未具名筆應只有一區有編號＋價格（合併腳本以 tw-/hk-<id> 作 key）；
    // 若兩區都有（舊檔或未來格式），兩區都收、同一款處理。
    const regions = [];
    if (e.twTitleId) regions.push(['TW', e.twTitleId, e.twPrice ?? null]);
    if (e.hkTitleId) regions.push(['HK', e.hkTitleId, e.hkPrice ?? null]);
    if (regions.length === 0) {
      stats.unnamedNoPrice.push(key);
      continue;
    }
    for (const [cc, titleId, price] of regions) {
      const nsuid = String(titleId);
      if (isSuspectNsuid(nsuid)) {
        stats.skippedDlc.push({ nsuid, country: cc, prefix: nsuid.slice(0, 4), key });
        continue;
      }
      if (!price || price.sales_status !== 'onsale') continue;
      let rec = unnamedByNsuid.get(nsuid);
      if (!rec) {
        rec = { nsuid, slug: null, countries: new Map(), source: e.source ?? 'price-api-scan' };
        unnamedByNsuid.set(nsuid, rec);
      }
      rec.countries.set(cc, { titleId: nsuid, price });
    }
  }
  // slug：TW 優先（同一編號兩區都有時只建一款）。
  for (const rec of unnamedByNsuid.values()) {
    rec.slug = rec.countries.has('TW') ? `tw-${rec.nsuid}` : `hk-${rec.nsuid}`;
  }
  return { named, unnamedByNsuid, stats };
}

/** 解析 KR 掃描檔 → onsale 條目 [{ nsuid, price }]（7005／7007 先記跳過）。 */
function parseKrScan(data) {
  const out = [];
  const skippedDlc = [];
  const results = data?.results ?? {};
  for (const [nsuid, p] of Object.entries(results)) {
    if (!p || p.sales_status !== 'onsale') continue;
    if (isSuspectNsuid(nsuid)) {
      skippedDlc.push({ nsuid, country: 'KR', prefix: String(nsuid).slice(0, 4), key: `kr-${nsuid}` });
      continue;
    }
    out.push({ nsuid: String(nsuid), price: p });
  }
  return { entries: out, skippedDlc };
}

// ============================================================================
// Supabase REST（live 模式；dry-run 完全不呼叫）
// ============================================================================

function restHeaders(json = true) {
  const h = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function postgrest(table, rows, onConflict) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...restHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`寫入 ${table} 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
  }
  return res.json();
}

async function patchGame(id, fields) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/games?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: restHeaders(),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`更新 games ${id} 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
  }
}

async function deleteGame(id) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/games?id=eq.${id}`;
  const res = await fetch(url, { method: 'DELETE', headers: restHeaders(false) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`刪除 games ${id} 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
  }
}

/** 分頁讀取整表（select 欄位，limit 1000）。 */
async function readAll(table, select) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const url =
      `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}` +
      `?select=${encodeURIComponent(select)}&limit=1000&offset=${offset}`;
    const res = await fetch(url, { headers: restHeaders(false) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`讀取 ${table} 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
    offset += page.length;
  }
  return rows;
}

/** 依 id 清單分批讀 prices（game_id, country），供「合併時只補缺口」判斷用。 */
async function loadPricesForGameIds(ids) {
  const have = new Set();
  const uniq = [...new Set(ids)];
  for (const batch of chunk(uniq, 200)) {
    const inList = `(${batch.join(',')})`;
    const url =
      `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/prices` +
      `?select=game_id,country&game_id=in.${encodeURIComponent(inList)}&limit=10000`;
    const res = await fetch(url, { headers: restHeaders(false) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`讀取 prices 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
    }
    for (const r of await res.json()) have.add(`${r.game_id}|${r.country}`);
  }
  return have;
}

// ============================================================================
// Dry-run：只印計畫，不碰 Supabase、不需環境變數
// ============================================================================

async function dryRun(opts) {
  const inputPath = opts.input ?? path.join(PROJECT_ROOT, 'data', 'tw-hk-full-ids.json');
  const data = await loadJson(inputPath);
  const { named, unnamedByNsuid, stats } = parseFullIds(data);
  console.log(`對照檔：${inputPath}（產生時間 ${data.generated_at ?? '未記錄'}）`);
  console.log(`  條目 ${stats.totalEntries} 筆：具名 ${stats.namedEntries}、未具名 ${stats.unnamedEntries}`);

  // 具名筆：與本機目錄快照比對 slug（資料庫現有款數更多，正式執行時以
  // 即時查詢為準；這裡只作本機預估）。
  let catalogSlugs = new Set();
  let catalogByTitleId = new Map();
  try {
    const cat = await loadJson(CATALOG_PATH);
    for (const g of cat.data.games ?? []) {
      if (g.slug) catalogSlugs.add(g.slug);
      if (g.titleId) catalogByTitleId.set(String(g.titleId), g.slug);
    }
  } catch {
    console.log('  [注意] 讀不到 data/catalog-expanded.json，具名筆碰撞預估跳過');
  }
  const namedMatchCatalog = named.filter(
    (e) => catalogSlugs.has(e.key) || (e.jpTitleId && catalogByTitleId.has(String(e.jpTitleId))),
  ).length;
  const namedToCreate = named.filter(
    (e) => !catalogSlugs.has(e.key) && !(e.jpTitleId && catalogByTitleId.has(String(e.jpTitleId))),
  );

  // 未具名筆：去重後數量、DLC 跳過、與本機目錄的 slug 碰撞。
  const dlcTw = stats.skippedDlc.filter((s) => s.country === 'TW').length;
  const dlcHk = stats.skippedDlc.filter((s) => s.country === 'HK').length;
  let collide = 0;
  const collideSamples = [];
  for (const rec of unnamedByNsuid.values()) {
    if (catalogSlugs.has(rec.slug)) {
      collide += 1;
      if (collideSamples.length < 5) collideSamples.push(rec.slug);
    }
  }
  const twPlaceholders = [...unnamedByNsuid.values()].filter((r) => r.slug.startsWith('tw-')).length;
  const hkPlaceholders = [...unnamedByNsuid.values()].filter((r) => r.slug.startsWith('hk-')).length;
  const priceRows = [...unnamedByNsuid.values()].reduce((n, r) => n + r.countries.size, 0);

  console.log('\n[未具名筆 → 佔位遊戲]');
  console.log(`  未具名條目 ${stats.unnamedEntries} 筆 → 以 nsuid 去重後 ${unnamedByNsuid.size} 款`);
  console.log(`    其中 slug tw-：${twPlaceholders} 款；hk-：${hkPlaceholders} 款`);
  console.log(`    價格列：${priceRows} 筆（TW＋HK 合計，每款 1–2 國）`);
  console.log(`  疑似 DLC／升級包跳過：${stats.skippedDlc.length} 筆（TW ${dlcTw}、HK ${dlcHk}，前綴 7005／7007）`);
  console.log(`  無價格跳過：${stats.unnamedNoPrice.length} 筆`);
  console.log(`  slug 與本機目錄碰撞（正式執行時跳過、不覆蓋）：${collide} 筆${collideSamples.length ? `，例如 ${collideSamples.join('、')}` : ''}`);

  console.log('\n[具名筆 → 具名遊戲]');
  console.log(`  具名條目 ${stats.namedEntries} 筆`);
  console.log(`  本機目錄已有的（正式執行時不新建，只補對照編號）：約 ${namedMatchCatalog} 筆`);
  console.log(`  本機目錄沒有的（正式執行時新建具名遊戲）：約 ${namedToCreate.length} 筆`);
  console.log('  （正式執行以資料庫即時查詢為準，數字可能與本機預估不同）');

  // 韓國掃描
  let krInfo = null;
  if (!opts.noKr) {
    const krPath = opts.krScan ?? path.join(PROJECT_ROOT, 'data', '.cache', 'scan-KR.json');
    if (existsSync(krPath)) {
      const kr = parseKrScan(await loadJson(krPath));
      const krNsuids = new Set(kr.entries.map((e) => e.nsuid));
      const krOverlap = [...krNsuids].filter((id) => unnamedByNsuid.has(id)).length;
      krInfo = { total: kr.entries.length, overlap: krOverlap, skippedDlc: kr.skippedDlc.length };
      console.log('\n[韓國掃描 → kr- 佔位遊戲]');
      console.log(`  KR 在售 ${kr.entries.length} 筆（主區間掃描檔 ${krPath}）`);
      console.log(`  其中 nsuid 與台港佔位遊戲相同（掛到同一款，不另建）：${krOverlap} 筆`);
      console.log(`  其餘新建 kr-<nsuid> 佔位遊戲：約 ${kr.entries.length - krOverlap} 筆`);
      console.log(`  疑似 DLC／升級包跳過：${kr.skippedDlc.length} 筆`);
    } else {
      console.log(`\n[韓國掃描] 找不到 ${krPath}（--no-kr 可跳過；工作流程會先跑 KR 掃描）`);
    }
  }

  // 5 筆樣本列（遊戲列＋對照編號＋價格列的完整形狀）
  console.log('\n[樣本列（前 5 筆未具名佔位遊戲，含完整寫入形狀）]');
  let fx = null;
  try {
    fx = await loadFx();
  } catch { /* 樣本 price_twd 顯示 null，不影響計數 */ }
  if (fx) console.log(`  匯率來源：${fx.source}`);
  const samples = [...unnamedByNsuid.values()].slice(0, 5);
  for (const rec of samples) {
    const t = placeholderTitles(rec.nsuid);
    const regionIds = [...rec.countries.entries()].map(([cc, v]) => ({
      country: cc,
      title_id: v.titleId,
      source: 'seed-unnamed-games',
    }));
    const prices = [...rec.countries.entries()].map(([cc, v]) => {
      const fxRate = fx?.ratesTwd[v.price.currency] ?? null;
      return priceEntryToRow('(新建遊戲的 id)', cc, v.price, fxRate);
    });
    console.log(
      JSON.stringify(
        {
          game: {
            slug: rec.slug,
            title_zh: t.titleZh,
            title_en: t.titleEn,
            title_id: null,
            product_type: 'game',
            is_unnamed: true,
            price_countries: rec.countries.size,
          },
          game_region_ids: regionIds,
          prices,
        },
        null,
        2,
      ),
    );
  }
  if (stats.skippedDlc.length > 0) {
    console.log('[疑似 DLC／升級包跳過，前 20 筆]');
    for (const s of stats.skippedDlc.slice(0, 20)) {
      console.log(`  - ${s.key}（${s.country} ${s.nsuid}，前綴 ${s.prefix}）`);
    }
    if (stats.skippedDlc.length > 20) console.log(`  ……共 ${stats.skippedDlc.length} 筆，僅列前 20 筆`);
  }
  console.log('\n--dry-run 結束：未寫入任何資料。正式執行請去掉 --dry-run（需 SUPABASE_SERVICE_ROLE_KEY）。');
  return { named, unnamedByNsuid, stats, krInfo };
}

// ============================================================================
// Live 模式
// ============================================================================

async function live(opts) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      '缺少環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 再執行。\n' +
        '（只看計畫不寫庫：node scripts/seed-unnamed-games.mjs --dry-run）',
    );
    process.exit(1);
  }
  const inputPath = opts.input ?? path.join(PROJECT_ROOT, 'data', 'tw-hk-full-ids.json');
  const data = await loadJson(inputPath);
  const { named, unnamedByNsuid, stats } = parseFullIds(data);
  console.log(`對照檔：${inputPath}（產生時間 ${data.generated_at ?? '未記錄'}）`);
  console.log(`  條目 ${stats.totalEntries} 筆：具名 ${stats.namedEntries}、未具名 ${stats.unnamedEntries}`);

  const fx = await loadFx();
  if (!fx) {
    throw new Error(
      '匯率抓取失敗且無快取（data/.cache/fx.json）：無法換算 price_twd，請確認網路後重跑。',
    );
  }
  console.log(`[fx] 匯率來源：${fx.source}`);

  // ---- 遊戲索引（分頁讀全表）----
  const gameRows = await readAll('games', 'id,slug,title_id,is_unnamed,title_zh,price_countries');
  const bySlug = new Map(gameRows.map((g) => [g.slug, g]));
  const byTitleId = new Map();
  for (const g of gameRows) {
    if (g.title_id) byTitleId.set(String(g.title_id), g);
  }
  console.log(`games：資料庫現有 ${gameRows.length} 款`);
  // is_unnamed 欄位檢查：migration 未跑時 select 會報 42703——fail fast。
  // （readAll 若因欄位不存在失敗，錯誤訊息會明確指出 is_unnamed。）

  // ---- 現有對照編號（供合併與 price_countries 重算）----
  const regionRows = await readAll('game_region_ids', 'game_id,country,title_id');
  const regionByGame = new Map(); // game_id → Map<country, titleId>
  for (const r of regionRows) {
    let m = regionByGame.get(r.game_id);
    if (!m) {
      m = new Map();
      regionByGame.set(r.game_id, m);
    }
    m.set(String(r.country).toUpperCase(), String(r.title_id));
  }
  console.log(`game_region_ids：現有 ${regionRows.length} 列`);

  const priceCountriesFor = (gameId, titleId, extraCountries) => {
    const have = new Set(regionByGame.get(gameId)?.keys() ?? []);
    for (const c of extraCountries) have.add(c);
    return (titleId ? 1 : 0) + have.size;
  };

  const counts = {
    namedCreated: 0,
    namedRenamed: 0,
    mergedIntoNamed: 0,
    placeholdersCreated: 0,
    placeholdersUpdated: 0,
    krAttached: 0,
    krCreated: 0,
    skippedCollision: [],
    skippedDlc: stats.skippedDlc,
    attachedToJpGame: [],
    regionIdsWritten: 0,
    pricesWritten: 0,
    gamesDeleted: 0,
  };

  const gamesUpsert = []; // { slug, title_zh, title_en, title_id, product_type, is_unnamed, price_countries }
  const regionUpsert = []; // { game_id, country, title_id, source }
  const priceUpsert = []; // prices 列（game_id 需先有 id；新建遊戲先寫 games 再補）

  // 新建遊戲的 id 由資料庫回傳；先收集「待寫價格／編號」的佇列，games
  // 寫入後再依 slug 回填 game_id。
  const pendingRegion = new Map(); // slug → [{ country, titleId }]
  const pendingPrices = new Map(); // slug → [{ country, priceEntry }]

  function queueRegionAndPrices(slug, countriesMap) {
    const regs = [];
    const prs = [];
    for (const [cc, v] of countriesMap) {
      regs.push({ country: cc, titleId: v.titleId });
      prs.push({ country: cc, price: v.price });
    }
    pendingRegion.set(slug, (pendingRegion.get(slug) ?? []).concat(regs));
    pendingPrices.set(slug, (pendingPrices.get(slug) ?? []).concat(prs));
  }

  // ---- 1. 具名筆：建檔／改名／合併 ----
  // 先處理具名筆：它們可能把已存在的佔位遊戲改名或併入，後面的未具名
  // 筆才不會對同一編號又建一個佔位遊戲。

  // 具名筆的 TW／HK 編號 → 佔位遊戲 slug（供合併查找）。
  function placeholdersForEntry(e) {
    const out = [];
    for (const [cc, titleId] of [['TW', e.twTitleId], ['HK', e.hkTitleId]]) {
      if (!titleId) continue;
      const g = bySlug.get(`${cc.toLowerCase()}-${titleId}`);
      if (g && g.is_unnamed) out.push(g);
    }
    return out;
  }

  // 把佔位遊戲 P 併入目標遊戲 G：編號＋價格搬過去（只補 G 沒有的國家），
  // 再刪 P（prices／game_region_ids 有 on delete cascade）。
  async function mergePlaceholderInto(target, ph) {
    const phRegions = regionByGame.get(ph.id) ?? new Map();
    const moveRegions = [];
    for (const [cc, titleId] of phRegions) {
      const have = regionByGame.get(target.id)?.get(cc);
      if (have == null) moveRegions.push({ country: cc, titleId });
      else if (have !== titleId) {
        counts.skippedCollision.push(
          `${target.slug} ${cc}：既有編號 ${have}，佔位 ${ph.slug} 的 ${titleId} 未覆蓋`,
        );
      }
    }
    // 價格：只補目標沒有的（game_id, country）。
    const priceHave = await loadPricesForGameIds([target.id, ph.id]);
    const phPrices = await (async () => {
      const rows = [];
      const url =
        `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/prices` +
        `?select=game_id,country,currency,regular_raw,effective_raw,discount_pct,discount_raw,sale_end,price_twd` +
        `&game_id=eq.${ph.id}&limit=100`;
      const res = await fetch(url, { headers: restHeaders(false) });
      if (!res.ok) return rows;
      return res.json();
    })();
    const movePrices = [];
    for (const p of phPrices) {
      if (!priceHave.has(`${target.id}|${p.country}`)) {
        movePrices.push({
          game_id: target.id,
          country: p.country,
          country_name: COUNTRY_NAMES[p.country] ?? p.country,
          currency: p.currency,
          regular_raw: p.regular_raw,
          effective_raw: p.effective_raw,
          discount_pct: p.discount_pct,
          discount_raw: p.discount_raw,
          sale_end: p.sale_end,
          price_twd: p.price_twd,
          is_historical_low: false,
          updated_at: new Date().toISOString(),
        });
      }
    }
    if (moveRegions.length > 0) {
      for (const batch of chunk(
        moveRegions.map((r) => ({ game_id: target.id, country: r.country, title_id: r.titleId, source: 'seed-unnamed-games' })),
        BATCH_REGION_IDS,
      )) {
        await postgrest('game_region_ids', batch, 'game_id,country');
        counts.regionIdsWritten += batch.length;
      }
      const m = regionByGame.get(target.id) ?? new Map();
      for (const r of moveRegions) m.set(r.country, r.titleId);
      regionByGame.set(target.id, m);
    }
    if (movePrices.length > 0) {
      for (const batch of chunk(movePrices, BATCH_PRICES)) {
        await postgrest('prices', batch, 'game_id,country');
        counts.pricesWritten += batch.length;
      }
    }
    await deleteGame(ph.id);
    counts.gamesDeleted += 1;
    bySlug.delete(ph.slug);
    regionByGame.delete(ph.id);
  }

  for (const e of named) {
    const slugKey = isRegionSlugKey(e.key) || !isNumericKey(e.key) ? e.key : `game-${e.key}`;
    let target = bySlug.get(slugKey) ?? null;
    if (!target && e.jpTitleId) target = byTitleId.get(String(e.jpTitleId)) ?? null;
    const placeholders = placeholdersForEntry(e).filter((p) => !target || p.id !== target.id);

    const entryCountries = new Map();
    if (e.twTitleId && e.twPrice?.sales_status === 'onsale') {
      entryCountries.set('TW', { titleId: String(e.twTitleId), price: e.twPrice });
    }
    if (e.hkTitleId && e.hkPrice?.sales_status === 'onsale') {
      entryCountries.set('HK', { titleId: String(e.hkTitleId), price: e.hkPrice });
    }

    if (target && target.is_unnamed) {
      // 佔位遊戲本身就是這筆具名條目：原地改名（slug 保持或改為真名）。
      const patch = {
        title_zh: e.titleZh,
        title_en: e.titleEn ?? e.titleZh,
        title_id: e.jpTitleId ? String(e.jpTitleId) : target.title_id,
        is_unnamed: false,
        price_countries: priceCountriesFor(target.id, e.jpTitleId ?? target.title_id, [...entryCountries.keys()]),
      };
      if (slugKey !== target.slug && !bySlug.has(slugKey)) {
        bySlug.delete(target.slug);
        patch.slug = slugKey;
        target.slug = slugKey;
        bySlug.set(slugKey, target);
      }
      await patchGame(target.id, patch);
      counts.namedRenamed += 1;
      queueRegionAndPrices(target.slug, entryCountries);
      // 其他佔位遊戲（同商品不同編號）併入改名後的遊戲。
      for (const ph of placeholders) {
        await mergePlaceholderInto(target, ph);
        counts.mergedIntoNamed += 1;
      }
      continue;
    }

    if (target) {
      // 具名遊戲已存在：佔位遊戲併入；對照編號由 seed-region-ids 負責，
      // 這裡只補它漏掉的（例如佔位遊戲帶來的另一區編號）。
      queueRegionAndPrices(target.slug, entryCountries);
      for (const ph of placeholders) {
        await mergePlaceholderInto(target, ph);
        counts.mergedIntoNamed += 1;
      }
      continue;
    }

    if (placeholders.length > 0) {
      // 沒有具名遊戲，但有佔位遊戲：取第一個改名，其餘併入。
      const first = placeholders[0];
      const patch = {
        title_zh: e.titleZh,
        title_en: e.titleEn ?? e.titleZh,
        title_id: e.jpTitleId ? String(e.jpTitleId) : first.title_id,
        is_unnamed: false,
        price_countries: priceCountriesFor(first.id, e.jpTitleId ?? first.title_id, [...entryCountries.keys()]),
      };
      if (slugKey !== first.slug && !bySlug.has(slugKey)) {
        bySlug.delete(first.slug);
        patch.slug = slugKey;
        first.slug = slugKey;
        bySlug.set(slugKey, first);
      }
      await patchGame(first.id, patch);
      counts.namedRenamed += 1;
      queueRegionAndPrices(first.slug, entryCountries);
      for (const ph of placeholders.slice(1)) {
        await mergePlaceholderInto(first, ph);
        counts.mergedIntoNamed += 1;
      }
      continue;
    }

    // 完全新建：具名遊戲（slug＝對照檔 key；純數字 key 用 game-<id>）。
    if (bySlug.has(slugKey)) {
      counts.skippedCollision.push(`${slugKey}：具名筆對不到遊戲、但 slug 已被佔用，跳過不建`);
      continue;
    }
    const row = {
      slug: slugKey,
      title_zh: e.titleZh,
      title_en: e.titleEn ?? e.titleZh,
      title_id: e.jpTitleId ? String(e.jpTitleId) : null,
      product_type: 'game',
      is_unnamed: false,
      price_countries: (e.jpTitleId ? 1 : 0) + entryCountries.size,
    };
    gamesUpsert.push(row);
    bySlug.set(slugKey, { id: null, slug: slugKey, title_id: row.title_id, is_unnamed: false });
    counts.namedCreated += 1;
    queueRegionAndPrices(slugKey, entryCountries);
  }

  // ---- 2. 未具名筆：佔位遊戲 ----
  for (const rec of unnamedByNsuid.values()) {
    // 同編號已是某遊戲的 JP title_id（極少數，如台港編號等於日本編號）：
    // 不建佔位遊戲，價格掛到該遊戲上。
    const jpGame = byTitleId.get(rec.nsuid);
    if (jpGame) {
      counts.attachedToJpGame.push(`${rec.slug} → ${jpGame.slug}（title_id 相同）`);
      queueRegionAndPrices(jpGame.slug, rec.countries);
      // 目標遊戲的 price_countries 也要重算（在寫入階段統一處理）。
      continue;
    }
    const existing = bySlug.get(rec.slug);
    if (existing && !existing.is_unnamed) {
      counts.skippedCollision.push(`${rec.slug}：slug 已是具名遊戲，不覆蓋`);
      continue;
    }
    if (existing && existing.is_unnamed) {
      // 已有佔位遊戲（重跑）：補編號＋價格、重算 price_countries。
      queueRegionAndPrices(rec.slug, rec.countries);
      counts.placeholdersUpdated += 1;
      continue;
    }
    const t = placeholderTitles(rec.nsuid);
    gamesUpsert.push({
      slug: rec.slug,
      title_zh: t.titleZh,
      title_en: t.titleEn,
      title_id: null,
      product_type: 'game',
      is_unnamed: true,
      price_countries: rec.countries.size,
    });
    bySlug.set(rec.slug, { id: null, slug: rec.slug, title_id: null, is_unnamed: true });
    counts.placeholdersCreated += 1;
    queueRegionAndPrices(rec.slug, rec.countries);
  }

  // ---- 3. 韓國掃描筆 ----
  let krEntries = [];
  let krSkippedDlc = [];
  if (!opts.noKr) {
    const krPath = opts.krScan ?? path.join(PROJECT_ROOT, 'data', '.cache', 'scan-KR.json');
    if (existsSync(krPath)) {
      const parsed = parseKrScan(await loadJson(krPath));
      krEntries = parsed.entries;
      krSkippedDlc = parsed.skippedDlc;
      console.log(`[kr] 掃描檔：${krPath}，在售 ${krEntries.length} 筆，疑似 DLC 跳過 ${krSkippedDlc.length} 筆`);
    } else {
      console.log(`[kr] 找不到 ${krPath}，跳過韓國筆（--no-kr 可關掉此提示）`);
    }
  }
  for (const kr of krEntries) {
    const countriesMap = new Map([['KR', { titleId: kr.nsuid, price: kr.price }]]);
    const jpGame = byTitleId.get(kr.nsuid);
    if (jpGame) {
      queueRegionAndPrices(jpGame.slug, countriesMap);
      counts.krAttached += 1;
      continue;
    }
    const twPh = bySlug.get(`tw-${kr.nsuid}`);
    const hkPh = bySlug.get(`hk-${kr.nsuid}`);
    const ph = twPh ?? hkPh ?? null;
    if (ph) {
      queueRegionAndPrices(ph.slug, countriesMap);
      counts.krAttached += 1;
      continue;
    }
    const existing = bySlug.get(`kr-${kr.nsuid}`);
    if (existing && !existing.is_unnamed) {
      counts.skippedCollision.push(`kr-${kr.nsuid}：slug 已是具名遊戲，不覆蓋`);
      continue;
    }
    if (existing && existing.is_unnamed) {
      queueRegionAndPrices(`kr-${kr.nsuid}`, countriesMap);
      counts.placeholdersUpdated += 1;
      continue;
    }
    const t = placeholderTitles(kr.nsuid);
    gamesUpsert.push({
      slug: `kr-${kr.nsuid}`,
      title_zh: t.titleZh,
      title_en: t.titleEn,
      title_id: null,
      product_type: 'game',
      is_unnamed: true,
      price_countries: 1,
    });
    bySlug.set(`kr-${kr.nsuid}`, { id: null, slug: `kr-${kr.nsuid}`, title_id: null, is_unnamed: true });
    counts.krCreated += 1;
    queueRegionAndPrices(`kr-${kr.nsuid}`, countriesMap);
  }

  // ---- 4. 寫入 games（upsert by slug）----
  // 注意：gamesUpsert 只含新建列與「slug 尚未被具名遊戲佔用」的列；
  // 具名碰撞已在上面過濾，upsert 不會覆蓋具名遊戲的標題。
  const slugToId = new Map();
  const knownPriceCountries = new Map(); // slug → 寫入 games 時的 price_countries
  for (const batch of chunk(gamesUpsert, BATCH_GAMES)) {
    const written = await postgrest('games', batch, 'slug');
    for (const g of written) {
      slugToId.set(g.slug, g.id);
      knownPriceCountries.set(g.slug, g.price_countries ?? null);
    }
  }
  // 既有遊戲的 id（queue 目標含既有遊戲）：從索引補。
  for (const [slug] of pendingRegion) {
    if (!slugToId.has(slug)) {
      const g = bySlug.get(slug);
      if (g?.id) slugToId.set(slug, g.id);
    }
  }

  // ---- 5. 寫入 game_region_ids（只補缺口：已有值保留，與 seed-region-ids 一致）----
  for (const [slug, regs] of pendingRegion) {
    const gameId = slugToId.get(slug);
    if (!gameId) {
      console.log(`  [警告] ${slug}：寫入 games 後找不到 id，${regs.length} 個編號未寫入`);
      continue;
    }
    const have = regionByGame.get(gameId) ?? new Map();
    const toWrite = [];
    for (const r of regs) {
      if (have.get(r.country) === r.titleId) continue;
      if (have.has(r.country) && have.get(r.country) !== r.titleId) {
        counts.skippedCollision.push(
          `${slug} ${r.country}：既有編號 ${have.get(r.country)}，新檔 ${r.titleId}——已保留現有值`,
        );
        continue;
      }
      toWrite.push({ game_id: gameId, country: r.country, title_id: r.titleId, source: 'seed-unnamed-games' });
      have.set(r.country, r.titleId);
    }
    regionByGame.set(gameId, have);
    for (const batch of chunk(toWrite, BATCH_REGION_IDS)) {
      await postgrest('game_region_ids', batch, 'game_id,country');
      counts.regionIdsWritten += batch.length;
    }
    // price_countries 重算（目標遊戲可能因掛上新國家而變多）：
    // 只有真的變了才 PATCH，否則上萬款遊戲各打一次 PATCH 會跑很久。
    const g = bySlug.get(slug);
    const currentCount =
      knownPriceCountries.get(slug) ?? g?.price_countries ?? null;
    const newCount = priceCountriesFor(gameId, g?.title_id ?? null, [...have.keys()]);
    if (newCount !== currentCount) {
      await patchGame(gameId, { price_countries: newCount });
      knownPriceCountries.set(slug, newCount);
    }
  }

  // ---- 6. 寫入 prices（upsert by game_id,country；佔位遊戲的價以掃描為準）----
  for (const [slug, prs] of pendingPrices) {
    const gameId = slugToId.get(slug);
    if (!gameId) continue;
    const rows = [];
    for (const p of prs) {
      const fxRate = fx.ratesTwd[p.price.currency] ?? null;
      if (fxRate == null) {
        console.log(`  [警告] ${slug} ${p.country}：缺 ${p.price.currency} 匯率，價格列跳過`);
        continue;
      }
      rows.push(priceEntryToRow(gameId, p.country, p.price, fxRate));
    }
    for (const batch of chunk(rows, BATCH_PRICES)) {
      await postgrest('prices', batch, 'game_id,country');
      counts.pricesWritten += batch.length;
    }
  }

  console.log(
    `\n完成：具名新建 ${counts.namedCreated} 款、佔位改名 ${counts.namedRenamed} 款、` +
      `佔位併入具名 ${counts.mergedIntoNamed} 款（刪除佔位列 ${counts.gamesDeleted} 列）、` +
      `佔位新建 ${counts.placeholdersCreated} 款、佔位更新 ${counts.placeholdersUpdated} 款、` +
      `KR 掛到既有遊戲 ${counts.krAttached} 筆、KR 新建佔位 ${counts.krCreated} 款。`,
  );
  console.log(
    `  對照編號寫入 ${counts.regionIdsWritten} 列、價格寫入 ${counts.pricesWritten} 筆、` +
      `掛到 JP 遊戲 ${counts.attachedToJpGame.length} 筆、` +
      `疑似 DLC 跳過 ${counts.skippedDlc.length + krSkippedDlc.length} 筆、` +
      `碰撞跳過 ${counts.skippedCollision.length} 筆。`,
  );
  if (counts.attachedToJpGame.length > 0) {
    console.log('  掛到 JP 遊戲（title_id 相同）：');
    for (const s of counts.attachedToJpGame.slice(0, 20)) console.log(`    - ${s}`);
  }
  if (counts.skippedCollision.length > 0) {
    console.log('  碰撞跳過（未覆蓋）：');
    for (const s of counts.skippedCollision.slice(0, 20)) console.log(`    ! ${s}`);
    if (counts.skippedCollision.length > 20) console.log(`    ……共 ${counts.skippedCollision.length} 筆，僅列前 20 筆`);
  }
  if (counts.skippedDlc.length > 0) {
    console.log('  疑似 DLC／升級包跳過（前 20 筆）：');
    for (const s of counts.skippedDlc.slice(0, 20)) {
      console.log(`    - ${s.key}（${s.country} ${s.nsuid}，前綴 ${s.prefix}）`);
    }
    if (counts.skippedDlc.length > 20) console.log(`    ……共 ${counts.skippedDlc.length} 筆，僅列前 20 筆`);
  }
  console.log('可重複執行：再跑一次應為新建 0 款、其餘全部更新或跳過。');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.dryRun) {
    await dryRun(opts);
    return;
  }
  await live(opts);
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
