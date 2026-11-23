import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, resolveGame } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// POST /api/comments { gameId, body, author_name? } → 留言物件
// 新增留言。未登入回 401；內文為空或超過 1000 字回 400；
// 名字 trim 後超過 10 個字回 400「名字最多 10 個字」，空字串視為不填
// （存 NULL，前端顯示「玩家」）。
// 回傳欄位對照前端 CommentsSection.tsx：
//   { id, game_id, user_id, body, created_at, likes_count, liked_by_me, author_name }
//   （comments.author_name 由 20261123_add_comment_author_name migration 新增；
//   若該 migration 還沒跑，帶 author_name 的 insert 會因欄位不存在而失敗，
//   此時自動重試一次不帶 author_name 的 insert，留言不會在空窗期 500。）
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }

  let body: { gameId?: unknown; body?: unknown; author_name?: unknown };
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

  const authorName =
    typeof body.author_name === "string" ? body.author_name.trim() : "";
  if (authorName.length > 10) {
    return NextResponse.json({ error: "名字最多 10 個字" }, { status: 400 });
  }
  // 空字串視為不填：不帶 author_name 欄位寫入（等同 NULL，前端顯示「玩家」）。
  const authorNameValue = authorName ? authorName : null;

  const insertRow: Record<string, string> = {
    user_id: user.id,
    game_id: game.id,
    body: text,
  };
  if (authorNameValue) insertRow.author_name = authorNameValue;

  let { data, error } = await supabase
    .from("comments")
    .insert(insertRow)
    .select("id, game_id, user_id, body, author_name, created_at")
    .single();

  // 容錯：migration（20261123_add_comment_author_name）還沒跑時，上面
  // 帶 author_name 的 insert／select 會因欄位不存在而失敗（PGRST204／
  // 42703）。此時重試一次不帶 author_name 的寫入，留言功能不中斷。
  if (error && isMissingColumnError(error)) {
    const retry = await supabase
      .from("comments")
      .insert({ user_id: user.id, game_id: game.id, body: text })
      .select("id, game_id, user_id, body, created_at")
      .single();
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (error || !data) {
    return NextResponse.json({ error: "留言失敗" }, { status: 500 });
  }

  return NextResponse.json({
    ...data,
    author_name: (data as { author_name?: string | null }).author_name ?? null,
    likes_count: 0,
    liked_by_me: false,
  });
}

// PostgREST 缺欄位錯誤：insert／select 提到不存在的欄位時回 PGRST204
//（底層 Postgres 42703）；message 也會帶欄位名，雙重比對避免誤判。
function isMissingColumnError(error: { code?: string; message?: string }) {
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    (typeof error.message === "string" &&
      error.message.includes("author_name"))
  );
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
