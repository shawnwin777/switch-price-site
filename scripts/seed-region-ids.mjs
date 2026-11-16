/**
 * Switch 遊戲比價 — 各區編號對照表匯入腳本
 * ============================================================
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
 *   node scripts/seed-region-ids.mjs
 *
 *   指定其他對照檔：node scripts/seed-region-ids.mjs data/tw-hk-full-ids.json
 *   強制覆蓋已有值：node scripts/seed-region-ids.mjs --force
 *
 * 前置作業：
 *   1. 先在 Supabase Dashboard → SQL Editor 執行
 *      supabase/migrations/20261116_game_region_ids.sql（只需一次）。
 *   2. 來源調查組的對照檔已放在 data/（預設讀 data/region-title-ids.json；
 *      若無此檔，依序改讀 data/tw-hk-full-ids.json、
 *      data/tw-hk-title-ids.json；三者皆無時報錯退出）。
 *
 * 輸入格式（見 scripts/region-ids-input.mjs 與 DATA_NOTES.md §11.1）：
 *   新格式 data/region-title-ids.json 的 games（key 為 slug 或 jpTitleId，
 *   twTitleId／hkTitleId 與 regionIds 兩種寫法皆吃），以及舊格式
 *   data/tw-hk-title-ids.json 的 mapped／tw_only_games。
 *
 * 找遊戲的方法（依序）：
 *   1. slug 對 games.slug；2. jpTitleId 對 games.title_id。
 *   兩者都對不到 → 記為 skipped（多半是 tw_only_games 裡目錄還沒有的
 *   遊戲），絕不因此新建遊戲——新遊戲由目錄匯入（seed-expanded）負責。
 *
 * 寫入規則（刻意保守）：
 *   - upsert game_region_ids，以 (game_id, country) 為準，分批 500 筆。
 *   - 預設「已有值保留」：該（遊戲、國家）已有列時不覆蓋——同值記為
 *     skipped_existing、不同值記為 kept_conflict（印出舊值與新值供人工
 *     核對）；要以新檔覆蓋舊值時，明確加 --force 才會寫入。
 *   - 絕不以 null 覆蓋：解析器只輸出有值的編號，空值根本不會進寫入批次。
 *   - JP 不寫入對照表：日本編號就是 games.title_id，查價時走 fallback。
 *   - 可重複執行：重跑一次應全部是 skipped_existing、寫入 0 筆。
 *
 * 連線：只用環境變數 NEXT_PUBLIC_SUPABASE_URL 與
 *       SUPABASE_SERVICE_ROLE_KEY（不讀 .env.local、不把 key 寫進檔案）。
 *       Service Role Key 會繞過 RLS，請只在伺服器端／本機執行，
 *       不要放進前端程式碼或公開倉庫。
 *
 * 需求：Node.js 18+（使用內建 fetch，不需安裝任何套件）。
 */

import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadRegionIdsFile } from './region-ids-input.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '缺少環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 再執行。\n' +
      '用法見本檔案開頭註解。',
  );
  process.exit(1);
}

const BATCH_SIZE = 500;

const CANDIDATE_INPUTS = [
  path.join(PROJECT_ROOT, 'data', 'region-title-ids.json'),
  path.join(PROJECT_ROOT, 'data', 'tw-hk-full-ids.json'),
  path.join(PROJECT_ROOT, 'data', 'tw-hk-title-ids.json'),
];

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
      '或指定舊檔：node scripts/seed-region-ids.mjs data/tw-hk-title-ids.json',
  );
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

