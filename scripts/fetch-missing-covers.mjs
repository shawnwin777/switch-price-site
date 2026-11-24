// Step 1: 拉具名缺封面遊戲清單 + 其 game_region_ids（唯讀，anon key）。
// 用法：node scripts/fetch-missing-covers.mjs
// 產出：data/missing-covers.json（games + regionIds）
import { writeFileSync } from "node:fs";

const BASE = "https://gplklnhsplydxmyepbzx.supabase.co/rest/v1";
const KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwbGtsbmhzcGx5ZHhteWVwYnp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3NzIzOTgsImV4cCI6MjExMDM0ODM5OH0.Osv8IjHyI9A-0uoqmPLBAe1urm5Fnya7sRN4BCidBUk";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function fetchAll(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${BASE}${path}&limit=1000&offset=${offset}`, {
      headers: H,
    });
    if (!res.ok) throw new Error(`GET ${path} offset=${offset} HTTP ${res.status}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

const games = [];
for (const cond of ["cover_url=is.null", "cover_url=eq./covers/placeholder.svg"]) {
  const rows = await fetchAll(
    `/games?is_unnamed=eq.false&${cond}&select=id,slug,title_zh,title_en,title_id,cover_url&order=slug`
  );
  console.log(cond, "→", rows.length);
  games.push(...rows);
}
console.log("缺封面具名遊戲總數：", games.length);

// game_region_ids：game_id in.(...) 分批（每批 200）
const ids = games.map((g) => g.id);
const regionIds = [];
for (let i = 0; i < ids.length; i += 200) {
  const batch = ids.slice(i, i + 200);
  const rows = await fetchAll(
    `/game_region_ids?game_id=in.(${batch.join(",")})&select=game_id,country,title_id`
  );
  regionIds.push(...rows);
  if ((i / 200) % 5 === 0) console.log(`region_ids ${i}/${ids.length} → 累計 ${regionIds.length}`);
}
console.log("game_region_ids 總筆：", regionIds.length);

writeFileSync(
  "data/missing-covers.json",
  JSON.stringify({ fetched_at: new Date().toISOString(), games, regionIds }, null, 1)
);
console.log("已寫 data/missing-covers.json");
