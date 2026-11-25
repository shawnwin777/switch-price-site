"use client";

import { useState } from "react";
import { formatTaipei } from "@/lib/format";

export type BlockedRow = {
  userId: string;
  email: string;
  reason: string | null;
  blockedBy: string | null;
  createdAt: string;
};

// 已封鎖名單（管理員頁的互動區）：每列可「解封」。
// 解封後該帳號可重新留言，舊留言恢復顯示。
export default function BlockedList({
  initialBlocks,
}: {
  initialBlocks: BlockedRow[];
}) {
  const [blocks, setBlocks] = useState<BlockedRow[]>(initialBlocks);
  const [busy, setBusy] = useState<string | null>(null);

  async function unblock(row: BlockedRow) {
    if (
      !window.confirm(
        `確定要解封 ${row.email} 嗎？\n\n解封後他可以重新留言，舊留言也會恢復顯示。`
      )
    )
      return;
    setBusy(row.userId);
    try {
      const res = await fetch(
        `/api/admin/blocks?user_id=${encodeURIComponent(row.userId)}`,
        { method: "DELETE" }
      );
      if (res.status === 401) {
        alert("請先登入。");
        return;
      }
      if (res.status === 403) {
        alert("只有管理員可以解封。");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBlocks((prev) => prev.filter((b) => b.userId !== row.userId));
    } catch (e) {
      console.error("解封失敗：", e);
      alert("解封失敗，請稍後再試。");
    } finally {
      setBusy(null);
    }
  }

  if (blocks.length === 0) {
    return <p className="muted">目前沒有被封鎖的使用者。</p>;
  }

  return (
    <div className="comment-list">
      {blocks.map((b) => (
        <article key={b.userId} className="comment">
          <p>
            <b>{b.email}</b>
          </p>
          <p className="muted">
            理由：{b.reason ? b.reason : "未填"} · 封鎖者：
            {b.blockedBy ?? "管理員"} · {formatTaipei(b.createdAt)}
          </p>
          <p>
            <button
              type="button"
              className="btn"
              onClick={() => unblock(b)}
              disabled={busy !== null}
            >
              {busy === b.userId ? "解封中…" : "🔓 解封"}
            </button>
          </p>
        </article>
      ))}
    </div>
  );
}
