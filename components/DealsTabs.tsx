"use client";

import { useState } from "react";
import type { DealsCarouselItem } from "@/lib/deals-carousel";
import { pageWindow } from "@/lib/pagination";
import DealCard from "./DealCard";

/** 每頁顯示款數（shawn 定：一次只呈現 24 款）。 */
const PAGE_SIZE = 24;

type TabKey = "epic" | "steam" | "xbox";

const TABS: { key: TabKey; label: string }[] = [
  { key: "epic", label: "Epic 免費" },
  { key: "steam", label: "Steam 特價" },
  { key: "xbox", label: "Xbox PC 特價" },
];

/** /deals 分頁框：同一頁上方三個平台分頁，點了不跳頁、不換路由，
 *  當下就切換顯示該平台的遊戲（client-side 切換）。
 *  三個平台各自都能摺疊：標題旁「▾ 收合／▸ 展開」，預設展開，
 *  點了把該平台的遊戲清單＋分頁控制一起收起來，再點展開。
 *  每平台取前 200 款，一次只顯示 24 款，在頁內翻頁。 */
export default function DealsTabs({
  epicCurrent,
  epicUpcoming,
  steam,
  steamTotalCount,
  xbox,
  xboxTotalCount,
}: {
  epicCurrent: DealsCarouselItem[];
  epicUpcoming: DealsCarouselItem[];
  steam: DealsCarouselItem[];
  steamTotalCount: number;
  xbox: DealsCarouselItem[];
  xboxTotalCount: number;
}) {
  // 預設 Steam（內容最多，特賣會期間第一眼就有 24 款可看）。
  const [active, setActive] = useState<TabKey>("steam");
  const [pages, setPages] = useState<Record<TabKey, number>>({
    epic: 1,
    steam: 1,
    xbox: 1,
  });
  const [open, setOpen] = useState<Record<TabKey, boolean>>({
    epic: true,
    steam: true,
    xbox: true,
  });

  const counts: Record<TabKey, number> = {
    epic: epicCurrent.length + epicUpcoming.length,
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
  const toggleOpen = (key: TabKey) =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

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

  const sectionHead = (
    key: TabKey,
    title: string,
    meta: string
  ) => (
    <div className="deals-section-head">
      <h2 className="deals-section-title">{title}</h2>
      <span className="deals-section-meta">{meta}</span>
      <button
        type="button"
        className="deals-collapse-btn"
        onClick={() => toggleOpen(key)}
        aria-expanded={open[key]}
      >
        {open[key] ? "▾ 收合" : "▸ 展開"}
      </button>
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
            {t.label}（{counts[t.key]}）
          </button>
        ))}
      </div>

      {active === "epic" && (
        <section className="deals-section" aria-label="Epic 免費遊戲">
          {sectionHead(
            "epic",
            "🎮 Epic 免費遊戲",
            `本週 ${epicCurrent.length} 款 · 下週預告 ${epicUpcoming.length} 款`
          )}
          {open.epic && (
            <div className="deals-section-body">
              {epicCurrent.length > 0 ? (
                <>
                  <h3 className="deals-subhead">本週免費領取</h3>
                  <div className="deals-grid">
                    {epicCurrent.map((item) => (
                      <DealCard key={item.key} item={item} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted">
                  本週台灣區暫無進行中的免費遊戲，下週預告如下。
                </p>
              )}
              {epicUpcoming.length > 0 && (
                <>
                  <h3 className="deals-subhead">下週預告</h3>
                  <div className="deals-grid">
                    {epicUpcoming.map((item) => (
                      <DealCard key={item.key} item={item} />
                    ))}
                  </div>
                </>
              )}
              {counts.epic === 0 && (
                <p className="muted">
                  目前 Epic 台灣區沒有免費遊戲資訊，請稍後再試。
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {active === "steam" && (
        <section className="deals-section" aria-label="Steam 特價">
          {sectionHead(
            "steam",
            "🔥 Steam 特價",
            `折扣大→小 · 前 ${steam.length} 款` +
              (steamTotalCount > 0
                ? ` · 台灣區特價中 ${steamTotalCount.toLocaleString("zh-Hant-TW")} 款`
                : "")
          )}
          {open.steam && (
            <>
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
            </>
          )}
        </section>
      )}

      {active === "xbox" && (
        <section className="deals-section" aria-label="Xbox PC 特價">
          {sectionHead(
            "xbox",
            "🟢 Xbox PC 特價",
            `折扣最大的 ${xbox.length} 款` +
              (xboxTotalCount > 0
                ? ` · 台灣區共 ${xboxTotalCount.toLocaleString("zh-Hant-TW")} 款特價`
                : "")
          )}
          {open.xbox && (
            <>
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
            </>
          )}
        </section>
      )}
    </div>
  );
}
