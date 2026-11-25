"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatTaipei } from "@/lib/format";

export type ReportRow = {
  id: string;
  commentId: string;
  commentUserId: string;
  gameSlug: string;
  gameTitle: string;
  commentBody: string;
  commentAuthor: string;
  reporterEmail: string;
  reason: string | null;
  createdAt: string;
};

// 檢舉清單（管理員頁的互動區）：每列可「刪除留言」、「封鎖此人」或「忽略檢舉」。
// 刪除留言沿用現成 DELETE /api/comments?id=（會連同該留言的檢舉一起清
// 掉，DB 有 ON DELETE CASCADE）；封鎖走 POST /api/admin/blocks（封鎖後
// 該使用者的檢舉也會清掉，解封請到下方「已封鎖名單」）；
// 忽略檢舉走 DELETE /api/reports?id=。
export default function ReportList({
  initialReports,
}: {
  initialReports: ReportRow[];
}) {
  const [reports, setReports] = useState<ReportRow[]>(initialReports);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  async function deleteComment(row: ReportRow) {
    if (!window.confirm(`確定要刪除「${row.gameTitle}」這則留言嗎？`)) return;
    setBusy(`del-${row.id}`);
    try {
      const res = await fetch(
        `/api/comments?id=${encodeURIComponent(row.commentId)}`,
        { method: "DELETE" }
      );
      if (res.status === 401) {
        alert("請先登入。");
        return;
      }
      if (res.status === 403) {
        alert("只有管理員可以刪除留言。");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 該留言的所有檢舉都隨留言清掉。
      setReports((prev) => prev.filter((r) => r.commentId !== row.commentId));
    } catch (e) {
      console.error("刪除留言失敗：", e);
      alert("刪除留言失敗，請稍後再試。");
    } finally {
      setBusy(null);
    }
  }

  async function blockUser(row: ReportRow) {
    if (
      !window.confirm(
        `確定要封鎖 ${row.commentAuthor} 嗎？\n\n封鎖後他不能再留言或檢舉，舊留言也不再顯示。\n解封後舊留言會恢復顯示（封鎖不刪留言，避免誤封無法挽回）。\n\n留言內容：「${row.commentBody.slice(0, 100)}」`
      )
    )
      return;
    setBusy(`blk-${row.id}`);
    try {
      const res = await fetch("/api/admin/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: row.commentUserId,
          reason: row.reason,
        }),
      });
      if (res.status === 401) {
        alert("請先登入。");
        return;
      }
      if (res.status === 403) {
        alert("只有管理員可以封鎖。");
        return;
      }
      if (res.status === 503) {
        alert("封鎖功能尚未啟用，請先跑 migration。");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 該使用者的檢舉都隨封鎖清掉（已處理）。
      setReports((prev) =>
        prev.filter((r) => r.commentUserId !== row.commentUserId)
      );
      alert(`已封鎖 ${row.commentAuthor}。解封請到下方「已封鎖名單」。`);
      router.refresh();
    } catch (e) {
      console.error("封鎖失敗：", e);
      alert("封鎖失敗，請稍後再試。");
    } finally {
      setBusy(null);
    }
  }

  async function ignoreReport(row: ReportRow) {
    if (!window.confirm("確定要忽略這一則檢舉嗎？留言會保留。")) return;
    setBusy(`ign-${row.id}`);
    try {
      const res = await fetch(
        `/api/reports?id=${encodeURIComponent(row.id)}`,
        { method: "DELETE" }
      );
      if (res.status === 401) {
        alert("請先登入。");
        return;
      }
      if (res.status === 403) {
        alert("只有管理員可以忽略檢舉。");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReports((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) {
      console.error("忽略檢舉失敗：", e);
      alert("忽略檢舉失敗，請稍後再試。");
    } finally {
      setBusy(null);
    }
  }

  if (reports.length === 0) {
    return <p className="muted">目前沒有檢舉。</p>;
  }

  return (
    <div className="comment-list">
      {reports.map((r) => (
        <article key={r.id} className="comment">
          <div className="comment-head">
            <span className="comment-author">
              {r.gameSlug ? (
                <Link href={`/games/${r.gameSlug}`}>{r.gameTitle}</Link>
              ) : (
                r.gameTitle
              )}{" "}
              · {formatTaipei(r.createdAt)}
            </span>
          </div>
          <p className="comment-body">{r.commentBody}</p>
          <p className="muted">
            留言者：{r.commentAuthor} · 檢舉人：{r.reporterEmail} · 理由：
            {r.reason ? r.reason : "未填理由"}
          </p>
          <p>
            <button
              type="button"
              className="btn"
              onClick={() => deleteComment(r)}
              disabled={busy !== null}
            >
              {busy === `del-${r.id}` ? "刪除中…" : "🗑️ 刪除留言"}
            </button>{" "}
            <button
              type="button"
              className="btn"
              onClick={() => blockUser(r)}
              disabled={busy !== null}
            >
              {busy === `blk-${r.id}` ? "封鎖中…" : "🚫 封鎖此人"}
            </button>{" "}
            <button
              type="button"
              className="btn"
              onClick={() => ignoreReport(r)}
              disabled={busy !== null}
            >
              {busy === `ign-${r.id}` ? "處理中…" : "忽略檢舉"}
            </button>
          </p>
        </article>
      ))}
    </div>
  );
}
