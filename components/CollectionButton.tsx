"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 愛心收藏按鈕。合約：POST /api/collections { gameId } → { collected }（登入組實作）。
// 未登入點下去跳到登入頁。
// 受控模式（2026-11-25）：傳入 collected + onCollectedChange 時由父層持有狀態
// （詳細頁用它同步「♥N人收藏」數字與特價橫幅）；不傳時維持內部 state（牆面卡片用）。
export default function CollectionButton({
  gameId,
  initialCollected = false,
  label = true,
  collected: controlledCollected,
  onCollectedChange,
}: {
  gameId: string;
  initialCollected?: boolean;
  label?: boolean;
  collected?: boolean;
  onCollectedChange?: (collected: boolean) => void;
}) {
  const [internalCollected, setInternalCollected] = useState(initialCollected);
  const isControlled = controlledCollected !== undefined;
  const collected = isControlled ? controlledCollected : internalCollected;
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // 統一出口：非受控時更新內部 state；不論哪種模式都通知父層。
  function applyCollected(next: boolean) {
    if (!isControlled) setInternalCollected(next);
    onCollectedChange?.(next);
  }

  async function toggle() {
    if (busy) return;
    // 樂觀更新（2026-11-25）：先顯示新狀態，背景再跟伺服器對帳；
    // 失敗或未登入時還原。之前是等 API 回來才更新，體感要 5–6 秒。
    const prevCollected = collected;
    const nextCollected = !collected;
    applyCollected(nextCollected);
    setBusy(true);
    try {
      const res = await fetch("/api/collections", {
        body: JSON.stringify({ gameId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (res.status === 401) {
        applyCollected(prevCollected);
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyCollected(Boolean(data.collected));
    } catch (e) {
      applyCollected(prevCollected);
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
