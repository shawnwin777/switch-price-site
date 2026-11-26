import {
  getCachedConsoleFreeGames,
  getCachedGamePassNew,
  getCachedPsDeals,
  getCachedPsPlusNew,
  getCachedXboxConsoleDeals,
  type ConsoleFreeGamesData,
} from "@/lib/cached-data";
import { formatTaipei } from "@/lib/format";
import type { GamePassNewData } from "@/lib/gamepass";
import type { PsDealsData } from "@/lib/ps-deals";
import type { PsPlusNewData } from "@/lib/ps-plus";
import type { XboxConsoleDealsData } from "@/lib/xbox-console-deals";
import ConsoleTabs from "@/components/ConsoleTabs";

export const dynamic = "force-dynamic";

// PS 掃描整輪約 25–40 秒（含空頁重掃的等待），拉到 Vercel Hobby 上限 60 秒
// 跟 /api/refresh、/api/sync-catalog 同一個做法，免得掃描做到一半被砍
// （2026-11-24：上限拉到 1621 後 Vercel 兩輪掃描都只收到 1,378 款，
// 空頁重掃見 lib/ps-deals.ts）。

export const metadata = {
  title: "家機特價（台灣）｜Shawn Game Studio",
};

/** 家機特價頁（/console，2026-11-23 新增）：
 *  shawn 12:17 改方向——家機不做 /deals 的第四個分頁，改獨立頁面；
 *  /deals 維持 PC 頁（免費遊戲／STEAM／XBOX PC），三大頁面是
 *  PC（/deals）、家機（本頁）、SWITCH（首頁）。
 *  2026-11-23 14:00 shawn 再定：會員方案不再單獨成頁，改放進
 *  XGP 家機（Game Pass）與 PS Plus 兩個分頁裡（新進遊戲在上、
 *  方案價目在下）；本頁有五個分頁：免費遊戲（最左，2026-11-26 新增，
 *  家機免費遊戲）、XBOX 家機（預設）、XGP 家機、PlayStation、PS Plus。
 *  舊 /membership 導向本頁，導覽列不再單獨列會員方案。
 *  XBOX 家機：Reco 特價清單＋Display Catalog（filter Windows.Xbox，
 *  與 PC 版同一條管線），前 900 款、每頁 30 款、折扣大→小，每小時快取。
 *  分頁狀態進 URL（低 B-3，2026-11-23）：?tab= 決定初始分頁（無效值
 *  回預設 XBOX 家機），?page= 決定該分頁初始頁碼；切換時元件用
 *  router.push／replace 更新 URL，上一頁能還原分頁。
 *  PS 家機（2026-11-23 上線，2026-11-23 擴量）：官方 GraphQL categoryGridRetrieve
 *  （persisted hash 來自公開文件，見 lib/ps-deals.ts），抓優惠頁「所有優惠」
 *  分類（總數 2,862），sales30 倒序分段抓、只列折扣 ≥50% 的，折扣大→小、
 *  前 1621 款；價格已抽 2 款對照未登入商店產品頁驗證過。
 *  GAME PASS／PS PLUS 新進（2026-11-23 新增）：Game Pass 最近新增（家機，
 *  見 lib/gamepass.ts）、PS Plus 本月新進（遊戲目錄＋每月遊戲，
 *  見 lib/ps-plus.ts），都只列本期／本月新進、不列整個目錄。 */
