import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRanking } from "@/lib/data";
import { formatTwd, saleEndLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RankingPage({
  searchParams,
}: {
  searchParams: { sale?: string };
}) {
  const onlyOnSale = searchParams.sale !== "all";
  const db = createSupabaseServerClient();
  const ranking = await getRanking(db, onlyOnSale, 50);

  return (
    <>
      <h1>🏆 收藏排行 TOP 50</h1>
      <p className="muted">
        最多玩家收藏的遊戲。預設只顯示特價中，方便直接撿便宜。
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
                <img
                  className="rank-cover"
                  src={entry.game.cover_url ?? "/covers/placeholder.svg"}
                  alt={entry.game.title_zh}
                  loading="lazy"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.src.endsWith("/covers/placeholder.svg")) {
                      img.src = "/covers/placeholder.svg";
                    }
                  }}
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
