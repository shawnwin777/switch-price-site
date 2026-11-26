import type { DealsCarouselItem } from "./deals-carousel";
import { fetchUsdToTwd, formatTwd, usdToTwd } from "./fx";

/** EA 特價（/deals EA 分頁用），伺服器端抓取（不需金鑰）。
 *  來源：EA 特價頁 https://www.ea.com/sales/deals/ （美國商店，美元計價）。
 *  沒有公開 API、舊 Origin API 已死（404）；特價頁是 Next.js，
 *  內嵌 __NEXT_DATA__ JSON 有乾淨的特價資料（原價／特價／折扣 %），
 *  解析內嵌 JSON 抓取。2026-11-26 實測：共 104 款、每頁 12 款
 *  （?page=N 翻頁，1-9 頁；第 9 頁 8 款），每款都有折扣。
 *  每款無個別截止日；salesDetails.promotions[0].endDate 若有全站
 *  特賣截止日就寫進 subLine，沒有就留空。
 *  免費／特價分流（2026-11-26）：折扣 100% 或特價 $0 的品項是免費領取，
 *  不進 EA 特價分頁，改進免費遊戲區（badge「免費」、
 *  priceLine「免費（原價 $X.XX）」、freeKinds ["pc"]）；折扣 <100%
 *  才進 EA 特價分頁。分流在 fetchDealsPage 做（見 lib/deals-carousel.ts），
 *  這裡只負責把免費品項標成免費格式（freeKinds ["pc"]）。
 *  抓取失敗回空陣列（不讓整個 /deals 頁面壞掉）；呼叫端用
 *  lib/cached-data.ts 的 unstable_cache 包一層（1 小時自動更新，
 *  不用另外開 cron、不用手動同步、不用推 GitHub 更新資料）。 */

const EA_DEALS_URL = "https://www.ea.com/sales/deals/playerfavorites";
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "shawn-game-studio-deals-page/1.0";
/** 特價頁總頁數（2026-11-26：104 款、每頁 12 款＝9 頁）。
 *  頁數寫死 9 頁抓滿，萬一 EA 之後變多款、尾頁超出時多抓的頁
 *  會回空陣列或重複（去重後不影響）；變少款時尾頁回空也不影響。 */
const PAGE_COUNT = 9;

interface EaGameItem {
  slug?: string;
  franchiseSlug?: string;
  title?: string;
  packArt?: { ar2X1?: string; ar1X1?: string };
  price?: {
    displayTotal?: string;
    displayTotalWithDiscount?: string;
    discountPercentage?: number;
    currency?: string;
  };
}

/** EA 遊戲頁網址。EA 站內多數遊戲放在系列子目錄下
 *  （例如 Battlefield 1 是 /games/battlefield/battlefield-1），
 *  只用 slug 會 404（2026-11-26 實測 104 款中有 34 款 404）。
 *  __NEXT_DATA__ 每款都有 franchiseSlug：跟 slug 不同時就用
 *  /games/<franchiseSlug>/<slug>，相同時用 /games/<slug>。
 *  實測：franchise 寫法修好全部 34 款，且 0 款原本好的變壞。 */
function eaGameUrl(slug: string, franchiseSlug?: string): string {
  const fs = typeof franchiseSlug === "string" ? franchiseSlug.trim() : "";
  if (fs && fs !== slug) return `https://www.ea.com/games/${fs}/${slug}`;
  return `https://www.ea.com/games/${slug}`;
}

/** "$69.99" 或 "$ 69.99" 正規化成 "$69.99"；解析不到回 null。 */
function fmtUsd(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : null;
}

/** "$69.99" 解析成數字（$0.00 回 0，免費判斷用）；解析不到回 null。 */
function parseUsdAmount(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function formatTaipeiDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).format(d);
}

