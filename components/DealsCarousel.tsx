"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DealsCarouselItem } from "@/lib/deals-carousel";

/** 自動輪播間隔（毫秒）。滑鼠停在輪播上時暫停。 */
const AUTO_ADVANCE_MS = 5000;

/** 首頁 Steam 特價＋Epic 免費遊戲輪播（首頁遊戲牆上方）。
 *  資料由伺服器端抓取＋每小時快取（lib/cached-data.ts），這裡只負責輪播。
 *  沒有項目時不顯示任何東西（上游 API 失敗時首頁不受影響）。 */
export default function DealsCarousel({
  items,
}: {
  items: DealsCarouselItem[];
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = items.length;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count]
  );

  useEffect(() => {
    if (count <= 1 || paused) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, AUTO_ADVANCE_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [count, paused]);

  // 項目變動（快取更新）時若目前 index 超出範圍，回到第一張。
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;
  const item = items[index];

  return (
    <section
      className="deals-carousel"
      aria-label="Steam 特價與 Epic 免費遊戲"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="deals-head">
        <h2 className="deals-title">
          🔥 本週特價 <span className="deals-title-sep">×</span> 免費遊戲
        </h2>
        <span className="deals-hint muted">Steam 特價・Epic 免費・點圖前往商店</span>
      </div>
      <div className="deals-slide-wrap">
        <a
          key={item.key}
          className="deals-slide"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${item.title}（${item.source === "steam" ? "Steam" : "Epic"}，另開新視窗前往商店）`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="deals-img"
            src={item.image}
            alt={item.title}
            loading="eager"
          />
          <span className="deals-overlay">
            <span
              className={`badge deals-badge ${
                item.source === "steam" ? "deals-badge-steam" : "deals-badge-epic"
              }`}
            >
              {item.source === "steam" ? "Steam" : "Epic"} · {item.badge}
            </span>
            <span className="deals-item-title">{item.title}</span>
            <span className="deals-price">{item.priceLine}</span>
            {item.subLine && (
              <span className="deals-sub">{item.subLine}</span>
            )}
          </span>
        </a>
        {count > 1 && (
          <>
            <button
              type="button"
              className="deals-arrow deals-arrow-left"
              onClick={() => go(index - 1)}
              aria-label="上一則"
            >
              ‹
            </button>
            <button
              type="button"
              className="deals-arrow deals-arrow-right"
              onClick={() => go(index + 1)}
              aria-label="下一則"
            >
              ›
            </button>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="deals-dots" role="tablist" aria-label="選擇輪播項目">
          {items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${it.title}（${it.source === "steam" ? "Steam" : "Epic"}）`}
              className={`deals-dot ${i === index ? "active" : ""}`}
              onClick={() => go(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
