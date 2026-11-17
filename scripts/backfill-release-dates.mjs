/**
 * Switch 遊戲比價 — 上市日期回填腳本（EU Solr 批次補）
 * ============================================================
 * 把還沒有 release_date 的遊戲，從任天堂歐洲 Solr（EU 官方搜尋，
 * 帶 dates_released_dts 上市日）批次查回來寫進 games.release_date。
 *
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
 *   node scripts/backfill-release-dates.mjs
 *
 *   只看不寫：node scripts/backfill-release-dates.mjs --dry-run
 *   只跑前 N 款：node scripts/backfill-release-dates.mjs --limit 500
 *
 * 前置作業：
 *   1. 先在 Supabase Dashboard → SQL Editor 執行
 *      supabase/migrations/20261118_add_release_date.sql（只需一次）。
 *      欄位還沒建時本腳本會直接報錯退出，不會寫壞東西。
 *
 * 找日期的方法：
 *   - 只處理 release_date 目前為 NULL 的遊戲（可重複執行，重跑一次
 *     應全部是「已填過」，寫入 0 筆）。
 *   - 以 game_region_ids 的 GB（歐洲）編號去問 EU Solr：
 *     一次問 100 個編號（q=nsuid_txt:(id1 OR id2 …)），回來的
 *     dates_released_dts 第一個值就是上市日（YYYY-MM-DD）。
 *   - 沒有 GB 編號的遊戲這次跳過（例如 JP-only 或 TW/HK-only）：
 *     目錄同步（/api/sync-catalog）的 releaseDateFills 會在各區清單
 *     輪到時自動補上（JP 搜尋 API sdate、EU Solr、JP XML SalesDate
 *     都有帶發售日），不用手動處理。
 *
 * 寫入規則（刻意保守）：
 *   - 只寫 release_date 為 NULL 的列：PATCH by id（逐筆更新已存在的列），
 *     payload 只有 { release_date }，不動其他欄位；重跑不會覆蓋已有值。
 *     注意：不能用 upsert（POST + on_conflict=id）只帶 {id, release_date}，
 *     Postgres 會先檢查整列 NOT NULL 欄位（slug、title_zh、title_en），
 *     那些欄位是 NULL，還沒判斷到 id 衝突就先報 23502。
 *   - 可重複執行、看到一半中斷也沒關係，下次重跑會從還沒填的繼續。
 *
 * 連線：只用環境變數 NEXT_PUBLIC_SUPABASE_URL 與
 *       SUPABASE_SERVICE_ROLE_KEY（不讀 .env.local、不把 key 寫進檔案）。
 *       Service Role Key 會繞過 RLS，請只在伺服器端／本機執行，
 *       不要放進前端程式碼或公開倉庫。
 *
 * 需求：Node.js 18+（使用內建 fetch，不需安裝任何套件）。
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '缺少環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 再執行。\n' +
      '用法見本檔案開頭註解。',
  );
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Math.max(1, parseInt(LIMIT_ARG.slice('--limit='.length), 10) || 0) : Infinity;

const SOLR_BATCH = 100; // 一次問 Solr 幾個編號
const WRITE_BATCH = 500; // 一次 PATCH 幾列（每列一個請求）
const PAGE_SIZE = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function restHeaders(json = true) {
  const h = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function restUrl(path) {
  return `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`);
  }
  return res.json();
}

/** 分頁讀 PostgREST（回傳全部列；select 用逗號，filter 用 PostgREST 語法）。 */
async function fetchAll(table, select, extraQuery = '') {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const url =
      `${restUrl(table)}?select=${encodeURIComponent(select)}` +
      `${extraQuery}&order=id&limit=${PAGE_SIZE}&offset=${from}`;
    const rows = await fetchJson(url, { headers: restHeaders(false) });
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function updateGames(rows) {
  // 用 PATCH 逐筆更新已存在的列：PATCH 只會更新、不會新增，所以永遠不會
  // 碰到 upsert 的陷阱——Postgres 會先檢查整列 NOT NULL 欄位（slug、
  // title_zh、title_en），upsert 只帶 {id, release_date} 時那些欄位是
  // NULL，還沒判斷到 id 衝突就先報 23502。
  for (const row of rows) {
    const url = `${restUrl('games')}?id=${encodeURIComponent(`eq.${row.id}`)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...restHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ release_date: row.release_date }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`寫入 games 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
    }
  }
}

