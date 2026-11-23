import Link from "next/link";
import { getCachedRanking } from "@/lib/cached-data";
import { formatTwd, saleEndLabel } from "@/lib/format";
import RankCover from "@/components/RankCover";

export const dynamic = "force-dynamic";

export default async function RankingPage({
  searchParams,
}: {
  searchParams: { sale?: string };
}) {
  const onlyOnSale = searchParams.sale !== "all";
  // 排行是完全公開資料，走快取（1 小時）；封面圖是 Client Component
  // RankCover（<img onError> 不能寫在 Server Component 裡，見 2026-11-17 修復）。
  const ranking = await getCachedRanking(onlyOnSale, 10);

  return (
    <>
      <h1>🏆 收藏排行 TOP 10</h1>
      <p className="muted">
        最多玩家收藏的遊戲。預設只顯示特價中，方便直接撿便宜。目前僅支援
        Switch 比價。
      </p>
      <div className="filter-row">
        <Link
          href="/ranking"
          className={`chip ${onlyOnSale ? "active" : ""}`}
          style={{ textDecoration: "none" }}
        >
          只看特價中
        </Link>
        <Link
          href="/ranking?sale=all"
          className={`chip ${!onlyOnSale ? "active" : ""}`}
          style={{ textDecoration: "none" }}
        >
          全部
        </Link>
      </div>
      {ranking.length === 0 ? (
        <div className="empty">
          <p>
            {onlyOnSale
              ? "目前沒有收藏的遊戲正在特價。"
              : "目前尚無排行資料（Supabase 尚未匯入資料或無人收藏）。"}
          </p>
          {onlyOnSale && (
            <p>
              <Link href="/ranking?sale=all">看全部排行 →</Link>
            </p>
          )}
        </div>
      ) : (
        <div className="rank-list">
          {ranking.map((entry, i) => (
            <div key={entry.game.id} className={`rank-row ${i < 3 ? "top3" : ""}`}>
              <div className="rank-num">{i + 1}</div>
              <Link href={`/games/${entry.game.slug}`}>
                <RankCover
                  src={entry.game.cover_url ?? "/covers/placeholder.svg"}
                  alt={entry.game.title_zh}
                />
              </Link>
              <div className="rank-info">
                <div className="t">
                  <Link href={`/games/${entry.game.slug}`} style={{ color: "var(--text)" }}>
                    {entry.game.title_zh}
                  </Link>
                </div>
                <div className="rank-meta">
                  ♥ {entry.collections_count} 人收藏 · 👍 {entry.likes_count}
                  {entry.cheapest && (
                    <>
                      {" · "}最低 {formatTwd(entry.cheapest.price_twd)}（
                      {entry.cheapest.country_name ?? entry.cheapest.country}）
                    </>
                  )}
                </div>
                {entry.on_sale && (
                  <div>
                    <span className="badge badge-sale">特價中</span>
                    {entry.sale_end && (
                      <span className="muted"> {saleEndLabel(entry.sale_end)}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
