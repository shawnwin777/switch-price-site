import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedNearLowPage } from "@/lib/cached-data";
import { cheapestPrice, NEAR_LOW_PAGE_SIZE } from "@/lib/data";
import { COUNTRY_MAP } from "@/lib/countries";
import { pageWindow } from "@/lib/pagination";
import { formatTwd } from "@/lib/format";
import RankCover from "@/components/RankCover";
import PaginationFab from "@/components/PaginationFab";
import NearLowCountryFilter from "@/components/NearLowCountryFilter";

export const dynamic = "force-dynamic";

export default async function NearLowPage({
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
    result = await getCachedNearLowPage(page, country);
  } catch {
    result = {
      games: [],
      ratios: {},
      total: 0,
      page,
      totalPages: 0,
      error: "查詢失敗",
    };
  }
  const offset = (result.page - 1) * NEAR_LOW_PAGE_SIZE;
  // 分頁連結要帶著國家篩選，不然翻頁就回到全部國家。
  const pageHref = (p: number) =>
    country ? `/near-low?page=${p}&country=${country}` : `/near-low?page=${p}`;
  // 頁數超出範圍時導回最後一頁（保留國家篩選）。
  if (!result.error && result.total > 0 && page > result.totalPages) {
    redirect(pageHref(result.totalPages));
  }

  return (
    <>
      <h1>📉 接近歷史低價</h1>
      <p className="muted">
        現在最低價只比歷史低價貴 0–10%（還沒等於歷史低價）的遊戲，
        越接近歷史低價越前面。最低價是全部國家換算台幣後的最低價，
        每小時更新一次。
        {country && (
          <>
            目前只顯示最低價在{COUNTRY_MAP[country].name}的遊戲。
          </>
        )}
      </p>
      <NearLowCountryFilter country={country} />
      {result.error ? (
        <div className="empty">
          <p>資料準備中，請稍後再試。</p>
        </div>
      ) : result.total === 0 ? (
        <div className="empty">
          <p>目前沒有接近歷史低價的遊戲。</p>
        </div>
      ) : (
        <>
          <p className="muted">共 {result.total} 款接近歷史低價。</p>
          <div className="rank-list four-col">
            {result.games.map((game, i) => {
              const cheapest = cheapestPrice(game.prices);
              const ratio = result.ratios[game.id] ?? 1;
              const pct = ((ratio - 1) * 100).toFixed(1);
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
                      {" · "}比歷史低貴 {pct}%
                    </div>
                    <div>
                      <span className="badge badge-sale">接近歷史低價</span>{" "}
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
            basePath="/near-low"
            country={country}
          />
        </>
      )}
    </>
  );
}
