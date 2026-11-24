// Step 2: 抓三家官方圖源全清單（唯讀公開端點），存原始檔供本機比對。
// 用法：node scripts/fetch-official-cover-sources.mjs [jp|eu|na|all]
// 產出：data/official-jp-search.json / data/official-eu-solr.json / data/official-na-algolia.json
import { writeFileSync } from "node:fs";

const UA = "shawn-game-studio/1.0 (cover-gap survey)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, opts = {}, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, ...(opts.headers ?? {}) },
        signal: AbortSignal.timeout(30000),
        ...(opts.method ? { method: opts.method, body: opts.body } : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}

// 並行池（固定併發數）
async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = { __error: String(e), __item: items[i] };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// ---- JP 搜尋 API：limit=100，page 從 1 起，直到回傳 items 為空 ----
async function fetchJp() {
  const all = [];
  let total = null;
  // 先抓第 1 頁拿 total
  const first = await fetchJson(
    "https://search.nintendo.jp/nintendo_soft/search.json?q=&limit=100&page=1",
    {}
  );
  total = first?.result?.total ?? null;
  const totalPages = total ? Math.ceil(total / 100) : null;
  console.log(`JP total=${total} totalPages=${totalPages}`);
  all.push(...(first?.result?.items ?? []));
  const pages = [];
  for (let p = 2; p <= (totalPages ?? 1); p++) pages.push(p);
  const results = await pool(pages, 4, async (p) => {
    const d = await fetchJson(
      `https://search.nintendo.jp/nintendo_soft/search.json?q=&limit=100&page=${p}`,
      {}
    );
    return d?.result?.items ?? [];
  });
  let failed = 0;
  for (const r of results) {
    if (r.__error) {
      failed++;
      console.log("JP 失敗頁：", r.__item, r.__error);
    } else all.push(...r);
  }
  console.log(`JP 抓到 ${all.length} 筆原始 items，失敗 ${failed} 頁`);
  writeFileSync(
    "data/official-jp-search.json",
    JSON.stringify({ fetched_at: new Date().toISOString(), total, items: all })
  );
  return all;
}

// ---- EU Solr：rows=1000，start 遞增 ----
async function fetchEu() {
  const base =
    "https://search.nintendo-europe.com/en/select?q=*&fq=type%3AGAME&fq=nsuid_txt%3A*&rows=1000&wt=json&fl=title,nsuid_txt,product_code_txt,system_names_txt,dates_released_dts,image_url_h16x9_s";
  const first = await fetchJson(`${base}&start=0`, {});
  const total = first?.response?.numFound ?? 0;
  console.log(`EU numFound=${total}`);
  const all = [...(first?.response?.docs ?? [])];
  const starts = [];
  for (let s = 1000; s < total; s += 1000) starts.push(s);
  const results = await pool(starts, 4, async (s) => {
    const d = await fetchJson(`${base}&start=${s}`, {});
    return d?.response?.docs ?? [];
  });
  let failed = 0;
  for (const r of results) {
    if (r.__error) {
      failed++;
      console.log("EU 失敗 start：", r.__item, r.__error);
    } else all.push(...r);
  }
  console.log(`EU 抓到 ${all.length} 筆 docs，失敗 ${failed} 頁`);
  writeFileSync(
    "data/official-eu-solr.json",
    JSON.stringify({ fetched_at: new Date().toISOString(), total, docs: all })
  );
  return all;
}

// ---- NA Algolia：popularityRank 數值帶，每帶 1,000 名 ----
const NA_APP = "U3B6GR4UA3";
const NA_KEY = "a29c6927638bfd8cee23993e51e721c9";
async function algoliaQuery(params) {
  await sleep(200);
  return fetchJson(`https://${NA_APP}-dsn.algolia.net/1/indexes/store_all_products_en_us/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Algolia-Application-Id": NA_APP,
      "X-Algolia-API-Key": NA_KEY,
    },
    body: JSON.stringify({ params }),
  });
}

async function fetchNa() {
  const bands = [];
  for (let u = 0; u < 18; u++) bands.push([u * 1000, (u + 1) * 1000]);
  const all = [];
  let nbTotal = 0;
  for (const [lo, hi] of bands) {
    const { hits, nbHits } = await algoliaQuery(
      `query=&hitsPerPage=1000&numericFilters=popularityRank%3E${lo}%2CpopularityRank%3C%3D${hi}`
    );
    console.log(`NA 帶 ${lo + 1}–${hi}：nbHits=${nbHits} hits=${hits.length}`);
    nbTotal += nbHits;
    all.push(...hits);
    if (nbHits > 1000) console.log(`  ⚠️ 帶 ${lo + 1}–${hi} 超過 1000 筆上限，已截斷`);
  }
  console.log(`NA 抓到 ${all.length} 筆 hits（nbHits 合計 ${nbTotal}）`);
  writeFileSync(
    "data/official-na-algolia.json",
    JSON.stringify({ fetched_at: new Date().toISOString(), hits: all })
  );
  return all;
}

const which = process.argv[2] ?? "all";
if (which === "all" || which === "jp") await fetchJp();
if (which === "all" || which === "eu") await fetchEu();
if (which === "all" || which === "na") await fetchNa();
console.log("完成");
