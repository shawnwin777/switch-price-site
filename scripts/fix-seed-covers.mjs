/**
 * Switch 遊戲比價 — 種子 32 款封面改接官方 CDN 腳本
 * ============================================================
 * 背景（2026-11-23 稽核，中-侵權-2）：
 *   public/covers/ 下的 32 張 *.jpg 是從官方來源下載、縮圖再重新編碼
 *   後重託管在本棧的官方 key art（來源見 DATA_NOTES.md §6 與
 *   scripts/lib/seed-cover-urls.mjs 的驗證記錄；26 款逐張與日本
 *   eShop CDN 原圖 dHash 比對全數相符，另 6 款與美版商店圖庫圖相符）。
 *   自架官方圖比單純 hotlink 官方 CDN 嚴重，故封面改為直接連官方
 *   CDN，本地 32 張圖待 shawn 從 GitHub 網頁刪除（push 工具不能刪檔）。
 *
 * 本腳本做的事（只動 games.cover_url，不動其他欄位）：
 *   - 把 32 款種子遊戲的 cover_url 從 `/covers/<slug>.jpg`
 *     改為 scripts/lib/seed-cover-urls.mjs 的官方 CDN 網址。
 *   - 冪等：只 PATCH 目前 cover_url 仍是 `/covers/<slug>.jpg` 的列；
 *     已經是 CDN 網址、佔位圖或其他值的列一律跳過。重跑不會重複寫入。
 *   - 寫入前先逐一驗證 32 個目標網址回 HTTP 200 且為圖片；驗證失敗
 *     的不寫入、不中斷（最後列出失敗清單）。
 *
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   node scripts/fix-seed-covers.mjs
 *     乾跑（預設）：不需環境變數、不寫資料庫。印出 32 筆對照、
 *     逐一驗證目標網址是否可取，並提示哪些列待改（不讀 DB，只列對照）。
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
 *   node scripts/fix-seed-covers.mjs --apply
 *     正式寫入：先讀 DB 現況，只改仍是 /covers/<slug>.jpg 的列，
 *     寫完再讀一次驗證 32 款皆已指向 CDN 網址。
 *
 * 注意：
 *   - 只用環境變數 NEXT_PUBLIC_SUPABASE_URL 與
 *     SUPABASE_SERVICE_ROLE_KEY，絕對不要把 key 寫死在程式碼裡。
 *   - 寫入後請再到 GitHub 網頁刪除 public/covers/ 下的 32 張 *.jpg
 *     （placeholder.svg 留著）；刪檔前確認網站圖片已正常顯示。
 *   - scripts/seed.mjs 與 scripts/build-expanded-catalog.mjs 已改為
 *     寫入本對照表的 CDN 網址，重跑不會把 /covers/ 寫回來；但若用
 *     舊版 data/catalog-expanded.json 重跑 scripts/seed-expanded.mjs，
 *     仍會把 cover_url 寫回 /covers/（該檔的 32 筆 coverUrl 尚未更新），
 *     跑完請再跑一次本腳本 --apply。
 *   - 每週 ingest（lib/catalog-sync.ts）只補 cover_url 為 null 或
 *     佔位圖的遊戲，不會覆蓋已改好的 CDN 網址。
 *
 * 需求：Node.js 18+（使用內建 fetch，不需安裝任何套件）。
 */

import { SEED_COVER_URLS } from './lib/seed-cover-urls.mjs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;
for (const a of process.argv.slice(2)) {
  if (a !== '--apply' && a !== '--dry-run') {
    throw new Error(`未知參數：${a}（可用：--apply、--dry-run）`);
  }
}

const SLUGS = Object.keys(SEED_COVER_URLS).sort();
const EXPECTED_LOCAL = (slug) => `/covers/${slug}.jpg`;

