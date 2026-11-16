/**
 * Switch 遊戲比價 — 各區價格抓取腳本（對照表 → 價格 patch 檔）
 * ============================================================
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   node scripts/fetch-region-prices.mjs
 *   node scripts/fetch-region-prices.mjs data/tw-hk-full-ids.json
 *   node scripts/fetch-region-prices.mjs --countries=US,GB,DE,FR,AU,CA
 *   node scripts/fetch-region-prices.mjs --use-cache   # 匯率只用 data/.cache/fx.json
 *
 * 前置作業：來源調查組的對照檔已放在 data/（預設讀
 *   data/region-title-ids.json；若無，依序改讀 data/tw-hk-full-ids.json、
 *   data/tw-hk-title-ids.json；三者皆無時報錯退出）。
 *
 * 做法：
 *   1. 用 scripts/region-ids-input.mjs 解析對照檔（與 seed-region-ids.mjs
 *      同一解析器），得到每款遊戲每國的專屬編號。
 *   2. 對每個國家，用「該國編號」分批（50 個一批）打任天堂官方價格 API
 *      （https://api.ec.nintendo.com/v1/price）。重試邏輯沿用
 *      lib/nintendo.ts 的精神：429／5xx／逾時指數退避（500ms→1000ms＋
 *      抖動，最多 3 次嘗試；429 的 Retry-After 優先但上限 5 秒），
 *      單批失敗只記進 summary.failedChunks、不中斷其他國家／批次。
 *      lang 規則與 lib/nintendo.ts 一致：JP 用 ja、TW／HK 用 zh、其餘用 en。
 *   3. 匯率：預設向 ExchangeRate-API 免 key 端點抓當日完整匯率表
 *      （每日更新也在 08:00 台北時間抓，同一快照語義），抓不到改讀
 *      data/.cache/fx.json；--use-cache 時只讀快取。priceTwd =
 *      round(effectiveRaw × 該幣別兌台幣匯率)；缺匯率的幣別不亂換算，
 *      該列跳過並記進 summary.missingFxCurrencies。
 *   4. 只收在售（sales_status=onsale）且有原價的列；not_found／下架／
 *      無價只記進 summary.notFound，不寫進 patch、不中斷。
 *
 * 輸出：data/region-prices-patch.json（可由 --out 改路徑）：
 *   {
 *     "generated_at", "input", "fxDateKey", "fxAsOf", "fxSource",
 *     "games": { "<slug>": { "titleZh", "titleEn",
 *                  "prices": [ { "country", "countryName", "currency",
 *                    "regularRaw", "effectiveRaw", "discountPct",
 *                    "discountRaw", "saleEnd", "priceTwd",
 *                    "isHistoricalLow": false, "titleId" } ] } },
 *     "summary": { "gamesWithPrices", "priceRows",
 *                  "perCountry": { "US": { "queried", "priced", "notFound" } },
 *                  "notFound": [ { "slug", "country", "titleId" } ],
 *                  "failedChunks": [ { "country", "message" } ],
 *                  "missingFxCurrencies": [ "XXX" ] }
 *   }
 *   prices 陣列元素的 10 個目錄欄位與 data/catalog-expanded.json 的
 *   prices 元素完全相容（多一個 titleId 僅供追溯，合併時會去掉）；
 *   下一步由 scripts/merge-region-prices.mjs 合併進目錄。
 *   本腳本不寫資料庫、不改目錄檔，只產 patch，可重複執行（重跑會覆寫
 *   同一份 patch，不會累積重複列）。
 *
 * 需求：Node.js 18+（使用內建 fetch，不需安裝任何套件）。
 */

import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadRegionIdsFile } from './region-ids-input.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FX_CACHE_PATH = path.join(PROJECT_ROOT, 'data', '.cache', 'fx.json');
const DEFAULT_OUT_PATH = path.join(PROJECT_ROOT, 'data', 'region-prices-patch.json');

const PRICE_API = 'https://api.ec.nintendo.com/v1/price';
const FETCH_TIMEOUT_MS = 20_000;
const PRICE_FETCH_MAX_ATTEMPTS = 3;
const PRICE_RETRY_BASE_MS = 500;
const PRICE_RETRY_AFTER_CAP_MS = 5_000;
const CHUNK_DELAY_MS = 250;

const FX_ENDPOINTS = [
  'https://open.er-api.com/v6/latest/USD',
  'https://api.exchangerate-api.com/v4/latest/USD',
];

