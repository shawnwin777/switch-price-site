"use client";

import { useState } from "react";
import type { DealsCarouselItem } from "@/lib/deals-carousel";
import { pageWindow } from "@/lib/pagination";
import DealCard from "./DealCard";
import MembershipServiceSection from "./MembershipTabs";

/** 每頁顯示款數（比照 /deals：一次只呈現 24 款）。 */
const PAGE_SIZE = 24;

type TabKey = "xbox-console" | "gamepass" | "ps" | "psplus";

const TABS: { key: TabKey; label: string }[] = [
  { key: "xbox-console", label: "XBOX 家機" },
  { key: "gamepass", label: "XGP 家機" },
  { key: "ps", label: "PlayStation" },
  { key: "psplus", label: "PS Plus" },
];

/** /console 家機頁的分頁框：只有四個分頁、順序固定，點了不跳頁、不換路由。
 *  面板永遠展開、不摺疊（跟 /deals 一樣）。
 *  1. XBOX 家機：Reco 清單＋Display Catalog（filter Windows.Xbox），
 *     前 350 款、折扣大→小，預設顯示。
 *  2. XGP 家機：Game Pass 最近新增（家機），官方清單順序、卡片標「新進」；
 *     下方接 Game Pass 方案價目。
 *  3. PlayStation：官方優惠分類，折扣 ≥50%、前 350 款。
 *  4. PS Plus：PS Plus 本月新進（遊戲目錄＋每月遊戲），PS Blog 當月文章
 *     解析、官方搜尋對應商店商品；下方接 PS Plus 方案價目。
 *  2026-11-23 14:00 shawn 再定：獨立的「🎫 會員方案」分頁拿掉，
 *  方案價目改放進 XGP 家機與 PS Plus 兩個分頁裡（新進遊戲在上、
 *  方案價目在下，各自呈現、不做對比表）。
 *  XGP 家機、PS Plus 兩個分頁永遠顯示——裡面有靜態方案價目，
 *  就算新進遊戲沒資料也不能整個分頁消失；新進遊戲區沒資料時
 *  只在區內顯示「目前沒有資訊，請稍後再試」。 */
