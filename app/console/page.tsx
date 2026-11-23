import Link from "next/link";
import {
  getCachedGamePassNew,
  getCachedPsDeals,
  getCachedPsPlusNew,
  getCachedXboxConsoleDeals,
} from "@/lib/cached-data";
import { formatTaipei } from "@/lib/format";
import ConsoleTabs from "@/components/ConsoleTabs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "家機特價（台灣）｜Shawn Game Studio",
};

/** 家機特價頁（/console，2026-11-23 新增）：
 *  shawn 12:17 改方向——家機不做 /deals 的第四個分頁，改獨立頁面；
 *  /deals 維持 PC 頁（免費遊戲／STEAM／XBOX PC），三大頁面是
 *  PC（/deals）、家機（本頁）、SWITCH（首頁）。
 *  2026-11-23 14:00 shawn 再定：會員方案不再單獨成頁，改放進
 *  XGP 家機（Game Pass）與 PS Plus 兩個分頁裡（新進遊戲在上、
 *  方案價目在下）；本頁只有四個分頁：XBOX 家機（預設）、XGP 家機、
 *  PlayStation、PS Plus。舊 /membership 導向本頁，導覽列不再單獨列
 *  會員方案。
 *  XBOX 家機：Reco 特價清單＋Display Catalog（filter Windows.Xbox，
 *  與 PC 版同一條管線），前 200 款、每頁 24 款、折扣大→小，每小時快取。
 *  PS 家機（2026-11-23 上線，2026-11-23 擴量）：官方 GraphQL categoryGridRetrieve
 *  （persisted hash 來自公開文件，見 lib/ps-deals.ts），抓優惠頁「所有優惠」
 *  分類（總數 2,862），sales30 倒序分段抓、只列折扣 ≥50% 的，折扣大→小、
 *  前 200 款；價格已抽 2 款對照未登入商店產品頁驗證過。
 *  GAME PASS／PS PLUS 新進（2026-11-23 新增）：Game Pass 最近新增（家機，
 *  見 lib/gamepass.ts）、PS Plus 本月新進（遊戲目錄＋每月遊戲，
 *  見 lib/ps-plus.ts），都只列本期／本月新進、不列整個目錄。 */
export default async function ConsolePage() {
  const [xboxConsole, ps, gamepassConsole, psplus] = await Promise.all([
    getCachedXboxConsoleDeals(),
    getCachedPsDeals(),
    getCachedGamePassNew("console"),
    getCachedPsPlusNew(),
  ]);

  return (
    <>
      <h1 className="page-title">
        🕹️ 家機<span>特價</span>
      </h1>
      <p className="muted">
        Xbox 家機特價、XGP 家機新進＋Game Pass 方案價目、PlayStation
        特價、PS Plus 本月新進＋PS Plus 方案價目——四個分頁都在這一頁，
        上方點分頁切換、不跳頁。
        特價清單是台灣區、每小時更新一次；只列台灣區——跨區帳號可能被鎖，這裡不做跨區切換。
      </p>
      <p className="muted">
        資料更新：
        {xboxConsole.fetchedAt
          ? formatTaipei(xboxConsole.fetchedAt)
          : "尚無資料"}
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
      />
      <p className="muted">
        PlayStation 特價取自官方商店的優惠分類（所有優惠，台灣區共 2,862 款），只列折扣
        ≥50% 的遊戲、折扣大→小、前 200 款；款數會隨檔期浮動。
      </p>
      <p>
        <Link href="/">← 回首頁</Link>
      </p>
    </>
  );
}