// 35 國清單：與 lib/countries.ts 同步（名稱與幣別供 patch 檔使用）。
// 若日後 lib/countries.ts 增減國家，請同步改這裡。
const COUNTRIES = {
  TW: { name: '台灣', currency: 'TWD' },
  JP: { name: '日本', currency: 'JPY' },
  HK: { name: '香港', currency: 'HKD' },
  KR: { name: '韓國', currency: 'KRW' },
  US: { name: '美國', currency: 'USD' },
  CA: { name: '加拿大', currency: 'CAD' },
  MX: { name: '墨西哥', currency: 'MXN' },
  BR: { name: '巴西', currency: 'BRL' },
  CL: { name: '智利', currency: 'CLP' },
  CO: { name: '哥倫比亞', currency: 'COP' },
  AR: { name: '阿根廷', currency: 'ARS' },
  PE: { name: '秘魯', currency: 'PEN' },
  GB: { name: '英國', currency: 'GBP' },
  IE: { name: '愛爾蘭', currency: 'EUR' },
  DE: { name: '德國', currency: 'EUR' },
  FR: { name: '法國', currency: 'EUR' },
  ES: { name: '西班牙', currency: 'EUR' },
  IT: { name: '義大利', currency: 'EUR' },
  NL: { name: '荷蘭', currency: 'EUR' },
  BE: { name: '比利時', currency: 'EUR' },
  AT: { name: '奧地利', currency: 'EUR' },
  CH: { name: '瑞士', currency: 'CHF' },
  PT: { name: '葡萄牙', currency: 'EUR' },
  PL: { name: '波蘭', currency: 'PLN' },
  CZ: { name: '捷克', currency: 'CZK' },
  DK: { name: '丹麥', currency: 'DKK' },
  FI: { name: '芬蘭', currency: 'EUR' },
  SE: { name: '瑞典', currency: 'SEK' },
  NO: { name: '挪威', currency: 'NOK' },
  AU: { name: '澳洲', currency: 'AUD' },
  NZ: { name: '紐西蘭', currency: 'NZD' },
  ZA: { name: '南非', currency: 'ZAR' },
  SG: { name: '新加坡', currency: 'SGD' },
  MY: { name: '馬來西亞', currency: 'MYR' },
  TH: { name: '泰國', currency: 'THB' },
};

const CANDIDATE_INPUTS = [
  path.join(PROJECT_ROOT, 'data', 'region-title-ids.json'),
  path.join(PROJECT_ROOT, 'data', 'tw-hk-full-ids.json'),
  path.join(PROJECT_ROOT, 'data', 'tw-hk-title-ids.json'),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function taipeiDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function langForCountry(country) {
  if (country === 'JP') return 'ja';
  if (country === 'TW' || country === 'HK') return 'zh';
  return 'en';
}

function parseRawValue(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt, res) {
  const header = res?.headers.get('retry-after');
  if (header != null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, PRICE_RETRY_AFTER_CAP_MS);
    }
  }
  return PRICE_RETRY_BASE_MS * 2 ** attempt + Math.random() * 200;
}

/** 抓一國的價格（50 個一批；單批失敗重試 3 次仍失敗則拋錯，由呼叫方記錄）。 */
async function fetchPricesForCountry(country, titleIds) {
  const out = [];
  const lang = langForCountry(country);
  for (let i = 0; i < titleIds.length; i += 50) {
    const chunk = titleIds.slice(i, i + 50);
    const url = `${PRICE_API}?country=${country}&ids=${chunk.join(',')}&lang=${lang}`;
    let lastError = null;
    let done = false;
    for (let attempt = 0; attempt < PRICE_FETCH_MAX_ATTEMPTS && !done; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'switch-price-site/1.0 (fetch-region-prices)' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
          if (isRetryableStatus(res.status) && attempt < PRICE_FETCH_MAX_ATTEMPTS - 1) {
            await sleep(retryDelayMs(attempt, res));
            continue;
          }
          throw new Error(`價格 API HTTP ${res.status}（country=${country}）`);
        }
        const data = await res.json();
        out.push(...(data?.prices ?? []));
        done = true;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isHttpError = lastError.message.startsWith('價格 API HTTP');
        const retryable =
          lastError.name === 'TimeoutError' ||
          lastError.name === 'AbortError' ||
          /HTTP (429|5\d\d)/.test(lastError.message) ||
          !isHttpError;
        if (retryable && attempt < PRICE_FETCH_MAX_ATTEMPTS - 1) {
          await sleep(retryDelayMs(attempt));
          continue;
        }
        throw lastError;
      }
    }
    if (!done && lastError) throw lastError;
    await sleep(CHUNK_DELAY_MS);
  }
  return out;
}

