import Link from "next/link";
import { getCachedPsDeals, getCachedXboxConsoleDeals } from "@/lib/cached-data";
import { formatTaipei } from "@/lib/format";
import ConsoleTabs from "@/components/ConsoleTabs";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "家機特價（台灣）｜Switch 遊戲比價",
};

/** 家機特價頁（/console，2026-11-23 新增）：
 *  shawn 12:17 改方向——家機不做 /deals 的第四個分頁，改獨立頁面；
 *  /deals 維持 PC 頁（免費遊戲／STEAM／XBOX PC），三大頁面是
 *  PC（/deals）、家機（本頁）、SWITCH（首頁）。
 *  XBOX 家機：Reco 特價清單＋Display Catalog（filter Windows.Xbox，
 *  與 PC 版同一條管線），前 200 款、每頁 24 款、折扣大→小，每小時快取。
 *  PS 家機（2026-11-23 上線）：官方 GraphQL categoryGridRetrieve
 *  （persisted hash 來自公開文件，見 lib/ps-deals.ts），抓 SALES＋
 *  OFFERS 兩個特價分類、只列目前真的有折扣的（當下 44 款，沒大檔期
 *  所以少）；價格已抽 2 款對照未登入商店產品頁驗證過。 */
export default async function ConsolePage() {
  const [xboxConsole, ps] = await Promise.all([
    getCachedXboxConsoleDeals(),
    getCachedPsDeals(),
  ]);

  return (
    <>
      <h1 className="page-title">
        🕹️ 家機<span>特價</span>
      </h1>
      <p className="muted">
        台灣區 Xbox 家機與 PS 特價完整清單，每小時更新一次。
        只列台灣區——跨區帳號可能被鎖，這裡不做跨區切換。
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
      />
      <p className="muted">
        PS 特價取自官方商店的特價分類（SALES＋OFFERS），只列目前真的有折扣的遊戲；款數會隨檔期浮動。
      </p>
      <p>
        <Link href="/">← 回首頁</Link>
      </p>
    </>
  );
}
