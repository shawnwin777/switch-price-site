import Link from "next/link";
import { getCachedXboxConsoleDeals } from "@/lib/cached-data";
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
 *  PS 家機：官方搜尋 GraphQL（getSearchResults，persisted hash 已破解）
 *  ＋價格已打通，且以《A Way Out》驗證過匿名抓到的價
 *  （NT$850→NT$170，-80%）與未登入商店產品頁內嵌價一致；但官方
 *  優惠頁走另一個 EMS 查詢（hash 未知、JS 內無內嵌），多詞搜尋聯集
 *  產出太低（16 個詞 382 款僅 37 款特價），沒有穩定的伺服器端
 *  優惠清單來源，所以 PS 分頁先不上線——ConsoleTabs 收到 ps 資料
 *  時分頁自動出現。下一步：瀏覽器實測抓優惠頁 hash，或找
 *  Chihiro 優惠容器 ID。 */
export default async function ConsolePage() {
  const xboxConsole = await getCachedXboxConsoleDeals();

  return (
    <>
      <h1 className="page-title">
        🕹️ 家機<span>特價</span>
      </h1>
      <p className="muted">
        台灣區 Xbox 家機特價完整清單，每小時更新一次。
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
      />
      <p className="muted">
        PS 家機特價正在接洽官方來源（搜尋與價格已打通，優惠清單還在找
        穩定的抓法），Xbox 家機先上線。
      </p>
      <p>
        <Link href="/">← 回首頁</Link>
      </p>
    </>
  );
}