function headers(extra = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function getCurrentCovers() {
  const inList = SLUGS.map((s) => `"${encodeURIComponent(s)}"`).join(',');
  const url =
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/games` +
    `?select=slug,cover_url&slug=in.(${inList})&limit=100`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`讀取 games 失敗（HTTP ${res.status}）：${(await res.text()).slice(0, 500)}`);
  }
  const rows = await res.json();
  return new Map(rows.map((r) => [r.slug, r.cover_url]));
}

/** 只在 cover_url 目前仍是 /covers/<slug>.jpg 時寫入；其餘情況不命中、不更動。 */
async function patchCoverIfLocal(slug, cdnUrl) {
  const url =
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/games` +
    `?slug=eq.${encodeURIComponent(slug)}&cover_url=eq.${encodeURIComponent(EXPECTED_LOCAL(slug))}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify({ cover_url: cdnUrl }),
  });
  if (!res.ok) {
    throw new Error(`寫入 cover_url（${slug}）失敗（HTTP ${res.status}）：${(await res.text()).slice(0, 500)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function checkUrl(url) {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-2' } });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') ?? '';
    if (type.startsWith('image/')) return true;
    // 任天堂 CDN 有兩款回 application/octet-stream（mario-party-j、
    // zelda-eow，見 DATA_NOTES.md §6）：以 JPEG 檔頭 FF D8 FF 驗證
    // 內容確為圖片。Range 不被支援時回 200 全文，前 3 個位元組一樣可驗。
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  } catch {
    return false;
  }
}

async function main() {
  console.log(
    `種子封面改接官方 CDN：共 ${SLUGS.length} 款\n` +
      `模式：${DRY_RUN ? '乾跑（不寫資料庫）' : '正式寫入 --apply'}`,
  );

  // 1. 驗證 32 個目標網址皆可取（乾跑與正式寫入都會做）
  const bad = [];
  for (const slug of SLUGS) {
    const ok = await checkUrl(SEED_COVER_URLS[slug]);
    console.log(`  [${ok ? 'OK  ' : 'FAIL'}] ${slug} -> ${SEED_COVER_URLS[slug]}`);
    if (!ok) bad.push(slug);
  }
  if (bad.length > 0) {
    console.log(`\n以下 ${bad.length} 款目標網址驗證失敗，本次不會寫入：${bad.join(', ')}`);
    if (DRY_RUN) {
      console.log('（乾跑結束；請先確認網址是否更動，再跑 --apply。）');
      return;
    }
    // 正式寫入時跳過失敗的款，繼續其他款
  }

  if (DRY_RUN) {
    console.log(
      `\n乾跑結束：目標網址 ${SLUGS.length - bad.length}/${SLUGS.length} 個可取。\n` +
        '正式寫入請在家執行：\n' +
        '  NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \\\n' +
        '  SUPABASE_SERVICE_ROLE_KEY=<service_role key> \\\n' +
        '  node scripts/fix-seed-covers.mjs --apply\n' +
        '寫入後再到 GitHub 網頁刪除 public/covers/ 下的 32 張 *.jpg（placeholder.svg 留著）。',
    );
    return;
  }

  // 2. 正式寫入：讀現況，只改仍是本地路徑的列
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      '缺少環境變數：--apply 需設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY。\n' +
        '只想看對照與驗證網址時，不加 --apply 直接執行即可（乾跑，不需環境變數）。',
    );
    process.exit(1);
  }
  const current = await getCurrentCovers();
  const missing = SLUGS.filter((s) => !current.has(s));
  if (missing.length > 0) {
    throw new Error(`以下遊戲在 DB 查不到：${missing.join(', ')}`);
  }
  let updated = 0;
  let skipped = 0;
  for (const slug of SLUGS) {
    if (bad.includes(slug)) {
      console.log(`  [跳過] ${slug}：目標網址驗證失敗`);
      skipped += 1;
      continue;
    }
    const cur = current.get(slug);
    if (cur === SEED_COVER_URLS[slug]) {
      console.log(`  [已是 CDN] ${slug}：不更動`);
      skipped += 1;
      continue;
    }
    if (cur !== EXPECTED_LOCAL(slug)) {
      console.log(`  [跳過] ${slug}：現值不是本地路徑（${cur}），不更動`);
      skipped += 1;
      continue;
    }
    const wrote = await patchCoverIfLocal(slug, SEED_COVER_URLS[slug]);
    console.log(`  [${wrote ? '已改' : '未改動'}] ${slug}：/covers/${slug}.jpg -> CDN`);
    if (wrote) updated += 1;
    else skipped += 1;
  }

  // 3. 寫完再讀一次驗證
  const after = await getCurrentCovers();
  const stillLocal = SLUGS.filter((s) => after.get(s) === EXPECTED_LOCAL(s));
  const nowCdn = SLUGS.filter((s) => after.get(s) === SEED_COVER_URLS[s]);
  console.log(
    `\n完成：本次寫入 ${updated} 款，跳過 ${skipped} 款；` +
      `驗證：${nowCdn.length}/${SLUGS.length} 款已指向 CDN 網址` +
      (stillLocal.length > 0 ? `，仍是本地路徑 ${stillLocal.length} 款：${stillLocal.join(', ')}` : '，無本地路徑殘留。'),
  );
  if (stillLocal.length > 0) {
    console.log('仍有殘留時請檢查目標網址驗證結果，或重跑一次本腳本 --apply。');
  } else {
    console.log('下一步：到 GitHub 網頁刪除 public/covers/ 下的 32 張 *.jpg（placeholder.svg 留著）。');
  }
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
