"use client";

import { useRouter } from "next/navigation";

/** 內頁頂部「回前頁」按鈕：先走瀏覽器上一頁（通常是從首頁卡片點進來），
 *  沒上一頁可回時（直接開連結進來）改去 /home，避免按了沒反應。 */
export default function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn back-btn"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push("/home");
        }
      }}
      aria-label="回前頁"
    >
      ← 回前頁
    </button>
  );
}
