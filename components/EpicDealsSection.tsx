"use client";

import { useState } from "react";
import type { DealsCarouselItem } from "@/lib/deals-carousel";
import DealCard from "./DealCard";

/** Epic 免費遊戲區塊（/deals 上方）：遊戲比較少，做成可以摺疊的，
 *  預設展開，點右邊按鈕收合。只列台灣區（country=TW）。 */
export default function EpicDealsSection({
  current,
  upcoming,
}: {
  current: DealsCarouselItem[];
  upcoming: DealsCarouselItem[];
}) {
  const [open, setOpen] = useState(true);
  const total = current.length + upcoming.length;

  return (
    <section className="deals-section" aria-label="Epic 免費遊戲">
      <div className="deals-section-head">
        <h2 className="deals-section-title">🎮 Epic 免費遊戲</h2>
        <span className="deals-section-meta">
          本週 {current.length} 款 · 下週預告 {upcoming.length} 款
        </span>
        <button
          type="button"
          className="deals-collapse-btn"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? "▾ 收合" : "▸ 展開"}
        </button>
      </div>
      {open && (
        <div className="deals-section-body">
          {current.length > 0 ? (
            <>
              <h3 className="deals-subhead">本週免費領取</h3>
              <div className="deals-grid">
                {current.map((item) => (
                  <DealCard key={item.key} item={item} />
                ))}
              </div>
            </>
          ) : (
            <p className="muted">
              本週台灣區暫無進行中的免費遊戲，下週預告如下。
            </p>
          )}
          {upcoming.length > 0 && (
            <>
              <h3 className="deals-subhead">下週預告</h3>
              <div className="deals-grid">
                {upcoming.map((item) => (
                  <DealCard key={item.key} item={item} />
                ))}
              </div>
            </>
          )}
          {total === 0 && (
            <p className="muted">
              目前 Epic 台灣區沒有免費遊戲資訊，請稍後再試。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
