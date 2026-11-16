import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  getGamesPage,
  getLatestFx,
  getLatestPriceUpdate,
  getProductTypes,
  type HomeSortKey,
} from "@/lib/data";
import { formatTaipei } from "@/lib/format";
import HomeClient from "@/components/HomeClient";

// 資料頁面用 force-dynamic：建置時不呼叫 Supabase，
// Supabase 專案不存在時也能 npm run build 通過。
export const dynamic = "force-dynamic";

const SORT_KEYS: HomeSortKey[] = ["cheap-asc", "cheap-desc", "title", "discount"];
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
    sort: (SORT_KEYS as string[]).includes(sort ?? "")
      ? (sort as HomeSortKey)
      : "cheap-asc",
    onlySale: first(searchParams.sale) === "1",
    onlyMine: first(searchParams.mine) === "1",
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
  if (params.sort !== "cheap-asc") sp.set("sort", params.sort);
  if (params.onlySale) sp.set("sale", "1");
  if (params.onlyMine) sp.set("mine", "1");
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
  const [page, fx, lastUpdate, productTypes] = await Promise.all([
    getGamesPage(db, { ...params, userId: user?.id ?? null }),
    getLatestFx(db),
    getLatestPriceUpdate(db),
    getProductTypes(db),
  ]);
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
      <HomeClient
        games={page.games}
        total={page.total}
        page={page.page}
        totalPages={page.totalPages}
        filters={params}
        productTypes={productTypes}
        loggedInUserId={user?.id ?? null}
      />
    </>
  );
}