/** 抓當日完整匯率表（1 單位外幣 = 多少台幣；TWD = 1）。失敗回 null。 */
async function fetchFxRatesLive() {
  for (const endpoint of FX_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        headers: { 'User-Agent': 'switch-price-site/1.0 (fetch-region-prices)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rates = data?.rates;
      if (!rates || typeof rates.TWD !== 'number' || rates.TWD <= 0) throw new Error('回應缺少 TWD');
      const out = { TWD: 1 };
      for (const [cur, perUsd] of Object.entries(rates)) {
        if (typeof perUsd === 'number' && perUsd > 0) out[cur] = rates.TWD / perUsd;
      }
      return {
        ratesTwd: out,
        asOf: data?.time_last_update_utc ?? data?.date ?? new Date().toISOString(),
        dateKey: taipeiDateKey(),
        source: endpoint,
      };
    } catch { /* 換下一個端點 */ }
  }
  return null;
}

async function loadFxFromCache() {
  try {
    const cached = JSON.parse(await readFile(FX_CACHE_PATH, 'utf8'));
    if (cached?.ratesTwd && typeof cached.ratesTwd === 'object') {
      return {
        ratesTwd: cached.ratesTwd,
        asOf: cached.fxAsOf ?? null,
        dateKey: cached.fxDateKey ?? null,
        source: `快取 ${FX_CACHE_PATH}`,
      };
    }
  } catch { /* 無快取 */ }
  return null;
}

async function pickInputPath(explicit) {
  if (explicit) return path.resolve(explicit);
  for (const p of CANDIDATE_INPUTS) {
    try {
      await access(p);
      return p;
    } catch { /* 試下一個 */ }
  }
  throw new Error(
    '找不到對照檔：請等來源調查組產出 data/region-title-ids.json（或 tw-hk-full-ids.json），\n' +
      '或指定舊檔：node scripts/fetch-region-prices.mjs data/tw-hk-title-ids.json',
  );
}