/** 分頁讀取 games 的 id / slug / title_id（10,051 款，單次讀不完）。 */
async function getGamesIndex() {
  const bySlug = new Map();
  const byTitleId = new Map();
  let offset = 0;
  for (;;) {
    const url =
      `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/games` +
      `?select=id,slug,title_id&limit=1000&offset=${offset}`;
    const res = await fetch(url, { headers: restHeaders(false) });
    if (!res.ok) {
      throw new Error(`讀取 games 失敗（HTTP ${res.status}）：${(await res.text()).slice(0, 500)}`);
    }
    const rows = await res.json();
    for (const r of rows) {
      bySlug.set(r.slug, { id: r.id, titleId: r.title_id ?? null });
      if (r.title_id) byTitleId.set(String(r.title_id), { id: r.id, slug: r.slug });
    }
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  return { bySlug, byTitleId };
}

/** 分頁讀取現有對照列：key 為 `${game_id}|${country}` → 現有 title_id。 */
async function getExistingRegionIds() {
  const existing = new Map();
  let offset = 0;
  for (;;) {
    const url =
      `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/game_region_ids` +
      `?select=game_id,country,title_id&limit=1000&offset=${offset}`;
    const res = await fetch(url, { headers: restHeaders(false) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `讀取 game_region_ids 失敗（HTTP ${res.status}）：${text.slice(0, 500)}\n` +
          '若是表不存在（PGRST205／relation does not exist），請先執行 ' +
          'supabase/migrations/20261116_game_region_ids.sql 再重跑。',
      );
    }
    const rows = await res.json();
    for (const r of rows) {
      existing.set(`${r.game_id}|${String(r.country).toUpperCase()}`, String(r.title_id));
    }
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  return existing;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const explicit = args.find((a) => !a.startsWith('--'));
  const inputPath = await pickInputPath(explicit);
  const { entries, warnings, meta } = await loadRegionIdsFile(inputPath);
  console.log(
    `對照檔：${inputPath}\n` +
      `  產生時間：${meta.generated_at ?? '（未記錄）'}，條目 ${entries.length} 筆` +
      (force ? '（--force：已有值將被覆蓋）' : '（預設：已有值保留）'),
  );
  for (const w of warnings) console.log(`  [警告] ${w}`);

  const { bySlug, byTitleId } = await getGamesIndex();
  console.log(`games：資料庫現有 ${bySlug.size} 款`);
  const existing = await getExistingRegionIds();
  console.log(`game_region_ids：現有 ${existing.size} 列`);

  const toInsert = [];
  const skippedNoGame = [];
  const keptConflicts = [];
  let skippedExisting = 0;
  let totalIds = 0;

  for (const entry of entries) {
    let game = entry.slug ? bySlug.get(entry.slug) : null;
    let matchedBy = 'slug';
    if (!game && entry.jpTitleId) {
      game = byTitleId.get(String(entry.jpTitleId)) ?? null;
      matchedBy = 'jpTitleId';
    }
    if (!game) {
      skippedNoGame.push(
        `${entry.key}（${entry.titleZh ?? entry.titleEn ?? ''}）：` +
          `slug 與 jpTitleId 皆對不到 games（${matchedBy === 'slug' ? '無此 slug' : '無此 jpTitleId'}），` +
          `其 ${entry.ids.size} 個編號未寫入`,
      );
      continue;
    }
    for (const [country, titleId] of entry.ids) {
      totalIds += 1;
      const key = `${game.id}|${country}`;
      const old = existing.get(key);
      if (old != null) {
        if (old === titleId) {
          skippedExisting += 1;
        } else if (force) {
          toInsert.push({ game_id: game.id, country, title_id: titleId, source: entry.source ?? null });
        } else {
          keptConflicts.push(
            `${game.slug} ${country}：現有 ${old}，新檔 ${titleId}——已保留現有值（加 --force 可覆蓋）`,
          );
        }
        continue;
      }
      toInsert.push({ game_id: game.id, country, title_id: titleId, source: entry.source ?? null });
    }
  }

  let inserted = 0;
  for (const batch of chunk(toInsert, BATCH_SIZE)) {
    await postgrest('game_region_ids', batch, 'game_id,country');
    inserted += batch.length;
  }

  console.log(
    `完成：對照檔編號 ${totalIds} 個 → 寫入 ${inserted} 列，` +
      `已有相同值跳過 ${skippedExisting} 列，` +
      `值衝突保留現有 ${keptConflicts.length} 列，` +
      `對不到遊戲跳過 ${skippedNoGame.length} 款。`,
  );
  if (keptConflicts.length > 0) {
    console.log('值衝突（已保留現有值，未覆蓋）：');
    for (const c of keptConflicts.slice(0, 20)) console.log(`  ! ${c}`);
    if (keptConflicts.length > 20) console.log(`  ……共 ${keptConflicts.length} 筆，僅列前 20 筆`);
  }
  if (skippedNoGame.length > 0) {
    console.log('對不到遊戲（未寫入任何編號；新遊戲請先跑 seed-expanded 匯入目錄）：');
    for (const s of skippedNoGame.slice(0, 20)) console.log(`  - ${s}`);
    if (skippedNoGame.length > 20) console.log(`  ……共 ${skippedNoGame.length} 款，僅列前 20 款`);
  }
  console.log('可重複執行：再跑一次應為寫入 0 列、其餘全部跳過。');
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
