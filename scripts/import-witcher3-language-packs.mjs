/**
 * Switch 遊戲比價 — 巫師 3 語言包（香港）匯入腳本
 * ============================================================
 * 把 public/data/witcher3-language-packs.json（香港 eShop 巫師 3 語言包
 * 9 款：5 款「截圖最可能款」＋4 款同遊戲韓文／中文包）寫進資料庫。
 * 這 9 款目前完全不在庫裡（tw-addons.json 搜 Witcher 0 筆、DB 查
 * product_type=dlc 且標題含 Witcher 0 筆），且台灣 eShop 完全沒有
 * 巫師 3 完整版本體與這些語言包（官方價格 API 即時查全部 not_found），
 * 所以是香港一國（HKD），不是台灣。
 *
 * 編號來源（2026-11-24 查證，詳見資料檔開頭的 finding／notes）：
 *   - 標題＋program id：TitleDB HK.zh（第三方標題資料庫，站上
 *     tw-addons.json 名字本來就用同一來源；名字是任天堂 CDN 詮釋資料，
 *     不是第三方比價站的編號）。
 *   - 在售＋0 元：任天堂官方價格 API（api.ec.nintendo.com/v1/price，
 *     country=HK），2026-11-16 全 7005 區間掃描＋2026-11-24 即時覆驗，
 *     9 款皆 onsale、regular=effective=0 HKD；TW 同批查全部 not_found。
 *   - 母遊戲：完整版 HK 70010000020986（香港官方商店 HKD 399、在售）、
 *     標準版 HK 70010000033070（2026-11-24 即時查已 sales_termination）。
 *   - 5 款「截圖最可能款」（資料檔 likelyInScreenshot=true）：
 *     德／法／葡巴／俄／波蘭 5 款標準版語言包——香港官方商店寫明完整版
 *     本體已內含繁中／簡中／英文／韓文，所以完整版頁面另列的語言包
 *     就是這 5 款不內含的語言；韓文／中文包（42978／42979／42775／
 *     42779）語言已在內含清單內。eShop App 的實際列法無法從外部
 *     API 驗證，若 shawn 在 App 點進任一款看連結得到不同編號，以
 *     App 連結為準；本檔 9 款已涵蓋香港全部巫師 3 語言包，匯入後
 *     無論截圖是哪 5 款都在庫裡。
 *
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   node scripts/import-witcher3-language-packs.mjs
 *   node scripts/import-witcher3-language-packs.mjs --dry-run
 *     預設就是 dry-run：只讀 JSON、不寫資料庫、不需環境變數，
 *     印出預計寫入的筆數與每款的寫入形狀。
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
 *   node scripts/import-witcher3-language-packs.mjs --apply
 *     正式寫入（冪等：重跑只更新、不重複建檔）。
 *
 * 寫入規則（與 scripts/import-tw-addons.mjs 同一套）：
 *   - 寫入順序：games → game_region_ids → prices。
 *   - slug 一律 tw-<nsuid>（專案慣例；雖是香港價，slug 仍用 tw- 前綴，
 *     地區寫在 game_region_ids／prices 的 country=HK，不要用 slug
 *     判斷地區）。
 *   - product_type 一律 "dlc"（7005 前綴）、platform 一律 "Switch"
 *    （9 款皆 Switch 1 語言包；Switch 2 重製版語言包是另一批編號，
 *     不在本檔）。
 *   - 價格：香港一國（currency HKD）；price_twd = 0（0 HKD × 任何匯率
 *     都是 0，不需查匯率）；折扣 null（regular=effective=0，無折扣）；
 *     sale_end null；is_historical_low = true、games.historical_low_twd
 *     = 0（新上架的目前價就是歷史低價，跟 /add 手動新增同一套做法）。
 *   - 0 元正確顯示：prices.price_twd 寫數字 0，不是 NULL。讀取端
 *     一律用 != null 判斷有無價格（lib/data.ts cheapestPrice、
 *     .not("price_twd","is",null)），所以 0 會正常當最低價，
 *     卡片顯示「最低價 · 香港 NT$ 0 HKD 0」＋「歷史低價：NT$ 0」，
 *     不會被當成缺價過濾掉。discount_pct 為 null 所以 isPriceOnSale
 *     為 false，不會誤掛「特價中」。
 *   - verified 欄位：本腳本不寫（跟 import-tw-addons.mjs 一致）。
 *     原因是 price-verified 遷移檔尚未進 repo（lib/data.ts 提到的
 *     price-verified-migration-20261124.sql 不在 supabase/migrations
 *     裡），欄位可能還不存在；且 isVerifiedPrice 把缺失／NULL 視為
 *     已確認，而這 9 筆價格已經官方價格 API 兩次探針驗證（2026-11-16
 *     全掃描＋2026-11-24 即時覆驗），本來就是已確認價。
 *   - 具名：9 款皆有 TitleDB 標題＋任天堂 CDN 封面，is_unnamed=false；
 *     封面用 bannerUrl（Nintendo CDN，站上 DLC 封面同一做法）。
 *   - 冪等與不覆蓋：重跑時，已存在的同 slug 列只補價格／編號；
 *     遊戲列本身只在「新建」或「佔位改名」時寫——已經是具名遊戲
 *     的列不覆蓋標題。唯一例外是 product_type 前綴衝突：既有列是
 *     'game'（或未填），但 nsuid 前綴是 7005 時，以前綴為準修正為
 *     dlc。同一 nsuid 若已掛在別款遊戲名下，價格掛到那款遊戲上，
 *     不另建。
 *   - 母遊戲連結：games 表沒有 parent 欄位，母遊戲資訊只記在資料檔
 *     （parentNsuid／parentSlug／parents），不寫庫。匯入後若要讓
 *     詳情頁顯示母遊戲連結，由前端組另處理，不要改本腳本。
 *   - 發售日：資料檔有 releaseDate（2021-01-28／2023-07-19），
 *     新建與佔位改名時寫入 games.release_date；已具名既有列不覆蓋。
 *
 * 連線：只用環境變數 NEXT_PUBLIC_SUPABASE_URL 與
 *       SUPABASE_SERVICE_ROLE_KEY（不讀 .env.local、不把 key 寫進檔案）。
 *       Service Role Key 會繞過 RLS，請只在伺服器端／本機執行，
 *       不要放進前端程式碼或公開倉庫。
 *
 * 需求：Node.js 18+（使用內建 fetch，不需安裝任何套件）。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const INPUT_PATH = path.join(
  PROJECT_ROOT,
  'public',
  'data',
  'witcher3-language-packs.json',
);

const SOURCE_TAG = 'import-witcher3-language-packs';
const COUNTRY = 'HK';
const COUNTRY_NAME = '香港';
const CURRENCY = 'HKD';

const BATCH_GAMES = 500;
const BATCH_REGION_IDS = 500;
const BATCH_PRICES = 200;

const PLACEHOLDER_COVER = '/covers/placeholder.svg';

function parseArgs(argv) {
  const out = { apply: false, input: null };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (!a.startsWith('--')) out.input = path.resolve(a);
    else throw new Error(`未知參數：${a}（可用：--apply、--dry-run）`);
  }
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** JSON 項目 → 寫入用的遊戲列＋價格列（純函式；dry-run 與 live 共用）。 */
function parseItems(data) {
  const items = data.items ?? [];
  const parsed = [];
  const stats = { total: 0, dlc: 0, likelyScreenshot: 0, skippedNotOnSale: [] };
  for (const it of items) {
    if (!it || typeof it !== 'object' || !it.nsuid) continue;
    stats.total += 1;
    if (it.salesStatus !== 'onsale') {
      stats.skippedNotOnSale.push({ nsuid: String(it.nsuid), salesStatus: it.salesStatus });
      continue;
    }
    const nsuid = String(it.nsuid);
    stats.dlc += 1;
    if (it.likelyInScreenshot) stats.likelyScreenshot += 1;
    const named = it.title != null && String(it.title).trim() !== '';
    // title_en 優先用資料檔的英文標題（標準版為 EU Solr／ec 官方頁驗證文；
    // 完整版 2 款為 CE 系命名推斷，見資料檔 titleEnNote）；沒有才退回中文標題。
    // 0 港元：price_twd 寫數字 0（不是 NULL），讀取端用 != null 判斷，
    // 卡片會顯示 NT$ 0，不會被當成缺價（見檔頭「0 元正確顯示」）。
    const effective = it.effective != null ? Math.round(it.effective) : null;
    parsed.push({
      nsuid,
      slug: `tw-${nsuid}`,
      titleZh: named ? String(it.title) : `未命名商品 ${nsuid}`,
      titleEn:
        named && it.titleEn != null && String(it.titleEn).trim() !== ''
          ? String(it.titleEn)
          : named
            ? String(it.title)
            : nsuid,
      coverUrl: named ? it.imageUrl ?? PLACEHOLDER_COVER : PLACEHOLDER_COVER,
      productType: 'dlc',
      platform: 'Switch',
      publisher: it.publisher ?? null,
      isUnnamed: !named,
      releaseDate: it.releaseDate ?? null,
      historicalLowTwd: effective,
      parentNsuid: it.parentNsuid ?? null,
      likelyInScreenshot: Boolean(it.likelyInScreenshot),
      price: {
        country: COUNTRY,
        countryName: COUNTRY_NAME,
        currency: it.currency ?? CURRENCY,
        regularRaw: it.regular ?? null,
        effectiveRaw: it.effective ?? null,
        discountPct: null,
        discountRaw: null,
        saleEnd: it.saleEnd ?? null,
        priceTwd: effective,
      },
    });
  }
  return { parsed, stats };
}