export default function ConsoleTabs({
  xboxConsole,
  xboxConsoleTotalCount,
  ps,
  psTotalCount,
  gamepass,
  gamepassTotalCount,
  psplus,
  psplusMonth,
  psplusCatalogUrl,
  psplusMonthlyUrl,
}: {
  xboxConsole: DealsCarouselItem[];
  xboxConsoleTotalCount: number;
  ps?: DealsCarouselItem[];
  psTotalCount?: number;
  gamepass?: DealsCarouselItem[];
  gamepassTotalCount?: number;
  psplus?: DealsCarouselItem[];
  psplusMonth?: string | null;
  psplusCatalogUrl?: string | null;
  psplusMonthlyUrl?: string | null;
}) {
  // 四個分頁永遠顯示（XGP 家機、PS Plus 裡有靜態方案價目，
  // 新進遊戲沒資料時分頁也不消失，只在遊戲區顯示空狀態）。
  const tabs = TABS;
  // 預設 XBOX 家機（第一分頁）。
  const [active, setActive] = useState<TabKey>("xbox-console");
  const [pages, setPages] = useState<Record<TabKey, number>>({
    "xbox-console": 1,
    gamepass: 1,
    ps: 1,
    psplus: 1,
  });

  const counts: Record<TabKey, number> = {
    "xbox-console": xboxConsole.length,
    gamepass: gamepass?.length ?? 0,
    ps: ps?.length ?? 0,
    psplus: psplus?.length ?? 0,
  };
  const totalPages = (key: TabKey) =>
    Math.max(1, Math.ceil(counts[key] / PAGE_SIZE));
  const pageItems = (key: TabKey, all: DealsCarouselItem[]) => {
    const p = Math.min(Math.max(1, pages[key]), totalPages(key));
    return all.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  };
  const goPage = (key: TabKey, p: number) =>
    setPages((prev) => ({ ...prev, [key]: p }));

  const renderPager = (key: TabKey) => {
    const total = totalPages(key);
    if (total <= 1) return null;
    const p = Math.min(Math.max(1, pages[key]), total);
    return (
      <nav className="pagination deals-pager" aria-label="分頁">
        <button
          type="button"
          className="chip"
          disabled={p <= 1}
          onClick={() => goPage(key, p - 1)}
        >
          ← 上一頁
        </button>
        {pageWindow(p, total).map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="ellipsis">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              className={`chip page-num ${n === p ? "active" : ""}`}
              aria-current={n === p ? "page" : undefined}
              onClick={() => goPage(key, n)}
            >
              {n}
            </button>
          )
        )}
        <button
          type="button"
          className="chip"
          disabled={p >= total}
          onClick={() => goPage(key, p + 1)}
        >
          下一頁 →
        </button>
      </nav>
    );
  };

  const sectionHead = (title: string, meta: string) => (
    <div className="deals-section-head">
      <h2 className="deals-section-title">{title}</h2>
      <span className="deals-section-meta">{meta}</span>
    </div>
  );

  const xboxConsolePage = pageItems("xbox-console", xboxConsole);
  const psPage = pageItems("ps", ps ?? []);
  const gamepassPage = pageItems("gamepass", gamepass ?? []);
  const psplusPage = pageItems("psplus", psplus ?? []);

  return (
    <div>
      <div className="deals-tabs" role="tablist" aria-label="平台切換">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`deals-tab ${active === t.key ? "active" : ""}`}
            onClick={() => setActive(t.key)}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {active === "xbox-console" && (
        <section className="deals-section" aria-label="XBOX 家機">
          {sectionHead(
            "🟢 XBOX 家機",
            `折扣最大的 ${xboxConsole.length} 款` +
              (xboxConsoleTotalCount > 0
                ? ` · 台灣區共 ${xboxConsoleTotalCount.toLocaleString("zh-Hant-TW")} 款特價`
                : "")
          )}
          {xboxConsolePage.length > 0 ? (
            <div className="deals-grid">
              {xboxConsolePage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 Xbox 家機台灣區沒有特價資訊，請稍後再試。
            </p>
          )}
          {renderPager("xbox-console")}
          <p className="muted">
            完整清單請看{" "}
            <a
              href="https://www.microsoft.com/zh-tw/store/top-paid/games/xbox?isdeal=true"
              target="_blank"
              rel="noopener noreferrer"
            >
              微軟商店台灣區 Xbox 特價頁 →
            </a>
          </p>
        </section>
      )}

      {active === "ps" && (
        <section className="deals-section" aria-label="PlayStation">
          {sectionHead(
            "🔵 PlayStation",
            `折扣最大的 ${ps?.length ?? 0} 款` +
              (psTotalCount != null && psTotalCount > 0
                ? ` · 台灣區共 ${psTotalCount.toLocaleString("zh-Hant-TW")} 款特價`
                : "")
          )}
          {psPage.length > 0 ? (
            <div className="deals-grid">
              {psPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">目前 PlayStation 台灣區沒有特價資訊，請稍後再試。</p>
          )}
          {renderPager("ps")}
        </section>
      )}

      {active === "gamepass" && (
        <section className="deals-section" aria-label="XGP 家機">
          {sectionHead(
            "🎮 Game Pass 最近新增（家機）",
            `本期新增 ${gamepass?.length ?? 0} 款` +
              (gamepassTotalCount != null && gamepassTotalCount > 0
                ? ` · 官方最近新增清單共 ${gamepassTotalCount} 款`
                : "")
          )}
          {gamepassPage.length > 0 ? (
            <div className="deals-grid">
              {gamepassPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 Game Pass 家機沒有最近新增的資訊，請稍後再試。
            </p>
          )}
          {renderPager("gamepass")}
          <p className="muted">
            完整目錄請看{" "}
            <a
              href="https://www.xbox.com/zh-TW/xbox-game-pass/games"
              target="_blank"
              rel="noopener noreferrer"
            >
              Xbox Game Pass 遊戲目錄 →
            </a>
          </p>
          <MembershipServiceSection serviceId="game-pass" />
        </section>
      )}

      {active === "psplus" && (
        <section className="deals-section" aria-label="PS Plus">
          {sectionHead(
            "🔵 PS Plus 本月新進",
            `${psplusMonth ?? "本月"}新進 ${psplus?.length ?? 0} 款 · 遊戲目錄＋每月遊戲`
          )}
          {psplusPage.length > 0 ? (
            <div className="deals-grid">
              {psplusPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 PS Plus 沒有本月新進的資訊，請稍後再試。
            </p>
          )}
          {renderPager("psplus")}
          <p className="muted">
            資料來源：PS Blog{" "}
            {psplusCatalogUrl && (
              <a href={psplusCatalogUrl} target="_blank" rel="noopener noreferrer">
                遊戲目錄文 →
              </a>
            )}
            {psplusCatalogUrl && psplusMonthlyUrl && " ／ "}
            {psplusMonthlyUrl && (
              <a href={psplusMonthlyUrl} target="_blank" rel="noopener noreferrer">
                每月遊戲文 →
              </a>
            )}
          </p>
          <MembershipServiceSection serviceId="ps-plus" />
        </section>
      )}
    </div>
  );
}
