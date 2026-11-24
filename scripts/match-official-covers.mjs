// Step 3: 比對缺封面遊戲 × 三家官方圖源（本機比對，不打 DB、不寫庫）。
// 規則：先 title_id（JP 用 games.title_id；NA/EU 用 game_region_ids），
// 再正規化標題（沿用 lib/catalog-sources.ts normalizeTitle：去 ™®©℠ → NFKD →
// 小寫 → 只留字母數字）。標題比對只收「該來源內唯一 nsuid」者；
// 同一正規化標題對到兩個以上缺圖遊戲時全部跳過（避免錯掛）。
// 優先順序 JP > EU > NA；最後對每個入選 image_url 做 HEAD/GET 驗證，
// 死連結剔除。產出 data/official-cover-gap-fills.json + 驗證抽樣檔。
import { readFileSync, writeFileSync } from "node:fs";

const missing = JSON.parse(readFileSync("data/missing-covers.json", "utf8"));
const jpRaw = JSON.parse(readFileSync("data/official-jp-search.json", "utf8"));
const euRaw = JSON.parse(readFileSync("data/official-eu-solr.json", "utf8"));
const naRaw = JSON.parse(readFileSync("data/official-na-algolia.json", "utf8"));

function normalizeTitle(s) {
  if (!s) return "";
  return String(s)
    .replace(/[™®©℠]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// ---------- 解析三家來源（沿用 lib/catalog-sources.ts 的過濾規則） ----------
function parseJp(items) {
  const byId = new Map();
  const byTitle = new Map(); // norm -> Map(nsuid -> entry)
  let noCover = 0;
  for (const it of items) {
    const nsuid = typeof it?.nsuid === "string" ? it.nsuid : "";
    const title = typeof it?.title === "string" ? it.title.trim() : "";
    if (!nsuid || !nsuid.startsWith("7001") || !title) continue;
    if (typeof it?.id === "string" && it.id.includes("_")) continue;
    const hard = typeof it?.hard === "string" ? it.hard : "";
    const platform = hard === "05_BEE" ? "Switch 2" : hard === "1_HAC" ? "Switch" : null;
    if (hard && !platform) continue;
    const iurl = typeof it?.iurl === "string" ? it.iurl : "";
    const cover = /^[0-9a-f]{64}$/.test(iurl)
      ? `https://img-eshop.cdn.nintendo.net/i/${iurl}.jpg`
      : null;
    if (!cover) {
      noCover++;
      continue;
    }
    const e = { nsuid, title, cover };
    if (!byId.has(nsuid)) byId.set(nsuid, e);
    const n = normalizeTitle(title);
    if (n) {
      if (!byTitle.has(n)) byTitle.set(n, new Map());
      byTitle.get(n).set(nsuid, e);
    }
  }
  return { byId, byTitle, noCover };
}

function parseEu(docs) {
  const byId = new Map();
  const byTitle = new Map();
  let noCover = 0;
  for (const d of docs) {
    const title = typeof d?.title === "string" ? d.title.trim() : "";
    const systems = Array.isArray(d?.system_names_txt) ? d.system_names_txt : [];
    const platform = systems.some((s) => /Nintendo Switch 2/i.test(s))
      ? "Switch 2"
      : systems.some((s) => /Nintendo Switch/i.test(s))
        ? "Switch"
        : null;
    if (!title || !platform) continue;
    const nsuid = (Array.isArray(d?.nsuid_txt) ? d.nsuid_txt : []).find((n) =>
      n.startsWith("7001")
    );
    if (!nsuid) continue;
    const cover = typeof d?.image_url_h16x9_s === "string" ? d.image_url_h16x9_s : "";
    if (!cover) {
      noCover++;
      continue;
    }
    const e = { nsuid, title, cover };
    if (!byId.has(nsuid)) byId.set(nsuid, e);
    const n = normalizeTitle(title);
    if (n) {
      if (!byTitle.has(n)) byTitle.set(n, new Map());
      byTitle.get(n).set(nsuid, e);
    }
  }
  return { byId, byTitle, noCover };
}

function parseNa(hits) {
  const byId = new Map();
  const byTitle = new Map();
  let noCover = 0;
  for (const h of hits) {
    const nsuid = typeof h?.nsuid === "string" ? h.nsuid : "";
    const title = typeof h?.title === "string" ? h.title.trim() : "";
    if (!nsuid || !title) continue;
    const pi = typeof h?.productImage === "string" ? h.productImage : "";
    const cover = pi
      ? `https://assets.nintendo.com/image/upload/q_auto/f_auto/${pi}`
      : typeof h?.productImageSquare === "string" && h.productImageSquare
        ? h.productImageSquare.startsWith("http")
          ? h.productImageSquare
          : `https://assets.nintendo.com/image/upload/q_auto/f_auto/${h.productImageSquare}`
        : null;
    if (!cover) {
      noCover++;
      continue;
    }
    const e = { nsuid, title, cover };
    if (!byId.has(nsuid)) byId.set(nsuid, e);
    const n = normalizeTitle(title);
    if (n) {
      if (!byTitle.has(n)) byTitle.set(n, new Map());
      byTitle.get(n).set(nsuid, e);
    }
  }
  return { byId, byTitle, noCover };
}

const jp = parseJp(jpRaw.items);
const eu = parseEu(euRaw.docs);
const na = parseNa(naRaw.hits);
console.log(`JP 原始 ${jpRaw.items.length} → 有圖唯一 nsuid ${jp.byId.size}（無圖跳過 ${jp.noCover}）`);
console.log(`EU 原始 ${euRaw.docs.length} → 有圖唯一 nsuid ${eu.byId.size}（無圖跳過 ${eu.noCover}）`);
console.log(`NA 原始 ${naRaw.hits.length} → 有圖唯一 nsuid ${na.byId.size}（無圖跳過 ${na.noCover}）`);

// ---------- 缺圖遊戲側索引 ----------
const games = missing.games;
const regionByGame = new Map(); // game.id -> [{country, title_id}]
for (const r of missing.regionIds) {
  if (!regionByGame.has(r.game_id)) regionByGame.set(r.game_id, []);
  regionByGame.get(r.game_id).push(r);
}

// DB 側正規化標題若對到多款缺圖遊戲 → 該標題視為歧義，標題比對時跳過
const dbTitleOwners = new Map(); // norm -> Set(slug)
for (const g of games) {
  for (const t of [g.title_zh, g.title_en]) {
    const n = normalizeTitle(t);
    if (!n) continue;
    if (!dbTitleOwners.has(n)) dbTitleOwners.set(n, new Set());
    dbTitleOwners.get(n).add(g.slug);
  }
}

const SOURCES = [
  { key: "jp", ...jp },
  { key: "eu", ...eu },
  { key: "na", ...na },
];

// 唯一標題比對：在某來源內正規化標題只對到一個 nsuid 才收
function titleMatchOne(norm, src) {
  const m = src.byTitle.get(norm);
  if (!m || m.size !== 1) return null;
  return [...m.values()][0];
}

const fills = [];
const stats = {
  bySource: { jp: 0, eu: 0, na: 0 },
  byMethod: { title_id: 0, title: 0 },
  idMatchPerSource: { jp: 0, eu: 0, na: 0 },
  titleMatchPerSource: { jp: 0, eu: 0, na: 0 },
  overlapId: 0, // title_id 在多家都命中
  ambiguousTitleSkipped: 0,
  titleMatchCandidates: [], // 供抽樣驗證
};

for (const g of games) {
  // --- 1. title_id ---
  const idHits = []; // [{source, entry}]
  if (g.title_id && jp.byId.has(g.title_id)) idHits.push({ source: "jp", entry: jp.byId.get(g.title_id) });
  for (const r of regionByGame.get(g.id) ?? []) {
    if (!r.title_id) continue;
    if (na.byId.has(r.title_id)) idHits.push({ source: "na", entry: na.byId.get(r.title_id) });
    if (eu.byId.has(r.title_id)) idHits.push({ source: "eu", entry: eu.byId.get(r.title_id) });
  }
  // 去重（同一 source 同一 nsuid 只計一次）
  const idSeen = new Set();
  const idUnique = idHits.filter((h) => {
    const k = `${h.source}:${h.entry.nsuid}`;
    if (idSeen.has(k)) return false;
    idSeen.add(k);
    return true;
  });
  if (idUnique.length > 0) {
    if (idUnique.length > 1) stats.overlapId++;
    // 優先 JP > EU > NA
    const pick = idUnique.find((h) => h.source === "jp") ?? idUnique.find((h) => h.source === "eu") ?? idUnique[0];
    for (const h of idUnique) stats.idMatchPerSource[h.source]++;
    stats.bySource[pick.source]++;
    stats.byMethod.title_id++;
    fills.push({ slug: g.slug, image_url: pick.entry.cover, source: pick.source, match_method: "title_id" });
    continue;
  }

  // --- 2. 正規化標題 ---
  const norms = [...new Set([normalizeTitle(g.title_zh), normalizeTitle(g.title_en)].filter(Boolean))];
  let picked = null;
  for (const n of norms) {
    if ((dbTitleOwners.get(n)?.size ?? 0) > 1) {
      stats.ambiguousTitleSkipped++;
      continue;
    }
    for (const src of SOURCES) {
      const e = titleMatchOne(n, src);
      if (e) {
        picked = { source: src.key, entry: e, dbNorm: n };
        break;
      }
    }
    if (picked) break;
  }
  if (picked) {
    stats.titleMatchPerSource[picked.source]++;
    stats.bySource[picked.source]++;
    stats.byMethod.title++;
    stats.titleMatchCandidates.push({
      slug: g.slug,
      title_zh: g.title_zh,
      title_en: g.title_en,
      norm: picked.dbNorm,
      source: picked.source,
      source_title: picked.entry.title,
      source_nsuid: picked.entry.nsuid,
      image_url: picked.entry.cover,
    });
    fills.push({ slug: g.slug, image_url: picked.entry.cover, source: picked.source, match_method: "title" });
  }
}

console.log("=== 比對結果（驗證圖片前）===");
console.log("入選總數：", fills.length);
console.log("bySource：", JSON.stringify(stats.bySource));
console.log("byMethod：", JSON.stringify(stats.byMethod));
console.log("title_id 各來源命中：", JSON.stringify(stats.idMatchPerSource));
console.log("title 各來源命中：", JSON.stringify(stats.titleMatchPerSource));
console.log("title_id 多家重疊款數：", stats.overlapId);
console.log("DB 標題歧義跳過（款·標題次數）：", stats.ambiguousTitleSkipped);
console.log("完全沒圖剩：", games.length - fills.length);

// ---------- 圖片 URL 存活驗證（全部入選逐一 HEAD，失敗再 GET Range） ----------
async function urlAlive(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
      if (r.ok) return true;
      if (r.status === 405 || r.status === 403) {
        const g = await fetch(url, {
          headers: { Range: "bytes=0-0" },
          signal: AbortSignal.timeout(15000),
        });
        return g.ok || g.status === 206;
      }
      return false;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}
async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (idx < items.length) {
        const i = idx++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}
const alive = await pool(fills, 10, (f) => urlAlive(f.image_url));
const deadIdx = [];
const liveFills = fills.filter((f, i) => {
  if (!alive[i]) deadIdx.push(i);
  return alive[i];
});
console.log(`圖片存活驗證：${liveFills.length}/${fills.length} 存活，死連結 ${deadIdx.length}`);
const deadBySource = {};
for (const i of deadIdx) {
  const s = fills[i].source;
  deadBySource[s] = (deadBySource[s] ?? 0) + 1;
}
console.log("死連結 by source：", JSON.stringify(deadBySource));

// 重新統計（只計存活者）
const finalStats = {
  bySource: { jp: 0, eu: 0, na: 0 },
  byMethod: { title_id: 0, title: 0 },
};
for (const f of liveFills) {
  finalStats.bySource[f.source]++;
  finalStats.byMethod[f.match_method]++;
}
console.log("最終 bySource：", JSON.stringify(finalStats.bySource));
console.log("最終 byMethod：", JSON.stringify(finalStats.byMethod));
console.log("最終完全沒圖剩：", games.length - liveFills.length);

// 抽樣檔：標題比對候選中隨機 40 筆（固定種子洗牌，人工驗證用）+ 全部 title_id 死連結
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const cands = [...stats.titleMatchCandidates];
for (let i = cands.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [cands[i], cands[j]] = [cands[j], cands[i]];
}
const sample = cands.slice(0, 40);
writeFileSync("data/cover-title-match-sample.json", JSON.stringify(sample, null, 1));
console.log(`抽樣檔：data/cover-title-match-sample.json（${sample.length} 筆標題比對）`);

// 只收存活的 title 比對候選進最終檔（死連結的 title 候選已在 liveFills 外）
const liveSlugs = new Set(liveFills.map((f) => f.slug));
const liveTitleCands = stats.titleMatchCandidates.filter((c) => liveSlugs.has(c.slug));
writeFileSync(
  "data/official-cover-gap-fills.json",
  JSON.stringify(liveFills, null, 1)
);
writeFileSync(
  "data/cover-gap-report.json",
  JSON.stringify(
    {
      fetched_at: new Date().toISOString(),
      missing_total: games.length,
      source_sizes: {
        jp_raw: jpRaw.items.length,
        jp_usable: jp.byId.size,
        eu_raw: euRaw.docs.length,
        eu_usable: eu.byId.size,
        na_raw: naRaw.hits.length,
        na_usable: na.byId.size,
      },
      pre_verify: {
        fills: fills.length,
        bySource: stats.bySource,
        byMethod: stats.byMethod,
        idMatchPerSource: stats.idMatchPerSource,
        titleMatchPerSource: stats.titleMatchPerSource,
        overlapId: stats.overlapId,
        ambiguousTitleSkipped: stats.ambiguousTitleSkipped,
      },
      image_check: { alive: liveFills.length, dead: deadIdx.length, deadBySource },
      final: { fills: liveFills.length, bySource: finalStats.bySource, byMethod: finalStats.byMethod, still_missing: games.length - liveFills.length },
      title_match_live_count: liveTitleCands.length,
    },
    null,
    1
  )
);
console.log("已寫 data/official-cover-gap-fills.json 與 data/cover-gap-report.json");
