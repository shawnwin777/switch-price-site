import Link from "next/link";
import { getCachedDealsPage, getCachedXboxPcDeals } from "@/lib/cached-data";
import { formatTaipei } from "@/lib/format";
import DealsTabs from "@/components/DealsTabs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "PC遊戲特價（台灣）｜Switch 遊戲比價",
};

/** PC 遊戲特價完整清單頁（只做台灣區）。
 *  上方三個分頁框（免費遊戲／STEAM／XBOX），點了不跳頁、不換路由，
 *  當下就切換顯示該平台的遊戲；面板永遠展開、不摺疊（2026-11-23：
 *  用分頁框的模式摺疊就沒意義了，收合按鈕全部拿掉）。
 *  每平台取前 200 款，一次只顯示 24 款，在頁內翻頁。
 *  免費遊戲分頁：Epic 免費遊戲（本週＋下週預告；Epic 特價抓不到——
 *  官網 403 擋機器人）＋Steam 限時免費領取（折扣 100% 的付費遊戲）；
 *  STEAM 分頁取折扣最大的前 200 款（特價搜尋 API，台灣區特價中共 15,020 款）；
 *  XBOX 分頁取折扣最大的前 200 款（台灣區共約 500 款特價）。
 *  資料伺服器端抓取、每小時快取（lib/cached-data.ts）。 */
export default async function DealsPage() {
  const [deals, xbox] = await Promise.all([
    getCachedDealsPage(),
    getCachedXboxPcDeals(),
  ]);

  return (
    <>
      <h1 className="page-title">
        🎮 PC遊戲<span>特價</span>
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
        steamFree={deals.steamFree}
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
