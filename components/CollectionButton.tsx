"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 愛心收藏按鈕。合約：POST /api/collections { gameId } → { collected }（登入組實作）。
// 未登入點下去跳到登入頁。
export default function CollectionButton({
  gameId,
  initialCollected = false,
  label = true,
}: {
  gameId: string;
  initialCollected?: boolean;
  label?: boolean;
}) {
  const [collected, setCollected] = useState(initialCollected);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/collections", {
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
      setCollected(Boolean(data.collected));
    } catch (e) {
      console.error("收藏切換失敗：", e);
      alert("收藏失敗，請稍後再試（需先登入）。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`icon-btn ${collected ? "active" : ""}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={collected}
      title={collected ? "取消收藏" : "加入收藏"}
    >
      {collected ? "♥ 已收藏" : "♡ 收藏"}
      {!label && null}
    </button>
  );
}
