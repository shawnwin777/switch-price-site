import type { DealsCarouselItem } from "./deals-carousel";
import { fetchUsdToTwd, formatTwd, usdToTwd } from "./fx";
import { decodeEntities } from "./html-entities";

/** Ubisoft 特價（/deals UBISOFT 分頁用），伺服器端抓取（不需金鑰）。
 *  來源：Ubisoft 商店特價頁 https://store.ubisoft.com/us/bargain-bin-sale
 *  （美國商店，美元計價；黑五期間 379 款）。
 *  限制（2026-11-26 實測）：目前只列特價頁前 36 款——
 *  特價頁是伺服器渲染 HTML，只給第一頁 36 款；?start=36 翻頁無效
 *  （回同樣的第一頁）、Search-ShowProductGrid 端點回 410、
 *  OCAPI 需要有效的 client ID（頁面上的 abbs-us_ubisoft 被拒），
 *  所以拿不到完整的 379 款。36 款是目前穩定可抓的上限。
 *  解析方式：每款是一個 <a class="thumb-link" href="/us/{slug}/{id}.html">
 *  區塊，內含 <div class="prod-title"> 遊戲名、<div class="card-subtitle">
 *  版本、<span class="price-sales standard-price"> 特價、
 *  <span class="price-item"> 原價、<img> 官方圖片（dw/image 官方圖床）。
 *  標題含 HTML 實體（&#39; 等）要解回原字。
 *  免費／特價分流（2026-11-26）：特價 $0 的品項是免費領取，不進
 *  UBISOFT 特價分頁，改進免費遊戲區（badge「免費」、
 *  priceLine「免費（原價 $X.XX）」、freeKinds ["pc"]）；特價 >$0
 *  才進 UBISOFT 特價分頁。分流在 fetchDealsPage 做
 *  （見 lib/deals-carousel.ts），這裡只負責把免費品項標成免費格式
 *  （freeKinds ["pc"]）。
 *  抓取失敗回空陣列（不讓整個 /deals 頁面壞掉）；呼叫端用
 *  lib/cached-data.ts 的 unstable_cache 包一層（1 小時自動更新，
 *  不用另外開 cron、不用手動同步、不用推 GitHub 更新資料）。 */

const UBISOFT_DEALS_URL = "https://store.ubisoft.com/us/bargain-bin-sale";
const UBISOFT_STORE = "https://store.ubisoft.com";
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

/** 標題裡的 HTML 實體（&#39;、&amp;、&rsquo;、&ouml; 等）解回原字
 *  （共用 lib/html-entities.ts）。 */

function parseUsdAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[^0-9.]/g, ""));
  // $0.00 回 0（免費判斷用）；解析不到回 null。
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** 解析特價頁 HTML：每款一個 thumb-link 區塊，取遊戲名＋版本＋
 *  特價／原價＋官方圖，缺欄位或特價不低於原價的跳過。
 *  usdToTwdRate：USD→TWD 匯率（fetchDealsPage 傳入；沒傳就自己抓一次，
 *  見 lib/fx.ts）。priceLine 台幣在前、美元在括號內
 *  （特價：NT$ 320（$9.99，原價 NT$ 1,280／$39.99）；免費：免費（原價
 *  NT$ 1,280／$39.99））。 */