const EMPTY_XBOX_CONSOLE: XboxConsoleDealsData = {
  items: [],
  fetchedAt: "",
  totalCount: 0,
  shownCount: 0,
};
const EMPTY_PS: PsDealsData = {
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
const EMPTY_PS_PLUS: PsPlusNewData = {
  items: [],
  fetchedAt: "",
  month: null,
  catalogUrl: null,
  monthlyUrl: null,
  totalCount: 0,
  shownCount: 0,
};
const EMPTY_CONSOLE_FREE: ConsoleFreeGamesData = {
  items: [],
  fetchedAt: "",
};

export default async function ConsolePage({
  searchParams,
}: {
  searchParams: { tab?: string; page?: string };
}) {
  // ?tab= 決定初始分頁（無效值回預設 xbox-console），?page= 決定該分頁初始頁碼。
  const rawTab = searchParams.tab;
  const initialTab:
    | "xbox-console"
    | "gamepass"
    | "ps"
    | "psplus"
    | "free" =
    rawTab === "xbox-console" ||
    rawTab === "gamepass" ||
    rawTab === "ps" ||
    rawTab === "psplus" ||
    rawTab === "free"
      ? rawTab
      : "xbox-console";
  const initialPage = Math.max(
    1,
    parseInt(searchParams.page ?? "1", 10) || 1
  );
  // 單一來源抓失敗時（getter 拋錯、空結果不進快取）只讓該分頁顯示空狀態，
  // 不拖垮整頁；下次請求會重抓（2026-11-23 Xbox 三分頁 18:14 中毒的教訓）。
  const [xboxConsole, ps, gamepassConsole, psplus, consoleFree] =
    await Promise.all([
      getCachedXboxConsoleDeals().catch(() => EMPTY_XBOX_CONSOLE),
      getCachedPsDeals().catch(() => EMPTY_PS),
      getCachedGamePassNew("console").catch(() => EMPTY_GAMEPASS),
      getCachedPsPlusNew().catch(() => EMPTY_PS_PLUS),
      getCachedConsoleFreeGames().catch(() => EMPTY_CONSOLE_FREE),
    ]);

  return (
    <>
      <h1 className="page-title">
        🕹️ 家機<span>特價</span>
      </h1>
      <p className="muted">
        家機免費遊戲、Xbox 家機特價、XGP 家機新進＋Game Pass 方案價目、PlayStation
        特價、PS Plus 本月新進＋PS Plus 方案價目——五個分頁都在這一頁，上方點分頁切換、不跳頁。
        特價清單是台灣區、每小時更新一次；只列台灣區——跨區帳號可能被鎖，這裡不做跨區切換。
        家機免費遊戲跟 /deals 免費區同一份來源（GamerPower 聚合）、
        每小時自動更新，DLC 與跨平台品項有標註。
      </p>
      <p className="muted">
        資料更新：
        {xboxConsole.fetchedAt
          ? formatTaipei(xboxConsole.fetchedAt)
          : "尚無資料"}
      </p>
      {/* 中-5：Xbox 家機文案附註——分頁標題「折扣最大的 N 款 · 台灣區共
          M 款特價」看起來矛盾，是因為兩個數字口徑不同：N 是去重後的有效
          款數，M 是清單 API 回報的原始總數。數字用 live 數插值（款數每小時
          浮動，寫死 900 會在掉到 470 時變錯）；分頁框內的標題與附註在
          components/ConsoleTabs.tsx，不在本檔範圍，仍待那邊同步改寫。 */}
      <p className="muted">
        Xbox 家機附註：本頁列出折扣最大的 {xboxConsole.items.length} 款（台灣區
        特價清單去重後的有效款數）；
        {xboxConsole.totalCount > 0
          ? `「台灣區共 ${xboxConsole.totalCount.toLocaleString("zh-Hant-TW")} 款」是清單 API 回報的原始總數（未去重），與去重後的有效款數口徑不同。`
          : "清單 API 回報的原始總數（未去重）與去重後的有效款數口徑不同。"}
      </p>
      <ConsoleTabs
        xboxConsole={xboxConsole.items}
        xboxConsoleTotalCount={xboxConsole.totalCount}
        ps={ps.items}
        psTotalCount={ps.totalCount}
        gamepass={gamepassConsole.items}
        gamepassTotalCount={gamepassConsole.totalCount}
        psplus={psplus.items}
        psplusMonth={psplus.month}
        psplusCatalogUrl={psplus.catalogUrl}
        psplusMonthlyUrl={psplus.monthlyUrl}
        consoleFree={consoleFree.items}
        initialTab={initialTab}
        initialPage={initialPage}
      />
    </>
  );
}
