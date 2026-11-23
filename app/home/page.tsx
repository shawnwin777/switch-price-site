import Link from "next/link";
import {
  getCachedGamesPagePublic,
  getCachedHistoricalLowPage,
  getCachedNearLowPage,
  getCachedUpcomingPage,
} from "@/lib/cached-data";

export const metadata = {
  title: "Shawn Game Studio｜遊戲比價首頁",
  description:
    "Switch 跨區比價、PC 與家機特價、NSO 會員跨區比價、歷史低價：價格取自各官方商店公開資料。",
};

// 資料頁面用 force-dynamic：建置時不呼叫 Supabase；
// 款數在資料層（lib/cached-data.ts，公開資料快取 1 小時）。
export const dynamic = "force-dynamic";

/** 新首頁 /home（2026-11-23，shawn 定）：Shawn Game Studio 的大首頁
 *  （landing page），主視覺＋分組入口，把站上各頁串起來。
 *  比價牆留在 /，這裡不放牆、不放搜尋。款數走與 / 牆上卡片相同的
 *  每小時快取 getter；任一查詢失敗時該卡顯示備用文案，不讓整頁壞掉。 */
export default async function HomeLandingPage() {
  const [wall, upcoming, nearLow, historicalLow] = await Promise.all([
    getCachedGamesPagePublic({
      sort: "deals",
      page: 1,
      mineIds: null,
      excludePurchasedIds: [],
    }),
    getCachedUpcomingPage(1),
    getCachedNearLowPage(1),
    getCachedHistoricalLowPage(1),
  ]);

  return (
    <>
      <section className="home-hero">
        <div className="home-hero-eyebrow">SHAWN GAME STUDIO</div>
        <h1 className="home-hero-title">
          遊戲比價，<span>從這裡開始</span>
        </h1>
        <p className="home-hero-sub">
          Switch 跨區比價、PC 與家機特價、NSO 會員跨區比價、歷史低價——
          價格取自各官方商店公開資料，僅供參考。
        </p>
        <Link href="/" className="btn home-hero-cta">
          開始比價 →
        </Link>
      </section>

      <h2 className="deals-section-title">比價</h2>
      <div className="feature-cards">
        <Link href="/" className="feature-card">
          <div className="feature-card-title">🎮 Switch 比價</div>
          <div className="feature-card-sub">
            {wall.error || wall.total === 0
              ? "35 國 eShop 跨區比價，找出最便宜的買法"
              : `35 國 eShop 跨區比價，台港有價 ${wall.total.toLocaleString("zh-Hant-TW")} 款`}
          </div>
        </Link>
        <Link href="/deals" className="feature-card">
          <div className="feature-card-title">💻 PC遊戲特價</div>
          <div className="feature-card-sub">
            Steam、Xbox PC 每平台前 510 款，Epic 免費遊戲
          </div>
        </Link>
        <Link href="/console" className="feature-card">
          <div className="feature-card-title">🕹️ 家機特價</div>
          <div className="feature-card-sub">
            Xbox 家機、PlayStation 每平台前 510 款，XGP／PS Plus 新進
          </div>
        </Link>
      </div>

      <h2 className="deals-section-title">特價情報</h2>
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
                ? `${nearLow.total.toLocaleString("zh-Hant-TW")} 款只比歷史低貴一點點`
                : "目前沒有接近歷史低價的遊戲"}
          </div>
        </Link>
        <Link href="/historical-low" className="feature-card">
          <div className="feature-card-title">💰 歷史低價</div>
          <div className="feature-card-sub">
            {historicalLow.error
              ? "資料準備中"
              : historicalLow.total > 0
                ? `${historicalLow.total.toLocaleString("zh-Hant-TW")} 款正在歷史低價`
                : "目前沒有正在歷史低價的遊戲"}
          </div>
        </Link>
      </div>

      <h2 className="deals-section-title">會員・收藏</h2>
      <div className="feature-cards">
        <Link href="/nso" className="feature-card">
          <div className="feature-card-title">🎮 NSO 會員跨區比價</div>
          <div className="feature-card-sub">
            一般、擴充、家庭會員與遊戲兌換券，35 國比價
          </div>
        </Link>
        <Link href="/ranking" className="feature-card">
          <div className="feature-card-title">🏆 收藏排行</div>
          <div className="feature-card-sub">大家收藏最多的遊戲 TOP 10</div>
        </Link>
        <Link href="/taiwan" className="feature-card">
          <div className="feature-card-title">🇹🇼 台灣完整目錄</div>
          <div className="feature-card-sub">台灣官方目錄完整清單</div>
        </Link>
      </div>
    </>
  );
}
