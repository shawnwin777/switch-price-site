import Link from "next/link";
import { getCachedNearLowPage } from "@/lib/cached-data";
import { cheapestPrice, NEAR_LOW_PAGE_SIZE } from "@/lib/data";
import { formatTwd } from "@/lib/format";
import RankCover from "@/components/RankCover";

export const dynamic = "force-dynamic";

export default async function NearLowPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const result = await getCachedNearLowPage(page);
  const offset = (result.page - 1) * NEAR_LOW_PAGE_SIZE;

  return (
    <>
      <h1>📉 接近歷史低價</h1>
      <p className="muted">
        現在最低價只比歷史低價貴 0–10%（還沒等於歷史低價）的遊戲，
        越接近歷史低價越前面。最低價是全部國家換算台幣後的最低價，
        每小時更新一次。
      </p>
      {result.error ? (
        <div className="empty">
          <p>資料準備中，請稍後再試。</p>
          <p>
            <Link href="/">回首頁 →</Link>
          </p>
        </div>
      ) : result.total === 0 ? (
        <div className="empty">
          <p>目前沒有接近歷史低價的遊戲。</p>
          <p>
            <Link href="/">回首頁 →</Link>
          </p>
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
                  <div className="rank-num">{offset + i + 1}</div>
                  <Link href={`/games/${game.slug}`}>
                    <RankCover
                      src={game.cover_url ?? "/covers/placeholder.svg"}
                      alt={game.title_zh}
                    />
                  </Link>
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
                </div>
              );
            })}
          </div>
          <div className="filter-row">
            {result.page > 1 && (
              <Link
                className="chip"
                href={`/near-low?page=${result.page - 1}`}
                style={{ textDecoration: "none" }}
              >
                ← 上一頁
              </Link>
            )}
            <span className="muted">
              第 {result.page} / {result.totalPages} 頁
            </span>
            {result.page < result.totalPages && (
              <Link
                className="chip"
                href={`/near-low?page=${result.page + 1}`}
                style={{ textDecoration: "none" }}
              >
                下一頁 →
              </Link>
            )}
          </div>
        </>
      )}
    </>
  );
}