function parseArgs(argv) {
  const out = { input: null, countries: null, outPath: DEFAULT_OUT_PATH, useCache: false };
  for (const a of argv) {
    if (a === '--use-cache') out.useCache = true;
    else if (a.startsWith('--countries=')) {
      out.countries = a.slice('--countries='.length).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    } else if (a.startsWith('--out=')) {
      out.outPath = path.resolve(a.slice('--out='.length));
    } else if (!a.startsWith('--')) {
      out.input = a;
    } else {
      throw new Error(`未知參數：${a}（可用：--countries=US,GB、--out=<路徑>、--use-cache）`);
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = await pickInputPath(opts.input);
  const { entries, warnings, meta } = await loadRegionIdsFile(inputPath);
  console.log(
    `對照檔：${inputPath}\n` +
      `  產生時間：${meta.generated_at ?? '（未記錄）'}，條目 ${entries.length} 筆`,
  );
  for (const w of warnings) console.log(`  [警告] ${w}`);

  // 匯率（與 seed-expanded 相同邏輯：先抓即時，失敗改讀快取）。
  let fx = null;
  if (!opts.useCache) fx = await fetchFxRatesLive();
  if (!fx) {
    fx = await loadFxFromCache();
    if (fx) console.log(`[fx] 即時匯率抓不到，改用快取（${fx.asOf ?? '時間未記錄'}，date_key=${fx.dateKey ?? '未記錄'}）`);
  }
  if (!fx) {
    throw new Error('匯率抓取失敗且無快取（data/.cache/fx.json）：無法換算 priceTwd，請確認網路後重跑。');
  }
  const todayKey = taipeiDateKey();
  if (fx.dateKey && fx.dateKey !== todayKey) {
    console.log(`[fx] 注意：匯率快照日期 ${fx.dateKey} 不是今天（台北 ${todayKey}），priceTwd 將以該快照換算；若要當日 08:00 快照，請在 08:00 前後重跑（不加 --use-cache）。`);
  }
  console.log(`[fx] 匯率來源：${fx.source}（as_of=${fx.asOf ?? '未記錄'}，date_key=${fx.dateKey ?? todayKey}）`);

  // 每國的（編號 → 條目）對照；同一編號在同國出現兩次時先登記者勝出。
  const byCountry = new Map(); // country → Map<titleId, entry>
  for (const entry of entries) {
    for (const [country, titleId] of entry.ids) {
      if (opts.countries && !opts.countries.includes(country)) continue;
      if (!COUNTRIES[country]) {
        console.log(`  [警告] ${entry.key}：未知國家代碼 ${country}，已跳過（請同步 lib/countries.ts）`);
        continue;
      }
      let m = byCountry.get(country);
      if (!m) {
        m = new Map();
        byCountry.set(country, m);
      }
      if (!m.has(titleId)) m.set(titleId, entry);
    }
  }
  const countries = [...byCountry.keys()].sort();
  if (countries.length === 0) {
    throw new Error('對照檔裡沒有任何可抓價的國家編號（可能只有 JP，或 --countries 篩掉了全部）。');
  }
  console.log(`待抓國家：${countries.join('、')}（共 ${countries.length} 國）`);

  const patchGames = new Map(); // slug → { titleZh, titleEn, prices: [] }
  const summary = {
    gamesWithPrices: 0,
    priceRows: 0,
    perCountry: {},
    notFound: [],
    failedChunks: [],
    missingFxCurrencies: [],
  };
  const missingFx = new Set();

  for (const country of countries) {
    const idToEntry = byCountry.get(country);
    const titleIds = [...idToEntry.keys()];
    const info = COUNTRIES[country];
    const per = { queried: titleIds.length, priced: 0, notFound: 0 };
    summary.perCountry[country] = per;
    let fetchedEntries = [];
    try {
      fetchedEntries = await fetchPricesForCountry(country, titleIds);
    } catch (err) {
      summary.failedChunks.push({ country, message: err.message });
      console.error(`[失敗] ${country}：整國抓價失敗（${err.message}），已跳過該國，其餘國家繼續`);
      continue;
    }
    const seen = new Set();
    for (const p of fetchedEntries) {
      const titleId = String(p.title_id);
      const entry = idToEntry.get(titleId);
      if (!entry) continue; // API 回了不在清單裡的 ID，忽略
      seen.add(titleId);
      if (p.sales_status !== 'onsale' || !p.regular_price || parseRawValue(p.regular_price.raw_value) == null) {
        per.notFound += 1;
        summary.notFound.push({ slug: entry.slug ?? entry.key, country, titleId });
        continue;
      }
      const regularRaw = parseRawValue(p.regular_price.raw_value);
      const discountRawValue = p.discount_price ? parseRawValue(p.discount_price.raw_value) : null;
      const effectiveRaw = discountRawValue ?? regularRaw;
      const currency = p.regular_price.currency;
      const fxRate = fx.ratesTwd[currency];
      if (fxRate == null) {
        missingFx.add(currency);
        summary.notFound.push({ slug: entry.slug ?? entry.key, country, titleId, note: `缺 ${currency} 匯率` });
        continue;
      }
      const slug = entry.slug ?? entry.key;
      let g = patchGames.get(slug);
      if (!g) {
        g = { titleZh: entry.titleZh ?? null, titleEn: entry.titleEn ?? null, prices: [] };
        patchGames.set(slug, g);
      }
      g.prices.push({
        country,
        countryName: info.name,
        currency,
        regularRaw,
        effectiveRaw,
        discountPct:
          discountRawValue != null && regularRaw > 0
            ? Math.round((1 - discountRawValue / regularRaw) * 100)
            : null,
        discountRaw: discountRawValue != null ? regularRaw - discountRawValue : null,
        saleEnd: p.discount_price?.end_datetime ?? null,
        priceTwd: Math.round(effectiveRaw * fxRate),
        isHistoricalLow: false, // 合併進目錄時重算
        titleId,
      });
      per.priced += 1;
    }
    // API 完全沒回的編號（連 not_found 條目都沒有）也記為 notFound。
    for (const titleId of titleIds) {
      if (!seen.has(titleId)) {
        const entry = idToEntry.get(titleId);
        per.notFound += 1;
        summary.notFound.push({ slug: entry.slug ?? entry.key, country, titleId });
      }
    }
    console.log(`  ${country}：查 ${per.queried} 個編號 → 有價 ${per.priced} 筆，無價 ${per.notFound} 筆`);
  }

  summary.missingFxCurrencies = [...missingFx];
  summary.gamesWithPrices = patchGames.size;
  summary.priceRows = [...patchGames.values()].reduce((n, g) => n + g.prices.length, 0);

  const patch = {
    generated_at: new Date().toISOString(),
    input: inputPath,
    fxDateKey: fx.dateKey ?? todayKey,
    fxAsOf: fx.asOf,
    fxSource: fx.source,
    games: Object.fromEntries([...patchGames.entries()].sort()),
    summary,
  };
  await mkdir(path.dirname(opts.outPath), { recursive: true });
  await writeFile(opts.outPath, JSON.stringify(patch, null, 2) + '\n', 'utf8');
  console.log(
    `完成：${summary.gamesWithPrices} 款遊戲、${summary.priceRows} 筆價格，寫入 ${opts.outPath}\n` +
      `  無價 ${summary.notFound.length} 筆、整國失敗 ${summary.failedChunks.length} 國、` +
      `缺匯率幣別 ${summary.missingFxCurrencies.join('、') || '無'}。\n` +
      `下一步：node scripts/merge-region-prices.mjs（只補目錄缺口，不覆蓋已有價）`,
  );
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
