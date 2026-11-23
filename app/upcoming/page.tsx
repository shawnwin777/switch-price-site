import Link from "next/link";
import { getCachedUpcomingPage } from "@/lib/cached-data";
import { cheapestPrice, UPCOMING_PAGE_SIZE } from "@/lib/data";
import { pageWindow } from "@/lib/pagination";
import { formatTwd } from "@/lib/format";
import RankCover from "@/components/RankCover";

export const dynamic = "force-dynamic";

/** "2026-04-10" → "2026/04/10"（直接切字串，不經過時區換算）。 */
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : d;
}

export default async function UpcomingPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  // 快取 getter 查詢失敗（unavailable）時拋錯（不快取「資料補充中」
  // 的空結果）；接住後照樣顯示「資料補充中」，畫面不變，下次請求會
  // 重查（2026-11-23 改）。
  let result;
  try {
    result = await getCachedUpcomingPage(page);
  } catch {
    result = {
      games: [],
      total: 0,
      page,
      totalPages: 0,
      hasAnyReleaseDate: false,
      unavailable: true,
    };
  }
  const offset = (result.page - 1) * UPCOMING_PAGE_SIZE;

  return (
    <>
      <h1>📅 準備上市</h1>
      <p className="muted">
        上市日期在今天之後的遊戲，越快上市越前面。今天上市的當天不列入
        （已經上市了，首頁遊戲牆看得到）。上市日期來自各區官方目錄，
        每小時更新一次。
      </p>
      {result.unavailable || !result.hasAnyReleaseDate ? (
        <div className="empty">
          <p>
            上市日期資料補充中——正在從各區目錄把上市日期補進來，
            補好後這裡會列出即將上市的遊戲。
          </p>
          <p>
            <Link href="/home">回首頁 →</Link>
          </p>
        </div>
      ) : result.total === 0 ? (
        <div className="empty">
          <p>目前沒有即將上市的遊戲。</p>
          <p>
            <Link href="/home">回首頁 →</Link>
          </p>
        </div>
      ) : (
        <>
          <p className="muted">共 {result.total} 款即將上市。</p>
          <div className="rank-list four-col">
            {result.games.map((game, i) => {
              const cheapest = cheapestPrice(game.prices);
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
                      上市 {fmtDate(game.release_date)}
                      {cheapest && (
                        <>
                          {" · "}最低 {formatTwd(cheapest.price_twd)}（
                          {cheapest.country_name ?? cheapest.country}）
                        </>
                      )}
                    </div>
                    <div>
                      <span className="badge badge-platform">
                        {game.platform ?? "Switch"}
                      </span>{" "}
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
                  href={`/upcoming?page=${result.page - 1}`}
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
                    href={`/upcoming?page=${n as number}`}
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
                  href={`/upcoming?page=${result.page + 1}`}
                  style={{ textDecoration: "none" }}
                >
                  下一頁 →
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
