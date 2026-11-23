"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTaipei } from "@/lib/format";
import type { CommentItem } from "@/lib/types";

// 留言區：放在價格上方，依讚數排序，預設最多顯示 5 則，其餘收在「顯示全部」裡。
// 合約（登入組實作）：POST /api/comments { gameId, body } → 留言物件；
// POST /api/comments/[id]/like → { liked, count }。
const PAGE_SIZE = 5;

export default function CommentsSection({
  gameId,
  initialComments,
}: {
  gameId: string;
  initialComments: CommentItem[];
}) {
  const [comments, setComments] = useState<CommentItem[]>(initialComments);
  const [showAll, setShowAll] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // 讚數高 → 新，留言預設照這個順序。
  const sorted = useMemo(
    () =>
      [...comments].sort(
        (a, b) =>
          b.likes_count - a.likes_count ||
          (b.created_at ?? "").localeCompare(a.created_at ?? "")
      ),
    [comments]
  );
  const visible = showAll ? sorted : sorted.slice(0, PAGE_SIZE);

  async function submitComment() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await fetch("/api/comments", {
        body: JSON.stringify({ body: text, gameId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      const item: CommentItem = {
        author_name: created.author_name ?? created.nickname ?? null,
        body: created.body ?? text,
        created_at: created.created_at ?? new Date().toISOString(),
        game_id: gameId,
        id: created.id ?? Date.now(),
        liked_by_me: false,
        likes_count: 0,
        user_id: created.user_id ?? null,
      };
      setComments((prev) => [item, ...prev]);
      setBody("");
    } catch (e) {
      console.error("留言失敗：", e);
      alert("留言失敗，請稍後再試（需先登入）。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike(comment: CommentItem) {
    try {
      const res = await fetch(`/api/comments/${comment.id}/like`, {
        method: "POST",
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id
            ? {
                ...c,
                liked_by_me: Boolean(data.liked),
                likes_count:
                  typeof data.count === "number"
                    ? data.count
                    : c.likes_count + (data.liked ? 1 : -1),
              }
            : c
        )
      );
    } catch (e) {
      console.error("留言按讚失敗：", e);
      alert("按讚失敗，請稍後再試（需先登入）。");
    }
  }

  return (
    <section aria-label="玩家留言">
      <h2>💬 玩家留言（依讚數排序）</h2>
      {sorted.length === 0 ? (
        <p className="muted">還沒有留言，來分享這款遊戲好不好玩吧！</p>
      ) : (
        <>
          <div className="comment-list">
            {visible.map((c) => (
              <article key={c.id} className="comment">
                <div className="comment-head">
                  <span className="comment-author">
                    {c.author_name ?? "玩家"} · {formatTaipei(c.created_at)}
                  </span>
                  <button
                    type="button"
                    className={`icon-btn ${c.liked_by_me ? "active" : ""}`}
                    onClick={() => toggleLike(c)}
                    aria-pressed={c.liked_by_me}
                  >
                    👍 {c.likes_count}
                  </button>
                </div>
                <p className="comment-body">{c.body}</p>
              </article>
            ))}
          </div>
          {sorted.length > PAGE_SIZE && (
            <p>
              <button
                type="button"
                className="btn"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll
                  ? "收起留言"
                  : `顯示全部（共 ${sorted.length} 則）`}
              </button>
            </p>
          )}
        </>
      )}
      <div className="comment-form">
        <label className="field-label" htmlFor="comment-body">
          寫留言（需登入）
        </label>
        <textarea
          id="comment-body"
          className="input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="這款遊戲好玩嗎？說說你的心得…"
          maxLength={1000}
        />
        <p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submitComment}
            disabled={busy || body.trim().length === 0}
          >
            {busy ? "送出中…" : "送出留言"}
          </button>
        </p>
      </div>
    </section>
  );
}
