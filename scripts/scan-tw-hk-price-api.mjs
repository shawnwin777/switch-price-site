// scripts/scan-tw-hk-price-api.mjs
// 以官方價格 API 掃描整個 NSUID 編號空間，列舉某區 eShop 全部在售商品。
//
// 背景（2026-11-16 實測，見 data/tw-hk-source-report.md）：
// - 價格 API https://api.ec.nintendo.com/v1/price?country={cc}&ids={ids}&lang=zh
//   要「該國編號」才查得到價；一次最多 50 個 ID；回傳每個 ID 的 sales_status
//  （onsale / sales_termination / preorder / not_found）。
// - NSUID 是按發售順序編排的 14 位數字（70010000000000 起）；台港 eShop 的
//   全部在售商品必然落在 70010000000000～7001000013xxxx 這個區間內，
//   因此「把整個區間掃一遍」就是一種不依賴任何清單的完整列舉法。
// - 密度抽樣（2026-11-16，TW，每窗 1000 個 ID）：
//   70010000005000 區（星露谷附近）onsale 0；70010000060000 區 15；
//   70010000102000 區（台灣 2025-09 重登記區）107；70010000120000 區（2026 新作）71。
//   全區間 130,000 個 ID＝2,600 批；實測約 75 個 ID／秒（單線），
//   並行度 4 時約 8 分鐘跑完一區。
// - 限制：價格 API 只回編號＋價格，不回標題。掃出的編號需另以官方清單
//   （台港 software/switch 清單、每週新作文章、香港 JSON、日本 XML）
//   對照標題；對不上的編號只能先記「未知商品＋價格」，且掃描結果包含
//   DLC／追加內容／同捆包等非單一遊戲商品，需再分類（見合併腳本的說明）。
//   另注意：掃描到的是「當下在售」；已停售（sales_termination）只記錄狀態。
//
// 用法：
//   node scripts/scan-tw-hk-price-api.mjs --country TW
//   node scripts/scan-tw-hk-price-api.mjs --country HK --from 70010000100000 --to 70010000130000
//   node scripts/scan-tw-hk-price-api.mjs --country TW --concurrency 6
//   斷點續跑：同一 country＋同一區間再次執行會讀取 data/.cache/scan-<CC>.json 續跑。
//   額外區間（不同 from/to）請加 --tag 另存檢查點，例如：
//   node scripts/scan-tw-hk-price-api.mjs --country TW --from 70010000130000 --to 70010000150000 --tag ext1
//   node scripts/scan-tw-hk-price-api.mjs --country TW --from 70070000000000 --to 70070000040000 --tag ext2
//   node scripts/scan-tw-hk-price-api.mjs --country TW --from 70050000000000 --to 70050000100000 --tag ext3
//   （ext1：2026-11 後的新編號，台灣清單已出現 7001000014xxxx；
//    ext2：Switch 2 Edition／升級包用的 700700000xxxxx 編號空間；
//    ext3：DLC／追加內容用的 700500000xxxxx 編號空間）
//
// 產出：data/.cache/scan-<CC>.json
//   { country, from, to, batch_size, scanned_batches, total_batches,
//     generated_at, updated_at,
//     results: { "<nsuid>": { sales_status, regularRaw, effectiveRaw,
//                             currency, discountPct, saleEnd } } }
//   只存非 not_found 的編號（not_found 為預設值，不存檔）。
//
// 節流：預設並行度 2、每批之間 750ms；429／403 指數退避重試（最多 5 次）。
// 這是對任天堂官方公開 API 的常規查詢，不是暴力請求；請勿把並行度調太高。
// 2026-11-17 教訓：GitHub Actions 共用 IP 跑 TW 掃描時，66 批後開始連續
// 回 403（家用 IP 同樣速度跑 15,000 次請求都沒事），所以 403 也要像 429
// 一樣長退避重試，並把速度放慢；若還是被擋，改用自架 runner（家用 IP）。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'data', '.cache');
const PRICE_API = 'https://api.ec.nintendo.com/v1/price';
const UA = 'shawn-game-studio/1.0 (tw-hk price-api scan)';
const BATCH = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs() {
  const a = { country: 'TW', from: 70010000000000, to: 70010000129999, concurrency: 2, tag: '' };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    const eq = arg.indexOf('=');
    const k = eq >= 0 ? arg.slice(0, eq) : arg;
    const v = eq >= 0 ? arg.slice(eq + 1) : process.argv[++i];
    if (k === '--country') a.country = v;
    else if (k === '--from') a.from = Number(v);
    else if (k === '--to') a.to = Number(v);
    else if (k === '--concurrency') a.concurrency = Number(v);
    else if (k === '--tag') a.tag = v; // 檢查點檔名後綴：掃描額外區間時用，避免覆蓋主區間結果
  }
  if (!/^[A-Z]{2}$/.test(a.country)) throw new Error('--country 須為 2 碼國家碼（如 TW、HK、KR）');
  return a;
}

