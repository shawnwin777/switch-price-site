import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, resolveGame } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

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
