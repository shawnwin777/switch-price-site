/**
 * Switch 遊戲比價 — 各區編號對照檔的共用解析器
 * ============================================================
 * 來源調查組的產出格式約定（見 DATA_NOTES.md §11.1），本檔是
 * seed-region-ids.mjs 與 fetch-region-prices.mjs 共用的唯一解析入口，
 * 兩支腳本看到的格式語義完全一致。
 *
 * 吃三種輸入（自動偵測，以檔案內容為準，與檔名無關）：
 *
 *   A. 新格式 data/region-title-ids.json（或 tw-hk-full-ids.json）：
 *      {
 *        "generated_at": "...", "sources": [...],
 *        "games": {
 *          "<key>": { "titleZh", "titleEn", "jpTitleId",
 *                     "twTitleId", "hkTitleId",
 *                     "regionIds": { "US": "...", "GB": "...", ... } }
 *        }
 *      }
 *      key 是 slug 或 jpTitleId（純數字即視為 jpTitleId）。
 *      twTitleId / hkTitleId 與 regionIds 兩種寫法都要相容：
 *      TW、HK 優先取 twTitleId／hkTitleId（若 regionIds 也有 TW／HK，
 *      以 twTitleId／hkTitleId 為準，衝突時記警告不中斷）。
 *
 *   B. 舊格式 data/tw-hk-title-ids.json（任務 A 產出）：
 *      {
 *        "mapped": { "<slug>": { "title_id", "tw_title_id",
 *                                "hk_title_id", "source", ... } },
 *        "tw_only_games": [ { "slug", "title_zh", "tw_title_id",
 *                             "source" } ],
 *        "unmapped": [ ... ]   // 無編號，不產生任何列
 *      }
 *      tw_only_games 只有台灣編號、且多半不在現有目錄裡：
 *      解析器照常輸出（只有 TW 一國），找不到 game_id 的由呼叫方
 *      記為 skipped——絕不因此新建遊戲。
 *
 * 輸出（統一）：
 *   { entries: [ { key, slug, jpTitleId, titleZh, titleEn,
 *                  ids: Map<country, titleId>, source } ],
 *     warnings: string[] }
 *   ids 只含「該國專屬編號」：TW、HK、US、GB……；JP 不放進 ids——
 *   日本編號就是 games.title_id 本身，查價時走 fallback（見
 *   lib/region-ids.ts），不需要、也不應該在對照表裡再存一份。
 *
 * 需求：Node.js 18+（不需套件）。本檔不連網、不寫檔。
 */

const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
const TITLE_ID_RE = /^\d{10,}$/;

function isTitleIdKey(key) {
  return TITLE_ID_RE.test(String(key).trim());
}

function normCountry(code) {
  return String(code ?? '').trim().toUpperCase();
}

