/**
 * Switch 遊戲比價 — 擴大目錄建置腳本
 * ============================================================
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   node scripts/build-expanded-catalog.mjs
 *   node scripts/build-expanded-catalog.mjs --force        # 忽略快取，全部重抓
 *   node scripts/build-expanded-catalog.mjs --limit 200    # 除錯：只取前 N 個 title ID
 *   node scripts/build-expanded-catalog.mjs --skip-cover-check
 *
 * 流程（全部只讀公開端點，不需金鑰、不寫資料庫）：
 *   1. 抓日本 XML（https://www.nintendo.co.jp/data/software/xml/switch.xml，
 *      約 10,045 筆）＋ 香港 JSON（https://www.nintendo.com.hk/data/json/
 *      switch_software.json，約 544 筆，內容停在 2022-06），以 title ID 去重。
 *   2. 抓日本價格 API 全量 title ID（分批 50），只保留 sales_status=onsale
 *      且有 regular_price 的遊戲；再對保留的遊戲抓其餘 34 國價格。
 *      現有 32 款種子遊戲另外全量抓 35 國（不論日本是否在售），其中
 *      mk-world / dk-bananza 的 title ID 不在日本 XML，用
 *      data/title-ids.json 的人工核對值；ring-fit / pokemon-za / hades2 /
 *      silksong 沒有 title ID，無法抓價，保留在目錄中、prices 為空。
 *   3. 封面用日本 XML 的 ScreenshotImgURL（任天堂 CDN 遠端網址），不下載
 *      圖片進 public/covers/；抽樣 20 張驗證 HTTP 200 且 Content-Type 為圖片。
 *   4. 寫出 data/catalog-expanded.json（種子檔相容格式）。
 *
 * 斷點續跑：每完成一個國家就把該國價格寫進 data/.cache/prices-<CC>.json，
 *   並更新 data/.cache/expanded-progress.json；重跑時自動跳過已完成的國家
 *   與已抓好的清單／日本價格。--force 可全部重來。
 * 並行度：5（價格 API 429 / 5xx 指數退避重試，最多 3 次；失敗的 chunk 只
 *   記錄、不中斷整批）。
 *
 * 已知限制（見輸出 status.notes）：
 *   - 【重要】title ID（NSUID）是「分區」的，不是全球共用：日本 XML
 *     的 LinkURL 只給日本區 NSUID，只在 JP 價格 API 回 onsale；同一款
 *     遊戲在 US / GB / DE 等區的 NSUID 不同（實測：botw JP=70010000000026、
 *     US=70010000000025；mk8dx JP=...186，US 附近 ID 皆為其他遊戲），
 *     且偏移量每款不同、無法推導；以 ±5 試探會抓到別款遊戲的價格，
 *     絕對不可用。因此本腳本按任務規定以日本 NSUID 抓全部 35 國，
 *     實測結果只有 JP（＋下方 HK/TW 補充）有價，其餘 33 國皆回
 *     not_found——這是 ID 問題，不是抓取失敗。種子檔 2026-11-15 的
 *     920 筆多國價格必定是用各區 NSUID 抓的；要真正做到多國比價，
 *     須另外建立各區 NSUID 對照表（各區 eShop 搜尋索引），不在本次
 *     任務範圍內。本限制同樣影響 app/api/refresh（以 JP title ID 抓
 *     35 國，每日更新在 JP 以外也會全數 not_found）。
 *   - 香港 JSON 的 thumb_img 數字是「香港區 NSUID」，在 HK / TW 價格
 *     API 回 onsale（舊文件稱其不是 title ID 是誤判：當時只以 JP
 *     驗證，當然 not_found）。本腳本用它為標題比對到的遊戲補 HK / TW
 *     價（約 52 款以日文標題對到；種子遊戲另以中文名比對）。
 *   - 日本 XML 沒有類型（genre）與試玩標記：SoftType 只有 dl / pkg_dl，
 *     無法區分 DLC／本體／組合包，一律記 product_type="game"、has_demo=0；
 *     genre 只有與香港 JSON 標題完全一致的極少數能取到 category，
 *     其餘為 null。
 *   - 日本 XML 最新發售日約 2025-05-01，Switch 2 之後的遊戲不在其中；
 *     Switch 2 遊戲只有現有 32 款裡的 4 款（mk-world、dk-bananza、
 *     pokemon-za、hades2）被保留，後兩款無 title ID、無價格。
 *   - TW eShop 對部分遊戲用不同 NSUID（如 botw 在 TW not_found），
 *     所以 TW / HK / KR 覆蓋天然偏低，不是抓取失敗。
 *   - 中文名：香港 JSON 只有 544 筆且停在 2022-06-24，與日本 XML 標題
 *     逐字比對只對到約 52 款；其餘中文名沿用日本原文標題。
 *
 * 需求：Node.js 18+（內建 fetch，不需安裝任何套件）。
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(PROJECT_ROOT, 'data', '.cache');
const OUT_PATH = path.join(PROJECT_ROOT, 'data', 'catalog-expanded.json');
const SEED_PATH = path.join(PROJECT_ROOT, 'seed', 'catalog-2026-11-15.json');
const TITLE_IDS_PATH = path.join(PROJECT_ROOT, 'data', 'title-ids.json');

const JP_XML_URL = 'https://www.nintendo.co.jp/data/software/xml/switch.xml';
const HK_JSON_URL = 'https://www.nintendo.com.hk/data/json/switch_software.json';
const PRICE_API = 'https://api.ec.nintendo.com/v1/price';
const FX_ENDPOINTS = [
  'https://open.er-api.com/v6/latest/USD',
  'https://api.exchangerate-api.com/v4/latest/USD',
];
const PLACEHOLDER_COVER = '/covers/placeholder.svg';
const UA = 'switch-price-site/1.0 (expanded catalog builder)';
const FETCH_TIMEOUT_MS = 20_000;
const CHUNK_SIZE = 50; // 價格 API 一次 ids 最多 50 個
const CONCURRENCY = 5;
const MAX_RETRIES = 3;

// 35 國清單（與 lib/countries.ts 同步，腳本獨立運作不 import TS）。
const COUNTRIES = [
  { code: 'TW', name: '台灣', currency: 'TWD' },
  { code: 'JP', name: '日本', currency: 'JPY' },
  { code: 'HK', name: '香港', currency: 'HKD' },
  { code: 'KR', name: '韓國', currency: 'KRW' },
  { code: 'US', name: '美國', currency: 'USD' },
  { code: 'CA', name: '加拿大', currency: 'CAD' },
  { code: 'MX', name: '墨西哥', currency: 'MXN' },
  { code: 'BR', name: '巴西', currency: 'BRL' },
  { code: 'CL', name: '智利', currency: 'CLP' },
  { code: 'CO', name: '哥倫比亞', currency: 'COP' },
  { code: 'AR', name: '阿根廷', currency: 'ARS' },
  { code: 'PE', name: '秘魯', currency: 'PEN' },
  { code: 'GB', name: '英國', currency: 'GBP' },
  { code: 'IE', name: '愛爾蘭', currency: 'EUR' },
  { code: 'DE', name: '德國', currency: 'EUR' },
  { code: 'FR', name: '法國', currency: 'EUR' },
  { code: 'ES', name: '西班牙', currency: 'EUR' },
  { code: 'IT', name: '義大利', currency: 'EUR' },
  { code: 'NL', name: '荷蘭', currency: 'EUR' },
  { code: 'BE', name: '比利時', currency: 'EUR' },
  { code: 'AT', name: '奧地利', currency: 'EUR' },
  { code: 'CH', name: '瑞士', currency: 'CHF' },
  { code: 'PT', name: '葡萄牙', currency: 'EUR' },
  { code: 'PL', name: '波蘭', currency: 'PLN' },
  { code: 'CZ', name: '捷克', currency: 'CZK' },
  { code: 'DK', name: '丹麥', currency: 'DKK' },
  { code: 'FI', name: '芬蘭', currency: 'EUR' },
  { code: 'SE', name: '瑞典', currency: 'SEK' },
  { code: 'NO', name: '挪威', currency: 'NOK' },
  { code: 'AU', name: '澳洲', currency: 'AUD' },
  { code: 'NZ', name: '紐西蘭', currency: 'NZD' },
  { code: 'ZA', name: '南非', currency: 'ZAR' },
  { code: 'SG', name: '新加坡', currency: 'SGD' },
  { code: 'MY', name: '馬來西亞', currency: 'MYR' },
  { code: 'TH', name: '泰國', currency: 'THB' },
];
const COUNTRY_MAP = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const SKIP_COVER_CHECK = args.includes('--skip-cover-check');
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : null;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function writeJson(p, obj) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/** 標題正規化：比對用（沿用 scripts/map-title-ids.mjs 的 normalizeTitle）。 */
function normalizeTitle(s) {
  if (!s) return '';
  return String(s).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 從標題抽出拉丁字母部分作英文名；沒有拉丁字母回 null（呼叫端改用原文）。 */
function extractLatin(title) {
  const s = String(title ?? '').normalize('NFKD');
  // 先去掉括號附註（如 (ゼノブレイド3)），再去掉非 ASCII，收掉首尾雜字
  const noParen = s.replace(/\([^)]*\)/g, ' ');
  const latin = noParen.replace(/[^\x20-\x7E]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  return /[A-Za-z]/.test(latin) ? latin : null;
}

/** 英文名 → slug：小寫連字號、去標點；無英文名回 null（呼叫端用 game-<id>）。 */
function slugify(en) {
  if (!en) return null;
  const s = String(en).normalize('NFKD').toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return s || null;
}

function langForCountry(country) {
  if (country === 'JP') return 'ja';
  if (country === 'TW' || country === 'HK') return 'zh';
  return 'en';
}

function taipeiDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function parseRawValue(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 有上限的並行池：items 經 worker(item, index) 處理，回傳結果陣列。 */
async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/** 可重試的 fetch：429 / 5xx / 網路錯誤指數退避重試（最多 MAX_RETRIES 次）；其他 4xx 直接丟錯。 */
async function fetchRetry(url, { method = 'GET', timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw lastErr;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError' || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(err.message)) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw lastErr;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('fetch 失敗');
}

async function fetchJson(url) {
  const res = await fetchRetry(url);
  return res.json();
}

async function fetchText(url) {
  const res = await fetchRetry(url, { timeoutMs: 60_000 });
  return res.text();
}

// ---------------------------------------------------------------------------
// 進度檔
// ---------------------------------------------------------------------------
const PROGRESS_PATH = path.join(CACHE_DIR, 'expanded-progress.json');
let progress = {
  startedAt: new Date().toISOString(), updatedAt: null,
  listsDone: false, jpDone: false, jpChunksDone: 0, jpChunksTotal: 0,
  countriesDone: [], failures: [],
};
async function loadProgress() {
  if (!FORCE && (await exists(PROGRESS_PATH))) {
    try { progress = { ...progress, ...(await readJson(PROGRESS_PATH)) }; } catch { /* 損毀就重來 */ }
  }
}
async function saveProgress() {
  progress.updatedAt = new Date().toISOString();
  await writeJson(PROGRESS_PATH, progress);
}

// ---------------------------------------------------------------------------
// 階段 0：匯率（ExchangeRate-API 免 key；快取在 data/.cache/fx.json）
// ---------------------------------------------------------------------------
async function fetchFx() {
  const fxPath = path.join(CACHE_DIR, 'fx.json');
  const todayKey = taipeiDateKey();
  if (!FORCE && (await exists(fxPath))) {
    try {
      const cached = await readJson(fxPath);
      if (cached.fxDateKey === todayKey && cached.ratesTwd) {
        console.log(`[fx] 使用今日快取：${cached.fxAsOf}（date_key=${todayKey}）`);
        return cached;
      }
    } catch { /* 快取損毀就重抓 */ }
  }
  let lastError = null;
  for (const endpoint of FX_ENDPOINTS) {
    try {
      const data = await fetchJson(endpoint);
      const rates = data?.rates;
      if (!rates || typeof rates.TWD !== 'number' || rates.TWD <= 0) throw new Error('回應缺少 TWD');
      const ratesTwd = { TWD: 1 };
      for (const [cur, perUsd] of Object.entries(rates)) {
        if (typeof perUsd === 'number' && perUsd > 0) ratesTwd[cur] = rates.TWD / perUsd;
      }
      const snap = {
        ratesTwd,
        fxAsOf: data?.time_last_update_utc ?? data?.date ?? new Date().toISOString(),
        fxDateKey: todayKey,
        source: endpoint,
      };
      await writeJson(fxPath, snap);
      console.log(`[fx] ${endpoint} → asOf=${snap.fxAsOf}（台北 ${todayKey} 08:00 快照，TWD/USD=${rates.TWD}）`);
      return snap;
    } catch (err) { lastError = err; }
  }
  throw new Error(`匯率抓取失敗（兩個端點都失敗）：${lastError?.message ?? '未知錯誤'}`);
}

// ---------------------------------------------------------------------------
// 階段 1：日本 XML ＋ 香港 JSON
// ---------------------------------------------------------------------------
function parseJpXml(xml) {
  const entries = [];
  const re = /<TitleInfo>([\s\S]*?)<\/TitleInfo>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const get = (t) => b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim() ?? '';
    const link = get('LinkURL');
    const id = /\/titles\/(\d+)/.exec(link)?.[1] ?? null;
    entries.push({
      title_id: id,
      title: get('TitleName'),
      maker: get('MakerName') || null,
      sales_date: get('SalesDate') || null,
      soft_type: get('SoftType') || null,
      cover_url: get('ScreenshotImgURL') || null,
    });
  }
  return entries;
}

async function stageLists() {
  const listsPath = path.join(CACHE_DIR, 'expanded-lists.json');
  if (!FORCE && progress.listsDone && (await exists(listsPath))) {
    const cached = await readJson(listsPath);
    console.log(`[lists] 使用快取：JP XML ${cached.jp.length} 筆、HK JSON ${cached.hk.length} 筆`);
    return cached;
  }
  console.log('[lists] 抓取日本 XML…');
  const xml = await fetchText(JP_XML_URL);
  const jp = parseJpXml(xml);
  console.log(`[lists] 抓取香港 JSON…`);
  const hkRaw = await fetchJson(HK_JSON_URL);
  const hkList = Array.isArray(hkRaw) ? hkRaw : (hkRaw?.software ?? hkRaw?.items ?? []);
  const hk = hkList.map((it) => ({
    title: (it.title ?? '').trim(),
    category: String(it.category ?? '').replace(/[\r\n]+/g, ' ').trim() || null,
    // thumb_img 檔名數字是香港區 NSUID（HK / TW 價格 API 有效，JP 無效）
    thumbId: /(\d{14})/.exec(it.thumb_img ?? '')?.[1] ?? null,
    maker: (it.maker_publisher ?? '').trim() || null,
  })).filter((h) => h.title);
  const data = {
    fetchedAt: new Date().toISOString(),
    jp, hk,
    jpSoftTypes: Object.entries(jp.reduce((a, e) => { a[e.soft_type] = (a[e.soft_type] ?? 0) + 1; return a; }, {})),
  };
  await writeJson(listsPath, data);
  progress.listsDone = true;
  await saveProgress();
  console.log(`[lists] JP XML ${jp.length} 筆（SoftType：${JSON.stringify(data.jpSoftTypes)}）、HK JSON ${hk.length} 筆`);
  return data;
}

// ---------------------------------------------------------------------------
// 階段 2＋3：價格 API
// ---------------------------------------------------------------------------
/** 抓一國、一批 chunk 的價格；失敗回 { error }，不丟錯（由呼叫端記錄）。 */
async function fetchPriceChunk(country, ids) {
  const lang = langForCountry(country);
  const url = `${PRICE_API}?country=${country}&ids=${ids.join(',')}&lang=${lang}`;
  try {
    const data = await fetchJson(url);
    return { prices: data?.prices ?? [] };
  } catch (err) {
    return { error: err.message, ids };
  }
}

/** 抓一國全部 title ID 的價格（分批 50、並行 CONCURRENCY），回傳 Map<title_id, entry>。 */
async function fetchCountryPrices(country, titleIds, onProgress) {
  const chunks = chunk(titleIds, CHUNK_SIZE);
  const map = new Map();
  const failures = [];
  let done = 0;
  await pool(chunks, CONCURRENCY, async (ids) => {
    const r = await fetchPriceChunk(country, ids);
    if (r.error) {
      failures.push({ country, ids, error: r.error });
    } else {
      for (const p of r.prices) map.set(String(p.title_id), p);
    }
    done++;
    if (onProgress && done % 20 === 0) onProgress(done, chunks.length);
  });
  return { map, failures, chunks: chunks.length };
}

function isOnSaleWithPrice(entry) {
  return entry && entry.sales_status === 'onsale' && entry.regular_price
    && parseRawValue(entry.regular_price.raw_value) != null;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await loadProgress();
  console.log(`開始擴大目錄建置（${new Date().toISOString()}，台北日期 ${taipeiDateKey()}）${FORCE ? ' [FORCE 全重抓]' : ' [可斷點續跑]'}`);

  // 0. 匯率
  const fx = await fetchFx();

  // 1. 清單
  const lists = await stageLists();
  const jpById = new Map();
  for (const e of lists.jp) {
    if (e.title_id && !jpById.has(e.title_id)) jpById.set(e.title_id, e);
  }
  console.log(`[dedup] JP XML 去重後 ${jpById.size} 個 title ID（原始 ${lists.jp.length} 筆）`);
  // 香港 JSON：正規化標題 → 第一筆（去重後 471 個標題，見註解：中文名覆蓋極低）
  const hkByNorm = new Map();
  for (const h of lists.hk) {
    const k = normalizeTitle(h.title);
    if (k && !hkByNorm.has(k)) hkByNorm.set(k, h);
  }

  // 現有 32 款種子遊戲（欄位一律保留）＋ title ID 對照
  const seed = JSON.parse(await readFile(SEED_PATH, 'utf8'));
  const seedGames = seed.data.games;
  const titleIds = JSON.parse(await readFile(TITLE_IDS_PATH, 'utf8'));
  const seedTitleId = {};
  for (const [slug, m] of Object.entries(titleIds.mapped ?? {})) seedTitleId[slug] = m.title_id;
  const seedBySlug = new Map(seedGames.map((g) => [g.slug, g]));
  const seedByTitleId = new Map();
  for (const g of seedGames) {
    const tid = seedTitleId[g.slug];
    if (tid) seedByTitleId.set(tid, g);
  }
  const manualExtraIds = [...seedByTitleId.keys()].filter((id) => !jpById.has(id));
  console.log(`[seed] 現有 ${seedGames.length} 款；其中 title ID 不在 JP XML：${manualExtraIds.length} 個（${manualExtraIds.join(', ') || '無'}）`);

  // 2. 建立遊戲記錄（先保留現有 32 款的 slug，再配新 slug）
  const slugTaken = new Set(seedGames.map((g) => g.slug));
  function uniqueSlug(base, titleId) {
    let s = base || `game-${titleId}`;
    if (!slugTaken.has(s)) { slugTaken.add(s); return s; }
    const suffixed = `${s}-${String(titleId).slice(-6)}`;
    if (!slugTaken.has(suffixed)) { slugTaken.add(suffixed); return suffixed; }
    let i = 2;
    while (slugTaken.has(`${suffixed}-${i}`)) i++;
    const final = `${suffixed}-${i}`;
    slugTaken.add(final);
    return final;
  }

  const games = new Map(); // title_id (或 seed slug) -> 記錄
  let hkMatched = 0;
  let genreFromHk = 0;
  for (const e of jpById.values()) {
    const seedGame = seedByTitleId.get(e.title_id);
    if (seedGame) {
      // 現有遊戲：欄位全部保留，只補 title_id；封面固定本地路徑
      // 香港 thumb 另以中文名比對（日文標題比對不到中文名時用）
      const hkByZh = hkByNorm.get(normalizeTitle(seedGame.titleZh));
      games.set(e.title_id, {
        titleId: e.title_id,
        hkThumbId: hkByZh?.thumbId ?? hkByNorm.get(normalizeTitle(e.title))?.thumbId ?? null,
        slug: seedGame.slug,
        titleZh: seedGame.titleZh,
        titleEn: seedGame.titleEn,
        genre: seedGame.genre ?? null,
        publisher: seedGame.publisher ?? null,
        platform: seedGame.platform ?? null,
        productType: seedGame.productType ?? 'game',
        hasDemo: typeof seedGame.hasDemo === 'number' ? seedGame.hasDemo : 0,
        coverUrl: `/covers/${seedGame.slug}.jpg`,
        youtubeId: seedGame.youtubeId ?? null,
        isSeed: true,
      });
      continue;
    }
    const hk = hkByNorm.get(normalizeTitle(e.title));
    if (hk) hkMatched++;
    const latin = extractLatin(e.title);
    const titleEn = latin ?? e.title;
    const slug = uniqueSlug(slugify(latin), e.title_id);
    const genre = hk?.category ?? null;
    if (genre) genreFromHk++;
    games.set(e.title_id, {
      titleId: e.title_id,
      hkThumbId: hk?.thumbId ?? null,
      slug,
      titleZh: hk?.title ?? e.title,
      titleEn,
      genre,
      publisher: e.maker,
      platform: 'Switch',
      productType: 'game',
      hasDemo: 0,
      coverUrl: e.cover_url || PLACEHOLDER_COVER,
      youtubeId: null,
      isSeed: false,
    });
  }
  // 現有 32 款中 title ID 不在 JP XML 的（Switch 2 人工核對款）與無 title ID 的
  for (const g of seedGames) {
    const tid = seedTitleId[g.slug];
    // 種子遊戲另以中文名比對香港 JSON（日文標題比對不到中文名時用）
    const hkByZh = hkByNorm.get(normalizeTitle(g.titleZh));
    if (tid && !games.has(tid)) {
      games.set(tid, {
        titleId: tid, hkThumbId: hkByZh?.thumbId ?? null,
        slug: g.slug, titleZh: g.titleZh, titleEn: g.titleEn,
        genre: g.genre ?? null, publisher: g.publisher ?? null, platform: g.platform ?? null,
        productType: g.productType ?? 'game',
        hasDemo: typeof g.hasDemo === 'number' ? g.hasDemo : 0,
        coverUrl: `/covers/${g.slug}.jpg`, youtubeId: g.youtubeId ?? null, isSeed: true,
      });
    } else if (!tid) {
      games.set(`seed:${g.slug}`, {
        titleId: null, hkThumbId: hkByZh?.thumbId ?? null,
        slug: g.slug, titleZh: g.titleZh, titleEn: g.titleEn,
        genre: g.genre ?? null, publisher: g.publisher ?? null, platform: g.platform ?? null,
        productType: g.productType ?? 'game',
        hasDemo: typeof g.hasDemo === 'number' ? g.hasDemo : 0,
        coverUrl: `/covers/${g.slug}.jpg`, youtubeId: g.youtubeId ?? null, isSeed: true,
      });
    }
  }
  const allRecords = [...games.entries()].map(([key, g]) => ({ ...g, key }));
  const allTitleIds = allRecords.map((g) => g.titleId).filter(Boolean);
  const limitedIds = LIMIT ? allTitleIds.slice(0, LIMIT) : allTitleIds;
  console.log(`[build] 遊戲記錄 ${allRecords.length} 款（種子 ${seedGames.length} 款；新遊戲 ${allRecords.length - seedGames.length} 款；香港中文名對到 ${hkMatched} 款，其中 genre ${genreFromHk} 款）${LIMIT ? ` [LIMIT=${LIMIT}]` : ''}`);

  // 3. 日本價格：全量 title ID，只保留 onsale＋有原價
  const jpPath = path.join(CACHE_DIR, 'expanded-jp.json');
  let jpKept = new Set();
  let jpMap = {};
  if (!FORCE && progress.jpDone && (await exists(jpPath))) {
    const cached = await readJson(jpPath);
    jpKept = new Set(cached.keptTitleIds);
    jpMap = cached.jpPrices;
    console.log(`[jp] 使用快取：${jpKept.size} 款在售（共 ${Object.keys(jpMap).length} 筆 JP 回應）`);
  } else {
    console.log(`[jp] 抓日本價格：${limitedIds.length} 個 ID、${Math.ceil(limitedIds.length / CHUNK_SIZE)} 批…`);
    const { map, failures } = await fetchCountryPrices('JP', limitedIds, (d, t) => console.log(`[jp] ${d}/${t} 批`));
    progress.failures.push(...failures);
    jpMap = {};
    for (const [id, entry] of map) jpMap[id] = entry;
    jpKept = new Set([...map.entries()].filter(([, e]) => isOnSaleWithPrice(e)).map(([id]) => id));
    // 現有種子遊戲即使 JP 未在售也保留（後面 35 國全抓）
    for (const g of allRecords) if (g.isSeed && g.titleId) jpKept.add(g.titleId);
    await writeJson(jpPath, { fetchedAt: new Date().toISOString(), keptTitleIds: [...jpKept], jpPrices: jpMap });
    progress.jpDone = true;
    await saveProgress();
    console.log(`[jp] 完成：JP 回應 ${map.size} 筆，在售＋有原價 ${[...map.values()].filter(isOnSaleWithPrice).length} 款；失敗 chunk ${failures.length} 個`);
  }

  // 4. 其餘 34 國：只抓保留的遊戲（＋全部有 title ID 的種子遊戲）
  const seedIdsWithTitle = allRecords.filter((g) => g.isSeed && g.titleId).map((g) => g.titleId);
  const fetchIds = [...new Set([...jpKept, ...seedIdsWithTitle])].filter((id) => !LIMIT || limitedIds.includes(id));
  const otherCountries = COUNTRIES.filter((c) => c.code !== 'JP');
  console.log(`[prices] 其餘 34 國抓取對象 ${fetchIds.length} 個 ID（JP 保留 ${jpKept.size} ＋種子 ${seedIdsWithTitle.length}，去重後）`);
  for (const country of otherCountries) {
    const cachePath = path.join(CACHE_DIR, `prices-${country.code}.json`);
    if (!FORCE && progress.countriesDone.includes(country.code) && (await exists(cachePath))) {
      continue;
    }
    const t0 = Date.now();
    const { map, failures } = await fetchCountryPrices(country.code, fetchIds);
    progress.failures.push(...failures);
    const obj = {};
    for (const [id, entry] of map) obj[id] = entry;
    await writeJson(cachePath, { country: country.code, fetchedAt: new Date().toISOString(), prices: obj });
    progress.countriesDone.push(country.code);
    await saveProgress();
    console.log(`[prices] ${country.code} 完成：回應 ${map.size} 筆、失敗 chunk ${failures.length} 個（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  }

  // 4b. HK / TW 補充：香港 thumb_img 是香港區 NSUID（HK / TW 有效）。
  // 為標題比對到的遊戲（含以中文名比對到的種子遊戲）用 thumb ID 另抓
  // HK 與 TW 價，補進該遊戲的 HK / TW 價格列（JP NSUID 在這兩區皆
  // not_found，故無衝突；若 JP NSUID 已有價則以原價為準）。
  const thumbToKey = new Map(); // thumbId -> game key（titleId 或 seed:<slug>）
  for (const [key, g] of games) {
    if (g.hkThumbId && !thumbToKey.has(g.hkThumbId)) thumbToKey.set(g.hkThumbId, key);
  }
  const thumbPath = path.join(CACHE_DIR, 'prices-hk-thumb.json');
  let thumbPrices = {};
  if (!FORCE && progress.hkThumbDone && (await exists(thumbPath))) {
    thumbPrices = (await readJson(thumbPath)).prices;
    console.log(`[hk-thumb] 使用快取：${Object.keys(thumbPrices).length} 個 thumb ID 的 HK/TW 價`);
  } else if (thumbToKey.size > 0) {
    const thumbIds = [...thumbToKey.keys()];
    console.log(`[hk-thumb] 抓 HK/TW 價：${thumbIds.length} 個 thumb ID…`);
    thumbPrices = {};
    for (const cc of ['HK', 'TW']) {
      const { map, failures } = await fetchCountryPrices(cc, thumbIds);
      progress.failures.push(...failures);
      for (const [id, entry] of map) {
        if (!thumbPrices[id]) thumbPrices[id] = {};
        thumbPrices[id][cc] = entry;
      }
      console.log(`[hk-thumb] ${cc}：回應 ${map.size} 筆、失敗 chunk ${failures.length} 個`);
    }
    await writeJson(thumbPath, { fetchedAt: new Date().toISOString(), prices: thumbPrices });
    progress.hkThumbDone = true;
    await saveProgress();
  } else {
    console.log('[hk-thumb] 無標題比對到的遊戲，跳過');
  }

  // 5. 組裝目錄
  console.log('[assemble] 組裝 catalog…');
  const priceByGame = new Map(); // game key -> { CC -> entry }
  function addPrice(key, cc, entry) {
    if (!priceByGame.has(key)) priceByGame.set(key, {});
    priceByGame.get(key)[cc] = entry;
  }
  for (const [id, entry] of Object.entries(jpMap)) {
    if (isOnSaleWithPrice(entry)) addPrice(id, 'JP', entry);
  }
  // 種子遊戲在 JP 未在售時不寫 JP 價（與新遊戲同一規則：只收 onsale＋有原價）
  for (const country of otherCountries) {
    const cached = await readJson(path.join(CACHE_DIR, `prices-${country.code}.json`));
    for (const entry of Object.values(cached.prices)) {
      if (isOnSaleWithPrice(entry)) addPrice(String(entry.title_id), country.code, entry);
    }
  }
  // HK thumb 補充：只補該遊戲在該國尚無價時
  let hkThumbEnriched = 0;
  for (const [thumbId, byCountry] of Object.entries(thumbPrices)) {
    const key = thumbToKey.get(thumbId);
    if (!key) continue;
    const have = priceByGame.get(key) ?? {};
    let gained = false;
    for (const cc of ['HK', 'TW']) {
      const entry = byCountry[cc];
      if (entry && isOnSaleWithPrice(entry) && !have[cc]) {
        addPrice(key, cc, entry);
        gained = true;
      }
    }
    if (gained) hkThumbEnriched++;
  }
  console.log(`[hk-thumb] 補到 HK/TW 價的遊戲：${hkThumbEnriched} 款（比對到 thumb 的遊戲共 ${thumbToKey.size} 款）`);

  function toPriceRow(cc, entry) {
    const info = COUNTRY_MAP[cc];
    const regularRaw = parseRawValue(entry.regular_price?.raw_value);
    const discountRaw = entry.discount_price ? parseRawValue(entry.discount_price.raw_value) : null;
    const effectiveRaw = discountRaw ?? regularRaw;
    const currency = entry.discount_price?.currency ?? entry.regular_price?.currency ?? info.currency;
    const rate = fx.ratesTwd[currency];
    const priceTwd = effectiveRaw != null && rate != null ? Math.round(effectiveRaw * rate) : null;
    const discountPct = discountRaw != null && regularRaw ? Math.round((1 - discountRaw / regularRaw) * 100) : null;
    return {
      country: cc, countryName: info.name, currency,
      regularRaw, effectiveRaw, discountPct, discountRaw,
      saleEnd: entry.discount_price?.end_datetime ?? null,
      priceTwd, isHistoricalLow: false,
    };
  }

  const outGames = [];
  const perCountryCount = {};
  for (const c of COUNTRIES) perCountryCount[c.code] = 0;
  let noPriceCount = 0;
  for (const g of allRecords) {
    const byCountry = priceByGame.get(g.key) ?? {};
    const prices = Object.entries(byCountry)
      .map(([cc, entry]) => toPriceRow(cc, entry))
      .sort((a, b) => (a.priceTwd ?? Infinity) - (b.priceTwd ?? Infinity));
    for (const p of prices) perCountryCount[p.country]++;
    let historicalLowTwd = null;
    let cheapest = null;
    if (prices.length > 0) {
      const min = prices.find((p) => p.priceTwd != null) ?? prices[0];
      min.isHistoricalLow = true;
      historicalLowTwd = min.priceTwd;
      cheapest = { ...min };
    } else {
      noPriceCount++;
    }
    outGames.push({
      slug: g.slug, titleZh: g.titleZh, titleEn: g.titleEn,
      genre: g.genre, publisher: g.publisher, platform: g.platform,
      productType: g.productType, hasDemo: g.hasDemo,
      coverUrl: g.coverUrl, youtubeId: g.youtubeId,
      titleId: g.titleId,
      historicalLowTwd, cheapest, prices,
    });
  }
  outGames.sort((a, b) => a.slug.localeCompare(b.slug));
  const totalPrices = outGames.reduce((n, g) => n + g.prices.length, 0);
  const priceCountryCount = Object.values(perCountryCount).filter((n) => n > 0).length;
  const genreNullCount = outGames.filter((g) => g.genre == null).length;

  // 6. 封面抽樣驗證（20 張 CDN 圖片：等距抽樣）
  let coverCheck = { sampled: 0, ok: 0, failed: [], skipped: true };
  if (!SKIP_COVER_CHECK) {
    const remote = outGames.filter((g) => g.coverUrl?.startsWith('http'));
    const step = Math.max(1, Math.floor(remote.length / 20));
    const sample = [];
    for (let i = 0; i < remote.length && sample.length < 20; i += step) sample.push(remote[i]);
    coverCheck = { sampled: sample.length, ok: 0, failed: [], skipped: false };
    await pool(sample, 5, async (g) => {
      try {
        let res;
        let ct = '';
        try {
          res = await fetchRetry(g.coverUrl, { method: 'HEAD', timeoutMs: 15_000 });
          ct = res.headers.get('content-type') ?? '';
        } catch { /* 有些 CDN 不支援 HEAD，改用 GET */ }
        if (ct.startsWith('image/')) { coverCheck.ok++; return; }
        // 任天堂 CDN 有時回 application/octet-stream 但內容確為 JPEG
        // （先例：mario-party-j、zelda-eow，見 DATA_NOTES.md §6）：
        // 改抓本體驗檔頭 magic bytes 再判定。
        res = await fetchRetry(g.coverUrl, { method: 'GET', timeoutMs: 15_000 });
        ct = res.headers.get('content-type') ?? '';
        if (ct.startsWith('image/')) { coverCheck.ok++; return; }
        const buf = new Uint8Array(await res.arrayBuffer());
        const isJpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        const isPng = buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        const isGif = buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
        const isWebp = buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
          && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
        if (isJpeg || isPng || isGif || isWebp) coverCheck.ok++;
        else coverCheck.failed.push({ slug: g.slug, url: g.coverUrl, reason: `Content-Type=${ct}，檔頭非圖片（${buf.length} bytes）` });
      } catch (err) {
        coverCheck.failed.push({ slug: g.slug, url: g.coverUrl, reason: err.message });
      }
    });
    console.log(`[cover] 抽樣 ${coverCheck.sampled} 張：${coverCheck.ok} 張 OK、${coverCheck.failed.length} 張失敗`);
  }

  const lastPriceUpdate = new Date().toISOString();
  const catalog = {
    ok: true,
    data: {
      games: outGames,
      status: {
        gameCount: outGames.length,
        priceCountryCount,
        lastPriceUpdate,
        fxAsOf: fx.fxAsOf,
        fxDateKey: fx.fxDateKey,
        sources: [
          { name: 'jp-xml', url: JP_XML_URL, entries: lists.jp.length, note: '日本官網 Switch 軟體清單；最新發售日約 2025-05-01，Switch 2 之後的遊戲不在其中；無類型／試玩標記，SoftType 只有 dl / pkg_dl，無法區分 DLC' },
          { name: 'hk-json', url: HK_JSON_URL, entries: lists.hk.length, note: '香港官網 Switch 軟體清單；內容停在 2022-06-24，僅以標題正規化比對提供繁中名與 category（對到約 52 款）；thumb_img 為 14 位數字的才是香港區 NSUID（HK / TW 有效，共 59 筆），其餘為 HAC 產品碼檔名' },
          { name: 'price-api', url: PRICE_API, entries: totalPrices, note: '任天堂官方價格 API；先以 JP 全量篩選 onsale＋有原價，再抓其餘 34 國；種子 32 款另以 title ID 全量抓 35 國' },
          { name: 'fx', url: fx.source, entries: Object.keys(fx.ratesTwd).length, note: `ExchangeRate-API 免 key 端點；快照 ${fx.fxAsOf}（台北 ${fx.fxDateKey} 08:00）` },
        ],
        coverCheck,
        stats: {
          totalPrices,
          perCountryCount,
          noPriceGameCount: noPriceCount,
          genreNullCount,
          hkMatched,
          hkThumbMatched: thumbToKey.size,
          hkThumbEnriched,
          jpXmlEntries: lists.jp.length,
          jpDedupedTitleIds: jpById.size,
          jpOnSaleKept: jpKept.size,
          fetchFailures: progress.failures.length,
          failedChunks: progress.failures.slice(0, 20),
        },
      },
    },
  };
  await writeJson(OUT_PATH, catalog);

  const sortedCountries = Object.entries(perCountryCount).sort((a, b) => b[1] - a[1]);
  console.log('\n===== 完成 =====');
  console.log(`遊戲總數：${outGames.length} 款（新遊戲 ${outGames.length - seedGames.length} ＋種子 ${seedGames.length}）`);
  console.log(`價格總筆數：${totalPrices} 筆；有價國家數：${priceCountryCount} / 35`);
  console.log(`各國覆蓋（有價遊戲款數）前五：${sortedCountries.slice(0, 5).map(([c, n]) => `${c}=${n}`).join('、')}`);
  console.log(`各國覆蓋後五：${sortedCountries.slice(-5).map(([c, n]) => `${c}=${n}`).join('、')}`);
  console.log(`完全無價遊戲：${noPriceCount} 款；genre 缺失：${genreNullCount} 款（${(genreNullCount / outGames.length * 100).toFixed(1)}%）`);
  console.log(`封面抽樣：${coverCheck.ok}/${coverCheck.sampled} 張 OK`);
  console.log(`失敗 chunk：${progress.failures.length} 個（見 status.stats.failedChunks，缺價只記錄不中斷）`);
  console.log(`寫出：${OUT_PATH}`);
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