// ============================================================================
// Supabase REST（live 模式；dry-run 完全不呼叫）
// ============================================================================

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

async function patchGame(id, fields) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/games?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: restHeaders(),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`更新 games ${id} 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
  }
}

/** 分頁讀取整表（select 欄位，limit 1000）。 */
async function readAll(table, select) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const url =
      `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}` +
      `?select=${encodeURIComponent(select)}&limit=1000&offset=${offset}`;
    const res = await fetch(url, { headers: restHeaders(false) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`讀取 ${table} 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
    offset += page.length;
  }
  return rows;
}

// ============================================================================
// Dry-run：只印計畫，不碰 Supabase、不需環境變數（預設行為）
// ============================================================================

async function dryRun(opts) {
  const inputPath = opts.input ?? INPUT_PATH;
  const data = JSON.parse(await readFile(inputPath, 'utf8'));
  const { parsed, stats } = parseItems(data);
  console.log(`對照檔：${inputPath}（產生時間 ${data.generatedAt ?? '未記錄'}，價格覆驗 ${data.priceCheckedAt ?? '未記錄'}）`);
  console.log(`  條目 ${stats.total} 筆：DLC ${stats.dlc}（截圖最可能款 ${stats.likelyScreenshot} 筆）`);
  console.log(`  全部 onsale、全部 0 ${data.currency ?? CURRENCY}（香港）；非 onsale 跳過 ${stats.skippedNotOnSale.length} 筆`);
  console.log('\n[預計寫入]');
  console.log(`  games：${parsed.length} 款（slug 一律 tw-<nsuid>，product_type 一律 dlc，platform 一律 Switch）`);
  console.log(`  game_region_ids：${parsed.length} 列（香港一國，source=${SOURCE_TAG}）`);
  console.log(`  prices：${parsed.length} 筆（香港一國，currency HKD，price_twd = 0 數字、非 NULL）`);
  console.log('  （正式執行以資料庫即時查詢為準：已存在的列只更新、不重複建）');
  console.log('\n[寫入形狀（全部 9 筆）]');
  for (const p of parsed) {
    console.log(
      JSON.stringify(
        {
          game: {
            slug: p.slug,
            title_zh: p.titleZh,
            title_en: p.titleEn,
            title_id: null,
            product_type: p.productType,
            platform: p.platform,
            publisher: p.publisher,
            cover_url: p.coverUrl,
            is_unnamed: p.isUnnamed,
            release_date: p.releaseDate,
            historical_low_twd: p.historicalLowTwd,
            price_countries: 1,
          },
          game_region_ids: [{ country: COUNTRY, title_id: p.nsuid, source: SOURCE_TAG }],
          prices: {
            game_id: '(新建遊戲的 id)',
            country: COUNTRY,
            country_name: COUNTRY_NAME,
            currency: p.price.currency,
            regular_raw: p.price.regularRaw,
            effective_raw: p.price.effectiveRaw,
            discount_pct: p.price.discountPct,
            discount_raw: p.price.discountRaw,
            sale_end: p.price.saleEnd,
            price_twd: p.price.priceTwd,
            is_historical_low: true,
          },
          parent_nsuid_hk: p.parentNsuid,
          likely_in_screenshot: p.likelyInScreenshot,
        },
        null,
        2,
      ),
    );
  }
  console.log('\n--dry-run 結束：未寫入任何資料。正式執行請加 --apply（需 SUPABASE_SERVICE_ROLE_KEY）。');
}

