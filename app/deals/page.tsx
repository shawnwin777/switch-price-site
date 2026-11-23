import Link from "next/link";
import {
  getCachedDealsPage,
  getCachedGamePassNew,
  getCachedXboxPcDeals,
} from "@/lib/cached-data";
import { formatTaipei } from "@/lib/format";
import DealsTabs from "@/components/DealsTabs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "PC遊戲特價（台灣）｜Shawn Game Studio",
};

/** PC 遊戲特價完整清單頁（只做台灣區）。
 *  上方三個分頁框（免費遊戲／STEAM／XBOX PC），點了不跳頁、
 *  不換路由，當下就切換顯示該平台的遊戲；面板永遠展開、不摺疊
 *  （2026-11-23：用分頁框的模式摺疊就沒意義了，收合按鈕全部拿掉）。
 *  每平台取前 350 款（2026-11-23 從 200 改成 350），一次只顯示 24 款，在頁內翻頁。
 *  免費遊戲分頁：Epic 免費遊戲（本週＋下週預告；Epic 特價抓不到——
 *  官網 403 擋機器人）＋Steam 限時免費領取（折扣 100% 的付費遊戲）；
 *  STEAM 分頁取折扣最大的前 350 款（特價搜尋 API，抓前 4 頁 400 列再取前 350，
 *  不是全台灣 15,020 款裡的全域前 350）；
 *  XBOX PC 分頁取折扣最大的前 350 款（台灣區共約 500 款特價）。
 *  GAME PASS 分頁（2026-11-23 新增）：Game Pass 最近新增（PC），
 *  官方最近新增清單順序、卡片標「新進」（見 lib/gamepass.ts）。
 *  家機不在這頁：2026-11-23 12:17 shawn 改方向，Xbox 家機改去獨立頁
 *  /console（PS 家機也在那頁等上線），本頁維持 PC 頁。
 *  資料伺服器端抓取、每小時快取（lib/cached-data.ts）。 */
export default async function DealsPage() {
  const [deals, xbox, gamepassPc] = await Promise.all([
    getCachedDealsPage(),
    getCachedXboxPcDeals(),
    getCachedGamePassNew("pc"),
  ]);

  return (
    <>
      <h1 className="page-title">
        🎮 PC遊戲<span>特價</span>
      </h1>
      <p className="muted">
        台灣區 Steam 特價、Epic 免費遊戲、Xbox PC 特價與 Game Pass
        最近新增完整清單，每小時更新一次。
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
        gamepass={gamepassPc.items}
        gamepassTotalCount={gamepassPc.totalCount}
      />
      <p>
        <Link href="/">← 回首頁</Link>
      </p>
    </>
  );
}
