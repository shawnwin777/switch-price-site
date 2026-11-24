// A 組重複遊戲併入（2026-11-24 shawn 決定：A 全併入、B 分開、C 分開）。
//
// 背景：外國價格乾跑找出 272 款新遊戲，其中 63 款與庫裡標題相似；
// shawn 審核後決定 A 組 34 款是同一款遊戲（美區／台區／港區編號不同），
// 併入現有列、不新建遊戲。B 組（豪華版／決定版／寶可夢多語言版）與 C 組
// （續作／不同遊戲）分開進庫，由排程同步自動新建，不在本腳本處理。
//
// 寫入規則（冪等、安全）：
//   - 只寫 game_region_ids：把新遊戲的美洲 8 國編號掛到現有列上
//     （upsert onConflict game_id,country；同一國家已有不同編號 → 跳過＋記錄，
//     絕不覆寫；同一國家＋同一編號 → 已存在，跳過）。
//   - 價格不寫：下次價格輪抓會對新編號抓官方價，並按寫入端合約標 verified=false。
//   - title_en 改成乾淨英文標題（中文名不動）：讓之後歐洲同步以標題比對時
//     也認得是同一款、不再建重複遊戲。若 titleEn 與其他遊戲撞名，該列只併編號、
//     跳過改名。寫入前先查現有 title_en／title_zh，norm 相同才算撞名。
//   - 新 slug 若已在庫（同步已先建了重複列）→ 整組跳過並記錄，不動它。
//   - 預設 dry-run（只印會寫什麼）；--apply 才真寫。
//
// 用法（PowerShell，環境變數按工作階段設定；service role key 只在家用）：
//   $env:NEXT_PUBLIC_SUPABASE_URL="https://gplklnhsplydxmyepbzx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service role key>"
//   node scripts/merge-foreign-duplicates-a.mjs            # 乾跑（預設）
//   node scripts/merge-foreign-duplicates-a.mjs --apply     # 真寫入
//   務必在今晚 02:00 排程同步前跑完，否則同步會把 A 組建成重複遊戲。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, "..");

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const READ_KEY = SERVICE_ROLE_KEY || ANON_KEY;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const dataIdx = args.indexOf("--data");
const DATA_PATH = dataIdx >= 0 ? args[dataIdx + 1] : join(PROJECT_ROOT, "data", "foreign-merge-a-20261124.json");

if (!SUPABASE_URL || !READ_KEY) {
  console.error("[error] 缺 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（dry-run 讀取可用 ANON_KEY）。");
  process.exit(1);
}
if (APPLY && !SERVICE_ROLE_KEY) {
  console.error("[error] --apply 需要 SUPABASE_SERVICE_ROLE_KEY。");
  process.exit(1);
}

