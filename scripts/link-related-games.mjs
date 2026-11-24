/**
 * Switch 遊戲比價 — DLC／組合包連結＋同名雙版本配對回填腳本
 * ============================================================
 * 把 product_type=dlc／bundle 的 games 列連結到本體遊戲
 * （product_type=game），以及把同名雙版本主程式（Switch／Switch 2、
 * 如 Witcher 3 Complete Edition ↔ Remastered）配對成 edition，
 * 寫進 public.game_relations（migration
 * supabase/migrations/20261124_add_game_relations.sql，需先跑）。
 *
 * 連結方法（完整說明見 docs/link-related-games-20261124.md；此檔的規則
 * 與該文件一致，改規則時兩邊要同步）：
 *   正規化：先去 ®™©（要在 NFKC 之前，否則 ™ 會變成 "TM"），NFKC
 *   全半形統一、小寫、標點轉空白、羅馬數字轉阿拉伯數字（II→2、IV→4，
 *   讓 "Bare Knuckle IV" 對上 "Bare Knuckle 4"）。
 *   候選標題：title_zh 為主；title_en 只有在「不是 title_zh 的子字串」
 *   時才加入（排除 "LEGO"、"DX"、"Nintendo Switch" 這類殘缺英文名）。
 *   依序嘗試：exact → 多遊戲組合包（A＋B／A＆B／《A》《B》）→
 *   （X專用）→ 冒號／破折號切分（"GAME: DLC名"、"GAME - DLC名"）→
 *   《本體》括號基底 → 最長 token 前綴（＋前綴是遊戲標題開頭的反向情況，
 *   如 "Formula Racing Pro 2026" < "Formula Racing Pro 2026 職業方程式賽車 2026"）
 *   → 字元前綴（中文無空格黏合，如 雷納提斯解放者版）→ 反向前綴
 *   （語言包 core 是遊戲標題開頭，如 霍格華茲的傳承 < 霍格華茲的傳承 Hogwarts Legacy）。
 *   接受條件：餘部含 DLC 標記（季票／擴充／豪華版／組合包／DLC／版／plus／
 *   prologue／uniform…）或父標題夠長且是最長唯一匹配；餘部以續作數字
 *   開頭（"2 DLC"、"3 …"）一律拒絕，避免把 2 代 DLC 連到 1 代。
 *   語言包／升級通行證先把後綴剝掉再比對（"Nintendo Switch 2 Edition
 *   升級通行證" 截斷到 Edition 之前；"xxx Language Pack"／"語言包"同理）。
 *   多遊戲組合包（三部曲合輯／trilogy collection）不連單一本體。
 *
 * 量測（2026-11-24，母體為庫內具名 DLC／組合包 3,498 筆，見上述文件）：
 *   匹配 1,680 筆（48.0%），其中人工抽查 60 筆全對、另 40 筆驗證全對；
 *   語言包 31 筆連上 30 筆（唯一漏的是邊緣禁地 3——庫裡沒有該本體列）；
 *   拒絕／未連 1,818 筆抽查 42 筆皆正確拒絕或確實無法從標題判斷。
 *   寫入列數：DLC／組合包關係約 2,381 列（含重複上架列）＋ edition 約
 *   1,000 列上下（依當時庫內資料而定）。
 *
 * 用法（在專案根目錄 ~/workspace/switch-price-site/ 執行）：
 *
 *   node scripts/link-related-games.mjs --dry-run
 *     只讀不寫：印出預計寫入的筆數與方法分布，並寫出
 *     data/game-relations-20261124.json（連結資料檔）。
 *     讀取可用 anon key（NEXT_PUBLIC_SUPABASE_ANON_KEY）或 service role key。
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
 *   node scripts/link-related-games.mjs --apply
 *     正式寫入 game_relations（冪等：重跑只更新、不重複建檔）。
 *     寫入前 migration 必須已跑（否則 upsert 會 404／PGRST205）。
 *
 *   加上 --prune 可同時清掉本次運算已不存在的舊連結
 *   （只清 source='link-related-games' 的列，手動補的列不受影響）。
 *
 *   額外可用 --emit <路徑> 指定連結資料檔輸出位置（預設
 *   data/game-relations-20261124.json）。
 *
 * 輸入：
 *   - Supabase games 全表（id／slug／title_zh／title_en／product_type／
 *     platform／is_unnamed，分頁讀取）。
 *   - public/data/tw-addons.json（僅對照：裡面有、庫裡還沒有的 nsuid
 *     會印出「尚未匯入」筆數，不會因此建檔；先跑
 *     scripts/import-tw-addons.mjs 再跑本腳本）。
 *
 * 連線：只用環境變數 NEXT_PUBLIC_SUPABASE_URL、
 *       SUPABASE_SERVICE_ROLE_KEY（寫入用）／NEXT_PUBLIC_SUPABASE_ANON_KEY
 *       （dry-run 讀取用；沒有 service key 時才用），不讀 .env.local、
 *       不把 key 寫進檔案。Service Role Key 會繞過 RLS，請只在伺服器端／
 *       本機執行，不要放進前端程式碼或公開倉庫。
 *
 * 需求：Node.js 18+（使用內建 fetch，不需安裝任何套件）。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const READ_KEY = SERVICE_ROLE_KEY || ANON_KEY;

const ADDONS_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'tw-addons.json');
const DEFAULT_EMIT = path.join(PROJECT_ROOT, 'data', 'game-relations-20261124.json');

const BATCH_UPSERT = 500;
const BATCH_DELETE = 100;

function parseArgs(argv) {
  const out = { apply: false, prune: false, emit: DEFAULT_EMIT, input: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.apply = false;
    else if (a === '--apply') out.apply = true;
    else if (a === '--prune') out.prune = true;
    else if (a === '--emit') out.emit = path.resolve(argv[++i]);
    else if (!a.startsWith('--')) out.input = path.resolve(a);
    else throw new Error(`未知參數：${a}（可用：--dry-run／--apply／--prune／--emit <路徑>）`);
  }
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ============================================================================
// 正規化與比對規則（與 docs/link-related-games-20261124.md 一致）
// ============================================================================

const PUNCT_RE = /[《》「」『』<>\[\]\(\)（）:：\-–—―/\\|"'’‘`.,，、·・~!！?？。♡#＃*＊]/g;
const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9' };

function norm(s) {
  if (s == null) return '';
  // 先去商標符號：NFKC 會把 ™ 變成 "TM"，一定要在 normalize 之前去掉。
  let t = String(s).replace(/[®™©]/g, '');
  t = t.normalize('NFKC').toLowerCase();
  t = t.replace(PUNCT_RE, ' ');
  t = t.replace(/\+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  // 羅馬數字轉阿拉伯數字（整個 token 才換；"X"、"I" 不動）。
  return t.split(' ').map((tok) => ROMAN[tok] ?? tok).join(' ');
}

function stripParens(s) {
  return (s ?? '').replace(/\([^)]*\)|（[^）]*）/g, ' ');
}

function hasCjk(s) {
  return /[\u4e00-\u9fff\u3040-\u30ff]/.test(s ?? '');
}

const UPG_RE = /nintendo\s+switch\s*2\s+edition.*?(升級通行證|upgrade\s*pack)\s*$/;
const LANG_WORDS =
  '(?:german|spanish|french|italian|japanese|portuguese|korean|chinese|dutch|polish|russian|english|德文|西班牙文|法文|義大利文|日文|葡萄牙文|韓文|中文|荷蘭文|波蘭文|俄文|英文)';

/** 孩子標題 → [core, kind]；kind: language_pack／upgrade_pass／plain。 */
function childCore(title) {
  const t = title ?? '';
  const m = t.match(/^\s*《([^》]+)》\s*(?:[:：]?\s*)?(.*)$/);
  if (m && /語言包|language\s*pack/i.test(m[2])) {
    return [norm(m[1]), 'language_pack'];
  }
  // 升級通行證：先試括號去掉的版本（"潛水員戴夫 (DAVE THE DIVER) …升級通行證"），
  // 再試原標題；截斷點在 "Nintendo Switch 2 Edition"，後面的 "+ XXX" 也一併去掉。
  let n = norm(stripParens(t));
  let mm = UPG_RE.exec(n);
  if (mm) return [n.slice(0, mm.index).trim(), 'upgrade_pass'];
  n = norm(t);
  mm = UPG_RE.exec(n);
  if (mm) return [n.slice(0, mm.index).trim(), 'upgrade_pass'];
  if (/language\s*pack\s*$/.test(n)) {
    let head = n.replace(/language\s*pack\s*$/, '').trim();
    head = head.replace(new RegExp(`\\s+${LANG_WORDS}\\s*(\\([^)]*\\))?\\s*$`), '').trim();
    return [head, 'language_pack'];
  }
  if (n.includes('語言包') || n.includes('額外語音語言')) {
    let head = n.split(/語言包|額外語音語言/)[0];
    head = head.replace(/[:：]?\s*[^\s]*?(?:文|語)\s*$/, '').trim();
    return [head, 'language_pack'];
  }
  return [n, 'plain'];
}