function normTitleId(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** 單一遊戲條目 → ids Map（TW/HK 欄位優先於 regionIds 的同國值）。 */
function buildIds(entry, warnings, label) {
  const ids = new Map();
  const regionIds = entry.regionIds ?? entry.region_ids ?? {};
  if (regionIds && typeof regionIds === 'object') {
    for (const [rawCode, rawId] of Object.entries(regionIds)) {
      const code = normCountry(rawCode);
      const id = normTitleId(rawId);
      if (!code || !id) continue;
      if (!COUNTRY_CODE_RE.test(code)) {
        warnings.push(`${label}：regionIds 有無效國家代碼「${rawCode}」，已跳過`);
        continue;
      }
      if (code === 'JP') continue; // JP 走 games.title_id fallback，不進對照表
      ids.set(code, id);
    }
  }
  // twTitleId / hkTitleId（新格式）或 tw_title_id / hk_title_id（舊格式）
  // 優先於 regionIds 的同國值；衝突時記警告。
  const flat = [
    ['TW', entry.twTitleId ?? entry.tw_title_id ?? null],
    ['HK', entry.hkTitleId ?? entry.hk_title_id ?? null],
  ];
  for (const [code, rawId] of flat) {
    const id = normTitleId(rawId);
    if (!id) continue;
    if (ids.has(code) && ids.get(code) !== id) {
      warnings.push(
        `${label}：${code} 編號有兩種寫法且不一致（${code === 'TW' ? 'twTitleId' : 'hkTitleId'}=${id}，regionIds.${code}=${ids.get(code)}），以 ${code === 'TW' ? 'twTitleId' : 'hkTitleId'} 為準`,
      );
    }
    ids.set(code, id);
  }
  return ids;
}

function parseNewFormat(data, warnings) {
  const entries = [];
  const gamesObj = data.games ?? {};
  const list = Array.isArray(gamesObj)
    ? gamesObj.map((g, i) => [g?.slug ?? g?.jpTitleId ?? String(i), g])
    : Object.entries(gamesObj);
  for (const [key, entry] of list) {
    if (!entry || typeof entry !== 'object') {
      warnings.push(`games.${key}：不是物件，已跳過`);
      continue;
    }
    const label = `games.${key}`;
    const isIdKey = isTitleIdKey(key);
    const jpTitleId = normTitleId(entry.jpTitleId ?? entry.title_id ?? (isIdKey ? key : null));
    const slug = isIdKey ? (normTitleId(entry.slug) ?? null) : String(key);
    const ids = buildIds(entry, warnings, label);
    entries.push({
      key: String(key),
      slug,
      jpTitleId,
      titleZh: entry.titleZh ?? entry.title_zh ?? null,
      titleEn: entry.titleEn ?? entry.title_en ?? null,
      ids,
      source: entry.source ?? null,
    });
  }
  return entries;
}

function parseLegacyTwHkFormat(data, warnings) {
  const entries = [];
  const mapped = data.mapped ?? {};
  for (const [slug, entry] of Object.entries(mapped)) {
    if (!entry || typeof entry !== 'object') continue;
    const ids = buildIds(entry, warnings, `mapped.${slug}`);
    entries.push({
      key: slug,
      slug,
      jpTitleId: normTitleId(entry.title_id ?? null),
      titleZh: entry.title_zh ?? null,
      titleEn: entry.title_en ?? null,
      ids,
      source: entry.source ?? null,
    });
  }
  for (const entry of data.tw_only_games ?? []) {
    if (!entry || typeof entry !== 'object') continue;
    const slug = entry.slug ?? null;
    const ids = buildIds(entry, warnings, `tw_only_games.${slug ?? '?'}`);
    entries.push({
      key: slug ?? `tw-${entry.tw_title_id ?? '?'}`,
      slug,
      jpTitleId: null,
      titleZh: entry.title_zh ?? null,
      titleEn: null,
      ids,
      source: entry.source ?? null,
    });
  }
  return entries;
}

/**
 * 解析對照檔 JSON 物件 → { entries, warnings }。
 * 偵測規則：有 games → 新格式；有 mapped 或 tw_only_games → 舊格式；
 * 兩者皆無 → 拋錯（格式不符，請來源調查組依 DATA_NOTES.md §11.1 修正）。
 */
export function parseRegionIdsData(data) {
  const warnings = [];
  if (!data || typeof data !== 'object') {
    throw new Error('對照檔不是 JSON 物件');
  }
  if (data.games != null) return { entries: parseNewFormat(data, warnings), warnings };
  if (data.mapped != null || data.tw_only_games != null) {
    return { entries: parseLegacyTwHkFormat(data, warnings), warnings };
  }
  throw new Error(
    '對照檔格式不符：需有 games（新格式）或 mapped／tw_only_games（舊台港格式），' +
      '格式約定見 DATA_NOTES.md §11.1',
  );
}

/** 讀檔＋解析（供 CLI 腳本用）。回傳 { entries, warnings, meta }。 */
export async function loadRegionIdsFile(filePath) {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(filePath, 'utf8');
  const data = JSON.parse(raw);
  const { entries, warnings } = parseRegionIdsData(data);
  return {
    entries,
    warnings,
    meta: {
      generated_at: data.generated_at ?? null,
      sources: Array.isArray(data.sources) ? data.sources : [],
    },
  };
}
