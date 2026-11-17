import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, resolveGame } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// POST /api/likes { gameId } → { liked: boolean, count: number }
// 切換遊戲讚。未登入回 401。
// 讚數會出現在首頁卡片／詳情頁／排行／接近歷史低價（都是快取的公開資料），
// 成功後清掉相關快取 tag，下次載入就是新數字（就算沒清到，1 小時也會到期）。
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
    .from("game_likes")
    .select("id")
    .eq("user_id", user.id)
    .eq("game_id", game.id)
    .maybeSingle();

  let liked: boolean;
  if (existing) {
    const { error } = await supabase
      .from("game_likes")
      .delete()
      .eq("user_id", user.id)
      .eq("game_id", game.id);
    if (error) {
      return NextResponse.json({ error: "取消讚失敗" }, { status: 500 });
    }
    liked = false;
  } else {
    const { error } = await supabase
      .from("game_likes")
      .insert({ user_id: user.id, game_id: game.id });
    if (error) {
      return NextResponse.json({ error: "按讚失敗" }, { status: 500 });
    }
    liked = true;
  }

  const { count } = await supabase
    .from("game_likes")
    .select("id", { count: "exact", head: true })
    .eq("game_id", game.id);

  revalidateTag("games-page");
  revalidateTag("game");
  revalidateTag("ranking");
  revalidateTag("near-low");

  return NextResponse.json({ liked, count: count ?? 0 });
}
