// 用 IGDB 補詳情頁畫廊的截圖（games.screenshots）。
//
// 背景：詳情頁點封面開左右滑動的影片／截圖 viewer；影片走 youtube_id，
// 截圖要另外存。日本官方目錄 XML 的 ScreenshotImgURL 每款只有 1 張，
// 且與 cover_url 完全相同，對畫廊沒有新增價值，所以截圖只從 IGDB 拿。
//
// 憑證（與 scripts/fill-covers-igdb.mjs 相同）：
//   IGDB_CLIENT_ID / IGDB_CLIENT_SECRET（Twitch 應用程式，見該檔說明）
//   SUPABASE_SERVICE_ROLE_KEY（--apply 才需要；讀取可用 anon key）
//
// 配對規則（與填封面相同，寧可漏掉、不要貼錯）：
//   用 title_en 優先、title_zh 其次去查 IGDB；回傳的候選必須有一個
//   名字（本名或 alternative_names）在正規化後「完全等於」遊戲的
//   title_en 或 title_zh 才算命中。正規化：小寫、去標點／空格、
//   去版本後綴、去 ™ ®。中文名在 IGDB 通常對不到，那些會列入 no_match。
//
// 取圖：screenshots（t_screenshot_big）最多 6 張；一張都沒有時，
//   用 artworks（t_1080p）最多 3 張補（仍是 IGDB 官方圖，畫廊裡
//   看不出差別；輸出檔會註明每款的來源組成）。與 cover_url 相同
//   的圖會跳過（畫廊裡不需要重複顯示封面）。
//
// 寫入：只寫 screenshots 仍是 NULL 的具名遊戲（寫入時再守一次，
//   避免覆蓋其他流程剛寫入的值）。沒有圖的遊戲不寫入，只記進
//   data/igdb-no-screenshots.json，下次跳過（想重查就把 slug 刪掉）。
//
// 用法（PowerShell，環境變數按工作階段設定）：
//   node scripts/fill-screenshots-igdb.mjs --limit 50            # 乾跑（預設）
//   node scripts/fill-screenshots-igdb.mjs --limit 50 --apply     # 真寫入
//   node scripts/fill-screenshots-igdb.mjs --limit 200 --offset 50 --apply
// 每次跑完把結果寫到 data/igdb-screenshot-fills.json（覆蓋，只留最新一次）。
// 乾跑也會印出覆蓋率（命中／有圖／平均張數），先看乾跑再決定要不要寫入。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID ?? '';
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET ?? '';

const IGDB_SLEEP_MS = 300; // 4 req/s 上限，留餘裕
const MAX_RETRIES = 3;
const MAX_SCREENSHOTS = 6;
const MAX_ARTWORKS_FALLBACK = 3;

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SKIP_PATH = join(DATA_DIR, 'igdb-no-screenshots.json');

/** 讀累積的沒截圖名單（不存在就當作空的）。 */
async function loadSkipSet() {
  try {
    const raw = await readFile(SKIP_PATH, 'utf8');
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : []);
  } catch {
    return new Set();
  }
}

