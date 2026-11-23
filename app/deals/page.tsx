import Link from "next/link";
import { getCachedDealsPage, getCachedXboxPcDeals } from "@/lib/cached-data";
import { formatTaipei } from "@/lib/format";
import DealCard from "@/components/DealCard";
import EpicDealsSection from "@/components/EpicDealsSection";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Steam＋Epic＋Xbox 特價（台灣）｜Switch 遊戲比價",
};

/** Steam 特價＋Epic 免費遊戲＋Xbox PC 特價的完整清單頁（只做台灣區）。
 *  順序：Epic 在上、可摺疊（遊戲少）；Steam 在中（specials 全部列出）；
 *  Xbox PC 在下（台灣區特價前 50 款，折扣大→小）。
 *  資料伺服器端抓取、每小時快取（lib/cached-data.ts）。 */
export default async function DealsPage() {
  const [deals, xbox] = await Promise.all([
    getCachedDealsPage(),
    getCachedXboxPcDeals(),
  ]);

  return (
    <>
      <h1 className="page-title">
        🎮 Steam＋Epic＋Xbox <span>特價</span>
      </h1>
      <p className="muted">
        台灣區 Steam 特價、Epic 免費遊戲與 Xbox PC 特價完整清單，每小時更新一次。
        只列台灣區——跨區帳號可能被鎖，這裡不做跨區切換。
      </p>
      <p className="muted">
        資料更新：
        {deals.fetchedAt ? formatTaipei(deals.fetchedAt) : "尚無資料"}
      </p>
      <EpicDealsSection
        current={deals.epicCurrent}
        upcoming={deals.epicUpcoming}
      />
      <section className="deals-section" aria-label="Steam 特價">
        <div className="deals-section-head">
          <h2 className="deals-section-title">🔥 Steam 特價</h2>
          <span className="deals-section-meta">
            {deals.steam.length} 款
          </span>
        </div>
        {deals.steam.length > 0 ? (
          <div className="deals-grid">
            {deals.steam.map((item) => (
              <DealCard key={item.key} item={item} />
            ))}
          </div>
        ) : (
          <p className="muted">
            目前 Steam 台灣區沒有特價資訊，請稍後再試。
          </p>
        )}
      </section>
      <section className="deals-section" aria-label="Xbox PC 特價">
        <div className="deals-section-head">
          <h2 className="deals-section-title">🟢 Xbox PC 特價</h2>
          <span className="deals-section-meta">
            折扣最大的 {xbox.shownCount} 款
            {xbox.totalCount > 0 && ` · 台灣區共 ${xbox.totalCount} 款特價`}
          </span>
        </div>
        {xbox.items.length > 0 ? (
          <div className="deals-grid">
            {xbox.items.map((item) => (
              <DealCard key={item.key} item={item} />
            ))}
          </div>
        ) : (
          <p className="muted">
            目前 Xbox PC 台灣區沒有特價資訊，請稍後再試。
          </p>
        )}
        <p className="muted">
          完整清單請看{" "}
          <a
            href="https://www.microsoft.com/zh-tw/store/top-paid/games/pc?isdeal=true"
            target="_blank"
            rel="noopener noreferrer"
          >
            微軟商店台灣區 PC 特價頁 →
          </a>
        </p>
      </section>
      <p>
        <Link href="/">← 回首頁</Link>
      </p>
    </>
  );
}
