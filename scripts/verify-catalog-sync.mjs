/**
 * Switch 遊戲比價 — 全自動目錄同步純函式驗算（不連庫、不連網）
 * ============================================================
 * 用法：node scripts/verify-catalog-sync.mjs
 *
 * 做法：先用 npx tsc 把 lib/catalog-sources.ts（零依賴、純函式）編譯到
 *   系統暫存目錄，再以 mock 資料驗算：
 *   1. parseJpXml：TitleInfo 解析、LinkURL 取 NSUID、重複 id 去重、缺 id 跳過
 *   2. parseTwHkRsc：\" 轉義還原後抓 title＋nsuid、重複 nsuid 去重
 *   3. normalizeTitle／extractLatin／slugify／uniqueSlug
 *   4. planCatalogSync：
 *      - JP 條目編號命中已在庫遊戲（＋封面回填）
 *      - JP 新遊戲建檔（slug、publisher＝MakerName、佔位封面規則）
 *      - TW 條目編號命中對照表 → 什麼都不做
 *      - TW 條目標題唯一命中 → 只補編號、不新建遊戲
 *      - TW＋HK 條目掛到同一 JP 新候選（中文標題索引補登，不建成兩款）
 *      - TW-only 新遊戲（title_id 留空、slug 用 tw-<nsuid> 規則）
 *      - 先以 TW-only 進庫的遊戲，JP 清單出現後回填 title_id
 *      - 標題撞名（兩款同名）→ needs_review、不自動合併
 *      - 疑似 DLC 標題 → needs_review、product_type 仍為 game
 *      - 冪等：同一份清單跑兩次，第二次新遊戲 0 款（以第一次產出更新索引模擬）
 *
 * 需求：Node.js 18+、專案已 npm install（用 npx tsc 做一次性編譯）。
 */

import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` —— ${extra}` : ''}`);
  }
}
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- 編譯 lib/catalog-sources.ts（零依賴）到暫存目錄再 import ----
const outDir = mkdtempSync(path.join(tmpdir(), 'catalog-sync-verify-'));
execSync(
  `npx tsc lib/catalog-sources.ts --outDir ${outDir} --module commonjs --target es2022 --skipLibCheck`,
  { cwd: PROJECT_ROOT, stdio: 'pipe' },
);
const lib = await import(path.join(outDir, 'catalog-sources.js'));
const {
  parseJpXml, parseTwHkRsc, normalizeTitle, extractLatin, slugify,
  uniqueSlug, planCatalogSync, kindFromNsuid,
  parseNaAlgoliaHits, parseEuSolrDocs, parseJpSearchItems, parseAuAlgoliaHits,
} = lib;

console.log('[1] parseJpXml');
{
  const xml = `
