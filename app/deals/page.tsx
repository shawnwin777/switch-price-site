import Link from "next/link";
import { getCachedDealsPage, getCachedXboxPcDeals } from "@/lib/cached-data";
import { formatTaipei } from "@/lib/format";
import DealsTabs from "@/components/DealsTabs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Steam＋Epic＋Xbox 特價（台灣）｜Switch 遊戲比價",
};

/** Steam 特價＋Epic 免費遊戲＋Xbox PC 特價的完整清單頁（只做台灣區）。
 *  上方三個平台分頁框（Epic／Steam／Xbox PC），點了不跳頁、不換路由，
 *  當下就切換顯示該平台的遊戲；三個平台各自都能摺疊（預設展開）。
 *  每平台取前 200 款，一次只顯示 24 款，在頁內翻頁。
 *  Epic 只有免費遊戲（本週＋下週預告；Epic 特價抓不到——官網 403 擋機器人）；
 *  Steam 取折扣最大的前 200 款（特價搜尋 API，台灣區特價中共 15,020 款）；
 *  Xbox PC 取折扣最大的前 200 款（台灣區共約 500 款特價）。
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
      <DealsTabs
        epicCurrent={deals.epicCurrent}
        epicUpcoming={deals.epicUpcoming}
        steam={deals.steam}
        steamTotalCount={deals.steamTotalCount}
        xbox={xbox.items}
        xboxTotalCount={xbox.totalCount}
      />
      <p>
        <Link href="/">← 回首頁</Link>
      </p>
    </>
  );
}
