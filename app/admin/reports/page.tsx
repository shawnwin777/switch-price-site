import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ADMIN_EMAIL, isAdminEmail } from "@/lib/admin";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import ReportList, { type ReportRow } from "@/components/ReportList";
import BlockedList, { type BlockedRow } from "@/components/BlockedList";

export const dynamic = "force-dynamic";

// 管理員檢舉清單：看誰檢舉了哪則留言，並可刪文、封鎖留言者或忽略檢舉。
// 下方另有「已封鎖名單」，可解封。封鎖只禁留言／檢舉、隱藏舊留言，
// 不刪留言——解封後舊留言恢復顯示，避免誤封無法挽回。
// Gating 沿用 /taiwan：未登入 → 登入頁；已登入非管理員 → 只顯示提示。
// comment_reports 沒有公開 SELECT policy，所以用 service-role client 讀
//（lib/supabase-admin.ts，繞過 RLS；絕對不要在瀏覽器端 import 它）。
export default async function AdminReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/reports");
  if (!isAdminEmail(user.email)) {
    return (
      <section className="narrow">
        <h1>🚩 檢舉管理</h1>
        <p>只有網站管理員（{ADMIN_EMAIL}）可以查看檢舉清單。</p>
      </section>
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: reports, error } = await admin
    .from("comment_reports")
    .select("id, comment_id, reporter_id, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !reports) {
    return (
      <section className="narrow">
        <h1>🚩 檢舉管理</h1>
        <p role="alert">檢舉清單暫時無法讀取，請稍後再試。</p>
      </section>
    );
  }

  const commentIds = [...new Set(reports.map((r) => r.comment_id))];
  const { data: comments } = commentIds.length
    ? await admin
        .from("comments")
        .select("id, game_id, body, author_name, user_id")
        .in("id", commentIds)
    : { data: [] as never[] };
  const commentById = new Map(
    (comments ?? []).map((c) => [c.id as string, c])
  );

  const gameIds = [
    ...new Set(
      (comments ?? [])
        .map((c) => c.game_id as string)
        .filter(Boolean)
    ),
  ];
  const { data: games } = gameIds.length
    ? await admin
        .from("games")
        .select("id, slug, title_zh, title_en")
        .in("id", gameIds)
    : { data: [] as never[] };
  const gameById = new Map((games ?? []).map((g) => [g.id as string, g]));

  // 檢舉人 email：逐一查 Auth（檢舉量小，直接查即可）。
  const reporterIds = [...new Set(reports.map((r) => r.reporter_id))];
  const reporterEmailById = new Map<string, string>();
  await Promise.all(
    reporterIds.map(async (rid) => {
      const { data } = await admin.auth.admin.getUserById(rid);
      const email = data?.user?.email;
      reporterEmailById.set(
        rid,
        email ?? `${rid.slice(0, 8)}…`
      );
    })
  );

  const rows: ReportRow[] = reports.map((r) => {
    const comment = commentById.get(r.comment_id as string);
    const game = comment ? gameById.get(comment.game_id as string) : undefined;
    return {
      id: r.id as string,
      commentId: r.comment_id as string,
      commentUserId: (comment?.user_id as string | undefined) ?? "",
      gameSlug: (game?.slug as string | undefined) ?? "",
      gameTitle:
        ((game?.title_zh as string | undefined) ||
          (game?.title_en as string | undefined) ||
          (game?.slug as string | undefined) ||
          "（遊戲已不存在）"),
      commentBody: (comment?.body as string | undefined) ?? "（留言已被刪除）",
      commentAuthor:
        (comment?.author_name as string | undefined) ?? "玩家",
      reporterEmail:
        reporterEmailById.get(r.reporter_id as string) ??
        `${(r.reporter_id as string).slice(0, 8)}…`,
      reason: (r.reason as string | null) ?? null,
      createdAt: r.created_at as string,
    };
  });

  // 已封鎖名單（表還沒建時當作空名單，頁面不 500）。
  const { data: blockRows, error: blocksError } = await admin
    .from("comment_blocks")
    .select("user_id, reason, blocked_by, created_at")
    .order("created_at", { ascending: false });
  const blocks = blocksError || !blockRows ? [] : blockRows;
  const blockedIds = [
    ...new Set(blocks.map((b) => b.user_id as string)),
  ];
  const blockedEmailById = new Map<string, string>();
  await Promise.all(
    blockedIds.map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid);
      const email = data?.user?.email;
      blockedEmailById.set(uid, email ?? `${uid.slice(0, 8)}…`);
    })
  );
  const blockedList: BlockedRow[] = blocks.map((b) => ({
    userId: b.user_id as string,
    email:
      blockedEmailById.get(b.user_id as string) ??
      `${(b.user_id as string).slice(0, 8)}…`,
    reason: (b.reason as string | null) ?? null,
    blockedBy: (b.blocked_by as string | null) ?? null,
    createdAt: b.created_at as string,
  }));

  return (
    <section className="narrow">
      <h1>🚩 檢舉管理</h1>
      <p className="muted">
        共 {rows.length} 則檢舉（最新在前）。「刪除留言」會連同該留言的所有檢舉一起清掉；「封鎖此人」封鎖該留言者（不能再留言或檢舉，舊留言隱藏不刪除，該使用者的檢舉也一併清掉）；「忽略檢舉」只清掉這一則檢舉、留言保留。
      </p>
      <ReportList initialReports={rows} />
      <h2>🚫 已封鎖名單</h2>
      <p className="muted">
        封鎖是看帳號的登入識別碼（UUID）禁的，名字改了也沒用；解封後舊留言恢復顯示。
      </p>
      <BlockedList initialBlocks={blockedList} />
    </section>
  );
}
