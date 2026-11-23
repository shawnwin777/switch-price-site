"use client";

import { useState } from "react";
import type { DealsCarouselItem } from "@/lib/deals-carousel";
import { pageWindow } from "@/lib/pagination";
import DealCard from "./DealCard";

/** 每頁顯示款數（shawn 定：一次只呈現 24 款）。 */
const PAGE_SIZE = 24;

type TabKey = "free" | "steam" | "xbox";

const TABS: { key: TabKey; label: string }[] = [
  { key: "free", label: "免費遊戲" },
  { key: "steam", label: "STEAM" },
  { key: "xbox", label: "XBOX PC" },
];

/** /deals 分頁框：同一頁上方三個分頁，點了不跳頁、不換路由，
 *  當下就切換顯示該平台的遊戲（client-side 切換）。
 *  面板永遠展開、不摺疊（2026-11-23：分頁框模式下摺疊沒意義）。
 *  免費遊戲分頁：Epic 免費遊戲（本週＋下週預告）＋Steam 限時免費領取
 *  （折扣 100% 的付費遊戲，可永久保留；免費遊玩 F2P 不在這裡）。
 *  每平台取前 200 款，一次只顯示 24 款，在頁內翻頁。
 *  家機不在這頁：2026-11-23 12:17 shawn 改方向，Xbox 家機改去獨立頁
 *  /console，本頁維持 PC 頁（免費遊戲／STEAM／XBOX PC）。 */
export default function DealsTabs({
  epicCurrent,
  epicUpcoming,
  steamFree,
  steam,
  steamTotalCount,
  xbox,
  xboxTotalCount,
}: {
  epicCurrent: DealsCarouselItem[];
  epicUpcoming: DealsCarouselItem[];
  steamFree: DealsCarouselItem[];
  steam: DealsCarouselItem[];
  steamTotalCount: number;
  xbox: DealsCarouselItem[];
  xboxTotalCount: number;
}) {
  // 預設 Steam（內容最多，特賣會期間第一眼就有 24 款可看）。
  const [active, setActive] = useState<TabKey>("steam");
  const [pages, setPages] = useState<Record<TabKey, number>>({
    free: 1,
    steam: 1,
    xbox: 1,
  });

  const counts: Record<TabKey, number> = {
    free: epicCurrent.length + epicUpcoming.length + steamFree.length,
    steam: steam.length,
    xbox: xbox.length,
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

  const steamPage = pageItems("steam", steam);
  const xboxPage = pageItems("xbox", xbox);

  return (
    <div>
      <div className="deals-tabs" role="tablist" aria-label="平台切換">
        {TABS.map((t) => (
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

      {active === "free" && (
        <section className="deals-section" aria-label="免費遊戲">
          {sectionHead(
            "🎮 免費遊戲",
            `Epic 本週 ${epicCurrent.length} 款 · 下週預告 ${epicUpcoming.length} 款 · Steam 限時免費 ${steamFree.length} 款`
          )}
          <div className="deals-section-body">
            {epicCurrent.length > 0 ? (
              <>
                <h3 className="deals-subhead">Epic 本週免費領取</h3>
                <div className="deals-grid">
                  {epicCurrent.map((item) => (
                    <DealCard key={item.key} item={item} />
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">
                本週 Epic 台灣區暫無進行中的免費遊戲，下週預告如下。
              </p>
            )}
            {epicUpcoming.length > 0 && (
              <>
                <h3 className="deals-subhead">Epic 下週預告</h3>
                <div className="deals-grid">
                  {epicUpcoming.map((item) => (
                    <DealCard key={item.key} item={item} />
                  ))}
                </div>
              </>
            )}
            {steamFree.length > 0 && (
              <>
                <h3 className="deals-subhead">Steam 限時免費領取</h3>
                <div className="deals-grid">
                  {steamFree.map((item) => (
                    <DealCard key={item.key} item={item} />
                  ))}
                </div>
              </>
            )}
            {counts.free === 0 && (
              <p className="muted">
                目前 Epic 與 Steam 台灣區都沒有免費遊戲資訊，請稍後再試。
              </p>
            )}
          </div>
        </section>
      )}

      {active === "steam" && (
        <section className="deals-section" aria-label="STEAM">
          {sectionHead(
            "🔥 STEAM",
            `折扣大→小 · 前 ${steam.length} 款` +
              (steamTotalCount > 0
                ? ` · 台灣區特價中 ${steamTotalCount.toLocaleString("zh-Hant-TW")} 款`
                : "")
          )}
          {steamPage.length > 0 ? (
            <div className="deals-grid">
              {steamPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 Steam 台灣區沒有特價資訊，請稍後再試。
            </p>
          )}
          {renderPager("steam")}
        </section>
      )}

      {active === "xbox" && (
        <section className="deals-section" aria-label="XBOX PC">
          {sectionHead(
            "🟢 XBOX PC",
            `折扣最大的 ${xbox.length} 款` +
              (xboxTotalCount > 0
                ? ` · 台灣區共 ${xboxTotalCount.toLocaleString("zh-Hant-TW")} 款特價`
                : "")
          )}
          {xboxPage.length > 0 ? (
            <div className="deals-grid">
              {xboxPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 Xbox PC 台灣區沒有特價資訊，請稍後再試。
            </p>
          )}
          {renderPager("xbox")}
          <p className="muted">
            完整清單請看{" "}
            <a
              href="https://www.microsoft.com/zh-tw/store/top-paid/games/pc?isdeal=true"
              target="_blank"
              rel="noopener noreferrer"
            >
              微軟商店台灣區 PC 特價頁 →
            </a>
          </p>
        </section>
      )}
    </div>
  );
}