function langFor(country) {
  if (country === 'JP') return 'ja';
  if (country === 'TW' || country === 'HK') return 'zh';
  return 'en';
}

async function fetchBatch(country, ids) {
  const lang = langFor(country);
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(
        `${PRICE_API}?country=${country}&ids=${ids.join(',')}&lang=${lang}`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) },
      );
      if (res.status === 429 || res.status === 403) {
        // 403 也長退避重試：GitHub 共用 IP 會被任天堂 WAF 擋，短退避沒用。
        await sleep(20000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

function toEntry(p) {
  const regularRaw = p.regular_price ? Number(String(p.regular_price.raw_value).replace(/,/g, '')) : null;
  const effectiveRaw = p.discount_price
    ? Number(String(p.discount_price.raw_value).replace(/,/g, ''))
    : regularRaw;
  return {
    sales_status: p.sales_status ?? 'unknown',
    regularRaw,
    effectiveRaw,
    currency: p.regular_price?.currency ?? p.discount_price?.currency ?? null,
    discountPct:
      regularRaw != null && effectiveRaw != null && effectiveRaw < regularRaw
        ? Math.round((1 - effectiveRaw / regularRaw) * 100)
        : null,
    saleEnd: p.discount_price?.end_datetime ?? null,
  };
}

async function main() {
  const { country, from, to, concurrency, tag } = parseArgs();
  mkdirSync(CACHE_DIR, { recursive: true });
  const outPath = join(CACHE_DIR, `scan-${country}${tag ? `-${tag}` : ''}.json`);

  const totalBatches = Math.ceil((to - from + 1) / BATCH);
  let state = {
    country,
    from,
    to,
    batch_size: BATCH,
    scanned_batches: 0,
    total_batches: totalBatches,
    done_batches: [], // 已完成批次的索引（並行完成順序不固定，續跑以此為準）
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    results: {},
  };
  if (existsSync(outPath)) {
    const prev = JSON.parse(readFileSync(outPath, 'utf8'));
    if (prev.country === country && prev.from === from && prev.to === to) {
      state = prev;
      if (!Array.isArray(state.done_batches)) state.done_batches = [];
      console.log(`[resume] ${country}：已掃 ${state.done_batches.length}/${totalBatches} 批，已存 ${Object.keys(state.results).length} 筆非 not_found`);
    }
  }

  const t0 = Date.now();
  const doneSet = new Set(state.done_batches);
  let done = doneSet.size;
  const batchIdx = Array.from({ length: totalBatches }, (_, i) => i).filter((i) => !doneSet.has(i));

  let cursor = 0;
  const save = () => {
    state.updated_at = new Date().toISOString();
    writeFileSync(outPath, JSON.stringify(state), 'utf8');
  };
  async function worker() {
    while (cursor < batchIdx.length) {
      const bi = batchIdx[cursor++];
      const start = from + bi * BATCH;
      const ids = [];
      for (let n = 0; n < BATCH && start + n <= to; n++) ids.push(String(start + n));
      let data;
      try {
        data = await fetchBatch(country, ids);
      } catch (err) {
        console.error(`[error] ${country} 批 #${bi}（${ids[0]}）失敗：${err.message}，停止`);
        process.exitCode = 1;
        cursor = batchIdx.length; // 讓其他 worker 停下
        break;
      }
      for (const p of data?.prices ?? []) {
        if (p.sales_status !== 'not_found') state.results[String(p.title_id)] = toEntry(p);
      }
      doneSet.add(bi);
      done++;
      state.scanned_batches = done;
      state.done_batches = [...doneSet].sort((a, b) => a - b);
      if (done % 25 === 0) save();
      if (done % 100 === 0) {
        const onsale = Object.values(state.results).filter((r) => r.sales_status === 'onsale').length;
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`[${country}] ${done}/${totalBatches} 批（${el}s，onsale ${onsale}，已存 ${Object.keys(state.results).length} 筆）`);
      }
      await sleep(750);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  save();
  const onsale = Object.values(state.results).filter((r) => r.sales_status === 'onsale').length;
  const term = Object.values(state.results).filter((r) => r.sales_status === 'sales_termination').length;
  const other = Object.keys(state.results).length - onsale - term;
  console.log(`\n[${country}] 完成：${state.scanned_batches}/${totalBatches} 批，耗時 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  非 not_found：${Object.keys(state.results).length} 筆（onsale ${onsale}、sales_termination ${term}、其他 ${other}）`);
  console.log(`  寫入 ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
