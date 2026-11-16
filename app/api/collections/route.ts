import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, resolveGame } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// POST /api/collections { gameId } → { collected: boolean }
// 切換收藏：已收藏就取消，沒收藏就加入。未登入回 401。
// gameId 接受 games.id（uuid）或 slug（見 lib/auth.ts resolveGame）。
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }

  let body: { gameId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求內容不是 JSON" }, { status: 400 });
  }

  const game = await resolveGame(supabase, body.gameId);
  if (!game) {
    return NextResponse.json({ error: "找不到遊戲" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("collections")
    .select("id")
    .eq("user_id", user.id)
    .eq("game_id", game.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("collections")
      .delete()
      .eq("user_id", user.id)
      .eq("game_id", game.id);
    if (error) {
      return NextResponse.json({ error: "取消收藏失敗" }, { status: 500 });
    }
    return NextResponse.json({ collected: false });
  }

  const { error } = await supabase
    .from("collections")
    .insert({ user_id: user.id, game_id: game.id });
  if (error) {
    return NextResponse.json({ error: "收藏失敗" }, { status: 500 });
  }
  return NextResponse.json({ collected: true });
}