function bracketBase(title) {
  const m = (title ?? '').match(/^\s*《([^》]+)》\s*[-–—:：]?\s*.+$/);
  return m ? norm(m[1]) : null;
}

const DLC_MARKERS = [
  'season pass', 'expansion pass', 'dlc', 'pack', 'bundle', 'deluxe', 'edition', 'pass',
  '追加', '擴充', '擴展', '內容包', '服裝', '造型', '樂曲', '組合包', '豪華版', '升級包',
  '升級通行證', '數位豪華版', '故事', '劇情', '關卡', '角色', '人物包', '語言包',
  '主題', '季票', '通行證', '外傳', '特典', '服裝包', '音樂包', '地圖包', '武器包',
  '包', '套組', '章節', '篇', '版', 'plus', 'prologue', '序章', '終極版', '完全版',
  '決定版', '重製版', '紀念版', 'uniform', '制服', 'collection',
];
const SEQUEL_TOKENS = new Set(['2', '3', '4', '5', '6', 'ii', 'iii', 'iv', 'v', '2nd', '3rd']);

function remainderHasMarker(rem) {
  return DLC_MARKERS.some((mk) => rem.includes(mk));
}

/** 餘部以續作數字開頭且緊接著標記（"2 dlc"）或只有數字本身 → 疑似續作，拒絕。 */
function isSequelRemainder(rem) {
  const toks = rem ? rem.split(' ') : [];
  if (!toks.length || !SEQUEL_TOKENS.has(toks[0])) return false;
  if (toks.length === 1) return true;
  if (DLC_MARKERS.includes(toks[1])) return true;
  return false;
}

