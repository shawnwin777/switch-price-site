"use client";

import { useState } from "react";
import type { DealsCarouselItem } from "@/lib/deals-carousel";
import { pageWindow } from "@/lib/pagination";
import DealCard from "./DealCard";

/** 每頁顯示款數（比照 /deals：一次只呈現 24 款）。 */
const PAGE_SIZE = 24;

type TabKey = "xbox-console" | "ps";

const TABS: { key: TabKey; label: string }[] = [
  { key: "xbox-console", label: "XBOX 家機" },
  { key: "ps", label: "PS" },
];

/** /console 家機頁的分頁框：同一頁上方切換平台，點了不跳頁、不換路由。
 *  面板永遠展開、不摺疊（跟 /deals 一樣）。
 *  XBOX 家機：Reco 清單＋Display Catalog（filter Windows.Xbox），
 *  前 200 款、折扣大→小。PS 分頁目前還沒資料就不顯示——
 *  官方搜尋＋價格已打通，但優惠清單還沒有穩定的伺服器端來源
 *  （見本頁下方的說明）；ps 有資料傳進來時分頁自動出現。 */
export default function ConsoleTabs({
  xboxConsole,
  xboxConsoleTotalCount,
  ps,
  psTotalCount,
}: {
  xboxConsole: DealsCarouselItem[];
  xboxConsoleTotalCount: number;
  ps?: DealsCarouselItem[];
  psTotalCount?: number;
}) {
  const showPs = (ps?.length ?? 0) > 0;
  const tabs = showPs ? TABS : TABS.filter((t) => t.key === "xbox-console");
  // 預設 XBOX 家機（目前唯一有資料的分頁）。
  const [active, setActive] = useState<TabKey>("xbox-console");
  const [pages, setPages] = useState<Record<TabKey, number>>({
    "xbox-console": 1,
    ps: 1,
  });

  const counts: Record<TabKey, number> = {
    "xbox-console": xboxConsole.length,
    ps: ps?.length ?? 0,
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

      {active === "ps" && showPs && (
        <section className="deals-section" aria-label="PS">
          {sectionHead(
            "🔵 PS",
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
            <p className="muted">目前 PS 台灣區沒有特價資訊，請稍後再試。</p>
          )}
          {renderPager("ps")}
        </section>
      )}
    </div>
  );
}
