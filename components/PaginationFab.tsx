"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 手機浮動分頁（/historical-low、/near-low、/upcoming 共用）：
 *  固定左下角（見 globals.css .pagination-fab，手機版才顯示），
 *  一排三顆：上一頁／第 X / Y 頁／下一頁；點中間頁數可跳頁。
 *  跟 HomeClient 牆上的浮動分頁同一個樣式，只是這裡走 URL 分頁
 *  （server page 用 ?page= 換頁），所以用 router.push，不用
 *  HomeClient 的 goPage state。桌機版不顯示（CSS 控制）。 */
export default function PaginationFab({
  page,
  totalPages,
  basePath,
  country,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  country?: string;
}) {
  const router = useRouter();
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const href = (p: number) =>
    country
      ? `${basePath}?page=${p}&country=${country}`
      : `${basePath}?page=${p}`;
  const go = (p: number) => {
    setJumpOpen(false);
    router.push(href(p));
  };
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination-fab" aria-label="分頁（浮動）">
      <button
        type="button"
        className="btn"
        disabled={page <= 1}
        onClick={() => go(page - 1)}
        aria-label="上一頁"
      >
        ← 上一頁
      </button>
      <button
        type="button"
        className="pagination-fab-page"
        onClick={() => {
          setJumpValue(String(page));
          setJumpOpen((v) => !v);
        }}
        aria-expanded={jumpOpen}
        aria-label="跳到指定頁數"
      >
        第 {page} / {totalPages} 頁
      </button>
      <button
        type="button"
        className="btn"
        disabled={page >= totalPages}
        onClick={() => go(page + 1)}
        aria-label="下一頁"
      >
        下一頁 →
      </button>
      {jumpOpen && (
        <form
          className="pagination-fab-jump"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Math.max(
              1,
              Math.min(totalPages, Number(jumpValue) || page)
            );
            if (n !== page) go(n);
            else setJumpOpen(false);
          }}
        >
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={totalPages}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            aria-label="頁數"
            autoFocus
          />
          <button type="submit" className="btn">
            前往
          </button>
        </form>
      )}
    </nav>
  );
}