/** 前綴候選的接受條件。回傳 [ok, reason]。 */
function acceptPrefix(cand, rem, secondLen = 0) {
  const toks = rem ? rem.split(' ') : [];
  // 多遊戲組合包守門：餘部是「三部曲合輯／trilogy collection」表示內含多款遊戲，
  // 不連單一本體。（DLC 名稱裡提到某三部曲，如跨界合作，不在此限。）
  if (
    (rem.includes('三部曲') || rem.includes('trilogy')) &&
    (rem.includes('合輯') || rem.includes('合集') || rem.includes('collection'))
  ) {
    return [false, 'multi-game'];
  }
  if (remainderHasMarker(rem)) {
    if (toks.length > 1 && SEQUEL_TOKENS.has(toks[0]) && DLC_MARKERS.includes(toks[1])) {
      return [false, 'sequel'];
    }
    return [true, 'prefix-marker'];
  }
  if (toks.length && SEQUEL_TOKENS.has(toks[0])) return [false, 'sequel'];
  if (hasCjk(cand) && cand.length >= 6 && cand.length - secondLen >= 2) {
    return [true, 'prefix-long-cjk'];
  }
  if (!hasCjk(cand) && cand.length >= 8 && cand.length - secondLen >= 2) {
    return [true, 'prefix-long'];
  }
  if (hasCjk(cand) && cand.length >= 5 && toks.length === 1) {
    return [true, 'prefix-short-cjk'];
  }
  return [false, 'no-marker-short'];
}

/** 本體標題索引：exact（norm → slugs）＋前綴索引（leading token 子序列 → 完整標題）。 */
function buildGameIndex(games) {
  const gameByNorm = new Map(); // norm -> Set<slug>
  const prefixIndex = new Map(); // leading token-subsequence -> Set<full norm>
  const add = (n, slug) => {
    if (!n) return;
    if (!gameByNorm.has(n)) gameByNorm.set(n, new Set());
    gameByNorm.get(n).add(slug);
    const toks = n.split(' ');
    for (let k = 1; k < toks.length; k++) {
      const sub = toks.slice(0, k).join(' ');
      if (!prefixIndex.has(sub)) prefixIndex.set(sub, new Set());
      prefixIndex.get(sub).add(n);
    }
  };
  for (const g of games) {
    if (g.product_type !== 'game' || g.is_unnamed) continue;
    const nzh = norm(g.title_zh);
    add(nzh, g.slug);
    add(norm(stripParens(g.title_zh)), g.slug);
    const nen = norm(g.title_en);
    // 英文名只有在「不是中文名的子字串」時才加入：排除 "LEGO"、"DX"、
    // "Nintendo Switch" 這類殘缺英文名（它是中文名裡的一小段）。
    if (nen && nen !== nzh && !nzh.includes(nen) && nen.length >= 3) {
      add(nen, g.slug);
      add(norm(stripParens(g.title_en)), g.slug);
      // 中英併寫（遊戲標題帶別名，如 雙人成行 It Takes Two）。
      add(`${nzh} ${nen}`, g.slug);
      add(`${nen} ${nzh}`, g.slug);
    }
  }
  return { gameByNorm, prefixIndex };
}

// ============================================================================
// 配對主程式
// ============================================================================