/** 問 EU Solr 一批 GB 編號，回傳 Map<nsuid, 上市日 YYYY-MM-DD>。 */
async function fetchSolrDates(nsuids) {
  const q = `nsuid_txt:(${nsuids.join(' OR ')})`;
  const url =
    'https://search.nintendo-europe.com/en/select?' +
    new URLSearchParams({
      q,
      fq: 'type:GAME',
      rows: String(nsuids.length),
      wt: 'json',
      fl: 'nsuid_txt,dates_released_dts',
    }).toString();
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await fetchJson(url);
      const map = new Map();
      for (const doc of data?.response?.docs ?? []) {
        const nsuid = Array.isArray(doc.nsuid_txt) ? doc.nsuid_txt[0] : doc.nsuid_txt;
        const dates = Array.isArray(doc.dates_released_dts)
          ? doc.dates_released_dts
          : doc.dates_released_dts
            ? [doc.dates_released_dts]
            : [];
        const first = typeof dates[0] === 'string' ? dates[0].slice(0, 10) : null;
        if (nsuid && first && /^\d{4}-\d{2}-\d{2}$/.test(first)) {
          if (!map.has(String(nsuid))) map.set(String(nsuid), first);
        }
      }
      return map;
    } catch (e) {
      lastErr = e;
      await sleep(500);
    }
  }
  throw lastErr ?? new Error('EU Solr 查詢失敗');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log(`上市日期回填開始（${DRY_RUN ? 'DRY-RUN，只看不寫' : '正式寫入'}${Number.isFinite(LIMIT) ? `，上限 ${LIMIT} 款` : ''}）`);

  // 1. 欄位探測：release_date 還沒建就直接退出（不要等寫入時才報錯）。
  try {
    await fetchJson(`${restUrl('games')}?select=release_date&limit=1`, {
      headers: restHeaders(false),
    });
  } catch (e) {
    const msg = String(e?.message ?? e);
    // 401 = key 不對（不是欄位問題），不要誤導成「去跑 migration」。
    if (/401|Invalid API key/i.test(msg)) {
      console.error(
        'Supabase 連線失敗（HTTP 401）：SUPABASE_SERVICE_ROLE_KEY 不正確或已失效，\n' +
          '請檢查環境變數（key 請從 .env.local 複製整串，不要手打）。',
      );
      process.exit(1);
    }
    console.error(
      'games.release_date 欄位還不存在：請先在 Supabase Dashboard → SQL Editor 執行\n' +
        '  supabase/migrations/20261118_add_release_date.sql\n' +
        `再跑本腳本（原始錯誤：${msg}）。`,
    );
    process.exit(1);
  }

  // 2. 還沒上市日的遊戲（id, slug, title_id）。
  console.log('讀取尚未填上市日的遊戲…');
  const games = await fetchAll('games', 'id,slug,title_id', '&release_date=is.null');
  console.log(`  尚未填上市日：${games.length} 款`);
  const targets = games.slice(0, LIMIT);

  // 3. GB（歐洲）編號對照表。
  console.log('讀取 GB 編號對照表…');
  const gbRows = await fetchAll('game_region_ids', 'game_id,title_id', '&country=eq.GB');
  const gbByGame = new Map(gbRows.map((r) => [r.game_id, String(r.title_id)]));
  console.log(`  GB 編號：${gbByGame.size} 筆`);

  const withGb = targets.filter((g) => gbByGame.has(g.id));
  const withoutGb = targets.length - withGb.length;
  console.log(`  其中有 GB 編號可問 Solr：${withGb.length} 款；無 GB 編號（本次跳過，靠目錄同步補）：${withoutGb} 款`);

  // 4. 分批問 Solr，收集 { id, release_date }。
  const updates = [];
  let solrFailed = 0;
  for (const batch of chunk(withGb, SOLR_BATCH)) {
    const nsuids = batch.map((g) => gbByGame.get(g.id));
    try {
      const dates = await fetchSolrDates(nsuids);
      for (const g of batch) {
        const d = dates.get(gbByGame.get(g.id));
        if (d) updates.push({ id: g.id, release_date: d });
      }
    } catch (e) {
      solrFailed += batch.length;
      console.warn(`  Solr 查詢失敗（${batch.length} 款跳過）：${e.message}`);
    }
    process.stdout.write(`\r  Solr 查詢進度：${Math.min(updates.length + solrFailed, withGb.length)}/${withGb.length} 款，查到 ${updates.length} 筆上市日`);
    await sleep(150);
  }
  console.log(`\n  Solr 查到上市日：${updates.length} 筆${solrFailed > 0 ? `（${solrFailed} 款查詢失敗未寫入）` : ''}`);

  // 5. 寫回 games（只寫 release_date 為 NULL 的列；PATCH by id 只帶 release_date）。
  if (DRY_RUN) {
    console.log('DRY-RUN：不寫入。範例前 5 筆：');
    for (const u of updates.slice(0, 5)) {
      const g = targets.find((x) => x.id === u.id);
      console.log(`  ${g?.slug ?? u.id} → ${u.release_date}`);
    }
  } else if (updates.length > 0) {
    let written = 0;
    for (const batch of chunk(updates, WRITE_BATCH)) {
      await updateGames(batch);
      written += batch.length;
      process.stdout.write(`\r  寫入進度：${written}/${updates.length}`);
    }
    console.log('\n  寫入完成。');
  }

  console.log(
    `完成：目標 ${targets.length} 款 → 查到 ${updates.length} 筆上市日` +
      `${DRY_RUN ? '（未寫入）' : `，寫入 ${updates.length} 筆`}；` +
      `無 GB 編號跳過 ${withoutGb} 款（靠目錄同步補）；Solr 失敗 ${solrFailed} 款。`,
  );
}

main().catch((e) => {
  console.error(`失敗：${e.message}`);
  process.exit(1);
});
