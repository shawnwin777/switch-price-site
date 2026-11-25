"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTaipei } from "@/lib/format";
import { isAdminEmail } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import type { CommentItem } from "@/lib/types";

// 留言區：放在價格上方，依讚數排序，預設最多顯示 5 則，其餘收在「顯示全部」裡。
// 合約（登入組實作）：POST /api/comments { gameId, body } → 留言物件；
// POST /api/comments/[id]/like → { liked, count }。
const PAGE_SIZE = 5;

/** 讀 API 回傳的錯誤訊息（{ error }）；讀不到回 null，改用預設訊息。 */
async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const data: { error?: unknown } = await res.json();
    return typeof data.error === "string" && data.error ? data.error : null;
  } catch {
    return null;
  }
}

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
  const [authorName, setAuthorName] = useState("");
  const [busy, setBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  // 一層回覆：正在回哪則上層留言（null＝沒展開）、回覆內文。
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const router = useRouter();

  // 上次打的名字自動帶入（可改；只存在自己的瀏覽器裡）。
  useEffect(() => {
    try {
      setAuthorName(localStorage.getItem("spc-comment-author") ?? "");
    } catch {
      // 瀏覽器不給存也沒關係，名字欄留空即可。
    }
  }, []);

  // 管理員判斷：沿用 SiteHeader 的現成做法（browser client 讀登入 email
  // ＋ isAdminEmail），刪文按鈕只對管理員顯示；真正擋人的是 API 路由。
  useEffect(() => {
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(({ data }) => {
      setIsAdmin(isAdminEmail(data.user?.email ?? null));
    });
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, session) => {
      setIsAdmin(isAdminEmail(session?.user?.email ?? null));
    });
    return () => subscription.unsubscribe();
  }, []);

  // 讚數高 → 新，上層留言預設照這個順序；回覆在父留言下照時間先後。
  const sorted = useMemo(
    () =>
      [...comments].sort(
        (a, b) =>
          b.likes_count - a.likes_count ||
          (b.created_at ?? "").localeCompare(a.created_at ?? "")
      ),
    [comments]
  );
  const topLevel = useMemo(
    () => sorted.filter((c) => !c.parent_comment_id),
    [sorted]
  );
  const repliesByParent = useMemo(() => {
    const map = new Map<string, CommentItem[]>();
    comments
      .filter((c) => c.parent_comment_id)
      .forEach((c) => {
        const parentId = c.parent_comment_id as string;
        const arr = map.get(parentId) ?? [];
        arr.push(c);
        map.set(parentId, arr);
      });
    map.forEach((arr) =>
      arr.sort((a, b) =>
        (a.created_at ?? "").localeCompare(b.created_at ?? "")
      )
    );
    return map;
  }, [comments]);
  const visible = showAll ? topLevel : topLevel.slice(0, PAGE_SIZE);

  async function submitComment() {
    const text = body.trim();
    if (!text) return;
    const name = authorName.trim();
    setBusy(true);
    try {
      const res = await fetch("/api/comments", {
        body: JSON.stringify({ body: text, gameId, author_name: name }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (!res.ok) {
        alert(
          (await readErrorMessage(res)) ??
            "留言失敗，請稍後再試（需先登入）。"
        );
        return;
      }
      const created = await res.json();
      const item: CommentItem = {
        author_name: created.author_name ?? created.nickname ?? null,
        body: created.body ?? text,
        created_at: created.created_at ?? new Date().toISOString(),
        game_id: gameId,
        id: created.id ?? Date.now(),
        liked_by_me: false,
        likes_count: 0,
        parent_comment_id: null,
        user_id: created.user_id ?? null,
      };
      setComments((prev) => [item, ...prev]);
      setBody("");
      // 名字留著，下次自動帶入。
      try {
        if (name) localStorage.setItem("spc-comment-author", name);
      } catch {
        // 存不進去也沒關係。
      }
    } catch (e) {
      console.error("留言失敗：", e);
      alert("留言失敗，請稍後再試（需先登入）。");
    } finally {
      setBusy(false);
    }
  }

  // 一層回覆：名字沿用下方表單共用的 authorName state，不另加名字欄。
  async function submitReply(parent: CommentItem) {
    const text = replyBody.trim();
    if (!text) return;
    const name = authorName.trim();
    setReplyBusy(true);
    try {
      const res = await fetch("/api/comments", {
        body: JSON.stringify({
          body: text,
          gameId,
          author_name: name,
          parent_comment_id: parent.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      // 503＝parent migration 還沒跑，回覆功能尚未啟用（不是 500）。
      if (res.status === 503) {
        alert("回覆功能尚未啟用，請稍後再試");
        return;
      }
      if (!res.ok) {
        alert(
          (await readErrorMessage(res)) ??
            "回覆失敗，請稍後再試（需先登入）。"
        );
        return;
      }
      const created = await res.json();
      const item: CommentItem = {
        author_name: created.author_name ?? created.nickname ?? null,
        body: created.body ?? text,
        created_at: created.created_at ?? new Date().toISOString(),
        game_id: gameId,
        id: created.id ?? Date.now(),
        liked_by_me: false,
        likes_count: 0,
        parent_comment_id: created.parent_comment_id ?? parent.id,
        user_id: created.user_id ?? null,
      };
      setComments((prev) => [...prev, item]);
      setReplyBody("");
      setReplyingTo(null);
      try {
        if (name) localStorage.setItem("spc-comment-author", name);
      } catch {
        // 存不進去也沒關係。
      }
    } catch (e) {
      console.error("回覆失敗：", e);
      alert("回覆失敗，請稍後再試（需先登入）。");
    } finally {
      setReplyBusy(false);
    }
  }

  async function reportComment(comment: CommentItem) {
    if (reportedIds.has(comment.id)) return;
    if (!window.confirm("確定要檢舉這則留言嗎？")) return;
    try {
      const res = await fetch(`/api/comments/${comment.id}/report`, {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (!res.ok) {
        alert(
          (await readErrorMessage(res)) ??
            "檢舉失敗，請稍後再試（需先登入）。"
        );
        return;
      }
      setReportedIds((prev) => new Set(prev).add(comment.id));
    } catch (e) {
      console.error("檢舉留言失敗：", e);
      alert("檢舉失敗，請稍後再試（需先登入）。");
    }
  }

  async function deleteComment(comment: CommentItem) {
    if (!window.confirm("確定要刪除這則留言嗎？")) return;
    try {
      const res = await fetch(
        `/api/comments?id=${encodeURIComponent(comment.id)}`,
        { method: "DELETE" }
      );
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (res.status === 403) {
        alert("只有管理員可以刪除留言。");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
    } catch (e) {
      console.error("刪除留言失敗：", e);
      alert("刪除留言失敗，請稍後再試。");
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

  // 留言頭（上層留言和回覆共用）：左組讚按鈕緊貼名字、右組檢舉／刪除。
  // 回覆沒有「回覆」按鈕——只做一層。
  function renderCommentHead(c: CommentItem) {
    return (
      <div className="comment-head">
        <span className="comment-head-left">
          <button
            type="button"
            className={`icon-btn ${c.liked_by_me ? "active" : ""}`}
            onClick={() => toggleLike(c)}
            aria-pressed={c.liked_by_me}
          >
            👍 {c.likes_count}
          </button>
          <span className="comment-author">
            {c.author_name ?? "玩家"} · {formatTaipei(c.created_at)}
          </span>
        </span>
        <span className="comment-head-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => reportComment(c)}
            disabled={reportedIds.has(c.id)}
            title="檢舉這則留言"
          >
            {reportedIds.has(c.id) ? "已檢舉" : "🚩 檢舉"}
          </button>
          {isAdmin && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => deleteComment(c)}
              title="管理員刪除留言"
            >
              🗑️ 刪除
            </button>
          )}
        </span>
      </div>
    );
  }

  return (
    <section aria-label="玩家留言">
      <h2>💬 玩家留言（依讚數排序）</h2>
      <p className="comment-rules">⚠️ 留言請保持友善，嚴禁攻擊其他玩家。</p>
      {topLevel.length === 0 ? (
        <p className="muted">還沒有留言，來分享這款遊戲好不好玩吧！</p>
      ) : (
        <>
          <div className="comment-list">
            {visible.map((c) => {
              const replies = repliesByParent.get(c.id) ?? [];
              return (
                <article key={c.id} className="comment">
                  {renderCommentHead(c)}
                  <p className="comment-body">{c.body}</p>
                  <p className="comment-reply-toggle">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        setReplyingTo(replyingTo === c.id ? null : c.id)
                      }
                    >
                      {replyingTo === c.id ? "收起回覆" : "💬 回覆"}
                    </button>
                  </p>
                  {replyingTo === c.id && (
                    <div className="comment-reply-form">
                      <textarea
                        className="input"
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        placeholder={`回覆 ${c.author_name ?? "玩家"}…`}
                        maxLength={1000}
                        aria-label="回覆內容"
                      />
                      <p>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => submitReply(c)}
                          disabled={replyBusy || replyBody.trim().length === 0}
                        >
                          {replyBusy ? "送出中…" : "送出回覆"}
                        </button>
                      </p>
                    </div>
                  )}
                  {replies.length > 0 && (
                    <div className="comment-replies">
                      {replies.map((r) => (
                        <article key={r.id} className="comment">
                          {renderCommentHead(r)}
                          <p className="comment-body">{r.body}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {topLevel.length > PAGE_SIZE && (
            <p>
              <button
                type="button"
                className="btn"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll
                  ? "收起留言"
                  : `顯示全部（共 ${topLevel.length} 則）`}
              </button>
            </p>
          )}
        </>
      )}
      <div className="comment-form">
        <label className="field-label" htmlFor="comment-author">
          名字（最多 10 個字，可不填）
        </label>
        <input
          id="comment-author"
          className="input"
          type="text"
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          placeholder="想叫什麼就打什麼"
          maxLength={10}
        />
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