function splitHeads(title) {
  const t = title ?? '';
  const out = []; // [kind, headNorm]，最長的在前
  const bm = t.match(/^\s*《([^》]+)》/);
  if (bm) out.push(['bracket', norm(bm[1])]);
  for (let i = 0; i < t.length; i++) {
    if (':：-–—'.includes(t[i])) {
      const head = norm(t.slice(0, i));
      if (head.length >= 3) out.push(['split', head]);
    }
  }
  for (let i = 0; i < t.length; i++) {
    if ('＋+'.includes(t[i])) {
      const head = norm(t.slice(0, i));
      if (head.length >= 3) out.push(['plus', head]);
    }
  }
  const seen = new Set();
  const res = [];
  for (const [kind, h] of out.sort((a, b) => b[1].length - a[1].length)) {
    if (!seen.has(h)) {
      seen.add(h);
      res.push([kind, h]);
    }
  }
  return res;
}

/** 把組合包的一個部分對到一款遊戲：exact／token 前綴／部分是遊戲標題開頭。 */
function matchPartToGame(part, gameByNorm, prefixIndex) {
  const p = norm(part);
  if (!p) return null;
  if (gameByNorm.has(p)) return [p, [...gameByNorm.get(p)].sort()];
  const toks = p.split(' ');
  for (let k = toks.length - 1; k >= 1; k--) {
    const cand = toks.slice(0, k).join(' ');
    if (gameByNorm.has(cand)) return [cand, [...gameByNorm.get(cand)].sort()];
  }
  for (let k = toks.length; k >= 1; k--) {
    const cand = toks.slice(0, k).join(' ');
    if (prefixIndex.has(cand)) {
      const fulls = [...prefixIndex.get(cand)].sort((a, b) => a.length - b.length);
      const longEnough =
        (toks.slice(0, k).length >= 2 && cand.length >= 8) ||
        (hasCjk(cand) && cand.length >= 4);
      if (
        longEnough &&
        fulls.length <= 5 &&
        (fulls.length === 1 || fulls[1].length - fulls[0].length >= 3)
      ) {
        return [fulls[0], [...gameByNorm.get(fulls[0])].sort()];
      }
    }
  }
  return null;
}

/** 多遊戲組合包："A＋B"／"A＆B"／"《A》《B》"，兩個以上的部分都是遊戲才成立。 */
function matchMultiSplit(title, gameByNorm, prefixIndex) {
  const t = title ?? '';
  const brackets = [...t.matchAll(/《([^》]+)》/g)].map((m) => m[1]);
  let parts;
  let isBracketForm = false;
  if (brackets.length >= 2) {
    parts = brackets;
    isBracketForm = true;
  } else {
    // 先拿掉 《...》 再切 &：引號裡的 & 是 DLC 名稱的一部分
    //（如《Raining Cats & Dog》），不是兩個遊戲。
    const noBracket = t.replace(/《[^》]*》/g, ' ');
    parts = noBracket.split(/[＋+&＆]/);
    if (parts.length < 2) return null;
    // "&"／"+" 分支：第一部分必須（幾乎）就是一款遊戲，否則 & 接的是
    // DLC 內容（如 "MARVEL Cosmic Invasion - Cyclops & The Thing"
    // 是兩個角色，不是兩個遊戲）。
    const first = parts[0]
      .replace(/(組合包|同捆包|bundle|豪華版|deluxe edition|特別版|complete edition)\s*$/i, '')
      .trim();
    const fn = norm(first);
    if (!gameByNorm.has(fn) && !prefixIndex.has(fn)) return null;
  }
  const matched = [];
  const seenSlugs = new Set();
  let partsMatched = 0;
  for (let part of parts) {
    part = part
      .replace(/(組合包|同捆包|bundle|豪華版|deluxe edition|特別版|complete edition)\s*$/i, '')
      .trim();
    const r = matchPartToGame(part, gameByNorm, prefixIndex);
    if (r) {
      partsMatched++;
      for (const s of r[1]) {
        if (!seenSlugs.has(s)) {
          seenSlugs.add(s);
          matched.push(s);
        }
      }
    }
  }
  if (partsMatched >= 2) return ['multi', 'MULTI', matched];
  return null;
}

