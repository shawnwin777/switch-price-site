import {
  getCachedDealsPage,
  getCachedGamesPagePublic,
  getCachedPsDeals,
  getCachedXboxConsoleDeals,
  getCachedXboxPcDeals,
} from "@/lib/cached-data";
import type { DealsCarouselItem } from "@/lib/deals-carousel";
import HomeMenu, { type HomePreviewItem, type HomePreviews } from "@/components/HomeMenu";

export const metadata = {
  title: "Shawn Game Studio｜遊戲比價首頁",
  description:
    "Switch 跨區比價、PC 與家機特價、NSO 會員跨區比價、歷史低價：價格取自各官方商店公開資料。",
};

/** 首頁每小時重新抓一次預覽（ISR）：冷快取時外部來源約 10 秒內回來，
 *  之後 1 小時都吃快取；任一來源失敗只影響那一格預覽，不拖垮首頁。 */
export const revalidate = 3600;

/** 新首頁 /home（2026-11-23 改版，shawn 定）：斜切抽屜式遊戲選單。
 *  左邊是斜切品牌板（SGS 標誌 public/sgs-logo.png）＋招牌語，
 *  右邊四個選單：SWITCH → /switch-price、PC GAMES → /deals、
 *  Gaming console → /console、關於我（第四格，展開看社群連結）；
 *  選單整體往下移，避開左邊的斜線。
 *  hover／點按選單時品牌板像抽屜一樣向左滑出、停住，露出預覽圖列
 *  （互動邏輯在 components/HomeMenu.tsx）。
 *  預覽圖全部用站上現成的官方圖：Switch 用站內特價遊戲的 Nintendo CDN
 *  封面；PC 用 Steam／Xbox PC 特價官方圖；家機用 Xbox／PS 特價官方圖。
 *  2026-11-23 下午 shawn 說下面兩組入口卡片（特價情報、會員・收藏）
 *  用不太到，整組刪掉——那些頁面（/upcoming、/near-low、
 *  /historical-low、/nso、/ranking、/taiwan）本身不動、還在站上，
 *  只是不在 /home 列出來。選單圖標是 inline SVG，不用 emoji。 */

const PREVIEW_COUNT = 6;

/** 單一來源抓太久就放棄（回空陣列、該格顯示佔位），不讓首頁等它。 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  } catch {
    return null;
  }
}

function fromDeal(item: DealsCarouselItem, source: string): HomePreviewItem {
  return {
    key: `${source}-${item.key}`,
    title: item.title,
    image: item.image,
    url: item.url,
    badge: item.badge,
    priceLine: item.priceLine,
    source,
    external: true,
  };
}

async function fetchSwitchPreviews(): Promise<HomePreviewItem[]> {
  const page = await withTimeout(
    getCachedGamesPagePublic({
      sort: "deals",
      onlySale: true,
      page: 1,
      mineIds: null,
      excludePurchasedIds: [],
    }),
    30000
  );
  if (!page || page.error) return [];
  return page.games
    .filter((g) => g.cover_url && !g.cover_url.includes("placeholder"))
    .slice(0, PREVIEW_COUNT)
    .map((g) => {
      const priced = g.prices.filter((p) => p.price_twd != null);
      const cheapest =
        priced.length > 0
          ? priced.reduce((a, b) => (a.price_twd! <= b.price_twd! ? a : b))
          : null;
      const bestDiscount = Math.max(
        0,
        ...g.prices.map((p) => p.discount_pct ?? 0)
      );
      return {
        key: g.slug,
        title: g.title_zh,
        image: g.cover_url as string,
        url: `/games/${g.slug}`,
        badge: bestDiscount > 0 ? `-${bestDiscount}%` : "特價中",
        priceLine:
          cheapest && cheapest.price_twd != null
            ? `最低 NT$ ${cheapest.price_twd.toLocaleString()}`
            : "查看各國價格",
        source: "Switch",
        external: false,
      } satisfies HomePreviewItem;
    });
}

async function fetchPcPreviews(): Promise<HomePreviewItem[]> {
  const [deals, xboxPc] = await Promise.all([
    withTimeout(getCachedDealsPage(), 12000),
    withTimeout(getCachedXboxPcDeals(), 12000),
  ]);
  const steam = (deals?.steam ?? []).slice(0, 3).map((i) => fromDeal(i, "Steam"));
  const xbox = (xboxPc?.items ?? []).slice(0, 3).map((i) => fromDeal(i, "Xbox PC"));
  return [...steam, ...xbox];
}

async function fetchConsolePreviews(): Promise<HomePreviewItem[]> {
  const [xboxConsole, ps] = await Promise.all([
    withTimeout(getCachedXboxConsoleDeals(), 12000),
    withTimeout(getCachedPsDeals(), 12000),
  ]);
  const xbox = (xboxConsole?.items ?? []).slice(0, 3).map((i) => fromDeal(i, "Xbox"));
  const psItems = (ps?.items ?? []).slice(0, 3).map((i) => fromDeal(i, "PlayStation"));
  return [...xbox, ...psItems];
}

export default async function HomeLandingPage() {
  const [switchItems, pcItems, consoleItems] = await Promise.all([
    fetchSwitchPreviews(),
    fetchPcPreviews(),
    fetchConsolePreviews(),
  ]);
  const previews: HomePreviews = {
    switch: switchItems,
    pc: pcItems,
    console: consoleItems,
  };
  return <HomeMenu previews={previews} />;
}
