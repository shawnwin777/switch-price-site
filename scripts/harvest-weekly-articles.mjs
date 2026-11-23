// scripts/harvest-weekly-articles.mjs
// 收集港台每週「Nintendo eShop 新作軟體資訊」文章內的 title＋nsuid，
// 作為台港編號的命名來源（補官方軟體清單 166／176 款之外的遊戲，
// 例如黑帝斯 II、小丑牌、歧路旅人 II、雙人成行皆出自此處）。
//
// 方法：
// - 港台 topics 索引（https://www.nintendo.com/{hk|tw}/topics/?p=N，
//   每頁 24 篇）分頁收集文章連結，直到無新連結為止；
// - 逐篇抓文章頁，只保留內文含「新作軟體資訊」者，
//   以 RSC payload 的 "title":"...","nsuid":"..." 抽出編號。
// - 港台同一篇文章 id 相同，只存一次。
//
// 產出：data/.cache/weekly-articles.json
//   { generated_at, articles: [{ url, region, pairs: [{title, nsuid}] }],
//     by_nsuid: { "<nsuid>": "<title>" }, counts: {...} }
//
// 用法：node scripts/harvest-weekly-articles.mjs
// 節流：文章頁每篇間隔 300ms；只做讀取，不寫其他檔案。

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'data', '.cache', 'weekly-articles.json');
const UA = 'shawn-game-studio/1.0 (tw-hk weekly-articles harvest)';
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

async function collectArticleLinks(region) {
  // 只收集標題含「新作軟體資訊」的文章（索引頁每篇都有標題，
  // ncmn-softUnit__name），避免把 693 篇全部文章都抓一遍。
  // 索引按時間倒序；分頁直到整頁無新文章連結才停（週報可能有間斷，
  // 不能只看單頁有無新週報就停）。
  const seen = new Map(); // articleId -> url
  let weeklyGap = 0; // 連續無新週報的頁數（週報可能間斷，3 頁才停）
  for (let p = 1; p <= 40; p++) {
    const { status, text } = await fetchText(`https://www.nintendo.com/${region}/topics/?p=${p}`);
    if (status !== 200) throw new Error(`topics 索引 HTTP ${status}（${region} p=${p}）`);
    let freshWeekly = 0;
    const allIds = new Set();
    for (const m of text.matchAll(/href="\/(?:hk|tw)\/topics\/article\/([A-Za-z0-9_-]+)"/g)) allIds.add(m[1]);
    // 本頁的週報標題（取連結後 1200 字元內的標題欄位）
    const weeklyIds = new Set();
    for (const m of text.matchAll(/href="\/(?:hk|tw)\/topics\/article\/([A-Za-z0-9_-]+)"[^>]*>[\s\S]{0,1200}?ncmn-softUnit__name">([^<]{1,120})</g)) {
      if (m[2].includes('新作軟體資訊')) weeklyIds.add(m[1]);
    }
    for (const id of weeklyIds) {
      if (!seen.has(id)) {
        seen.set(id, `https://www.nintendo.com/${region}/topics/article/${id}`);
        freshWeekly++;
      }
    }
    // 到底判斷：本頁無文章連結即停；連續 3 頁無新週報亦停
    // （索引按時間倒序，週報可能有間斷，故不用單頁無新週報就停）。
    if (allIds.size === 0) break;
    if (freshWeekly === 0) {
      weeklyGap++;
      if (weeklyGap >= 3) break;
    } else {
      weeklyGap = 0;
    }
    await sleep(300);
  }
  return seen;
}

async function main() {
  const PARTIAL_PATH = join(ROOT, 'data', '.cache', 'weekly-articles.partial.json');
  // 斷點續跑：讀取上次的檢查點，跳過已處理的文章。
  let doneIds = new Set();
  let articles = [];
  let byNsuid = new Map();
  try {
    const prev = JSON.parse(readFileSync(PARTIAL_PATH, 'utf8'));
    doneIds = new Set(prev.done_ids ?? []);
    articles = prev.articles ?? [];
    byNsuid = new Map(Object.entries(prev.by_nsuid ?? {}));
    if (doneIds.size) console.log(`[resume] 檢查點：已處理 ${doneIds.size} 篇，已保留 ${articles.length} 篇新作文章`);
  } catch { /* 無檢查點，從頭開始 */ }
  const savePartial = () => {
    mkdirSync(join(ROOT, 'data', '.cache'), { recursive: true });
    writeFileSync(PARTIAL_PATH, JSON.stringify({
      updated_at: new Date().toISOString(),
      done_ids: [...doneIds],
      articles,
      by_nsuid: Object.fromEntries(byNsuid),
    }), 'utf8');
  };

  const ids = new Map(); // articleId -> { url, regions:Set }
  for (const region of ['hk', 'tw']) {
    const links = await collectArticleLinks(region);
    console.log(`[info] ${region} topics 索引：${links.size} 篇新作軟體資訊文章連結`);
    for (const [id, url] of links) {
      if (!ids.has(id)) ids.set(id, { url, regions: new Set() });
      ids.get(id).regions.add(region);
    }
  }
  console.log(`[info] 去重後共 ${ids.size} 篇文章`);

  let kept = articles.length;
  let n = 0;
  for (const [id, { url, regions }] of ids) {
    if (doneIds.has(id)) { n++; continue; }
    n++;
    let text;
    try {
      ({ text } = await fetchText(url));
    } catch (e) {
      console.error(`[warn] 文章抓取失敗，跳過：${url}（${e.message}）`);
      doneIds.add(id);
      await sleep(300);
      continue;
    }
    const un = text.replace(/\\"/g, '"').replace(/\\u0026/g, '&');
    if (!un.includes('新作軟體資訊')) { doneIds.add(id); await sleep(300); continue; }
    const pairs = [];
    const seenPair = new Set();
    for (const m of un.matchAll(/"title":"([^"]{1,120})","nsuid":"(\d+)"/g)) {
      const key = `${m[1]}|${m[2]}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      pairs.push({ title: m[1].trim(), nsuid: m[2] });
      if (!byNsuid.has(m[2])) byNsuid.set(m[2], m[1].trim());
    }
    if (pairs.length) {
      kept++;
      articles.push({ url, article_id: id, regions: [...regions], pairs });
    }
    doneIds.add(id);
    if (n % 10 === 0) savePartial();
    if (n % 20 === 0) console.log(`  ...已處理 ${n}/${ids.size} 篇，保留 ${kept} 篇新作文章`);
    await sleep(300);
  }
  savePartial();

  mkdirSync(join(ROOT, 'data', '.cache'), { recursive: true });
  const result = {
    generated_at: new Date().toISOString(),
    counts: { articles_total: ids.size, weekly_articles: articles.length, unique_nsuids: byNsuid.size },
    articles,
    by_nsuid: Object.fromEntries(byNsuid),
  };
  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`\n完成：${ids.size} 篇文章中，${articles.length} 篇為新作軟體資訊，共 ${byNsuid.size} 個不重複編號`);
  console.log(`寫入 ${OUT_PATH}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