/** 孩子 → [core, kind, match|null]；match = [method, parentNorm, parentSlugs]。 */
function matchChild(title, gameByNorm, prefixIndex) {
  const [core, kind] = childCore(title);
  if (!core) return [core, kind, null];
  // 0. exact（含中英併寫的 norm）
  if (gameByNorm.has(core)) {
    return [core, kind, ['exact', core, [...gameByNorm.get(core)].sort()]];
  }
  // 0a. 多遊戲組合包
  const multi = matchMultiSplit(title, gameByNorm, prefixIndex);
  if (multi) return [core, kind, multi];
  // 0b. 括號裡的 "（X專用）"／"(for X)"：X 就是本體
  for (const pm of (title ?? '').matchAll(/[(（]([^)）]*)[)）]/g)) {
    const seg = pm[1].trim();
    let segGame = seg.replace(/專用\s*$/, '').trim();
    segGame = segGame.replace(/^for\s+/i, '').trim();
    if (segGame && segGame !== seg) {
      const sg = norm(segGame);
      if (sg && gameByNorm.has(sg)) {
        return [core, kind, ['paren-for', sg, [...gameByNorm.get(sg)].sort()]];
      }
      if (sg) {
        const cands = [...gameByNorm.keys()].filter((n) => n.startsWith(`${sg} `));
        if (cands.length) {
          const best = cands.sort((a, b) => a.length - b.length)[0];
          return [core, kind, ['paren-for-reverse', best, [...gameByNorm.get(best)].sort()]];
        }
      }
    }
  }
  // 1. 冒號／破折號／加號切分（括號優先：先取 《X》 當 head）
  for (const [sk, head] of splitHeads(title)) {
    if (gameByNorm.has(head)) {
      if (sk === 'plus') {
        return [core, kind, ['plus', head, [...gameByNorm.get(head)].sort()]];
      }
      // 切分精確命中："GAME: DLC名"／"GAME - DLC名" 直接點名本體，
      // 只有餘部是續作數字時才拒絕（"GAME: 2 …"）。
      if (core === head) {
        return [core, kind, ['split', head, [...gameByNorm.get(head)].sort()]];
      }
      if (core.startsWith(`${head} `)) {
        const rem = core.slice(head.length + 1);
        if (!isSequelRemainder(rem)) {
          return [core, kind, ['split', head, [...gameByNorm.get(head)].sort()]];
        }
      }
      continue;
    }
    // head 是某款遊戲標題的開頭（如 "Fitness Boxing 3" < "Fitness Boxing 3: Your Personal Trainer"）
    const cands = prefixIndex.get(head);
    if (cands) {
      const fulls = [...cands].sort((a, b) => a.length - b.length);
      const headOk =
        head.split(' ').length >= 2 || head.length >= 8 || (hasCjk(head) && head.length >= 4);
      if (!headOk) {
        // 單 token 短 head（如 "sega"）太模糊，跳過
      } else if (fulls.length > 5 || (fulls.length > 1 && fulls[1].length - fulls[0].length < 3)) {
        // 好幾款遊戲共用這個開頭，無法判斷是哪一款
      } else {
        const best = fulls[0];
        if (sk === 'plus') {
          return [core, kind, ['plus-reverse', best, [...gameByNorm.get(best)].sort()]];
        }
        if (core === best || core.startsWith(`${best} `)) {
          const rem = core === best ? '' : core.slice(best.length + 1);
          const [ok, why] = acceptPrefix(best, rem);
          if (ok) {
            return [core, kind, [`split-reverse-${why}`, best, [...gameByNorm.get(best)].sort()]];
          }
        }
      }
    }
  }
  // 2. 《本體》括號基底
  const bb = bracketBase(title);
  if (bb) {
    if (gameByNorm.has(bb)) {
      return [core, kind, ['bracket', bb, [...gameByNorm.get(bb)].sort()]];
    }
    const toks = bb.split(' ');
    for (let k = toks.length - 1; k >= 1; k--) {
      const cand = toks.slice(0, k).join(' ');
      if (gameByNorm.has(cand)) {
        const [ok] = acceptPrefix(cand, toks.slice(k).join(' '));
        if (ok) return [core, kind, ['bracket-prefix', cand, [...gameByNorm.get(cand)].sort()]];
        break;
      }
    }
  }
  // 3. 最長 token 前綴（＋前綴是遊戲標題開頭的反向情況），取最長候選
  {
    const toks = core.split(' ');
    let best = null; // [candLen, candNorm, rem]
    for (let k = toks.length - 1; k >= 1; k--) {
      const cand = toks.slice(0, k).join(' ');
      const rem = toks.slice(k).join(' ');
      if (gameByNorm.has(cand)) {
        best = [cand.length, cand, rem];
        break;
      }
      if (prefixIndex.has(cand)) {
        const fulls = [...prefixIndex.get(cand)].sort((a, b) => a.length - b.length);
        const longEnough =
          (toks.slice(0, k).length >= 2 && cand.length >= 8) ||
          (hasCjk(cand) && cand.length >= 4);
        if (
          longEnough &&
          fulls.length <= 5 &&
          (fulls.length === 1 || fulls[1].length - fulls[0].length >= 3)
        ) {
          best = [cand.length, fulls[0], rem];
          break;
        }
      }
    }
    if (best) {
      const [, cand, rem] = best;
      let secondLen = 0;
      for (let k2 = toks.length - 1; k2 >= 1; k2--) {
        const c2 = toks.slice(0, k2).join(' ');
        if (c2.length < cand.length && (gameByNorm.has(c2) || prefixIndex.has(c2))) {
          secondLen = c2.length;
          break;
        }
      }
      const [ok, why] = acceptPrefix(cand, rem, secondLen);
      if (ok) return [core, kind, [why, cand, [...gameByNorm.get(cand)].sort()]];
      return [core, kind, ['REJECT', cand, [...gameByNorm.get(cand)].sort()]];
    }
  }
  // 4. 字元前綴（中文無空格黏合，如 雷納提斯解放者版）
  for (let k = core.length - 1; k > 3; k--) {
    const cand = core.slice(0, k);
    if (gameByNorm.has(cand)) {
      const rem = core.slice(k).trim();
      const [ok, why] = acceptPrefix(cand, rem);
      if (ok) return [core, kind, [`char-${why}`, cand, [...gameByNorm.get(cand)].sort()]];
      return [core, kind, ['REJECT', cand, [...gameByNorm.get(cand)].sort()]];
    }
  }
  // 5. 反向前綴（遊戲標題以 core 開頭；只用在語言包／升級通行證，或 core 很長時）
  if ((kind === 'language_pack' || kind === 'upgrade_pass') && core.length >= 6 || core.length >= 12) {
    const cands = [...gameByNorm.keys()].filter((n) => n.startsWith(`${core} `));
    if (cands.length) {
      const best = cands.sort((a, b) => a.length - b.length)[0];
      const extra = best.slice(core.length).trim();
      const firstTok = extra ? extra.split(' ')[0] : '';
      if (!SEQUEL_TOKENS.has(firstTok)) {
        return [core, kind, ['reverse', best, [...gameByNorm.get(best)].sort()]];
      }
    }
  }
  return [core, kind, null];
}

