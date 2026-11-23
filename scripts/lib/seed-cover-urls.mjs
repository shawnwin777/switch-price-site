/**
 * 種子 32 款遊戲的官方封面遠端網址對照表。
 *
 * 背景：public/covers/ 下的 32 張 *.jpg 是 2026-11-15/16 期間從官方
 * 來源下載、縮圖（寬 1280／1240）再 JPEG q85 重新編碼後重託管在本
 * 站的官方 key art（見 DATA_NOTES.md §6）。2026-11-23 稽核確認後，
 * 封面改為直接連官方 CDN，不再自架圖片；本表是唯一的對照來源。
 *
 * 驗證（2026-11-23，見稽核回報）：
 *  - 來源 A（26 款）：日本 eShop 清單 switch.xml 的 ScreenshotImgURL
 *   （img-eshop.cdn.nintendo.net，1920x1080 原圖）。逐張下載原圖與
 *    本站舊檔做 dHash 比對，26/26 Hamming 距離 0～1／256，全數相符。
 *  - 來源 B（6 款）：美國任天堂商店商品頁圖庫第 1 張
 *    （assets.nintendo.com）。mk-world、dk-bananza、silksong 與現行
 *    圖庫圖 dHash 距離 0～4；hades2、pokemon-za 為同一主視覺的舊版
 *    本（現行圖庫圖多了／少了獎項緞帶與 Switch 2 Edition 標籤，目視
 *    確認同構圖）；ring-fit 為舊版商品頁首圖，dHash 距離 7。
 *    本表取 w_1240 固定寬度版本（1240x698，與舊檔尺寸一致）。
 *  - NSUID 是分區的：美版商店頁的 NSUID（如 mk-world 70010000095431）
 *    與 data/title-ids.json 的港版 NSUID 不同，屬正常；封面網址只認
 *    圖片雜湊，不認 NSUID。
 *
 * 使用處：scripts/fix-seed-covers.mjs（把 DB cover_url 從 /covers/ 改
 * 為本表網址）、scripts/seed.mjs、scripts/build-expanded-catalog.mjs
 *（重跑時不再寫入 /covers/ 路徑）。新增遊戲不要用本表，封面一律走
 * 任天堂 CDN 或 IGDB 遠端網址，不要下載進 public/covers/。
 */

