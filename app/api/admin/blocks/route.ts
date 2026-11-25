import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// POST /api/admin/blocks { user_id, reason? } → { ok: true, already?: boolean }
// 封鎖留言者。管理員限定。user_id 是 Supabase Auth UUID（Google／Discord
// 登入的帳號識別碼），不是 email、不是自填名字——名字可改、email 我們
// 不收，只有 UUID 穩定，封鎖就靠它。
// 封鎖後：該帳號不能再留言／檢舉，舊留言在詳情頁隱藏（不刪除，解封後
// 恢復顯示，避免誤封無法挽回）。同時清掉該使用者留言的所有檢舉（已處理；
// 刪文時也一樣清檢舉）。
// comment_blocks 表還沒建（migration 空窗期）回 503。
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "只有管理員可以封鎖" }, { status: 403 });
  }

  let body: { user_id?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求內容不是 JSON" }, { status: 400 });
  }
  const targetUserId =
    typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!targetUserId) {
    return NextResponse.json({ error: "缺少 user_id" }, { status: 400 });
  }
  if (targetUserId === user.id) {
    return NextResponse.json({ error: "不能封鎖自己" }, { status: 400 });
  }
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("comment_blocks").insert({
    user_id: targetUserId,
    reason: reason ? reason : null,
    blocked_by: user.email,
  });
  if (error) {
    // 已經封鎖過：冪等成功。
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, already: true });
    }
    // 表不存在（42P01）或欄位不存在（PGRST204）：migration 還沒跑。
    if (error.code === "42P01" || error.code === "PGRST204") {
      return NextResponse.json(
        { error: "封鎖功能尚未啟用，請先跑 migration" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "封鎖失敗" }, { status: 500 });
  }

  // 清掉該使用者留言的檢舉（已處理）。
  const { data: userComments } = await admin
    .from("comments")
    .select("id")
    .eq("user_id", targetUserId);
  const ids = (userComments ?? []).map((c: { id: string }) => c.id);
  if (ids.length > 0) {
    await admin.from("comment_reports").delete().in("comment_id", ids);
  }
  return NextResponse.json({ ok: true, already: false });
}

// DELETE /api/admin/blocks?user_id=<uuid> → { ok: true }
// 解封。管理員限定。解封後該帳號可重新留言，舊留言恢復顯示。
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "只有管理員可以解封" }, { status: 403 });
  }
  const targetUserId = request.nextUrl.searchParams.get("user_id") ?? "";
  if (!targetUserId) {
    return NextResponse.json({ error: "缺少 user_id" }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("comment_blocks")
    .delete()
    .eq("user_id", targetUserId);
  if (error) {
    return NextResponse.json({ error: "解封失敗" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