async function fetchEaPage(page: number): Promise<{
  items: EaGameItem[];
  saleEnd: string | null;
}> {
  const res = await fetch(`${EA_DEALS_URL}?page=${page}`, {
    headers: { Accept: "text/html", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} EA 特價頁 page=${page}`);
  const html = await res.text();
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error(`EA 特價頁 page=${page} 沒有 __NEXT_DATA__`);
  const data = JSON.parse(m[1]) as {
    props?: {
      pageProps?: {
        gameListResult?: { items?: EaGameItem[] };
        salesDetails?: { promotions?: { endDate?: string }[] };
      };
    };
  };
  const items = data?.props?.pageProps?.gameListResult?.items;
  return {
    items: Array.isArray(items) ? items : [],
    saleEnd:
      data?.props?.pageProps?.salesDetails?.promotions?.[0]?.endDate ?? null,
  };
}

/** 抓 EA 特價全清單（9 頁並行、依 slug 去重、折扣大→小）。
 *  單頁失敗不影響其他頁；全部失敗回空陣列。
 *  usdToTwdRate：USD→TWD 匯率（fetchDealsPage 傳入；沒傳就自己抓一次，
 *  見 lib/fx.ts）。priceLine 台幣在前、美元在括號內
 *  （特價：NT$ 320（$9.99，原價 NT$ 1,280／$39.99）；免費：免費（原價
 *  NT$ 1,280／$39.99）；無原價：NT$ 320（$9.99））。 */
export async function fetchEaDeals(
  usdToTwdRate?: number
): Promise<DealsCarouselItem[]> {
  const rate = usdToTwdRate ?? (await fetchUsdToTwd());
  const pages = await Promise.allSettled(
    Array.from({ length: PAGE_COUNT }, (_, i) => fetchEaPage(i + 1))
  );
  const ok = pages.filter(
    (p): p is PromiseFulfilledResult<{ items: EaGameItem[]; saleEnd: string | null }> =>
      p.status === "fulfilled"
  );
  if (ok.length === 0) {
    console.warn("[ea-deals] EA 特價 9 頁全數抓取失敗");
    return [];
  }
  // 全站特賣截止日（有才寫進 subLine；2026-11-26 實測為 null）。
  const saleEndRaw = ok.map((p) => p.value.saleEnd).find((v) => v) ?? null;
  const saleEnd = formatTaipeiDate(saleEndRaw);
  const seen = new Set<string>();
  const items: DealsCarouselItem[] = [];
  for (const p of ok) {
    for (const it of p.value.items) {
      const slug = typeof it?.slug === "string" ? it.slug : "";
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const url = eaGameUrl(
        slug,
        typeof it?.franchiseSlug === "string" ? it.franchiseSlug : ""
      );
      const title = typeof it?.title === "string" ? it.title.trim() : "";
      const discount =
        typeof it?.price?.discountPercentage === "number"
          ? it.price.discountPercentage
          : 0;
      const saleAmt = parseUsdAmount(it?.price?.displayTotalWithDiscount);
      const listAmt = parseUsdAmount(it?.price?.displayTotal);
      const sale = fmtUsd(it?.price?.displayTotalWithDiscount);
      const list = fmtUsd(it?.price?.displayTotal);
      const image = it?.packArt?.ar2X1 || it?.packArt?.ar1X1 || "";
      if (!title || saleAmt == null || !image) continue;
      // 免費：折扣 100% 或特價 $0——標成免費格式（freeKinds ["pc"]），
      // fetchDealsPage 會把它合併進免費遊戲區，不放進 EA 特價分頁。
      // 本體／DLC：EA 特價頁 __NEXT_DATA__ 沒有類型欄位，無法區分，
      // 依使用者規則一律算本體（kind="game"）。
      if (discount >= 100 || saleAmt === 0) {
        items.push({
          source: "ea",
          key: `ea-${slug}`,
          title,
          image,
          url,
          badge: "免費",
          priceLine:
            listAmt != null && listAmt > 0
              ? `免費（原價 ${formatTwd(usdToTwd(listAmt, rate))}／$${listAmt.toFixed(2)}）`
              : "免費領取",
          subLine: saleEnd ? `免費領取至 ${saleEnd}` : null,
          freeKinds: ["pc"],
          kind: "game",
          // EA 免費品項無個別截止日，免費區裡排最後。
          sortKey: Number.MAX_SAFE_INTEGER,
        });
        continue;
      }
      if (discount <= 0 || !sale || listAmt == null) continue;
      // 特價：台幣在前、美元在括號內；有原價且跟特價不同才寫原價。
      const saleTwd = formatTwd(usdToTwd(saleAmt, rate));
      const listTwd =
        listAmt != null ? formatTwd(usdToTwd(listAmt, rate)) : null;
      items.push({
        source: "ea",
        key: `ea-${slug}`,
        title,
        image,
        url,
        badge: `-${discount}%`,
        priceLine:
          list && list !== sale && listTwd
            ? `${saleTwd}（${sale}，原價 ${listTwd}／${list}）`
            : `${saleTwd}（${sale}）`,
        subLine: saleEnd ? `特價至 ${saleEnd}` : null,
        kind: "game",
        sortKey: discount,
      });
    }
  }
  items.sort((a, b) => b.sortKey - a.sortKey || a.key.localeCompare(b.key));
  return items;
}