async function saveSkipSet(set) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SKIP_PATH, JSON.stringify([...set].sort(), null, 2));
}

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return def;
  return process.argv[i + 1];
}
const hasFlag = (name) => process.argv.includes(name);
const LIMIT = Math.max(1, parseInt(arg('--limit', '50'), 10) || 50);
const OFFSET = Math.max(0, parseInt(arg('--offset', '0'), 10) || 0);
const APPLY = hasFlag('--apply');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function restHeaders(useServiceRole) {
  const key = useServiceRole ? SERVICE_ROLE_KEY : ANON_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

/** 正規化標題：小寫、去標點空白、去版本後綴、去 ™ ®（與填封面腳本相同）。 */
function normalizeTitle(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/nintendo switch( 2)? edition/g, '')
    .replace(/deluxe edition/g, '')
    .replace(/definitive edition/g, '')
    .replace(/- nintendo switch( 2)?/g, '')
    .replace(/[\s\-_:：・\.',!?"'()\[\]<>~～/\\|@#\$%\^&\*\+=]+/g, '')
    .trim();
}

function igdbImageUrl(imageId, size) {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

/** 選圖：截圖最多 6 張；一張都沒有時用美術圖最多 3 張補。回傳 {urls, sources}。 */
function pickScreenshots(g, coverUrl) {
  const urls = [];
  const sources = { screenshot: 0, artwork: 0 };
  const seen = new Set();
  const take = (list, size, source, max) => {
    for (const item of list ?? []) {
      if (urls.length >= max) break;
      const id = item?.image_id;
      if (!id) continue;
      const url = igdbImageUrl(id, size);
      if (url === coverUrl || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      sources[source] += 1;
    }
  };
  take(g.screenshots, 't_screenshot_big', 'screenshot', MAX_SCREENSHOTS);
  if (urls.length === 0) {
    take(g.artworks, 't_1080p', 'artwork', MAX_ARTWORKS_FALLBACK);
  }
  return { urls, sources };
}

async function getIgdbToken() {
  const url =
    'https://id.twitch.tv/oauth2/token' +
    `?client_id=${encodeURIComponent(IGDB_CLIENT_ID)}` +
    `&client_secret=${encodeURIComponent(IGDB_CLIENT_SECRET)}` +
    '&grant_type=client_credentials';
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`換 IGDB token 失敗（HTTP ${res.status}）：${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function igdbSearch(token, query, attempt = 0) {
  const body =
    `search "${query.replace(/"/g, '')}"; ` +
    'fields name,alternative_names.name,cover.image_id,artworks.image_id,screenshots.image_id,platforms; limit 5;';
  const res = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': IGDB_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body,
  });
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const wait = 5000 * (attempt + 1);
    console.log(`[igdb] 429，${wait}ms 後重試（第 ${attempt + 1} 次）`);
    await sleep(wait);
    return igdbSearch(token, query, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`IGDB 查詢失敗（HTTP ${res.status}）：${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

/** 讀一批還沒截圖的具名遊戲（按 slug 排序，決定性分頁），跳過已知沒圖的。
 * 候選名單按 slug 排序、沒圖的永遠留在名單裡，所以直接用 limit/offset
 * 切會越切越少新遊戲：改成分頁 500 筆往後掃，跳過 skipSet 裡的 slug，
 * 湊滿 limit 款新遊戲為止。offset 是原始名單的位置（不是過濾後的位置）。 */
async function readCandidates(limit, offset, skipSet) {
  const collected = [];
  let rawOffset = offset;
  let skipped = 0;
  for (;;) {
    const url =
      `${SUPABASE_URL}/rest/v1/games` +
      `?select=id,slug,title_zh,title_en,cover_url` +
      `&is_unnamed=eq.false` +
      `&screenshots=is.null` +
      `&order=slug.asc&limit=500&offset=${rawOffset}`;
    const res = await fetch(url, { headers: restHeaders(!!SERVICE_ROLE_KEY) });
    if (!res.ok) {
      throw new Error(`讀 games 失敗（HTTP ${res.status}）：${(await res.text()).slice(0, 300)}`);
    }
    const page = await res.json();
    if (page.length === 0) break;
    rawOffset += page.length;
    for (const g of page) {
      if (skipSet.has(g.slug)) {
        skipped += 1;
        continue;
      }
      collected.push(g);
      if (collected.length >= limit) break;
    }
    if (collected.length >= limit || page.length < 500) break;
  }
  return { games: collected, skipped };
}

async function writeScreenshots(gameId, urls) {
  const url = `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&screenshots=is.null`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: restHeaders(true),
    body: JSON.stringify({ screenshots: urls }),
  });
  if (!res.ok) {
    throw new Error(`寫 screenshots 失敗 ${gameId}（HTTP ${res.status}）：${(await res.text()).slice(0, 300)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function main() {
  if (!SUPABASE_URL) throw new Error('未設定 NEXT_PUBLIC_SUPABASE_URL（或 SUPABASE_URL）。');
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
    throw new Error(
      '未設定 IGDB_CLIENT_ID / IGDB_CLIENT_SECRET。\n' +
        '取得方式：Twitch 帳號（開兩步驟驗證）→ dev.twitch.tv 註冊應用程式\n' +
        '（Client Type 選 Confidential，Redirect URL 填 localhost）→ 記下 Client ID 與 Secret。',
    );
  }
  if (APPLY && !SERVICE_ROLE_KEY) throw new Error('--apply 需要 SUPABASE_SERVICE_ROLE_KEY。');
  if (!SERVICE_ROLE_KEY && !ANON_KEY) {
    throw new Error('讀取需要 NEXT_PUBLIC_SUPABASE_ANON_KEY 或 SUPABASE_SERVICE_ROLE_KEY。');
  }

  console.log(`[info] ${APPLY ? '寫入模式' : '乾跑模式（不寫入）'}：limit=${LIMIT} offset=${OFFSET}`);
  const token = await getIgdbToken();
  console.log('[info] IGDB token 取得成功。');

  const skipSet = await loadSkipSet();
  console.log(`[info] 已知沒截圖 ${skipSet.size} 款，本次會跳過。`);
  const { games: candidates, skipped } = await readCandidates(LIMIT, OFFSET, skipSet);
  console.log(`[info] 讀到 ${candidates.length} 款還沒截圖的具名遊戲（跳過已知沒圖 ${skipped} 款）。`);

  const counts = {
    total: candidates.length,
    skipped,
    matched: 0,
    withImages: 0,
    written: 0,
    noMatch: 0,
    ambiguous: 0,
    noImages: 0,
    totalImages: 0,
    bySource: { screenshot: 0, artwork: 0 },
  };
  const fills = [];
  const noMatch = [];
  const ambiguous = [];

  for (const g of candidates) {
    const queries = [];
    for (const t of [g.title_en, g.title_zh]) {
      if (t && !queries.includes(t)) queries.push(t);
    }
    const want = new Set([normalizeTitle(g.title_en), normalizeTitle(g.title_zh)].filter(Boolean));
    let hit = null;
    let hitName = '';
    for (const q of queries) {
      if (hit) break;
      const results = await igdbSearch(token, q);
      await sleep(IGDB_SLEEP_MS);
      const exact = results.filter((r) => {
        const names = [r.name, ...((r.alternative_names ?? []).map((a) => a.name))];
        return names.some((n) => n && want.has(normalizeTitle(n)));
      });
      if (exact.length === 1) {
        hit = exact[0];
        hitName = exact[0].name;
      } else if (exact.length > 1) {
        ambiguous.push({ slug: g.slug, title: g.title_zh, candidates: exact.map((e) => e.name) });
        counts.ambiguous += 1;
        break;
      }
    }
    if (ambiguous.length > 0 && ambiguous[ambiguous.length - 1].slug === g.slug) continue;
    if (!hit) {
      noMatch.push({ slug: g.slug, title: g.title_zh, title_en: g.title_en });
      counts.noMatch += 1;
      continue;
    }
    counts.matched += 1;
    const picked = pickScreenshots(hit, g.cover_url);
    if (picked.urls.length === 0) {
      counts.noImages += 1;
      noMatch.push({ slug: g.slug, title: g.title_zh, title_en: g.title_en, reason: 'IGDB 有遊戲但沒截圖／美術圖' });
      continue;
    }
    counts.withImages += 1;
    counts.totalImages += picked.urls.length;
    counts.bySource.screenshot += picked.sources.screenshot;
    counts.bySource.artwork += picked.sources.artwork;
    const rec = {
      slug: g.slug,
      title: g.title_zh,
      igdb_id: hit.id,
      igdb_name: hitName,
      image_count: picked.urls.length,
      sources: picked.sources,
      image_urls: picked.urls,
    };
    let wrote = false;
    if (APPLY) {
      wrote = await writeScreenshots(g.id, picked.urls);
      if (wrote) counts.written += 1;
      else rec.write_note = '寫入時截圖已被其他流程寫入，跳過';
    }
    fills.push({ ...rec, written: wrote });
  }

  const avg = counts.withImages > 0 ? (counts.totalImages / counts.withImages).toFixed(1) : '0';
  console.log('[done]', JSON.stringify(counts, null, 2));
  console.log(
    `[done] 命中 ${counts.matched} / ${counts.total}；有圖 ${counts.withImages} 款（覆蓋率 ${counts.total > 0 ? ((counts.withImages / counts.total) * 100).toFixed(1) : '0'}%）` +
      `，平均每款 ${avg} 張（截圖 ${counts.bySource.screenshot}、美術圖 ${counts.bySource.artwork}）；寫入 ${counts.written}；無命中 ${counts.noMatch}；多個同名 ${counts.ambiguous}；有遊戲但沒圖 ${counts.noImages}；跳過已知沒圖 ${counts.skipped}。`,
  );

  // 本次新沒圖的（含多個同名）記進累積名單，下次不再重查。
  let skipChanged = false;
  for (const r of [...noMatch, ...ambiguous]) {
    if (!skipSet.has(r.slug)) {
      skipSet.add(r.slug);
      skipChanged = true;
    }
  }
  if (skipChanged) {
    await saveSkipSet(skipSet);
    console.log(`[info] 沒截圖名單已更新，共 ${skipSet.size} 款（data/igdb-no-screenshots.json）。`);
  }

  const outPath = join(DATA_DIR, 'igdb-screenshot-fills.json');
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        limit: LIMIT,
        offset: OFFSET,
        dry_run: !APPLY,
        counts,
        fills,
        no_match: noMatch,
        ambiguous,
      },
      null,
      2,
    ),
  );
  console.log(`[info] 結果已寫到 data/igdb-screenshot-fills.json`);
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
