// 用 IGDB 補沒有封面的具名遊戲（每週 ingest 與目錄同步都對不上的缺口）。
//
// 背景：目錄同步只認任天堂官方來源（JP 搜尋／NA Algolia／EU Solr），
// 佔位遊戲與台港獨佔遊戲對不上就一直沒封面。IGDB 是玩家資料庫，
// 用遊戲名字去對，封面／美術圖／截圖都有，適合補這批。
//
// 憑證（IGDB API 免費、非商業用途；見 https://api-docs.igdb.com/）：
//   1. Twitch 帳號（需開兩步驟驗證）→ dev.twitch.tv 註冊應用程式
//      （Client Type 選 Confidential 才能產生 Secret；
//       OAuth Redirect URL 不用，填 localhost 即可）
//   2. 記下 Client ID 與 Client Secret，設成環境變數：
//      IGDB_CLIENT_ID / IGDB_CLIENT_SECRET
//   3. 腳本用 client_credentials 向 id.twitch.tv 換 access token，
//      再以 Client-ID + Bearer 打 api.igdb.com/v4/games。
//   限速 4 req/s：每次查詢間隔 300ms，429 時退避重試。
//
// 圖片選擇（站上卡片是 16:9）：
//   artworks[0]（t_1080p，1920x1080）→ screenshots[0]（t_screenshot_big，
//   1280x720）→ cover（t_cover_big，264x352 直式盒繪，最後手段）。
//   直式封面在 16:9 卡片裡會被裁掉上下，只在 --allow-portrait 時才寫入，
//   預設不寫（寧缺勿濫）；報告會列出各來源的數量。
//
// 配對規則（寧可漏掉、不要貼錯）：
//   用 title_en 優先、title_zh 其次去查 IGDB；回傳的候選必須有一個
//   名字（本名或 alternative_names）在正規化後「完全等於」遊戲的
//   title_en 或 title_zh 才算命中。正規化：小寫、去標點／空格、
//   去「- Nintendo Switch 2 Edition」「- Deluxe Edition」等版本後綴、
//   去 ™ ®。中文名在 IGDB 通常對不到（IGDB 以英文／日文名為主），
//   那些會列入 no_match，不硬湊。
//
// 寫入：只寫 cover_url 仍是 NULL 或 /covers/placeholder.svg 的遊戲
//   （寫入時再守一次，避免覆蓋同步剛補上的任天堂原圖）。
//   讀取可用 anon key；寫入需要 SUPABASE_SERVICE_ROLE_KEY。
//
// 用法（PowerShell，環境變數按工作階段設定）：
//   node scripts/fill-covers-igdb.mjs --limit 50            # 乾跑（預設）
//   node scripts/fill-covers-igdb.mjs --limit 50 --apply     # 真寫入
//   node scripts/fill-covers-igdb.mjs --limit 200 --offset 50 --apply
//   node scripts/fill-covers-igdb.mjs --limit 50 --apply --allow-portrait
// 每次跑完把結果寫到 data/igdb-cover-fills.json（覆蓋，只留最新一次）。
//
// 跳過已知對不到的（data/igdb-no-match.json，累積式）：
//   對不到的遊戲封面永遠是空的，所以永遠留在候選名單裡；候選名單按
//   slug 排序，對不到的會一直卡在名單前頭。不跳過的話，每批重跑都要
//   再查一次所有累積的對不到款，而且每批新處理的款會越來越少，最後
//   整批都是對不到的、完全推不動。腳本每次跑會先讀這個檔跳過裡面的
//   slug，跑完再把本次新對不到（含多個同名、只有直式封面）的 slug 補
//   進去。想重查某款時，把它從檔案裡刪掉再跑即可。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID ?? '';
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET ?? '';

const PLACEHOLDER = '/covers/placeholder.svg';
const IGDB_SLEEP_MS = 300; // 4 req/s 上限，留餘裕
const MAX_RETRIES = 3;

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SKIP_PATH = join(DATA_DIR, 'igdb-no-match.json');

/** 讀累積的對不到名單（不存在就當作空的）。 */
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
const ALLOW_PORTRAIT = hasFlag('--allow-portrait');

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

/** 正規化標題：小寫、去標點空白、去版本後綴、去 ™ ®。 */
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

