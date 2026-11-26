"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

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
    // 未登入先攔：點下去直接跳登入頁，不要先樂觀顯示「已讚 1」再收回
    // （之前是先樂觀更新、等 API 回 401 才還原，誤導人以為按讚成功）。
    // getSession 讀本地 session、不發網路請求，幾乎不花時間。
    const db = createSupabaseBrowserClient();
    const { data } = await db.auth.getSession();
    if (!data.session) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    // 樂觀更新（2026-11-25）：先顯示新狀態與數字，背景再跟伺服器對帳；
    // 失敗時還原。之前是等 API 回來才更新，體感要 5–6 秒。
    const prevLiked = liked;
    const prevCount = count;
    const nextLiked = !liked;
    setLiked(nextLiked);
    setCount((c) => c + (nextLiked ? 1 : -1));
    setBusy(true);
    try {
      const res = await fetch("/api/likes", {
        body: JSON.stringify({ gameId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (res.status === 401) {
        setLiked(prevLiked);
        setCount(prevCount);
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // 以伺服器為準（數字可能因別人同時按讚而有差）。
      setLiked(Boolean(data.liked));
      if (typeof data.count === "number") setCount(data.count);
    } catch (e) {
      setLiked(prevLiked);
      setCount(prevCount);
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