<TitleInfo><TitleName>ゼルダの伝説 ブレス オブ ザ ワイルド</TitleName>
<MakerName>任天堂</MakerName><SalesDate>2017-03-03</SalesDate><SoftType>pkg_dl</SoftType>
<LinkURL>/titles/70010000000026</LinkURL>
<ScreenshotImgURL>https://example.com/botw.jpg</ScreenshotImgURL></TitleInfo>
<TitleInfo><TitleName>重複條目</TitleName><MakerName>任天堂</MakerName>
<LinkURL>/titles/70010000000026</LinkURL></TitleInfo>
<TitleInfo><TitleName>沒有 LinkURL</TitleName><MakerName>任天堂</MakerName></TitleInfo>
<TitleInfo><TitleName>New Game 新作</TitleName><MakerName>Indie</MakerName>
<LinkURL>/titles/70010000999999</LinkURL></TitleInfo>`;
  const entries = parseJpXml(xml);
  check('解析出 2 筆（重複 id 去重、缺 id 跳過）', entries.length === 2, `得 ${entries.length}`);
  check('第一筆 titleId／maker／cover 正確',
    entries[0].titleId === '70010000000026' && entries[0].maker === '任天堂' &&
    entries[0].coverUrl === 'https://example.com/botw.jpg' && entries[0].country === 'JP');
  check('第二筆是新作', entries[1].titleId === '70010000999999');
}

console.log('[2] parseTwHkRsc');
{
  const rsc = 'x\\"title\\":\\"薩爾達傳說 王國之淚\\",\\"nsuid\\":\\"70010000063713\\"y'
    + '\\"title\\":\\"薩爾達傳說 王國之淚\\",\\"nsuid\\":\\"70010000063713\\"z'
    + '\\"title\\":\\"Hades II\\",\\"nsuid\\":\\"70010000103276\\"';
  const entries = parseTwHkRsc(rsc, 'TW');
  check('解析出 2 筆（重複 nsuid 去重）', entries.length === 2, `得 ${entries.length}`);
  check('中文標題＋nsuid 正確',
    entries[0].title === '薩爾達傳說 王國之淚' && entries[0].titleId === '70010000063713');
  check('拉丁標題正確', entries[1].title === 'Hades II' && entries[1].source === 'tw-list');
}

console.log('[3] 標題工具');
{
  check('normalizeTitle 去標點／空白／大小寫',
    normalizeTitle('薩爾達傳說：王國之淚') === '薩爾達傳說王國之淚' &&
    normalizeTitle('Hades II') === 'hadesii' &&
    normalizeTitle('  A - B_C ') === 'abc');
  check('extractLatin 抽拉丁部分', extractLatin('ゼルダの伝説 (The Legend of Zelda)') === 'The Legend of Zelda');
  check('extractLatin 無拉丁回 null', extractLatin('薩爾達傳說') === null);
  check('extractLatin 括號外無拉丁時看括號內容，括號是日文附註時回 null',
    extractLatin('ゼルダの伝説 ブレス オブ ザ ワイルド (ゼノブレイド3)') === null);
  check('normalizeTitle 先去 ™®©℠ 再 NFKD（Mario Kart™ 8 Deluxe 不會變成 …TM…）',
    normalizeTitle('Mario Kart™ 8 Deluxe') === 'mariokart8deluxe' &&
    normalizeTitle('薩爾達傳說™') === '薩爾達傳說');
  check('slugify', slugify('Hades II') === 'hades-ii' && slugify("It's a Game!") === 'its-a-game');
  const taken = new Set(['hades-ii']);
  check('uniqueSlug 佔用時加 nsuid 末 6 碼',
    uniqueSlug('hades-ii', '70010000103276', taken) === 'hades-ii-103276');
  check('uniqueSlug 未佔用回原 slug', uniqueSlug('new-game', '70010000999999', taken) === 'new-game');
}

console.log('[4] planCatalogSync');
{
  const existingGames = [
    { id: 'g-botw', slug: 'botw', title_id: '70010000000026', title_zh: '薩爾達傳說 曠野之息', title_en: 'The Legend of Zelda: Breath of the Wild', cover_url: null },
    { id: 'g-totk', slug: 'totk', title_id: '70010000063713', title_zh: '薩爾達傳說 王國之淚', title_en: 'The Legend of Zelda: Tears of the Kingdom', cover_url: '/covers/totk.jpg' },
    { id: 'g-stardew', slug: 'stardew', title_id: '70010000005423', title_zh: '星露谷物語', title_en: 'Stardew Valley', cover_url: '/covers/stardew.jpg' },
    { id: 'g-scarlet', slug: 'pokemon-scarlet', title_id: null, title_zh: '寶可夢 朱', title_en: 'Pokemon Scarlet', cover_url: null },
    { id: 'g-violet', slug: 'pokemon-violet', title_id: null, title_zh: '寶可夢 紫', title_en: 'Pokemon Violet', cover_url: null },
    { id: 'g-switch2', slug: 'mk-world-tw', title_id: null, title_zh: '瑪利歐賽車世界', title_en: 'Mario Kart World', cover_url: '/covers/placeholder.svg' },
    // 正向 titleIdFill 案例：日文標題與 JP 條目同文，可唯一命中、回填編號
    { id: 'g-eow', slug: 'eow-jp', title_id: null, title_zh: 'ゼルダの伝説 知恵のかりもの', title_en: 'The Legend of Zelda: Echoes of Wisdom', cover_url: null },
  ];
  const existingRegionIds = [
    { game_id: 'g-totk', country: 'TW', title_id: '70010000063713' },
    { game_id: 'g-switch2', country: 'TW', title_id: '70010000096808' },
  ];
  const results = [
    {
      source: 'jp-xml', country: 'JP', status: 'ok', fetchedAt: '', entries: [
        { titleId: '70010000000026', title: 'ゼルダの伝説 ブレス オブ ザ ワイルド', maker: '任天堂', coverUrl: 'https://example.com/botw.jpg', country: 'JP', source: 'jp-xml' },
        { titleId: '70010000096808', title: 'マリオカートワールド', maker: '任天堂', coverUrl: 'https://example.com/mkw.jpg', country: 'JP', source: 'jp-xml' },
        { titleId: '70010000084617', title: 'ゼルダの伝説 知恵のかりもの', maker: '任天堂', coverUrl: null, country: 'JP', source: 'jp-xml' },
        { titleId: '70010000999999', title: 'New Indie Game 新作', maker: 'Indie Studio', coverUrl: 'https://example.com/new.jpg', country: 'JP', source: 'jp-xml' },
        { titleId: '70010000999998', title: 'Cool DLC Pack 追加包', maker: 'Indie Studio', coverUrl: null, country: 'JP', source: 'jp-xml' },
      ],
    },
    {
      source: 'tw-list', country: 'TW', status: 'ok', fetchedAt: '', entries: [
        { titleId: '70010000063713', title: '薩爾達傳說 王國之淚', country: 'TW', source: 'tw-list' },
        { titleId: '70010000005423', title: '星露谷物語', country: 'TW', source: 'tw-list' },
        { titleId: '70010000999999', title: 'New Indie Game 新作', country: 'TW', source: 'tw-list' },
        { titleId: '70010000111111', title: '寶可夢 朱', country: 'TW', source: 'tw-list' },
        { titleId: '70010000222222', title: '寶可夢 紫', country: 'TW', source: 'tw-list' },
        { titleId: '70010000333333', title: '台灣獨佔新作', country: 'TW', source: 'tw-list' },
      ],
    },
    {
      source: 'hk-list', country: 'HK', status: 'ok', fetchedAt: '', entries: [
        { titleId: '70010000999999', title: 'New Indie Game 新作', country: 'HK', source: 'hk-list' },
        { titleId: '70010000333333', title: '台灣獨佔新作', country: 'HK', source: 'hk-list' },
      ],
    },
  ];
  const plan = planCatalogSync(existingGames, existingRegionIds, results);

  check('JP 編號命中 botw（不建新遊戲）',
    plan.stats.matchedByTitleId === 1, `得 ${plan.stats.matchedByTitleId}`);
  check('botw 封面回填（原為 null）',
    plan.coverFills.some((c) => c.slug === 'botw' && c.cover_url === 'https://example.com/botw.jpg'));
  check('TW 編號已在對照表 → 0 動作',
    plan.stats.matchedByRegionId === 1, `得 ${plan.stats.matchedByRegionId}`);
  check('TW 條目標題唯一命中 stardew → 只補編號',
    plan.regionIdUpserts.some((u) => u.gameSlug === 'stardew' && u.country === 'TW' && u.title_id === '70010000005423'));
  check('JP 新遊戲 2 款（New Indie＋DLC 疑似）',
    plan.stats.newFromJp === 2, `得 ${plan.stats.newFromJp}`);
  check('TW-only 新遊戲 1 款（台灣獨佔新作），HK 條目掛同一款、不重建',
    plan.stats.newFromNonJp === 1 &&
    plan.newGames.filter((g) => g.title_zh === '台灣獨佔新作').length === 1 &&
    plan.regionIdUpserts.filter((u) => u.gameSlug === plan.newGames.find((g) => g.title_zh === '台灣獨佔新作')?.slug).length === 2,
    `newGames：${plan.newGames.map((g) => g.slug).join(',')}`);
  check('TW＋HK 掛到同一 JP 新候選（不建成兩款）',
    plan.newGames.filter((g) => g.slug.includes('new-indie')).length === 1 &&
    plan.regionIdUpserts.filter((u) => u.gameSlug.includes('new-indie')).length === 2,
    `新遊戲：${plan.newGames.map((g) => g.slug).join(',')}；編號：${JSON.stringify(plan.regionIdUpserts.filter((u) => u.gameSlug.includes('new-indie')))}`);
  check('JP 候選的 title_zh 被 TW 中文標題取代',
    plan.newGames.find((g) => g.slug.includes('new-indie'))?.title_zh === 'New Indie Game 新作');
  check('JP 新遊戲 publisher＝MakerName、cover＝ScreenshotImgURL',
    plan.newGames.find((g) => g.slug.includes('new-indie'))?.publisher === 'Indie Studio' &&
    plan.newGames.find((g) => g.slug.includes('new-indie'))?.cover_url === 'https://example.com/new.jpg');
  check('TW-only 新遊戲 title_id 為 null、cover 為佔位圖',
    (() => {
      const g = plan.newGames.find((x) => x.title_zh === '台灣獨佔新作');
      return g?.title_id === null && g?.cover_url === '/covers/placeholder.svg' && g?.genre === null;
    })());
  check('先 TW-only 進庫的瑪利歐賽車世界：片假名標題對不上中文／英文，'
    + '且 JP 編號已是其 TW 編號 → 不建重複遊戲、列入 needs_review',
    plan.needsReview.some((n) => n.title === 'マリオカートワールド' && n.slug === 'mk-world-tw') &&
    !plan.newGames.some((g) => g.title_id === '70010000096808'),
    `needsReview：${JSON.stringify(plan.needsReview.map((n) => n.title))}`);
  check('同文標題唯一命中 → 回填 title_id（智慧的再現）',
    plan.titleIdFills.some((f) => f.slug === 'eow-jp' && f.title_id === '70010000084617'));
  check('寶可夢 朱／紫標題各唯一命中 → 各補 TW 編號',
    plan.regionIdUpserts.some((u) => u.gameSlug === 'pokemon-scarlet' && u.title_id === '70010000111111') &&
    plan.regionIdUpserts.some((u) => u.gameSlug === 'pokemon-violet' && u.title_id === '70010000222222'));

  // 撞名案例：兩款既有遊戲標題正規化後相同，TW 條目不自動合併
  const dupGames = [
    { id: 'g-a', slug: 'same-a', title_id: '70010000000001', title_zh: '同名遊戲', title_en: 'Same Game', cover_url: null },
    { id: 'g-b', slug: 'same-b', title_id: '70010000000002', title_zh: '同名遊戲', title_en: 'Same Game', cover_url: null },
  ];
  const dupPlan = planCatalogSync(dupGames, [], [
    { source: 'tw-list', country: 'TW', status: 'ok', fetchedAt: '', entries: [
      { titleId: '70010000555555', title: '同名遊戲', country: 'TW', source: 'tw-list' },
    ] },
  ]);
  check('標題撞名 → needs_review、不建新遊戲、不掛編號',
    dupPlan.needsReview.length === 1 && dupPlan.newGames.length === 0 && dupPlan.regionIdUpserts.length === 0,
    `needsReview=${dupPlan.needsReview.length}，newGames=${dupPlan.newGames.length}`);
  check('疑似 DLC 標題列入 needs_review、product_type 仍為 game',
    plan.needsReview.some((n) => n.title.includes('追加包')) &&
    plan.newGames.find((g) => g.title_zh.includes('追加包'))?.product_type === 'game');

  // 冪等：把第一次計畫的新遊戲「寫回」既有目錄再跑一次，應 0 新遊戲
  const afterFirst = [
    ...existingGames,
    ...plan.newGames.map((g, i) => ({
      id: `g-new-${i}`, slug: g.slug, title_id: g.title_id,
      title_zh: g.title_zh, title_en: g.title_en, cover_url: g.cover_url,
    })),
  ];
  const afterRegionIds = [
    ...existingRegionIds,
    ...plan.regionIdUpserts
      .filter((u) => u.gameId)
      .map((u) => ({ game_id: u.gameId, country: u.country, title_id: u.title_id })),
    ...plan.regionIdUpserts
      .filter((u) => !u.gameId)
      .map((u, i) => ({ game_id: `g-new-${plan.newGames.findIndex((g) => g.slug === u.gameSlug)}`, country: u.country, title_id: u.title_id })),
  ];
  const plan2 = planCatalogSync(afterFirst, afterRegionIds, results);
  check('冪等：重跑同一份清單，新遊戲 0 款',
    plan2.newGames.length === 0 && plan2.stats.newFromJp === 0 && plan2.stats.newFromNonJp === 0,
    `newGames=${plan2.newGames.length}`);
}

console.log('[5] 完整來源解析器（NA Algolia／EU Solr／JP 搜尋 API／AU Algolia）');
{
  check('kindFromNsuid 前綴：7001 本體、7005 升級包、7007 DLC',
    kindFromNsuid('70010000000025') === 'game' &&
    kindFromNsuid('70050000000001') === 'upgrade' &&
    kindFromNsuid('70070000000001') === 'dlc');
  const na = parseNaAlgoliaHits([
    { title: 'The Legend of Zelda: Breath of the Wild', nsuid: '70010000000025', platform: 'Nintendo Switch' },
    { title: 'Zelda DLC Pack', nsuid: '70070000000001', platform: 'Nintendo Switch' },
    { title: 'Upgrade Pack', nsuid: '70050000000001', platform: 'Nintendo Switch' },
    { title: '重複', nsuid: '70010000000025', platform: 'Nintendo Switch' },
    { title: 'No NSUID', platform: 'Nintendo Switch' },
  ]);
  check('NA：7001 進、7005／7007 標種類、重複與無 nsuid 排除',
    na.length === 3 &&
    na.find((e) => e.titleId === '70010000000025')?.productKind === 'game' &&
    na.find((e) => e.titleId === '70070000000001')?.productKind === 'dlc' &&
    na.find((e) => e.titleId === '70050000000001')?.productKind === 'upgrade',
    `得 ${na.length} 筆`);
  const eu = parseEuSolrDocs([
    { title: 'The Legend of Zelda: Breath of the Wild', nsuid_txt: ['70070000000001', '70010000000023'], product_code_txt: ['HACPAAAAA'], system_names_txt: ['Nintendo Switch'], dates_released_dts: ['2017-03-03T00:00:00Z'] },
    { title: 'Mario Kart World', nsuid_txt: ['70010000096802'], system_names_txt: ['Nintendo Switch 2'] },
    { title: 'Wii U Old Game', nsuid_txt: ['70010000000099'], system_names_txt: ['Wii U'] },
    { title: 'No NSUID', nsuid_txt: [], system_names_txt: ['Nintendo Switch'] },
  ]);
  check('EU：nsuid_txt 取 7001 者、Switch 2 判平台、Wii U 排除、product_code 保留',
    eu.length === 2 &&
    eu[0].titleId === '70010000000023' && eu[0].productCode === 'HACPAAAAA' && eu[0].platform === 'Switch' &&
    eu[1].platform === 'Switch 2' && eu[1].salesDate === null,
    `得 ${eu.length} 筆`);
  const jp = parseJpSearchItems([
    { nsuid: '70010000020841', icode: 'AUSUA', title: 'Hollow Knight: Silksong', ssitu: 'onsale', sdate: '2025-09-04', hard: '1_HAC', id: '12345' },
    { nsuid: '70010000092842', icode: 'XXXXX', title: 'マリオカートワールド', ssitu: 'onsale', sdate: '2025-06-05', hard: '05_BEE', id: '67890' },
    { nsuid: '70010000000001', title: 'DLC 項目', hard: '1_HAC', id: 'abc_def' },
    { nsuid: null, title: '已停售', hard: '1_HAC', id: '111' },
    { nsuid: '70010000000002', title: '非 Switch', hard: '99_XXX', id: '222' },
  ]);
  check('JP 搜尋：絲之歌進、Switch 2 判平台、id 含 _ 跳過、nsuid 空跳過、非 Switch 跳過',
    jp.length === 2 &&
    jp[0].icode === 'AUSUA' && jp[0].platform === 'Switch' &&
    jp[1].platform === 'Switch 2',
    `得 ${jp.length} 筆`);
  const au = parseAuAlgoliaHits([
    { title: 'The Legend of Zelda: Ocarina of Time', nsuid: '70010000130793', objectType: 'game', console: 'Nintendo Switch 2', genre: 'Action-Adventure', date_timestamp: 1780000000 },
    { title: 'amiibo Figure', nsuid: '70010000000001', objectType: 'amiibo', console: 'Nintendo Switch' },
    { title: 'DLC Pack', nsuid: '70070000000001', objectType: 'game', console: 'Nintendo Switch' },
  ]);
  check('AU：只取 objectType=game、genre 保留、date_timestamp 轉發售日、7007 標 DLC',
    au.length === 2 &&
    au[0].genre === 'Action-Adventure' && au[0].salesDate === '2026-05-28' &&
    au[0].platform === 'Switch 2' && au[1].productKind === 'dlc',
    `得 ${au.length} 筆：${JSON.stringify(au.map((e) => e.salesDate))}`);
  // 非遊戲項目不進目錄：NA 7007 條目只計數
  const dlcPlan = planCatalogSync([], [], [
    { source: 'na-algolia', country: 'US', status: 'ok', fetchedAt: '', entries: [
      { titleId: '70070000000001', title: 'Zelda DLC Pack', country: 'US', source: 'na-algolia', productKind: 'dlc' },
      { titleId: '70010000000025', title: 'Breath of the Wild', country: 'US', source: 'na-algolia', productKind: 'game' },
    ] },
  ]);
  check('規劃器跳過 DLC 條目（skippedNonGame＝1）、本體照常進目錄',
    dlcPlan.stats.skippedNonGame === 1 && dlcPlan.newGames.length === 1 &&
    dlcPlan.newGames[0].title_id === null &&
    dlcPlan.regionIdUpserts.some((u) => u.country === 'US' && u.title_id === '70010000000025'),
    `skipped=${dlcPlan.stats.skippedNonGame}，newGames=${dlcPlan.newGames.length}`);
}

console.log('[6] 商店前端價格（NA／JP 已驗證、EU 只記參考價）');
{
  // NA：MKW regularPrice 79.99 USD＝價格 API；特價結束時間戳轉 ISO
  const na = parseNaAlgoliaHits([
    { title: 'Mario Kart World', nsuid: '70010000092843', platform: 'Nintendo Switch 2',
      eshopDetails: { regularPrice: 79.99, discountPrice: 59.99, currency: 'USD',
        discountPriceEndTimestamp: 1790000000, isPurchasable: true, productType: 'TITLE' } },
    { title: 'Zelda DLC', nsuid: '70010000000026', platform: 'Nintendo Switch',
      eshopDetails: { regularPrice: 9.99, currency: 'USD', productType: 'ADD_ON_CONTENT' } },
  ]);
  check('NA eshopDetails：原價／特價／幣別／特價結束日（Unix 秒→ISO）／onSale',
    na[0].storePrice?.regularRaw === 79.99 && na[0].storePrice?.effectiveRaw === 59.99 &&
    na[0].storePrice?.currency === 'USD' && na[0].storePrice?.onSale === true &&
    na[0].storePrice?.saleEnd === new Date(1790000000 * 1000).toISOString(),
    `storePrice：${JSON.stringify(na[0].storePrice)}`);
  check('NA productType ADD_ON_CONTENT → dlc（即使 nsuid 是 7001）',
    na[1].productKind === 'dlc',
    `kind=${na[1].productKind}`);
  // JP：BOTW 7,678＝價格 API；特價例 pprice 4,290→current／sprice 2,574
  const jp = parseJpSearchItems([
    { nsuid: '70010000000026', title: 'ゼルダの伝説 ブレス オブ ザ ワイルド', hard: '1_HAC', id: '1',
      pprice: 7678, dprice: 7678, current_price: 7678, sale_flg: '0', ssitu: 'onsale' },
    { nsuid: '70010000000030', title: '超兄貴 爆烈亂鬥篇', hard: '1_HAC', id: '2',
      pprice: 4290, dprice: 4290, sprice: 2574, current_price: 2574, sale_flg: '1', ssitu: 'onsale' },
    { nsuid: '70010000000031', title: '純 DLC', hard: '1_HAC', id: '3',
      pprice: null, dprice: 199, current_price: 199, sale_flg: '0', ssitu: 'onsale' },
  ]);
  check('JP：原價取 dprice、現價取 current_price、無特價 onSale=false、saleEnd 為 null',
    jp[0].storePrice?.regularRaw === 7678 && jp[0].storePrice?.effectiveRaw === 7678 &&
    jp[0].storePrice?.onSale === false && jp[0].storePrice?.saleEnd === null,
    `storePrice：${JSON.stringify(jp[0].storePrice)}`);
  check('JP 特價：pprice 4,290→current／sprice 2,574、sale_flg=1→onSale=true',
    jp[1].storePrice?.regularRaw === 4290 && jp[1].storePrice?.effectiveRaw === 2574 &&
    jp[1].storePrice?.onSale === true,
    `storePrice：${JSON.stringify(jp[1].storePrice)}`);
  check('JP 純 DLC：pprice null 時原價取 dprice 199',
    jp[2].storePrice?.regularRaw === 199 && jp[2].storePrice?.effectiveRaw === 199,
    `storePrice：${JSON.stringify(jp[2].storePrice)}`);
  // EU：只記參考價、不產生 storePrice
  const eu = parseEuSolrDocs([
    { title: 'I am Setsuna', nsuid_txt: ['70010000000040'], system_names_txt: ['Nintendo Switch'],
      price_regular_f: 29.99, price_lowest_f: 8.99, price_discount_percentage_f: 70 },
  ]);
  check('EU：參考價 regular 29.99／lowest 8.99／-70%、幣別 GBP、無 storePrice',
    eu[0].referencePrice?.regularRaw === 29.99 && eu[0].referencePrice?.effectiveRaw === 8.99 &&
    eu[0].referencePrice?.discountPct === 70 && eu[0].referencePrice?.currency === 'GBP' &&
    eu[0].storePrice == null,
    `referencePrice：${JSON.stringify(eu[0].referencePrice)}`);
  // 規劃器分流：JP／NA 新遊戲進 storefrontPrices，EU 新遊戲進 referencePrices
  const mixPlan = planCatalogSync([], [], [
    { source: 'jp-search', country: 'JP', status: 'ok', fetchedAt: '', entries: [
      { titleId: '70010000000026', title: 'ゼルダの伝説 ブレス オブ ザ ワイルド', country: 'JP', source: 'jp-search',
        storePrice: { regularRaw: 7678, effectiveRaw: 7678, currency: 'JPY', saleEnd: null, onSale: false } },
    ] },
    { source: 'na-algolia', country: 'US', status: 'ok', fetchedAt: '', entries: [
      { titleId: '70010000092843', title: 'Mario Kart World', country: 'US', source: 'na-algolia',
        storePrice: { regularRaw: 79.99, effectiveRaw: 59.99, currency: 'USD', saleEnd: '2026-06-30T00:00:00.000Z', onSale: true } },
    ] },
    { source: 'eu-solr', country: 'GB', status: 'ok', fetchedAt: '', entries: [
      { titleId: '70010000000040', title: 'I am Setsuna', country: 'GB', source: 'eu-solr',
        referencePrice: { regularRaw: 29.99, effectiveRaw: 8.99, discountPct: 70, currency: 'GBP' } },
    ] },
  ]);
  check('規劃器：JP／NA 新遊戲進 storefrontPrices（含 saleEnd／onSale）、EU 進 referencePrices、不混進 storefrontPrices',
    mixPlan.storefrontPrices.length === 2 &&
    mixPlan.storefrontPrices.some((s) => s.country === 'JP' && s.effectiveRaw === 7678) &&
    mixPlan.storefrontPrices.some((s) => s.country === 'US' && s.effectiveRaw === 59.99 && s.onSale === true) &&
    mixPlan.referencePrices.length === 1 && mixPlan.referencePrices[0].country === 'GB' &&
    !mixPlan.storefrontPrices.some((s) => s.country === 'GB'),
    `storefront=${mixPlan.storefrontPrices.length}，reference=${mixPlan.referencePrices.length}`);
}

console.log(`\n完成：通過 ${passed} 項，失敗 ${failed} 項。`);
if (failed > 0) process.exit(1);