function parseUbisoftDeals(html: string, rate: number): DealsCarouselItem[] {
  const items: DealsCarouselItem[] = [];
  if (!html) return items;
  const anchorRe =
    /<a[^>]*class="thumb-link"[^>]*href="([^"]+)"/g;
  const anchors = [...html.matchAll(anchorRe)];
  for (let i = 0; i < anchors.length; i++) {
    const href = anchors[i][1];
    const start = anchors[i].index ?? 0;
    const end =
      i + 1 < anchors.length
        ? (anchors[i + 1].index ?? html.length)
        : Math.min(html.length, start + 12000);
    const seg = html.slice(start, end);
    const titleM = /<div class="prod-title">\s*([\s\S]*?)\s*<\/div>/.exec(seg);
    const subM = /<div class="card-subtitle">\s*([\s\S]*?)\s*<\/div>/.exec(seg);
    const saleM =
      /class="price-sales standard-price">\s*\$([0-9]+\.[0-9]{2})/.exec(seg);
    const listM = /class="price-item">\$([0-9]+\.[0-9]{2})/.exec(seg);
    const imgM =
      /<img[^>]*src="(https:\/\/store\.ubisoft\.com\/dw\/image\/v2\/ABBS_PRD\/[^"]+)"/.exec(
        seg
      );
    if (!titleM || !saleM || !listM) continue;
    const name = decodeEntities(titleM[1].trim());
    const edition = subM ? decodeEntities(subM[1].trim()) : "";
    const sale = parseUsdAmount(saleM[1]);
    const list = parseUsdAmount(listM[1]);
    const image = imgM ? imgM[1].replace(/&amp;/g, "&") : "";
    if (!name || sale == null || list == null || list <= 0 || !image)
      continue;
    const path = href.split("?")[0];
    if (!path.startsWith("/us/")) continue;
    // 免費：特價 $0——標成免費格式（freeKinds ["pc"]），
    // fetchDealsPage 會把它合併進免費遊戲區，不放進 UBISOFT 特價分頁。
    // 本體／DLC：Ubisoft 特價頁 HTML 沒有類型欄位（只有版本副標），
    // 無法區分，依使用者規則一律算本體（kind="game"）。
    if (sale === 0) {
      items.push({
        source: "ubisoft",
        key: `ubisoft-${path}`,
        title: edition ? `${name} - ${edition}` : name,
        image,
        url: `${UBISOFT_STORE}${path}`,
        badge: "免費",
        priceLine: `免費（原價 ${formatTwd(usdToTwd(list, rate))}／${formatUsd(list)}）`,
        subLine: null,
        freeKinds: ["pc"],
        kind: "game",
        // Ubisoft 免費品項無截止日，免費區裡排最後。
        sortKey: Number.MAX_SAFE_INTEGER,
      });
      continue;
    }
    if (sale >= list) continue;
    const discount = Math.round((1 - sale / list) * 100);
    if (discount <= 0) continue;
    items.push({
      source: "ubisoft",
      key: `ubisoft-${path}`,
      title: edition ? `${name} - ${edition}` : name,
      image,
      url: `${UBISOFT_STORE}${path}`,
      badge: `-${discount}%`,
      priceLine: `${formatTwd(usdToTwd(sale, rate))}（${formatUsd(sale)}，原價 ${formatTwd(usdToTwd(list, rate))}／${formatUsd(list)}）`,
      // 特價頁沒有個別截止日。
      subLine: null,
      kind: "game",
      sortKey: discount,
    });
  }
  // 同款多版本各算一款（不同 edition 不同 key）；折扣大→小。
  items.sort((a, b) => b.sortKey - a.sortKey || a.key.localeCompare(b.key));
  return items;
}

/** 抓 Ubisoft 特價頁前 36 款（失敗回空陣列）。
 *  usdToTwdRate：USD→TWD 匯率（fetchDealsPage 傳入；沒傳就自己抓一次，
 *  見 lib/fx.ts）。 */
export async function fetchUbisoftDeals(
  usdToTwdRate?: number
): Promise<DealsCarouselItem[]> {
  const rate = usdToTwdRate ?? (await fetchUsdToTwd());
  try {
    const res = await fetch(UBISOFT_DEALS_URL, {
      headers: { Accept: "text/html", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${UBISOFT_DEALS_URL}`);
    const html = await res.text();
    const items = parseUbisoftDeals(html, rate);
    if (items.length === 0) {
      console.warn("[ubisoft-deals] 特價頁解析出 0 款（版面可能變了）");
    }
    return items;
  } catch (e) {
    console.warn("[ubisoft-deals] Ubisoft 特價抓取失敗：", e);
    return [];
  }
}