// ============================================================================
// Live 模式（--apply）
// ============================================================================

async function live(opts) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      '缺少環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 再執行。\n' +
        '（只看計畫不寫庫：node scripts/import-witcher3-language-packs.mjs --dry-run）',
    );
    process.exit(1);
  }
  const inputPath = opts.input ?? INPUT_PATH;
  const data = JSON.parse(await readFile(inputPath, 'utf8'));
  const { parsed, stats } = parseItems(data);
  console.log(`對照檔：${inputPath}（產生時間 ${data.generatedAt ?? '未記錄'}）`);
  console.log(`  條目 ${stats.total} 筆：DLC ${stats.dlc}、截圖最可能款 ${stats.likelyScreenshot}`);

  // ---- 現有索引（分頁讀全表）----
  const gameRows = await readAll('games', 'id,slug,title_id,product_type,is_unnamed,title_zh,cover_url,price_countries,release_date');
  const bySlug = new Map(gameRows.map((g) => [g.slug, g]));
  console.log(`games：資料庫現有 ${gameRows.length} 款`);
  const regionRows = await readAll('game_region_ids', 'game_id,country,title_id');
  const regionByGame = new Map(); // game_id → Map<country, titleId>
  const gameByTitleId = new Map(); // title_id → game row（同一編號已掛在別款遊戲名下時用）
  for (const r of regionRows) {
    let m = regionByGame.get(r.game_id);
    if (!m) {
      m = new Map();
      regionByGame.set(r.game_id, m);
    }
    m.set(String(r.country).toUpperCase(), String(r.title_id));
    if (!gameByTitleId.has(String(r.title_id))) {
      gameByTitleId.set(String(r.title_id), r.game_id);
    }
  }
  console.log(`game_region_ids：現有 ${regionRows.length} 列`);

  const counts = {
    gamesCreated: 0,
    gamesRenamed: 0,
    gamesPriceOnly: 0,
    gamesTypeFixed: 0,
    attachedToExisting: 0,
    skippedCollision: [],
    regionIdsWritten: 0,
    pricesWritten: 0,
  };

  const gamesUpsert = []; // 只含「新建」列
  const renames = []; // { id, patch }：佔位遊戲原地改名
  const typeFixes = []; // { id, product_type }：具名遊戲的前綴衝突修正
  const pendingRegion = new Map(); // slug → [{ country, titleId }]
  const pendingPrices = new Map(); // slug → [price]
  const slugToId = new Map();

  const priceCountriesFor = (gameId, titleId, extraCountries) => {
    const have = new Set(regionByGame.get(gameId)?.keys() ?? []);
    for (const c of extraCountries) have.add(c);
    return (titleId ? 1 : 0) + have.size;
  };

  for (const p of parsed) {
    const existing = bySlug.get(p.slug) ?? null;
    // 同一 nsuid 已掛在別款遊戲名下：價格掛到那款遊戲上，不另建。
    const attachedGameId = gameByTitleId.get(p.nsuid) ?? null;
    if (attachedGameId && (!existing || existing.id !== attachedGameId)) {
      const target = gameRows.find((g) => g.id === attachedGameId);
      if (target) {
        pendingRegion.set(
          target.slug,
          (pendingRegion.get(target.slug) ?? []).concat([{ country: COUNTRY, titleId: p.nsuid }]),
        );
        pendingPrices.set(
          target.slug,
          (pendingPrices.get(target.slug) ?? []).concat([p.price]),
        );
        slugToId.set(target.slug, target.id);
        counts.attachedToExisting += 1;
        continue;
      }
    }
    if (existing) {
      slugToId.set(p.slug, existing.id);
      // 已是具名遊戲：不覆蓋標題，只補編號＋價格；但 product_type
      // 前綴明確衝突時覆蓋修正——既有列是 'game'（或未填），本次
      // nsuid 前綴卻是 7005 時，以前綴為準改為 dlc。
      if (!existing.is_unnamed) {
        if (existing.product_type === 'game' || existing.product_type == null) {
          typeFixes.push({ id: existing.id, product_type: p.productType });
          counts.gamesTypeFixed += 1;
        } else if (existing.product_type !== p.productType) {
          counts.skippedCollision.push(
            `${p.slug}：既有 product_type=${existing.product_type}，與本次 ${p.productType} 不同，不覆蓋`,
          );
          continue;
        }
        counts.gamesPriceOnly += 1;
      } else {
        // 佔位遊戲原地改名（只在 JSON 具名時；未具名佔位維持佔位）。
        if (!p.isUnnamed) {
          renames.push({
            id: existing.id,
            patch: {
              title_zh: p.titleZh,
              title_en: p.titleEn,
              cover_url: p.coverUrl,
              product_type: p.productType,
              platform: p.platform,
              publisher: p.publisher,
              release_date: p.releaseDate,
              is_unnamed: false,
              historical_low_twd: p.historicalLowTwd,
              price_countries: priceCountriesFor(existing.id, null, [COUNTRY]),
            },
          });
          counts.gamesRenamed += 1;
        } else {
          counts.gamesPriceOnly += 1;
        }
      }
      pendingRegion.set(
        p.slug,
        (pendingRegion.get(p.slug) ?? []).concat([{ country: COUNTRY, titleId: p.nsuid }]),
      );
      pendingPrices.set(
        p.slug,
        (pendingPrices.get(p.slug) ?? []).concat([p.price]),
      );
      continue;
    }
    // 完全新建。
    gamesUpsert.push({
      slug: p.slug,
      title_zh: p.titleZh,
      title_en: p.titleEn,
      title_id: null,
      product_type: p.productType,
      platform: p.platform,
      publisher: p.publisher,
      cover_url: p.coverUrl,
      has_demo: 0,
      is_unnamed: p.isUnnamed,
      release_date: p.releaseDate,
      historical_low_twd: p.historicalLowTwd,
      price_countries: 1,
    });
    bySlug.set(p.slug, { id: null, slug: p.slug, title_id: null, is_unnamed: p.isUnnamed });
    counts.gamesCreated += 1;
    pendingRegion.set(p.slug, [{ country: COUNTRY, titleId: p.nsuid }]);
    pendingPrices.set(p.slug, [p.price]);
  }

  // ---- 1. 寫入 games（新建 upsert by slug）----
  for (const batch of chunk(gamesUpsert, BATCH_GAMES)) {
    const written = await postgrest('games', batch, 'slug');
    for (const g of written) slugToId.set(g.slug, g.id);
  }
  // 既有遊戲的 id（queue 目標含既有遊戲）：從索引補。
  for (const [slug] of pendingRegion) {
    if (!slugToId.has(slug)) {
      const g = bySlug.get(slug);
      if (g?.id) slugToId.set(slug, g.id);
    }
  }

  // ---- 2. 佔位改名（PATCH，只改佔位列）----
  for (const r of renames) {
    await patchGame(r.id, r.patch);
  }

  // ---- 2b. product_type 前綴衝突修正（只改 game／NULL → dlc）----
  for (const f of typeFixes) {
    await patchGame(f.id, { product_type: f.product_type });
  }

  // ---- 3. 寫入 game_region_ids（只補缺口：已有值保留）----
  for (const [slug, regs] of pendingRegion) {
    const gameId = slugToId.get(slug);
    if (!gameId) {
      console.log(`  [警告] ${slug}：寫入 games 後找不到 id，${regs.length} 個編號未寫入`);
      continue;
    }
    const have = regionByGame.get(gameId) ?? new Map();
    const toWrite = [];
    for (const r of regs) {
      if (have.get(r.country) === r.titleId) continue;
      if (have.has(r.country) && have.get(r.country) !== r.titleId) {
        counts.skippedCollision.push(
          `${slug} ${r.country}：既有編號 ${have.get(r.country)}，新檔 ${r.titleId}——已保留現有值`,
        );
        continue;
      }
      toWrite.push({ game_id: gameId, country: r.country, title_id: r.titleId, source: SOURCE_TAG });
      have.set(r.country, r.titleId);
    }
    regionByGame.set(gameId, have);
    for (const batch of chunk(toWrite, BATCH_REGION_IDS)) {
      await postgrest('game_region_ids', batch, 'game_id,country');
      counts.regionIdsWritten += batch.length;
    }
  }

  // ---- 4. 寫入 prices（upsert by game_id,country）----
  for (const [slug, prs] of pendingPrices) {
    const gameId = slugToId.get(slug);
    if (!gameId) continue;
    const rows = prs.map((p) => ({
      game_id: gameId,
      country: p.country,
      country_name: p.countryName,
      currency: p.currency,
      regular_raw: p.regularRaw,
      effective_raw: p.effectiveRaw,
      discount_pct: p.discountPct,
      discount_raw: p.discountRaw,
      sale_end: p.saleEnd,
      price_twd: p.priceTwd,
      is_historical_low: true,
      updated_at: new Date().toISOString(),
    }));
    for (const batch of chunk(rows, BATCH_PRICES)) {
      await postgrest('prices', batch, 'game_id,country');
      counts.pricesWritten += batch.length;
    }
  }

  console.log(
    `\n完成：遊戲新建 ${counts.gamesCreated} 款、佔位改名 ${counts.gamesRenamed} 款、` +
      `product_type 前綴修正 ${counts.gamesTypeFixed} 款、` +
      `只補價格 ${counts.gamesPriceOnly} 款、掛到既有遊戲 ${counts.attachedToExisting} 筆。`,
  );
  console.log(
    `  對照編號寫入 ${counts.regionIdsWritten} 列、價格寫入 ${counts.pricesWritten} 筆、` +
      `碰撞跳過 ${counts.skippedCollision.length} 筆。`,
  );
  if (counts.skippedCollision.length > 0) {
    console.log('  碰撞跳過（未覆蓋）：');
    for (const s of counts.skippedCollision.slice(0, 20)) console.log(`    ! ${s}`);
    if (counts.skippedCollision.length > 20) console.log(`    ……共 ${counts.skippedCollision.length} 筆，僅列前 20 筆`);
  }
  console.log('可重複執行：再跑一次應為新建 0 款、其餘全部更新或跳過。');
  console.log('匯入後檢查：詳情頁應顯示「最低價 · 香港 NT$ 0 HKD 0」＋「歷史低價：NT$ 0」，不掛「特價中」。');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.apply) {
    await live(opts);
    return;
  }
  await dryRun(opts);
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
