// 套用 DLC／組合包覆蓋 patch：data/dlc-coverage-patch-20261126.json
// 用法（家用電腦，PowerShell）：
//   $env:SUPABASE_URL = "https://gplklnhsplydxmyepbzx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
//   node scripts/apply-dlc-coverage-patch.mjs data/dlc-coverage-patch-20261126.json
// 步驟（跟 patch 檔 apply 欄位一致）：
//   1) game_region_ids：按 (game_id, country) upsert（JP 除外，JP 走 games.title_id）。
//   2) games.title_id：title_id_fills 的 JP 編號寫入 games.title_id，只填空值、不覆蓋已有值。
//   3) prices：按 (game_id, country) upsert（verified=true，跟 /api/refresh 寫入格式一致）。
//   4) historical_low_twd：對受影響的遊戲重算（取該遊戲全部價格列的最低 price_twd，
//      is_historical_low 標到最低價那列）；跳過也行，等下一次 /api/refresh 會自動重算。
// 注意：service role key 只能在家用電腦用，不要在學校／共用電腦打。
import { readFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("請先設 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY（見檔案上方用法）。");
  process.exit(1);
}
const patchPath = process.argv[2];
if (!patchPath) {
  console.error("用法：node scripts/apply-dlc-coverage-patch.mjs <patch json 路徑>");
  process.exit(1);
}
const patch = JSON.parse(readFileSync(patchPath, "utf8"));

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function upsert(table, rows, onConflict, label) {
  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`,
      {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(batch),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${label} upsert 失敗（第 ${i + 1} 筆起）：HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    done += batch.length;
    console.log(`${label}：${done}/${rows.length}`);
  }
  return done;
}

async function patchTitleId(row) {
  // 只填空值：title_id 目前是 null 才寫，不覆蓋已有值。
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/games?game_id=eq.${row.game_id}&title_id=is.null`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title_id: row.title_id }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`games.title_id 寫入失敗（${row.slug}）：HTTP ${res.status} ${text.slice(0, 300)}`);
  }
}

async function recomputeHistoricalLow(gameIds) {
  // 對受影響的遊戲重算 historical_low_twd：先抓全部價格，再把最低價那列標 is_historical_low。
  const BATCH = 200;
  let done = 0;
  for (let i = 0; i < gameIds.length; i += BATCH) {
    const ids = gameIds.slice(i, i + BATCH);
    const inList = ids.map((id) => `"${id}"`).join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/prices?game_id=in.(${encodeURIComponent(`(${inList})`)})&select=game_id,price_twd&verified=is.true&limit=10000`,
      { headers },
    );
    if (!res.ok) throw new Error(`抓價格失敗：HTTP ${res.status}`);
    const rows = await res.json();
    const minByGame = new Map();
    for (const r of rows) {
      if (r.price_twd == null) continue;
      const cur = minByGame.get(r.game_id);
      if (cur == null || r.price_twd < cur) minByGame.set(r.game_id, r.price_twd);
    }
    for (const [gameId, minTwd] of minByGame) {
      // 先把該遊戲的 is_historical_low 全部清掉，再標最低價那列。
      await fetch(
        `${SUPABASE_URL}/rest/v1/prices?game_id=eq.${gameId}`,
        { method: "PATCH", headers, body: JSON.stringify({ is_historical_low: false }) },
      );
      await fetch(
        `${SUPABASE_URL}/rest/v1/prices?game_id=eq.${gameId}&price_twd=eq.${minTwd}`,
        { method: "PATCH", headers, body: JSON.stringify({ is_historical_low: true }) },
      );
    }
    done += ids.length;
    console.log(`歷史低價重算：${done}/${gameIds.length}`);
  }
}

const t0 = Date.now();
console.log(`套用 patch：${patchPath}`);
console.log(`region_ids ${patch.region_ids.length} 筆、title_id_fills ${patch.title_id_fills.length} 筆、prices ${patch.prices.length} 筆`);

// 1) game_region_ids（JP 除外，JP 走 games.title_id）。
const regionRows = patch.region_ids.filter((r) => r.country !== "JP");
await upsert("game_region_ids", regionRows, "game_id,country", "game_region_ids");

// 2) games.title_id（只填空值）。
let titleDone = 0;
for (const row of patch.title_id_fills) {
  await patchTitleId(row);
  titleDone++;
  if (titleDone % 100 === 0) console.log(`games.title_id：${titleDone}/${patch.title_id_fills.length}`);
}
console.log(`games.title_id：${titleDone}/${patch.title_id_fills.length}`);

// 3) prices。
await upsert("prices", patch.prices, "game_id,country", "prices");

// 4) historical_low_twd 重算。
const affected = [...new Set(patch.prices.map((p) => p.game_id))];
await recomputeHistoricalLow(affected);

console.log(`完成（${((Date.now() - t0) / 1000).toFixed(1)} 秒）。驗證：/switch-price?type=dlc&country=JP、?type=bundle&country=US 應不再是 0 款。`);
