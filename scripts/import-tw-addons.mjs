/**
 * Switch 遊戲比價 — 台灣 DLC／Switch 2 Edition 匯入腳本
 * ============================================================
 * 把 public/data/tw-addons.json（台灣價格 API 驗證過的在售 DLC／組合包）
 * 寫進資料庫。2026-11-23：這批資料之前只以 JSON 靜態檔呈現在
 * /taiwan/addons，資料庫裡還沒有（game_region_ids 前綴 7005／7007
 * 皆為 0 列）；匯入後 DLC／組合包才有遊戲頁、收藏與比價。
 *
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   node scripts/import-tw-addons.mjs --dry-run
 *     只讀 JSON、不寫資料庫、不需環境變數：印出預計寫入的筆數
 *     （DLC／組合包 × 具名／未具名）與 3 筆樣本列。
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
 *   node scripts/import-tw-addons.mjs
 *     正式寫入（冪等：重跑只更新、不重複建檔）。
 *
 * 輸入形狀（public/data/tw-addons.json，2026-11-22 產生）：
 *   items: [{ nsuid, title, imageUrl, addonType, publisher,
 *     salesStatus, regular, effective, currency, saleEnd,
 *     parentVerified, nameSource, imageSource }]
 *   - addonType：dlc_candidate（前綴 7005）／bundle_candidate（前綴 7007，
 *     組合包——注意：7007 只是「組合包」，不等於 Switch 2 Edition。
 *     2026-11-24 查證：1,114 筆組合包裡只有 1 筆是 Switch 2 Edition
 *     （寶可夢傳說 Z-A），其餘具名皆為 Switch 1；未具名 343 筆無法
 *     從標題判斷（抽查有快打旋風 6、RAIDOU 等 Switch 2 原生組合包），
 *     以商店「平台」欄為準，不要只憑標題硬判）；共 5,284 筆
 *     （DLC 4,170、組合包 1,114）。
 *   - 全部 salesStatus=onsale、currency=TWD；具名 3,498 筆（皆有圖片），
 *     未具名 1,786 筆（title／imageUrl 皆 null）。
 *   - 沒有 releaseDate 欄位：這些都是在售商品，不屬於「準備上市」。
 *
 * 規則（與每週 ingest 的分工，見 scripts/seed-unnamed-games.mjs）：
 *   - 每週 ingest 仍跳過 7005／7007 前綴（價格 API 掃描不含這兩個區間），
 *     只由這支腳本負責；兩邊不會重複建檔。
 *   - 寫入順序與 seed-unnamed-games 一致：games → game_region_ids → prices。
 *   - slug 一律 tw-<nsuid>（具名／未具名相同）：決定性、不碰撞、重跑可對上。
 *   - product_type：dlc_candidate → "dlc"、bundle_candidate → "bundle"；
 *     platform：組合包看標題——含 "Switch 2"（或 NS2）才判 "Switch 2"，
 *     其餘 "Switch"（見 platformOf 的註解）；DLC 也看標題——含 "Switch 2"
 *     （或 NS2，如升級通行證）才判 "Switch 2"，其餘 "Switch"。
 *   - 價格：TW 一國（currency TWD，不需匯率）；price_twd = effective；
 *     折扣由 regular／effective 現算；sale_end 照 JSON（多數為 null）；
 *     is_historical_low = true、games.historical_low_twd = effective
 *     （新上架的目前價就是歷史低價，跟 /add 手動新增同一套做法）。
 *   - 具名／未具名：title 有值 → is_unnamed=false、封面用 Nintendo CDN
 *     的 imageUrl；title 為 null → is_unnamed=true、標題沿用佔位寫法
 *     「未命名商品 <nsuid>」、封面用 /covers/placeholder.svg。未具名
 *     的不出現在首頁牆／搜尋／接近歷史低價（is_unnamed 過濾）。
 *   - 名字與 NSUID 是不變的事實，可以用第三方 TitleDB 的候選名；
 *     圖片是 Nintendo CDN 的，可以用（parentVerified=false 只表示
 *     母遊戲配對未驗證，不影響 DLC 本身的建檔）。
 *   - 冪等與不覆蓋：重跑時，已存在的同 slug 列只補價格／編號；
 *     遊戲列本身只在「新建」或「佔位改名」時寫——已經是具名遊戲
 *     的列不覆蓋標題（命名來源可能在別處補過更好的名字）。
 *     唯一例外是 product_type 前綴衝突：既有列是 'game'（或未填），
 *     但本次 nsuid 前綴是 7005／7007 時，以前綴為準修正為 dlc／bundle
 *     （例如每週 ingest 先建的列）；既有已是 dlc／bundle 但與本次
 *     不同時，仍視為碰撞、不覆蓋。
 *     同一 nsuid 若已掛在別款遊戲名下（game_region_ids 查得到），
 *     價格掛到那款遊戲上，不另建。
 *   - 準備上市（/upcoming）只認 release_date > 今天：這批全部 onsale
 *     且無 releaseDate，所以不會進 /upcoming，這是正常的，不用硬補；
 *     預購項目寫發售日的規則，是以後匯台灣官方目錄時才用。
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

const INPUT_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'tw-addons.json');

const BATCH_GAMES = 500;
const BATCH_REGION_IDS = 500;
const BATCH_PRICES = 200;

const PLACEHOLDER_COVER = '/covers/placeholder.svg';

function parseArgs(argv) {
  const out = { dryRun: false, input: null };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (!a.startsWith('--')) out.input = path.resolve(a);
    else throw new Error(`未知參數：${a}（可用：--dry-run）`);
  }
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function productTypeOf(item) {
  return item.addonType === 'bundle_candidate' ? 'bundle' : 'dlc';
}

function platformOf(item) {
  // 7007 前綴只是「組合包」，不等於 Switch 2 Edition（2026-11-24 查證：
  // 1,114 筆組合包裡只有 1 筆標題含 Switch 2；其餘具名皆為 Switch 1
  // 的豪華版／組合包／季票，另有 17 筆經台灣官方目錄確認為 Nintendo Switch）。
  // 標題含 "Switch 2"（或 NS2）才判 "Switch 2"，其餘組合包與 DLC 皆為 "Switch"。
  // 注意：這是啟發式——極少數 Switch 2 原生組合包標題不帶 "Switch 2"
  //（如快打旋風 6 Years 1-2 Fighters Edition、RAIDOU Remastered 數位豪華版，
  // 皆為未具名、商店「平台」欄為 Nintendo Switch 2），以商店平台欄為準，
  // 誤判者以 SQL 修正，不要只憑標題硬判。
  if (item.addonType === 'bundle_candidate') {
    const title = typeof item.title === 'string' ? item.title : '';
    return /switch\s*2|NS2/i.test(title) ? 'Switch 2' : 'Switch';
  }
  // DLC：標題含 "Switch 2"（或 NS2）的是 Switch 2 專屬（如升級通行證），
  // 才判 "Switch 2"；其餘 DLC 為 "Switch"。舊行為是一律 "Switch"，
  // 漏了 Switch 2 專屬 DLC（2026-11-24 稽核發現）。
  const title = typeof item.title === 'string' ? item.title : '';
  return /switch\s*2|NS2/i.test(title) ? 'Switch 2' : 'Switch';
}

function discountPctOf(item) {
  if (
    item.regular != null &&
    item.effective != null &&
    item.effective < item.regular
  ) {
    return Math.round((1 - item.effective / item.regular) * 100);
  }
  return null;
}

/** JSON 項目 → 寫入用的遊戲列＋價格列（純函式；dry-run 與 live 共用）。 */
function parseItems(data) {
  const items = data.items ?? [];
  const parsed = [];
  const stats = {
    total: 0,
    dlc: 0,
    bundle: 0,
    named: 0,
    unnamed: 0,
    skippedNotOnSale: [],
  };
  for (const it of items) {
    if (!it || typeof it !== 'object' || !it.nsuid) continue;
    stats.total += 1;
    if (it.salesStatus !== 'onsale') {
      stats.skippedNotOnSale.push({ nsuid: String(it.nsuid), salesStatus: it.salesStatus });
      continue;
    }
    const nsuid = String(it.nsuid);
    const named = it.title != null && String(it.title).trim() !== '';
    const productType = productTypeOf(it);
    if (productType === 'dlc') stats.dlc += 1;
    else stats.bundle += 1;
    if (named) stats.named += 1;
    else stats.unnamed += 1;
    const effective = it.effective != null ? Math.round(it.effective) : null;
    parsed.push({
      nsuid,
      slug: `tw-${nsuid}`,
      titleZh: named ? String(it.title) : `未命名商品 ${nsuid}`,
      titleEn: named ? String(it.title) : nsuid,
      coverUrl: named ? it.imageUrl ?? PLACEHOLDER_COVER : PLACEHOLDER_COVER,
      productType,
      platform: platformOf(it),
      publisher: it.publisher ?? null,
      isUnnamed: !named,
      historicalLowTwd: effective,
      price: {
        country: 'TW',
        countryName: '台灣',
        currency: it.currency ?? 'TWD',
        regularRaw: it.regular ?? null,
        effectiveRaw: it.effective ?? null,
        discountPct: discountPctOf(it),
        discountRaw:
          it.regular != null && it.effective != null && it.effective < it.regular
            ? it.regular - it.effective
            : null,
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
// Dry-run：只印計畫，不碰 Supabase、不需環境變數
// ============================================================================

async function dryRun(opts) {
  const inputPath = opts.input ?? INPUT_PATH;
  const data = JSON.parse(await readFile(inputPath, 'utf8'));
  const { parsed, stats } = parseItems(data);
  console.log(`對照檔：${inputPath}（產生時間 ${data.generatedAt ?? '未記錄'}）`);
  console.log(`  條目 ${stats.total} 筆：DLC ${stats.dlc}、組合包 ${stats.bundle}`);
  console.log(`  具名 ${stats.named} 筆、未具名 ${stats.unnamed} 筆`);
  console.log(`  全部 onsale、全部 TWD；非 onsale 跳過 ${stats.skippedNotOnSale.length} 筆`);
  console.log('\n[預計寫入]');
  console.log(`  games：${parsed.length} 款（slug 一律 tw-<nsuid>，product_type 區分 dlc／bundle）`);
  console.log(`  game_region_ids：${parsed.length} 列（TW 一國）`);
  console.log(`  prices：${parsed.length} 筆（TW 一國，price_twd = effective）`);
  console.log('  （正式執行以資料庫即時查詢為準：已存在的列只更新、不重複建）');
  console.log('\n[樣本列（前 3 筆，含完整寫入形狀）]');
  for (const p of parsed.slice(0, 3)) {
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
            cover_url: p.coverUrl,
            is_unnamed: p.isUnnamed,
            historical_low_twd: p.historicalLowTwd,
            price_countries: 1,
          },
          game_region_ids: [{ country: 'TW', title_id: p.nsuid, source: 'import-tw-addons' }],
          prices: {
            game_id: '(新建遊戲的 id)',
            country: 'TW',
            country_name: '台灣',
            currency: p.price.currency,
            regular_raw: p.price.regularRaw,
            effective_raw: p.price.effectiveRaw,
            discount_pct: p.price.discountPct,
            discount_raw: p.price.discountRaw,
            sale_end: p.price.saleEnd,
            price_twd: p.price.priceTwd,
            is_historical_low: true,
          },
        },
        null,
        2,
      ),
    );
  }
  console.log('\n--dry-run 結束：未寫入任何資料。正式執行請去掉 --dry-run（需 SUPABASE_SERVICE_ROLE_KEY）。');
}

// ============================================================================
// Live 模式
// ============================================================================

async function live(opts) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      '缺少環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 再執行。\n' +
        '（只看計畫不寫庫：node scripts/import-tw-addons.mjs --dry-run）',
    );
    process.exit(1);
  }
  const inputPath = opts.input ?? INPUT_PATH;
  const data = JSON.parse(await readFile(inputPath, 'utf8'));
  const { parsed, stats } = parseItems(data);
  console.log(`對照檔：${inputPath}（產生時間 ${data.generatedAt ?? '未記錄'}）`);
  console.log(`  條目 ${stats.total} 筆：DLC ${stats.dlc}、組合包 ${stats.bundle}、具名 ${stats.named}、未具名 ${stats.unnamed}`);

  // ---- 現有索引（分頁讀全表）----
  const gameRows = await readAll('games', 'id,slug,title_id,product_type,is_unnamed,title_zh,cover_url,price_countries');
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
    // 同一 nsuid 已掛在別款遊戲名下（例如每週 ingest 或其他流程先建了）：
    // 價格掛到那款遊戲上，不另建。
    const attachedGameId = gameByTitleId.get(p.nsuid) ?? null;
    if (attachedGameId && (!existing || existing.id !== attachedGameId)) {
      const target = gameRows.find((g) => g.id === attachedGameId);
      if (target) {
        pendingRegion.set(
          target.slug,
          (pendingRegion.get(target.slug) ?? []).concat([{ country: 'TW', titleId: p.nsuid }]),
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
      // 已是具名遊戲：不覆蓋標題（命名來源可能在別處補過更好的名字），
      // 只補編號＋價格；但 product_type 前綴明確衝突時覆蓋修正——
      // 既有列是 'game'（或未填，例如每週 ingest 先建的），本次 nsuid
      // 前綴卻是 7005／7007 時，以前綴為準改為 dlc／bundle。
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
              is_unnamed: false,
              historical_low_twd: p.historicalLowTwd,
              price_countries: priceCountriesFor(existing.id, null, ['TW']),
            },
          });
          counts.gamesRenamed += 1;
        } else {
          counts.gamesPriceOnly += 1;
        }
      }
      pendingRegion.set(
        p.slug,
        (pendingRegion.get(p.slug) ?? []).concat([{ country: 'TW', titleId: p.nsuid }]),
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
      historical_low_twd: p.historicalLowTwd,
      price_countries: 1,
    });
    bySlug.set(p.slug, { id: null, slug: p.slug, title_id: null, is_unnamed: p.isUnnamed });
    counts.gamesCreated += 1;
    pendingRegion.set(p.slug, [{ country: 'TW', titleId: p.nsuid }]);
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

  // ---- 2b. product_type 前綴衝突修正（只改 game／NULL → dlc／bundle）----
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
      toWrite.push({ game_id: gameId, country: r.country, title_id: r.titleId, source: 'import-tw-addons' });
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
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.dryRun) {
    await dryRun(opts);
    return;
  }
  await live(opts);
}

main().catch((err) => {
  console.error(`失敗：${err.message}`);
  process.exit(1);
});