/** 選一張圖：美術圖 → 截圖 → 封面（直式，預設不取）。回傳 {url, source}。 */
function pickImage(g) {
  const art = g.artworks?.[0]?.image_id;
  if (art) return { url: igdbImageUrl(art, 't_1080p'), source: 'artwork' };
  const shot = g.screenshots?.[0]?.image_id;
  if (shot) return { url: igdbImageUrl(shot, 't_screenshot_big'), source: 'screenshot' };
  const cover = g.cover?.image_id;
  if (cover && ALLOW_PORTRAIT) return { url: igdbImageUrl(cover, 't_cover_big'), source: 'cover' };
  if (cover) return { url: igdbImageUrl(cover, 't_cover_big'), source: 'cover-skipped' };
  return null;
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

/** 讀一批沒封面的具名遊戲（按 slug 排序，決定性分頁），跳過已知對不到的。
 * 候選名單按 slug 排序、對不到的永遠留在名單裡，所以直接用 limit/offset
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
      `&or=(cover_url.is.null,cover_url.eq.${encodeURIComponent(PLACEHOLDER)})` +
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

async function writeCover(gameId, coverUrl) {
  const url =
    `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}` +
    `&or=(cover_url.is.null,cover_url.eq.${encodeURIComponent(PLACEHOLDER)})`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: restHeaders(true),
    body: JSON.stringify({ cover_url: coverUrl }),
  });
  if (!res.ok) {
    throw new Error(`寫 cover 失敗 ${gameId}（HTTP ${res.status}）：${(await res.text()).slice(0, 300)}`);
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

  console.log(`[info] ${APPLY ? '寫入模式' : '乾跑模式（不寫入）'}：limit=${LIMIT} offset=${OFFSET} allow-portrait=${ALLOW_PORTRAIT}`);
  const token = await getIgdbToken();
  console.log('[info] IGDB token 取得成功。');

  const skipSet = await loadSkipSet();
  console.log(`[info] 已知對不到 ${skipSet.size} 款，本次會跳過。`);
  const { games: candidates, skipped } = await readCandidates(LIMIT, OFFSET, skipSet);
  console.log(`[info] 讀到 ${candidates.length} 款沒封面的具名遊戲（跳過已知對不到 ${skipped} 款）。`);

  const counts = {
    total: candidates.length,
    skipped,
    matched: 0,
    written: 0,
    noMatch: 0,
    ambiguous: 0,
    coverSkippedPortrait: 0,
    bySource: { artwork: 0, screenshot: 0, cover: 0 },
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
    const picked = pickImage(hit);
    if (!picked) {
      noMatch.push({ slug: g.slug, title: g.title_zh, title_en: g.title_en, reason: 'IGDB 有遊戲但沒圖' });
      counts.noMatch += 1;
      continue;
    }
    if (picked.source === 'cover-skipped') {
      counts.coverSkippedPortrait += 1;
      noMatch.push({ slug: g.slug, title: g.title_zh, title_en: g.title_en, reason: '只有直式封面（預設不寫，加 --allow-portrait 才寫）' });
      counts.noMatch += 1;
      continue;
    }
    counts.matched += 1;
    counts.bySource[picked.source] += 1;
    const rec = {
      slug: g.slug,
      title: g.title_zh,
      igdb_id: hit.id,
      igdb_name: hitName,
      image_url: picked.url,
      source: picked.source,
    };
    let wrote = false;
    if (APPLY) {
      wrote = await writeCover(g.id, picked.url);
      if (wrote) counts.written += 1;
      else rec.write_note = '寫入時封面已被同步補上，跳過';
    }
    fills.push({ ...rec, written: wrote });
  }

  console.log('[done]', JSON.stringify(counts, null, 2));
  console.log(`[done] 命中 ${counts.matched} / ${counts.total}（artwork ${counts.bySource.artwork}、screenshot ${counts.bySource.screenshot}、cover ${counts.bySource.cover}）；寫入 ${counts.written}；無命中 ${counts.noMatch}；多個同名 ${counts.ambiguous}；直式封面跳過 ${counts.coverSkippedPortrait}；跳過已知對不到 ${counts.skipped}。`);

  // 本次新對不到的（含多個同名）記進累積名單，下次不再重查。
  let skipChanged = false;
  for (const r of [...noMatch, ...ambiguous]) {
    if (!skipSet.has(r.slug)) {
      skipSet.add(r.slug);
      skipChanged = true;
    }
  }
  if (skipChanged) {
    await saveSkipSet(skipSet);
    console.log(`[info] 對不到名單已更新，共 ${skipSet.size} 款（data/igdb-no-match.json）。`);
  }

  const outPath = join(DATA_DIR, 'igdb-cover-fills.json');
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        limit: LIMIT,
        offset: OFFSET,
        dry_run: !APPLY,
        allow_portrait: ALLOW_PORTRAIT,
        counts,
        fills,
        no_match: noMatch,
        ambiguous,
      },
      null,
      2,
    ),
  );
  console.log(`[info] 結果已寫到 data/igdb-cover-fills.json`);
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