const HIGH_METHODS = new Set([
  'exact', 'split', 'bracket', 'paren-for', 'paren-for-reverse', 'plus', 'multi', 'bracket-prefix',
  'edition-base',
]);

function relationTypeFor(child, kind, method) {
  if (kind === 'language_pack') return 'language_pack';
  if (kind === 'upgrade_pass') return 'upgrade_pass';
  if (method === 'exact' && child.product_type === 'bundle') return 'edition';
  if (child.product_type === 'bundle') return 'bundle';
  return 'dlc';
}

// ============================================================================
// 同名雙版本配對（edition）
// ============================================================================

const EDITION_MARKERS = [
  /\s*nintendo\s+switch\s*2\s+edition\s*$/,
  /\s*switch\s*2\s+edition\s*$/,
  /\s*complete\s+edition\s*$/,
  /\s*remastered\s*$/,
  /\s*remaster\s*$/,
  /\s*deluxe\s+edition\s*$/,
  /\s*definitive\s+edition\s*$/,
  /\s*ultimate\s+edition\s*$/,
  /\s*game\s+of\s+the\s+year\s+edition\s*$/,
  /\s*goty\s+edition\s*$/,
  /\s*digital\s+deluxe\s+edition\s*$/,
  /\s*collector\s*s\s+edition\s*$/,
  /\s*special\s+edition\s*$/,
  /\s*limited\s+edition\s*$/,
  /\s*重製版\s*$/,
  /\s*完全版\s*$/,
  /\s*終極版\s*$/,
  /\s*豪華版\s*$/,
  /\s*決定版\s*$/,
  /\s*典藏版\s*$/,
  /\s*年度版\s*$/,
  /\s*加強版\s*$/,
  /\s*導演剪輯版\s*$/,
  /\s*完全收藏版\s*$/,
  /\s*hd\s*2d\s+remake\s*$/,
  /\s*remake\s*$/,
];

function editionBase(n) {
  let b = n;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pat of EDITION_MARKERS) {
      const nb = b.replace(pat, '').trim();
      if (nb !== b && nb) {
        b = nb;
        changed = true;
      }
    }
  }
  return b;
}

/** 回傳 edition 配對列：[{aSlug, bSlug}]（未展開方向，呼叫端再寫雙向）。 */
function editionPairs(games) {
  const byBase = new Map(); // base -> Map<"norm||platform", slugs[]>
  for (const g of games) {
    if (g.product_type !== 'game' || g.is_unnamed) continue;
    const titles = new Set([g.title_zh, g.title_en]);
    for (const t of titles) {
      const n = norm(t);
      if (!n) continue;
      // 英文殘缺名跳過（同 buildGameIndex 的規則）
      if (t === g.title_en && n !== norm(g.title_zh) && norm(g.title_zh).includes(n)) continue;
      const b = editionBase(n);
      if (b.length < 4) continue;
      if (!byBase.has(b)) byBase.set(b, new Map());
      const key = `${n}||${g.platform ?? ''}`;
      if (!byBase.get(b).has(key)) byBase.get(b).set(key, []);
      if (!byBase.get(b).get(key).includes(g.slug)) byBase.get(b).get(key).push(g.slug);
    }
  }
  const pairs = [];
  const seen = new Set();
  for (const [, distinct] of byBase) {
    const entries = [...distinct.entries()]; // [key, slugs]
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [keyA, slugsA] = entries[i];
        const [keyB, slugsB] = entries[j];
        const [normA, platA] = keyA.split('||');
        const [normB, platB] = keyB.split('||');
        // 標題相同且其中一邊主機為空＝重複上架列，不是另一代，跳過。
        const platformsDiffer = platA !== platB && platA !== '' && platB !== '';
        const titlesDiffer = normA !== normB;
        if (!platformsDiffer && !titlesDiffer) continue;
        for (const a of slugsA) {
          for (const b of slugsB) {
            if (a === b) continue;
            const k = [a, b].sort().join('|');
            if (seen.has(k)) continue;
            seen.add(k);
            pairs.push({ aSlug: a, bSlug: b });
          }
        }
      }
    }
  }
  return pairs;
}

