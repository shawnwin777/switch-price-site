"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 已購買切換按鈕。合約：POST /api/purchases { gameId } → { purchased }，
// 與 CollectionButton 同一個模式。未登入點下去跳到登入頁。
export default function PurchaseButton({
  gameId,
  initialPurchased = false,
}: {
  gameId: string;
  initialPurchased?: boolean;
}) {
  const [purchased, setPurchased] = useState(initialPurchased);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/purchases", {
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
      setPurchased(Boolean(data.purchased));
    } catch (e) {
      console.error("已購買切換失敗：", e);
      alert("標記失敗，請稍後再試（需先登入）。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`icon-btn ${purchased ? "active" : ""}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={purchased}
      title={purchased ? "取消已購買" : "標記為已購買"}
    >
      {purchased ? "✓ 已購買" : "＋ 已購買"}
    </button>
  );
}
