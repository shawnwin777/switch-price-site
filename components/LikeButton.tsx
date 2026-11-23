"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 遊戲讚按鈕。合約：POST /api/likes { gameId } → { liked, count }（登入組實作）。
// 未登入點下去跳到登入頁。
export default function LikeButton({
  gameId,
  initialLiked = false,
  initialCount = 0,
}: {
  gameId: string;
  initialLiked?: boolean;
  initialCount?: number;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/likes", {
        body: JSON.stringify({ gameId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLiked(Boolean(data.liked));
      if (typeof data.count === "number") setCount(data.count);
    } catch (e) {
      console.error("按讚失敗：", e);
      alert("按讚失敗，請稍後再試（需先登入）。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`icon-btn ${liked ? "active" : ""}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={liked}
      title={liked ? "取消讚" : "覺得好玩，按讚"}
    >
      {liked ? "👍 已讚" : "👍 讚"} {count}
    </button>
  );
}