// ============================================================================
// Supabase REST（live 模式寫入用；dry-run 讀取也走這裡）
// ============================================================================

function restHeaders(json = true) {
  const h = {
    apikey: READ_KEY,
    Authorization: `Bearer ${READ_KEY}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function readAll(table, select, extra = '') {
  const rows = [];
  let offset = 0;
  for (;;) {
    const url =
      `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}` +
      `?select=${encodeURIComponent(select)}&limit=1000&offset=${offset}${extra}`;
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

async function postgrestUpsert(table, rows, onConflict) {
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

async function deleteByIds(table, ids) {
  for (const batch of chunk(ids, BATCH_DELETE)) {
    const url =
      `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}` +
      `?id=in.(${batch.map((id) => encodeURIComponent(id)).join(',')})`;
    const res = await fetch(url, { method: 'DELETE', headers: restHeaders(false) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`刪除 ${table} 失敗（HTTP ${res.status}）：${text.slice(0, 500)}`);
    }
  }
}

// ============================================================================
// 運算本體（dry-run 與 live 共用；純運算，不寫庫）
// ============================================================================

function computeRelations(games) {
  const bySlug = new Map(games.map((g) => [g.slug, g]));
  const { gameByNorm, prefixIndex } = buildGameIndex(games);
  const children = games.filter(
    (g) => (g.product_type === 'dlc' || g.product_type === 'bundle') && !g.is_unnamed,
  );
  const relations = []; // {gameSlug, relatedSlug, relationType, method, confidence}
  const stats = { childrenTotal: children.length, matched: 0, rejected: 0, none: 0, byMethod: {} };
  const seen = new Set();
  const pushRel = (gameSlug, relatedSlug, relationType, method) => {
    const key = `${gameSlug}|${relatedSlug}|${relationType}`;
    if (seen.has(key)) return;
    seen.add(key);
    relations.push({
      gameSlug,
      relatedSlug,
      relationType,
      method,
      confidence: HIGH_METHODS.has(method) ? 'high' : 'medium',
    });
  };
  for (const c of children) {
    const [, kind, m] = matchChild(c.title_zh, gameByNorm, prefixIndex);
    if (!m) {
      stats.none += 1;
      continue;
    }
    if (m[0] === 'REJECT') {
      stats.rejected += 1;
      continue;
    }
    stats.matched += 1;
    stats.byMethod[m[0]] = (stats.byMethod[m[0]] ?? 0) + 1;
    const relationType = relationTypeFor(c, kind, m[0]);
    for (const parentSlug of m[2]) {
      if (bySlug.has(parentSlug)) pushRel(c.slug, parentSlug, relationType, m[0]);
    }
  }
  // edition：雙向各一列
  const pairs = editionPairs(games);
  let editionRows = 0;
  for (const { aSlug, bSlug } of pairs) {
    if (!bySlug.has(aSlug) || !bySlug.has(bSlug)) continue;
    pushRel(aSlug, bSlug, 'edition', 'edition-base');
    pushRel(bSlug, aSlug, 'edition', 'edition-base');
    editionRows += 2;
  }
  stats.editionPairs = pairs.length;
  stats.editionRows = editionRows;
  stats.relationRows = relations.length;
  relations.sort((a, b) =>
    a.gameSlug.localeCompare(b.gameSlug) ||
    a.relationType.localeCompare(b.relationType) ||
    a.relatedSlug.localeCompare(b.relatedSlug),
  );
  return { relations, stats };
}

async function emitJson(emitPath, payload) {
  await mkdir(path.dirname(emitPath), { recursive: true });
  await writeFile(emitPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function summarize(stats) {
  const lines = [
    `具名 DLC／組合包：${stats.childrenTotal} 筆`,
    `  連結成功：${stats.matched} 筆（${((stats.matched / stats.childrenTotal) * 100).toFixed(1)}%）`,
    `  拒絕（疑似續作／太短無標記）：${stats.rejected} 筆`,
    `  未連上（標題無本體名）：${stats.none} 筆`,
    `  方法分布：${Object.entries(stats.byMethod).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、')}`,
    `同名雙版本配對：${stats.editionPairs} 對 → ${stats.editionRows} 列（雙向）`,
    `關係列總計：${stats.relationRows} 列`,
  ];
  return lines.join('\n');
}

