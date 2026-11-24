import {
  getCachedDealsPage,
  getCachedGamePassNew,
  getCachedXboxPcDeals,
} from "@/lib/cached-data";
import type { DealsPageData } from "@/lib/deals-carousel";
import { formatTaipei } from "@/lib/format";
import type { GamePassNewData } from "@/lib/gamepass";
import type { XboxPcDealsData } from "@/lib/xbox-deals";
import DealsTabs from "@/components/DealsTabs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "PC遊戲特價（台灣）｜Shawn Game Studio",
};

/** PC 遊戲特價完整清單頁（只做台灣區）。
 *  上方三個分頁框（免費遊戲／STEAM／XBOX PC），點了不跳頁、
 *  不換路由，當下就切換顯示該平台的遊戲；面板永遠展開、不摺疊
 *  （2026-11-23：用分頁框的模式摺疊就沒意義了，收合按鈕全部拿掉）。
 *  分頁狀態進 URL（低 B-3，2026-11-23）：?tab= 決定初始分頁（無效值
 *  回預設 STEAM），?page= 決定該分頁初始頁碼；切換時元件用
 *  router.push／replace 更新 URL，上一頁能還原分頁。
 *  每平台取前 900 款（2026-11-24 從 510 改成 900），一次只顯示 30 款，在頁內翻頁（900 款剛好 30 頁）。
 *  免費遊戲分頁：Epic 免費遊戲（本週＋下週預告；Epic 特價抓不到——
 *  官網 403 擋機器人）＋Steam 限時免費領取（折扣 100% 的付費遊戲）；
 *  STEAM 分頁取折扣最大的前 900 款（特價搜尋 API，抓前 10 頁 1000 列再取前 900，
 *  不是全台灣 15,020 款裡的全域前 900）；
 *  XBOX PC 分頁取折扣最大的前 900 款（台灣區共約 500 款特價）。
 *  GAME PASS 分頁（2026-11-23 新增）：Game Pass 最近新增（PC），
 *  官方最近新增清單順序、卡片標「新進」（見 lib/gamepass.ts）。
 *  家機不在這頁：2026-11-23 12:17 shawn 改方向，Xbox 家機改去獨立頁
 *  /console（PS 家機也在那頁等上線），本頁維持 PC 頁。
 *  資料伺服器端抓取、每小時快取（lib/cached-data.ts）。 */
const EMPTY_DEALS: DealsPageData = {
  items: [],
  steam: [],
  steamFree: [],
  epicCurrent: [],
  epicUpcoming: [],
  fetchedAt: "",
  steamCount: 0,
  steamFreeCount: 0,
  steamTotalCount: 0,
  steamFromFallback: false,
  epicCurrentCount: 0,
  epicUpcomingCount: 0,
};
const EMPTY_XBOX_PC: XboxPcDealsData = {
  items: [],
  fetchedAt: "",
  totalCount: 0,
  shownCount: 0,
};
const EMPTY_GAMEPASS: GamePassNewData = {
  items: [],
  fetchedAt: "",
  totalCount: 0,
  shownCount: 0,
};

export default async function DealsPage({
  searchParams,
}: {
  searchParams: { tab?: string; page?: string };
}) {
  // ?tab= 決定初始分頁（無效值回預設 steam），?page= 決定該分頁初始頁碼。
  const rawTab = searchParams.tab;
  const initialTab: "free" | "steam" | "xbox" | "gamepass" =
    rawTab === "free" ||
    rawTab === "steam" ||
    rawTab === "xbox" ||
    rawTab === "gamepass"
      ? rawTab
      : "steam";
  const initialPage = Math.max(
    1,
    parseInt(searchParams.page ?? "1", 10) || 1
  );
  // 單一來源抓失敗時（getter 拋錯、空結果不進快取）只讓該分頁顯示空狀態，
  // 不拖垮整頁；下次請求會重抓（2026-11-23 Xbox 三分頁 18:14 中毒的教訓）。
  const [deals, xbox, gamepassPc] = await Promise.all([
    getCachedDealsPage().catch(() => EMPTY_DEALS),
    getCachedXboxPcDeals().catch(() => EMPTY_XBOX_PC),
    getCachedGamePassNew("pc").catch(() => EMPTY_GAMEPASS),
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
      {/* 高-1：Steam 顯示的是 specials 備援（只有 10 款精選）時，在 STEAM
          分頁上方顯示「資料暫時不完整」提示（STEAM 是預設分頁，進頁就看得到；
          分頁框內的文案在 components/DealsTabs.tsx，不在本檔範圍）。
          中-6：STEAM 取數範圍附註——抓前 10 頁 1000 列再取前 900，
          不是全台灣特價款裡的全域前 900（程式現況，見 lib/deals-carousel.ts）。 */}
      {deals.steamFromFallback && (
        <p className="muted">
          ⚠️ Steam 資料暫時不完整：特價搜尋暫時抓不到，目前 STEAM 只顯示{" "}
          {deals.steam.length} 款精選（不是完整特價清單）；每小時會重新抓取，
          恢復後自動回到完整清單。Epic 免費遊戲與其他分頁不受影響。
        </p>
      )}
      <p className="muted">
        STEAM 取數範圍：先抓特價搜尋前 10 頁（1000 列）再按折扣大→小取前 900
        款，不是全台灣特價中
        {deals.steamTotalCount > 0
          ? ` ${deals.steamTotalCount.toLocaleString("zh-Hant-TW")} 款`
          : "約 15,020 款"}
        裡的全域前 900 款。
      </p>
      <DealsTabs
        epicCurrent={deals.epicCurrent}
        epicUpcoming={deals.epicUpcoming}
        steamFree={deals.steamFree}
        steam={deals.steam}
        steamTotalCount={deals.steamTotalCount}
        steamFromFallback={deals.steamFromFallback}
        xbox={xbox.items}
        xboxTotalCount={xbox.totalCount}
        gamepass={gamepassPc.items}
        gamepassTotalCount={gamepassPc.totalCount}
        initialTab={initialTab}
        initialPage={initialPage}
      />
    </>
  );
}
