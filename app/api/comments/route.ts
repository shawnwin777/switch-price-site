import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, resolveGame } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// POST /api/comments { gameId, body } → 留言物件
// 新增留言。未登入回 401；內文為空或超過 1000 字回 400。
// 回傳欄位對照前端 CommentsSection.tsx：
//   { id, game_id, user_id, body, created_at, likes_count, liked_by_me, author_name }
//   （comments 表沒有 author_name 欄位，前端讀不到時會顯示「玩家」。）
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }

  let body: { gameId?: unknown; body?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求內容不是 JSON" }, { status: 400 });
  }

  const game = await resolveGame(supabase, body.gameId);
  if (!game) {
    return NextResponse.json({ error: "找不到遊戲" }, { status: 404 });
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "留言內容不可為空" }, { status: 400 });
  }
  if (text.length > 1000) {
    return NextResponse.json({ error: "留言最多 1000 字" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({ user_id: user.id, game_id: game.id, body: text })
    .select("id, game_id, user_id, body, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "留言失敗" }, { status: 500 });
  }

  return NextResponse.json({
    ...data,
    author_name: null,
    likes_count: 0,
    liked_by_me: false,
  });
}

// DELETE /api/comments?id=<comment uuid> → { ok: true }
// 管理員刪文。未登入回 401；非管理員回 403；留言不存在回 404。
// 注意：社群四表已有 RLS（comments_delete_own：auth.uid() = user_id），
// anon key 只能刪自己的留言，所以這裡必須用 service role 的 server 端
// client（lib/supabase-admin.ts，沿用 /api/refresh 的現成用法）才能刪
// 別人的留言；管理員身分由 isAdminEmail 在路由內再檢查一次。
export async function DELETE(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "只有管理員可以刪除留言" }, { status: 403 });
  }

  let commentId = request.nextUrl.searchParams.get("id") ?? "";
  if (!commentId) {
    try {
      const body: { id?: unknown; commentId?: unknown } =
        await request.json();
      const raw = body.id ?? body.commentId;
      commentId = typeof raw === "string" ? raw : "";
    } catch {
      // 沒有 JSON body 就當作沒給 id，下面回 400。
    }
  }
  if (!commentId) {
    return NextResponse.json({ error: "缺少留言 id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  // 先清該留言的讚（comment_likes 的 FK 未必有 cascade，刪留言前先清掉
  // 才不會被 FK 擋下；有 cascade 時這步只是空操作）。
  await admin.from("comment_likes").delete().eq("comment_id", commentId);
  const { data, error } = await admin
    .from("comments")
    .delete()
    .eq("id", commentId)
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "刪除留言失敗" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "找不到留言" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
