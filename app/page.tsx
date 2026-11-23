import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  getUserCollectionGameIds,
  getUserPurchaseGameIds,
  overlayMyGameFlags,
  type HomeSortKey,
} from "@/lib/data";
import {
  getCachedDealsCarousel,
  getCachedGamesPagePublic,
  getCachedLatestFx,
  getCachedLatestPriceUpdate,
  getCachedNearLowPage,
  getCachedProductTypes,
  getCachedUpcomingPage,
} from "@/lib/cached-data";
import { formatTaipei } from "@/lib/format";
import { COUNTRY_MAP } from "@/lib/countries";
import { isAdminEmail } from "@/lib/admin";
import HomeClient from "@/components/HomeClient";
import DealsCarousel from "@/components/DealsCarousel";

// 資料頁面用 force-dynamic：建置時不呼叫 Supabase，
// Supabase 專案不存在時也能 npm run build 通過。
// 快取在資料層（lib/cached-data.ts，公開資料快取 1 小時），
// 頁面本身仍每次請求都讀登入狀態、即時補個人狀態。
export const dynamic = "force-dynamic";

const SORT_KEYS: HomeSortKey[] = [
  "deals",
  "cheap-asc",
  "cheap-desc",
  "title",
  "discount",
  "release",
];
const PRODUCT_TYPES = ["game", "dlc", "bundle", "subscription"];

type SearchParams = { [key: string]: string | string[] | undefined };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** 解析並驗證 URL 搜尋參數（非法值退回預設）。 */
function parseParams(searchParams: SearchParams) {
  const q = (first(searchParams.q) ?? "").trim().slice(0, 100);
  const platform = first(searchParams.platform);
  const type = first(searchParams.type);
  const demo = first(searchParams.demo);
  const country = first(searchParams.country);
  const sort = first(searchParams.sort);
  const page = Math.max(1, parseInt(first(searchParams.page) ?? "1", 10) || 1);
  return {
    q,
    platform:
      platform === "Switch" || platform === "Switch 2" ? platform : undefined,
    productType:
      type && type !== "all" && PRODUCT_TYPES.includes(type)
        ? type
        : undefined,
    demo: demo === "1" || demo === "2" || demo === "3" ? Number(demo) : undefined,
    country:
      country && COUNTRY_MAP[country] ? country : undefined,
    sort: (SORT_KEYS as string[]).includes(sort ?? "")
      ? (sort as HomeSortKey)
      : "deals",
    onlySale: first(searchParams.sale) === "1",
    onlyMine: first(searchParams.mine) === "1",
    excludePurchased:
      first(searchParams.showpurchased) === "1" ? false : undefined,
    page,
  };
}

export type HomePageParams = ReturnType<typeof parseParams>;

/** 把篩選條件轉回 URL 參數（預設值不寫進 URL，保持網址乾淨）。 */
function toSearchParams(params: HomePageParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.platform) sp.set("platform", params.platform);
  if (params.productType) sp.set("type", params.productType);
  if (params.demo != null) sp.set("demo", String(params.demo));
  if (params.country) sp.set("country", params.country);
  if (params.sort !== "deals") sp.set("sort", params.sort);
  if (params.onlySale) sp.set("sale", "1");
  if (params.onlyMine) sp.set("mine", "1");
  if (params.excludePurchased === false) sp.set("showpurchased", "1");
  if (params.page > 1) sp.set("page", String(params.page));
  return sp;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseParams(searchParams);
  const db = createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const userId = user?.id ?? null;

  // 個人 id 清單即時取（小查詢，不快取；同時是快取鍵的一部分，
  // 所以收藏／購買一變，下次就是新的 key，不會拿到舊的排除結果）。
  let mineIds: string[] | null = null;
  let excludePurchasedIds: string[] = [];
  if (params.onlyMine) {
    mineIds = userId
      ? await getUserCollectionGameIds(db, userId)
      : [];
  }
  // 排除已購買：登入時預設排除；showpurchased=1 時不排除。
  if (userId && !params.onlyMine && params.excludePurchased !== false) {
    excludePurchasedIds = await getUserPurchaseGameIds(db, userId);
  }

  const [pageRes, fx, lastUpdate, productTypes, nearLow, upcoming, deals] =
    await Promise.all([
      getCachedGamesPagePublic({
        ...params,
        mineIds,
        excludePurchasedIds,
      }),
      getCachedLatestFx(),
      getCachedLatestPriceUpdate(),
      getCachedProductTypes(),
      getCachedNearLowPage(1),
      getCachedUpcomingPage(1),
      // Steam＋Epic 輪播：伺服器端抓取、每小時快取（失敗回空、不影響首頁）。
      getCachedDealsCarousel(),
    ]);
  // 個人狀態即時補上（快取裡沒有個人資料）。
  const page = {
    ...pageRes,
    games: await overlayMyGameFlags(db, pageRes.games, userId),
  };
  // 頁數超出範圍時導回最後一頁（保留其他篩選條件）。
  if (page.total > 0 && params.page > page.totalPages) {
    const sp = toSearchParams({ ...params, page: page.totalPages });
    redirect(`/?${sp.toString()}`);
  }
  const hasFilter =
    Boolean(params.q) ||
    Boolean(params.platform) ||
    Boolean(params.productType) ||
    params.demo != null ||
    Boolean(params.country) ||
    params.onlySale ||
    params.onlyMine;

  return (
    <>
      <h1 className="page-title">
        <b>Switch</b> 遊戲<span>比價</span>
      </h1>
      <p className="muted">
        跨區比價 35 國 eShop，找出最便宜的買法。點封面進詳細頁看完整價格表與玩家留言。
      </p>
      <div className="status-bar">
        💱 匯率以 <b>當天 08:00 台北時間</b> 為準
        {fx.asOf ? (
          <>
            （本次快照：{formatTaipei(fx.asOf)}
            {fx.dateKey ? `，日期 ${fx.dateKey}` : ""}）
          </>
        ) : (
          "（尚無匯率資料）"
        )}
        {" ｜ "}💰 遊戲價格最後更新：
        <b>{lastUpdate ? formatTaipei(lastUpdate) : "尚無資料"}</b>
        {page.total === 0 && !hasFilter && (
          <>
            {" ｜ "}
            目前尚無遊戲資料（Supabase 尚未匯入種子資料或專案未建立）。
          </>
        )}
      </div>
      <div className="feature-cards">
        <Link href="/upcoming" className="feature-card">
          <div className="feature-card-title">📅 準備上市</div>
          <div className="feature-card-sub">
            {upcoming.unavailable || !upcoming.hasAnyReleaseDate
              ? "上市日期資料補充中"
              : upcoming.total > 0
                ? `${upcoming.total} 款即將上市`
                : "目前沒有即將上市的遊戲"}
          </div>
        </Link>
        <Link href="/near-low" className="feature-card">
          <div className="feature-card-title">📉 接近歷史低價</div>
          <div className="feature-card-sub">
            {nearLow.error
              ? "資料準備中"
              : nearLow.total > 0
                ? `${nearLow.total} 款只比歷史低貴一點點`
                : "目前沒有接近歷史低價的遊戲"}
          </div>
        </Link>
      </div>
      <DealsCarousel items={deals.items} />
      <HomeClient
        games={page.games}
        total={page.total}
        page={page.page}
        totalPages={page.totalPages}
        filters={params}
        productTypes={productTypes}
        loggedInUserId={user?.id ?? null}
        isAdmin={isAdminEmail(user?.email)}
      />
    </>
  );
}