const rest = (path, { method = "GET", key = READ_KEY, body = undefined } = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "resolution=merge-duplicates" : undefined,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function norm(s) {
  if (!s) return "";
  return String(s)
    .replace(/[™®©℠]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
const groups = data.groups ?? [];
console.log(`[info] ${APPLY ? "寫入模式" : "乾跑模式（不寫入）"}，共 ${groups.length} 組。`);

const report = { total: 0, attached: 0, alreadyPresent: 0, conflicts: 0, titleRenames: 0, titleSkipped: 0, skippedGroups: 0, details: [] };

for (const g of groups) {
  const detail = { newSlug: g.newSlug, existingSlug: g.existingSlug, attached: [], already: [], conflicts: [], titleRenamed: false, titleSkipped: null, skipped: null };
  // 1. 新 slug 是否已在庫（同步已先建了重複列）→ 整組跳過。
  const newRow = await (await rest(`games?select=id,slug&slug=eq.${encodeURIComponent(g.newSlug)}`)).json();
  if (Array.isArray(newRow) && newRow.length > 0) {
    detail.skipped = "新 slug 已在庫（同步已建重複列），整組跳過，請人工處理該重複列";
    report.skippedGroups++;
    report.details.push(detail);
    console.log(`[skip] ${g.newSlug}：${detail.skipped}`);
    continue;
  }
  // 2. 現有列。
  const ex = await (await rest(`games?select=id,slug,title_zh,title_en&slug=eq.${encodeURIComponent(g.existingSlug)}`)).json();
  if (!Array.isArray(ex) || ex.length === 0) {
    detail.skipped = `現有列 ${g.existingSlug} 不在庫，整組跳過`;
    report.skippedGroups++;
    report.details.push(detail);
    console.log(`[skip] ${g.newSlug}：${detail.skipped}`);
    continue;
  }
  const game = ex[0];
  // 3. 現有編號。
  const ids = await (await rest(`game_region_ids?select=country,title_id&game_id=eq.${game.id}&limit=100`)).json();
  const byCountry = new Map((Array.isArray(ids) ? ids : []).map((r) => [String(r.country).toUpperCase(), String(r.title_id)]));
  // 4. 逐筆判斷。
  const toWrite = [];
  for (const row of g.rows) {
    report.total++;
    const cur = byCountry.get(row.country.toUpperCase());
    if (cur === row.title_id) {
      detail.already.push(`${row.country} ${row.title_id}`);
      report.alreadyPresent++;
    } else if (cur !== undefined) {
      detail.conflicts.push(`${row.country}：現有 ${cur} ≠ 新 ${row.title_id}（跳過，不覆寫）`);
      report.conflicts++;
    } else {
      toWrite.push({ game_id: game.id, country: row.country, title_id: row.title_id, source: row.source });
      detail.attached.push(`${row.country} ${row.title_id}`);
    }
  }
  // 5. title_en 改名（norm 不同才改；撞名檢查）。
  if (g.titleEn && norm(g.titleEn) !== norm(game.title_en)) {
    const cand = await (await rest(`games?select=slug,title_zh,title_en&title_en=ilike.${encodeURIComponent(g.titleEn)}&limit=100`)).json();
    const clash = (Array.isArray(cand) ? cand : []).find(
      (c) => c.slug !== game.slug && (norm(c.title_en) === norm(g.titleEn) || norm(c.title_zh) === norm(g.titleEn)),
    );
    if (clash) {
      detail.titleSkipped = `titleEn「${g.titleEn}」與 ${clash.slug} 撞名，只併編號、跳過改名`;
      report.titleSkipped++;
    } else if (APPLY) {
      const res = await rest(`games?id=eq.${game.id}`, { method: "PATCH", key: SERVICE_ROLE_KEY, body: { title_en: g.titleEn } });
      if (!res.ok) {
        detail.titleSkipped = `改名失敗：${res.status} ${await res.text()}`;
        report.titleSkipped++;
      } else {
        detail.titleRenamed = true;
        report.titleRenames++;
      }
    } else {
      detail.titleRenamed = true; // 乾跑：計入預計改名
      report.titleRenames++;
    }
  }
  // 6. 寫入編號（單次 upsert，on_conflict=game_id,country；toWrite 皆為該遊戲
  //    尚未有的國家，絕不覆寫既有編號）。
  if (toWrite.length > 0) {
    if (!APPLY) {
      report.attached += toWrite.length; // 乾跑：計入預計寫入
    } else {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/game_region_ids?on_conflict=game_id,country`,
        {
          method: "POST",
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify(toWrite),
        },
      );
      if (!res.ok) {
        detail.skipped = `編號寫入失敗：${res.status} ${await res.text()}`;
        report.skippedGroups++;
      } else {
        report.attached += toWrite.length;
      }
    }
  }
  report.details.push(detail);
  console.log(
    `[${detail.skipped ? "skip" : "ok"}] ${g.newSlug} → ${g.existingSlug}：` +
      `掛編號 ${detail.attached.length}、已存在 ${detail.already.length}、衝突跳過 ${detail.conflicts.length}` +
      (detail.titleRenamed ? `、改英文名「${g.titleEn}」` : "") +
      (detail.titleSkipped ? `、改名跳過（${detail.titleSkipped}）` : ""),
  );
}

console.log(
  `[done] 共 ${report.total} 筆編號；${APPLY ? "已寫入" : "預計寫入"} ${report.attached}、已存在 ${report.alreadyPresent}、衝突跳過 ${report.conflicts}；` +
    `改英文名 ${report.titleRenames}、改名跳過 ${report.titleSkipped}、整組跳過 ${report.skippedGroups}。`,
);
mkdirSync(join(PROJECT_ROOT, "data"), { recursive: true });
const outPath = join(PROJECT_ROOT, "data", `foreign-merge-a-report-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`[info] 報告寫入 data/${outPath.split("/").pop()}`);
