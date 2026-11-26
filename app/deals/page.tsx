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
import BackButton from "@/components/BackButton";
import BackToTop from "@/components/BackToTop";

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
 *  免費遊戲分頁（2026-11-26 改吃免費資源自動抓的清單）：
 *  免費資源自動抓（Epic 官方＋GOG 官方＋GamerPower 聚合）的 PC 完整遊戲
 *  （進行中＋即將免費，見 data/free-games.json、lib/free-games.ts，
 *  每日同步 cron 從 artifact 重新產生）＋Steam 限時免費領取
 *  （折扣 100% 的付費遊戲）；Epic 本來就在免費資源清單裡，
 *  原本只顯示 Epic 的專區已併入，不再單獨列。
 *  STEAM 分頁取折扣最大的前 900 款（特價搜尋 API，抓前 10 頁 1000 列再取前 900，
 *  不是全台灣 15,020 款裡的全域前 900）；
 *  XBOX PC 分頁取折扣最大的前 900 款（台灣區共約 500 款特價）。
 *  GAME PASS 分頁（2026-11-23 新增）：Game Pass 最近新增（PC），
 *  官方最近新增清單順序、卡片標「新進」（見 lib/gamepass.ts）。
 *  EA／UBISOFT／FANATICAL 分頁（2026-11-26 新增）：三家都是美國商店、
 *  美元計價；EA 特價頁全清單、Ubisoft 特價頁前 36 款、Fanatical
 *  官方 MCP 特價前 100 款（見 lib/ea-deals.ts、lib/ubisoft-deals.ts、
 *  lib/fanatical-deals.ts；每小時自動更新）。
 *  家機不在這頁：2026-11-23 12:17 shawn 改方向，Xbox 家機改去獨立頁
 *  /console（PS 家機也在那頁等上線），本頁維持 PC 頁。
 *  資料伺服器端抓取、每小時快取（lib/cached-data.ts）。
 *  版權聲明（2026-11-26 新增，頁面最下方）：本頁各平台的遊戲名稱、
 *  圖片、價格皆取自該平台官方商店，版權與商標歸各權利人所有；
 *  本站與各平台均無關聯，亦未獲得其背書或授權。 */
const EMPTY_DEALS: DealsPageData = {
  items: [],
  steam: [],
  steamFree: [],
  epicCurrent: [],
  epicUpcoming: [],
  freeGames: [],
  freeGamesUpcoming: [],
  ea: [],
  ubisoft: [],
  fanatical: [],
  fetchedAt: "",
  steamCount: 0,
  steamFreeCount: 0,
  steamTotalCount: 0,
  steamFromFallback: false,
  epicCurrentCount: 0,
  epicUpcomingCount: 0,
  eaCount: 0,
  ubisoftCount: 0,
  fanaticalCount: 0,
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
  const initialTab:
    | "free"
    | "steam"
    | "xbox"
    | "gamepass"
    | "ea"
    | "ubisoft"
    | "fanatical" =
    rawTab === "free" ||
    rawTab === "steam" ||
    rawTab === "xbox" ||
    rawTab === "gamepass" ||
    rawTab === "ea" ||
    rawTab === "ubisoft" ||
    rawTab === "fanatical"
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
      <BackButton />
      <BackToTop />
      <h1 className="page-title">
        🎮 PC遊戲<span>特價</span>
      </h1>
      <p className="muted">
        台灣區 Steam 特價、免費遊戲領取（Epic／GOG／GamerPower）、Xbox PC
        特價、Game Pass 最近新增，以及 EA、Ubisoft、Fanatical（美國商店、
        美元計價）特價完整清單，每小時更新一次。
        只列台灣區——跨區帳號可能被鎖，這裡不做跨區切換。
      </p>
      <p className="muted">
        資料更新：
        {deals.fetchedAt ? formatTaipei(deals.fetchedAt) : "尚無資料"}
      </p>
      {/* 高-1：Steam 顯示的是 specials 備援（只有 10 款精選）時，在 STEAM
          分頁上方顯示「資料暫時不完整」提示（STEAM 是預設分頁，進頁就看得到；
          分頁框內的文案在 components/DealsTabs.tsx，不在本檔範圍）。
          中-6：STEAM 取數範圍附註——白話版：依折扣大→小取前 1500（本體 1200＋DLC 300），
          不是台灣區全部特價（程式現況，見 lib/deals-carousel.ts）。 */}
      {deals.steamFromFallback && (
        <p className="muted">
          ⚠️ Steam 資料暫時不完整：特價搜尋暫時抓不到，目前 STEAM 只顯示{" "}
          {deals.steam.length} 款精選（不是完整特價清單）；每小時會重新抓取，
          恢復後自動回到完整清單。Epic 免費遊戲與其他分頁不受影響。
        </p>
      )}
      <p className="muted">
        STEAM 是以折扣大到小，取前 1500 款（本體前 1200＋DLC 前 300），不是台灣區全部
        {deals.steamTotalCount > 0
          ? ` ${deals.steamTotalCount.toLocaleString("zh-Hant-TW")} 款`
          : "約 20,529 款"}
        特價。
      </p>
      <DealsTabs
        freeGames={deals.freeGames}
        freeGamesUpcoming={deals.freeGamesUpcoming}
        steamFree={deals.steamFree}
        steam={deals.steam}
        steamTotalCount={deals.steamTotalCount}
        steamFromFallback={deals.steamFromFallback}
        xbox={xbox.items}
        xboxTotalCount={xbox.totalCount}
        gamepass={gamepassPc.items}
        gamepassTotalCount={gamepassPc.totalCount}
        ea={deals.ea}
        ubisoft={deals.ubisoft}
        fanatical={deals.fanatical}
        initialTab={initialTab}
        initialPage={initialPage}
      />
      {/* 版權聲明（2026-11-26 新增，整頁最下方）：本頁各平台的遊戲名稱、
          圖片、價格皆取自該平台官方商店，版權與商標歸各權利人所有；
          本站與各平台均無關聯，亦未獲得其背書或授權；圖片為直接引用
          官方商店圖片連結，未下載轉存；價格僅供參考，以各官方商店
          結帳頁為準。語氣跟頁尾非官方聲明一致。 */}
      <p className="muted">
        本頁遊戲名稱、圖片、價格皆取自各平台官方商店公開資料：Steam、Epic
        Games、Xbox／Microsoft（含 Game
        Pass）、EA、Ubisoft、Fanatical、GamerPower、GOG，版權與商標歸各權利人所有。本站與上述任何平台均無關聯，亦未獲得其背書或授權。圖片為直接引用官方商店圖片連結，未下載轉存；價格僅供參考，以各官方商店結帳頁為準。
      </p>
    </>
  );
}