export const SEED_COVER_URLS = {
  'acnh': 'https://img-eshop.cdn.nintendo.net/i/e607c120cab2c59c5ebb491deaa1095e750ad795e8e1129c8f4f4f5bdefc6a92.jpg',
  'balatro': 'https://img-eshop.cdn.nintendo.net/i/d0e1e8cc1f43d815b1a65723cf3d41ca85d06a9fabb0009026dfed76cbf78b00.jpg',
  'botw': 'https://img-eshop.cdn.nintendo.net/i/66a1e231272eb0241d0aa0a81f9eb0416e9bd5b205759caaac71220aebdc3a84.jpg',
  'celeste': 'https://img-eshop.cdn.nintendo.net/i/691ba3e0801180a9864cc8a7694b6f98097f9d9799bc7e3dc6db92f086759252.jpg',
  'dave-diver': 'https://img-eshop.cdn.nintendo.net/i/e77cbe3c83da8de952bce5bc0f0960092dbc2e08d377f0e082673239322301bb.jpg',
  'dead-cells': 'https://img-eshop.cdn.nintendo.net/i/8159de779f7d1e70a663dc226bf022bd7c7667bd587e238fe29554fdb966deaf.jpg',
  'dk-bananza': 'https://assets.nintendo.com/image/upload/ar_16:9,c_lpad,w_1240/b_white/f_auto/q_auto/store/software/switch2/70010000096809/3c8219fbdcd3bdd0ebd6239cf32c651fe10f2157aa7730fcc6a7d96cd27460e5',
  'fire-emblem-3h': 'https://img-eshop.cdn.nintendo.net/i/32234a4cfdde88d30afb9147abf6c30933cd42259363e4950831332a9398213c.jpg',
  'hades': 'https://img-eshop.cdn.nintendo.net/i/dbc8c55a21688b446a5c57711b726956483a14ef8c5ddb861f897c0595ccb6b5.jpg',
  'hades2': 'https://assets.nintendo.com/image/upload/ar_16:9,c_lpad,w_1240/b_white/f_auto/q_auto/store/software/switch/70010000060675/a9a30b2adb707f5922eb2a845f821c99516a69e023751491b10584ac1352462f',
  'hollow-knight': 'https://img-eshop.cdn.nintendo.net/i/4643fb058642335c523910f3a7910575f56372f612f7c0c9a497aaae978d3e51.jpg',
  'it-takes-two': 'https://img-eshop.cdn.nintendo.net/i/e7200824041808289d4a65589ed368f7e08dc2e538a5fd7ee9f8d39e58015c24.jpg',
  'kirby-fl': 'https://img-eshop.cdn.nintendo.net/i/70d985e5ca0536e23ed2eba589446234ea607a9f2f98d78db2c931db5a7a3a1f.jpg',
  'luigi3': 'https://img-eshop.cdn.nintendo.net/i/fab95c00a7f0634a4316bf981dc4dff05cd6c8c47c887196bb642daaaffba4c5.jpg',
  'mario-odyssey': 'https://img-eshop.cdn.nintendo.net/i/155fc615dfb2fd8702542916b57f6bdd6c0ab5a103f44f7d84a7aacd2c4f222e.jpg',
  'mario-party-j': 'https://img-eshop.cdn.nintendo.net/i/2a23faa1822c06adf074c8bb2ccf5f46a23490b3fe267e176e0b5339d0e1d3b7.jpg',
  'mario-wonder': 'https://img-eshop.cdn.nintendo.net/i/c2ca89f80c33548e972dbba1dd0a3e3279c56a33b81fa426499f66cad7a4c2b2.jpg',
  'mk-world': 'https://assets.nintendo.com/image/upload/ar_16:9,c_lpad,w_1240/b_white/f_auto/q_auto/store/software/switch2/70010000095431/0485f410193ca12f92a2f615ea608bb437540f321bd05e464593c33fefa09bf2',
  'mk8dx': 'https://img-eshop.cdn.nintendo.net/i/e681f02b84dd9f7207b2b00ec7803e39d242141af0fb681f0d27f2d824898373.jpg',
  'octopath2': 'https://img-eshop.cdn.nintendo.net/i/1e6e0b547a00e768e9c67263fedd6c34be54521169b7eb597892767bc72113b4.jpg',
  'persona5r': 'https://img-eshop.cdn.nintendo.net/i/206a3b6840d9f5a709db879bdf003de07b184b8065473a0447eb2ed3b350fee7.jpg',
  'pokemon-sv': 'https://img-eshop.cdn.nintendo.net/i/59fe0390ab27f918e42bbc703ff68be65e547ae2003529142324243059255674.jpg',
  'pokemon-za': 'https://assets.nintendo.com/image/upload/ar_16:9,c_lpad,w_1240/b_white/f_auto/q_auto/store/software/switch2/70010000099365/80e1e26cdb1dd973909009e8c5bd457b01c9a57236ba6161d5e158f1357526f9',
  'ring-fit': 'https://assets.nintendo.com/image/upload/ar_16:9,c_lpad,w_1240/b_white/f_auto/q_auto/ncom/en_US/products/games/switch/ring-fit-adventure/110583-switch-ring-fit-adventure-1200x675',
  'silksong': 'https://assets.nintendo.com/image/upload/ar_16:9,c_lpad,w_1240/b_white/f_auto/q_auto/store/software/switch/70010000020840/60eebc8f7133f685eddbffbe43c8da617ba0a5d699f2008f9c31c6119d1792af',
  'smash': 'https://img-eshop.cdn.nintendo.net/i/24d750a5c901181f24d2f248fff70a9ed93d632d8591e91e7df69d515a388a87.jpg',
  'splatoon3': 'https://img-eshop.cdn.nintendo.net/i/be6eb6c8e642eb104ab329de6fb840c0ba27106659d4c1ba054a38208f3200aa.jpg',
  'stardew': 'https://img-eshop.cdn.nintendo.net/i/7aa9c6cf5e7d4cecf481f18b1d7a9d79e7aab85045b22203effb2dda409bc5b7.jpg',
  'totk': 'https://img-eshop.cdn.nintendo.net/i/1a637778f3ea270ca6ff053d0204073e555575099e82cb018ddb1877be0a0fde.jpg',
  'undertale': 'https://img-eshop.cdn.nintendo.net/i/44bea8c565db26c0c470a6325a47c9ea031633945cb91e4b5e1b1a39b01a2cdb.jpg',
  'xenoblade3': 'https://img-eshop.cdn.nintendo.net/i/b9ef520dc0b5c3a8a7f53d490b315e1b9ba48a7009856d12cc70c1e1320e94c4.jpg',
  'zelda-eow': 'https://img-eshop.cdn.nintendo.net/i/4adaa29bd7ea465f8b4fbe656aec2697817a0db3faec4554617363ef81335c99.jpg',
};

