// 用官方圖源補缺封面的具名遊戲（任天堂 JP／EU／NA 官方 CDN 圖，不用第三方）。
//
// 對照檔 data/official-cover-gap-fills.json 由 scripts/match-official-covers.mjs
// 產出（2026-11-24 實測）：缺圖 4,739 款中 3,916 款對到官方圖，
// 其中 title_id 對上 2,195 款（全 JP）、正規化標題對上 1,721 款
// （JP 63／EU 168／NA 1,490）；標題比對抽樣 40/40 人工驗證正確，
// title_id 抽樣 20/20 與 JP 原標題完全一致；入選圖片 URL 已逐一
// HEAD/GET 驗證存活（3,916/3,917，1 條 EU 死連結已剔除）。
// 剩 823 款官方三家都對不到（多為台港獨佔／未上市／長尾小品），
// 只能等 IGDB 或其他來源。
//
// 寫入規則（冪等、安全）：
//   - 只寫 cover_url 仍是 NULL 或 /covers/placeholder.svg 的遊戲；
//     寫入前先 GET 再確認一次，絕不覆寫已有官方／IGDB 封面的遊戲。
//   - PATCH 後檢查回傳的 cover_url 是否等於要寫的值。
//   - 預設 dry-run（只印會寫什麼）；--apply 才真寫。
//
// 用法（PowerShell，環境變數按工作階段設定；service role key 只在家用）：
//   $env:NEXT_PUBLIC_SUPABASE_URL="https://gplklnhsplydxmyepbzx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service role key>"
//   node scripts/fill-covers-official.mjs --limit 50            # 乾跑（預設）
//   node scripts/fill-covers-official.mjs --limit 50 --apply     # 真寫入
//   node scripts/fill-covers-official.mjs --apply                # 全量寫入
//   node scripts/fill-covers-official.mjs --limit 200 --offset 50 --apply
import { readFileSync } from "node:fs";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
// 讀取用 key：寫入時用 service role；dry-run 只有 anon 也能查現況。
const READ_KEY = SERVICE_ROLE_KEY || ANON_KEY;
const CAN_CHECK = Boolean(SUPABASE_URL && READ_KEY);
const PLACEHOLDER = "/covers/placeholder.svg";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const limitIdx = args.indexOf("--limit");
const offsetIdx = args.indexOf("--offset");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const OFFSET = offsetIdx >= 0 ? Number(args[offsetIdx + 1]) : 0;

if (!Number.isFinite(LIMIT) && limitIdx >= 0) throw new Error("--limit 需為數字");
if (!Number.isFinite(OFFSET)) throw new Error("--offset 需為數字");
if (APPLY && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
  throw new Error(
    "--apply 需要 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 環境變數（service role key 只在家用，不要貼在對話裡）"
  );
}

const fills = JSON.parse(readFileSync("data/official-cover-gap-fills.json", "utf8"));
if (!Array.isArray(fills)) throw new Error("data/official-cover-gap-fills.json 不是陣列");
const batch = fills.slice(OFFSET, OFFSET + LIMIT);
console.log(
  `對照檔共 ${fills.length} 筆；本次處理 offset=${OFFSET} limit=${LIMIT === Infinity ? "全部" : LIMIT} → ${batch.length} 筆；模式：${APPLY ? "寫入 --apply" : "dry-run（預設，不寫庫）"}`
);

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

let updated = 0;
let skippedCovered = 0;
let skippedSame = 0;
let failed = 0;
const failures = [];

for (const [i, f] of batch.entries()) {
  const n = OFFSET + i + 1;
  try {
    // 寫入前再確認：只寫仍缺圖的（NULL 或 placeholder）。
    // dry-run 且無 URL/key 可查時跳過現況檢查，只印計畫。
    if (!CAN_CHECK) {
      if (APPLY) throw new Error("無法查現況（缺 URL/key），拒寫");
      console.log(`[${n}] ${f.slug}：會寫 ${f.source}/${f.match_method} → ${f.image_url}（未查現況）`);
      updated++;
      continue;
    }
    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/games?slug=eq.${encodeURIComponent(f.slug)}&select=slug,cover_url`,
      { headers: { apikey: READ_KEY, Authorization: `Bearer ${READ_KEY}` } }
    );
    if (!check.ok) throw new Error(`GET 現況 HTTP ${check.status}`);
    const rows = await check.json();
    const cur = rows?.[0]?.cover_url ?? null;
    if (rows.length === 0) {
      failed++;
      failures.push({ slug: f.slug, reason: "DB 無此 slug" });
      console.log(`[${n}] ${f.slug}：DB 無此 slug，跳過`);
      continue;
    }
    if (cur === f.image_url) {
      skippedSame++;
      continue; // 已是同一張圖，冪等跳過
    }
    if (cur !== null && cur !== PLACEHOLDER) {
      skippedCovered++;
      console.log(`[${n}] ${f.slug}：已有封面 ${cur}，不覆寫`);
      continue;
    }
    if (!APPLY) {
      console.log(`[${n}] ${f.slug}：會寫 ${f.source}/${f.match_method} → ${f.image_url}`);
      updated++;
      continue;
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/games?slug=eq.${encodeURIComponent(f.slug)}`,
      { method: "PATCH", headers, body: JSON.stringify({ cover_url: f.image_url }) }
    );
    if (!res.ok) throw new Error(`PATCH HTTP ${res.status} ${await res.text()}`);
    const back = await res.json();
    if (back?.[0]?.cover_url !== f.image_url) {
      throw new Error(`寫後驗證不符：回傳 ${back?.[0]?.cover_url}`);
    }
    updated++;
    if (updated % 100 === 0) console.log(`…已寫 ${updated} 筆`);
  } catch (err) {
    failed++;
    failures.push({ slug: f.slug, reason: String(err?.message ?? err) });
    console.log(`[${n}] ${f.slug}：失敗 ${err?.message ?? err}`);
  }
}

console.log("=== 結果 ===");
console.log(`處理 ${batch.length} 筆；${APPLY ? "已寫入" : "dry-run 會寫入"}：${updated}；已有封面跳過：${skippedCovered}；已是同一張圖跳過：${skippedSame}；失敗：${failed}`);
if (failures.length > 0) console.log("失敗清單：", JSON.stringify(failures, null, 1));
