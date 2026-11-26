import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedHistoricalLowPage } from "@/lib/cached-data";
import { cheapestPrice, isPriceOnSale, HISTORICAL_LOW_PAGE_SIZE } from "@/lib/data";
import { COUNTRY_MAP } from "@/lib/countries";
import { pageWindow } from "@/lib/pagination";
import { formatTwd } from "@/lib/format";
import RankCover from "@/components/RankCover";
import PaginationFab from "@/components/PaginationFab";
import BackButton from "@/components/BackButton";
import BackToTop from "@/components/BackToTop";
import NearLowCountryFilter from "@/components/NearLowCountryFilter";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "歷史低價｜Shawn Game Studio",
};

/** 歷史低價頁（/historical-low，2026-11-23 新增）：
 *  目前最低價正好等於歷史低價（比值 = 1）的遊戲——這是 /near-low
 *  收不到的區間（那頁只收 1 < 比值 <= 1.1），shawn 問得沒錯，所以
 *  獨立成頁。100 款一頁、直式卡片、排名徽章、最低價國家篩選，
 *  版式比照 /near-low。排序：折扣最大優先（還沒特價過的遊戲也在
 *  歷史低價——原價就是最低價——排在後面），再按最低價由低到高。
 *  資料：DB 層單一查詢（view 欄位 is_at_historical_low，見
 *  supabase/migrations/20261123_add_is_at_historical_low.sql）；
 *  欄位未建時自動改走 prices 旗標備援（見 lib/data.ts），不走
 *  /near-low 的全掃描做法。快取 key historical-low-page-v1，
 *  不跟 near-low 共用。 */
export default async function HistoricalLowPage({
  searchParams,
}: {
  searchParams: { page?: string; country?: string };
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const country =
    searchParams.country && COUNTRY_MAP[searchParams.country]
      ? searchParams.country
      : undefined;
  // 快取 getter 查詢失敗時拋錯（不快取錯誤結果）；接住後照樣顯示
  // 「資料準備中」，畫面不變，下次請求會重查（2026-11-23 改）。
  let result;
  try {
    result = await getCachedHistoricalLowPage(page, country);
  } catch {
    result = { games: [], total: 0, page, totalPages: 0, error: "查詢失敗" };
  }
  const offset = (result.page - 1) * HISTORICAL_LOW_PAGE_SIZE;
  // 分頁連結要帶著國家篩選，不然翻頁就回到全部國家。
  const pageHref = (p: number) =>
    country
      ? `/historical-low?page=${p}&country=${country}`
      : `/historical-low?page=${p}`;
  // 頁數超出範圍時導回最後一頁（保留國家篩選）。
  if (!result.error && result.total > 0 && page > result.totalPages) {
    redirect(pageHref(result.totalPages));
  }

  return (
    <>
      <BackButton />
      <BackToTop />
      <h1>💰 歷史低價</h1>
      <p className="muted">
        現在最低價正好等於歷史最低價的遊戲——現在買就是有史以來最便宜。
        折扣最大的排前面；還沒特價過的遊戲也在歷史低價（原價就是最低價），
        排在後面。每小時更新一次。
        {country && (
          <>
            目前只顯示最低價在{COUNTRY_MAP[country].name}的遊戲。
          </>
        )}
      </p>
      <NearLowCountryFilter country={country} basePath="/historical-low" />
      {result.error ? (
        <div className="empty">
          <p>資料準備中，請稍後再試。</p>
        </div>
      ) : result.total === 0 ? (
        <div className="empty">
          <p>目前沒有正在歷史低價的遊戲。</p>
        </div>
      ) : (
        <>
          <p className="muted">共 {result.total} 款正在歷史低價。</p>
          <div className="rank-list four-col">
            {result.games.map((game, i) => {
              const cheapest = cheapestPrice(game.prices);
              // 折扣只算還在特價的價格：特價已結束就不掛 -%；
              // 曾經特價過（但已結束）顯示「特價已結束」，不是「尚未特價過」。
              const discount = Math.max(
                0,
                ...game.prices
                  .filter(isPriceOnSale)
                  .map((p) => p.discount_pct ?? 0)
              );
              const everDiscounted = game.prices.some(
                (p) => (p.discount_pct ?? 0) > 0
              );
              return (
                <div key={game.id} className="rank-row">
                  <div className="rank-info">
                    <div className="t">
                      <Link
                        href={`/games/${game.slug}`}
                        style={{ color: "var(--text)" }}
                      >
                        {game.title_zh}
                      </Link>
                    </div>
                    <div className="rank-meta">
                      {cheapest && (
                        <>
                          最低 {formatTwd(cheapest.price_twd)}（
                          {cheapest.country_name ?? cheapest.country}）
                        </>
                      )}
                      {" · "}歷史低{" "}
                      {formatTwd(game.historical_low_twd)}
                      {discount > 0
                        ? ` · 折扣 -${discount}%`
                        : everDiscounted
                          ? " · 特價已結束"
                          : " · 尚未特價過"}
                    </div>
                    <div>
                      <span className="badge badge-sale">歷史低價</span>{" "}
                      <span className="muted">
                        ♥ {game.collections_count} 人收藏 · 👍{" "}
                        {game.likes_count}
                      </span>
                    </div>
                  </div>
                  <Link href={`/games/${game.slug}`} className="rank-cover-link">
                    <RankCover
                      src={game.cover_url ?? "/covers/placeholder.svg"}
                      alt={game.title_zh}
                    />
                    <div className="rank-num">{offset + i + 1}</div>
                  </Link>
                </div>
              );
            })}
          </div>
          {result.totalPages > 1 && (
            <nav className="pagination" aria-label="分頁">
              {result.page > 1 && (
                <Link
                  className="chip"
                  href={pageHref(result.page - 1)}
                  style={{ textDecoration: "none" }}
                >
                  ← 上一頁
                </Link>
              )}
              {pageWindow(result.page, result.totalPages).map((n, i) =>
                n === "…" ? (
                  <span key={`e${i}`} className="ellipsis">
                    …
                  </span>
                ) : (
                  <Link
                    key={n}
                    className={`chip page-num ${
                      n === result.page ? "active" : ""
                    }`}
                    href={pageHref(n as number)}
                    style={{ textDecoration: "none" }}
                    aria-current={n === result.page ? "page" : undefined}
                  >
                    {n}
                  </Link>
                )
              )}
              {result.page < result.totalPages && (
                <Link
                  className="chip"
                  href={pageHref(result.page + 1)}
                  style={{ textDecoration: "none" }}
                >
                  下一頁 →
                </Link>
              )}
            </nav>
          )}
          <PaginationFab
            page={result.page}
            totalPages={result.totalPages}
            basePath="/historical-low"
            country={country}
          />
        </>
      )}
    </>
  );
}