// ============================================================================
// Dry-run / live
// ============================================================================

async function loadGames() {
  if (!SUPABASE_URL || !READ_KEY) {
    throw new Error(
      '缺少環境變數：請設定 NEXT_PUBLIC_SUPABASE_URL，以及 SUPABASE_SERVICE_ROLE_KEY\n' +
        '（寫入用）或 NEXT_PUBLIC_SUPABASE_ANON_KEY（dry-run 讀取用）。',
    );
  }
  const games = await readAll(
    'games',
    'id,slug,title_zh,title_en,product_type,platform,is_unnamed',
  );
  return games;
}

async function dryRun(opts) {
  const games = await loadGames();
  console.log(`games：資料庫現有 ${games.length} 列`);
  let addonsNotImported = 0;
  try {
    const data = JSON.parse(await readFile(opts.input ?? ADDONS_PATH, 'utf8'));
    const slugs = new Set(games.map((g) => g.slug));
    for (const it of data.items ?? []) {
      if (!slugs.has(`tw-${it.nsuid}`)) addonsNotImported += 1;
    }
    console.log(
      `tw-addons.json：${(data.items ?? []).length} 筆，其中 ${addonsNotImported} 筆在庫裡還沒有` +
        '（先跑 scripts/import-tw-addons.mjs 再跑本腳本，否則這幾筆不會被連結）',
    );
  } catch (err) {
    console.log(`tw-addons.json 讀不到（${err.message}），跳過對照，只連庫內現有列`);
  }
  const { relations, stats } = computeRelations(games);
  console.log(`\n${summarize(stats)}`);
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'scripts/link-related-games.mjs --dry-run',
    counts: stats,
    relations: relations.map((r) => ({
      game_slug: r.gameSlug,
      related_slug: r.relatedSlug,
      relation_type: r.relationType,
      method: r.method,
      confidence: r.confidence,
    })),
  };
  await emitJson(opts.emit, payload);
  console.log(`\n連結資料檔已寫出：${opts.emit}（${relations.length} 列）`);
  console.log('--dry-run 結束：未寫入資料庫。正式執行請加 --apply（需 SUPABASE_SERVICE_ROLE_KEY，且 migration 已跑）。');
}

async function live(opts) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(
      '缺少環境變數：--apply 需要 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY。\n' +
        '（只看計畫不寫庫：node scripts/link-related-games.mjs --dry-run）',
    );
    process.exit(1);
  }
  const games = await loadGames();
  console.log(`games：資料庫現有 ${games.length} 列`);
  const bySlug = new Map(games.map((g) => [g.slug, g]));
  const { relations, stats } = computeRelations(games);
  console.log(`\n${summarize(stats)}`);

  const rows = relations
    .map((r) => {
      const game = bySlug.get(r.gameSlug);
      const related = bySlug.get(r.relatedSlug);
      if (!game || !related) return null;
      return {
        game_id: game.id,
        related_game_id: related.id,
        relation_type: r.relationType,
        method: r.method,
        confidence: r.confidence,
        source: 'link-related-games',
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);
  let written = 0;
  for (const batch of chunk(rows, BATCH_UPSERT)) {
    await postgrestUpsert('game_relations', batch, 'game_id,related_game_id,relation_type');
    written += batch.length;
  }
  console.log(`\ngame_relations：寫入／更新 ${written} 列`);

  if (opts.prune) {
    const existing = await readAll(
      'game_relations',
      'id,game_id,related_game_id,relation_type,source',
      '&source=eq.link-related-games',
    );
    const fresh = new Set(rows.map((r) => `${r.game_id}|${r.related_game_id}|${r.relation_type}`));
    const stale = existing
      .filter((r) => !fresh.has(`${r.game_id}|${r.related_game_id}|${r.relation_type}`))
      .map((r) => r.id);
    if (stale.length) {
      await deleteByIds('game_relations', stale);
      console.log(`--prune：清掉已不存在的舊連結 ${stale.length} 列`);
    } else {
      console.log('--prune：沒有要清的舊連結');
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'scripts/link-related-games.mjs --apply',
    counts: stats,
    relations: relations.map((r) => ({
      game_slug: r.gameSlug,
      related_slug: r.relatedSlug,
      relation_type: r.relationType,
      method: r.method,
      confidence: r.confidence,
    })),
  };
  await emitJson(opts.emit, payload);
  console.log(`連結資料檔已寫出：${opts.emit}（${relations.length} 列）`);
  console.log('可重複執行：再跑一次應為相同列數、全部更新、不重複建檔。');
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
