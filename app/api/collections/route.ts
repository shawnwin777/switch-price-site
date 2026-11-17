import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, resolveGame } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// POST /api/collections { gameId } → { collected: boolean }
// 切換收藏：已收藏就取消，沒收藏就加入。未登入回 401。
// gameId 接受 games.id（uuid）或 slug（見 lib/auth.ts resolveGame）。
// 收藏數會出現在首頁卡片／詳情頁／排行／接近歷史低價（都是快取的公開資料），
// 成功後清掉相關快取 tag，下次載入就是新數字（就算沒清到，1 小時也會到期）。
// 注意：收藏／取消不影響「只看我的收藏」的快取鍵（id 清單是即時取的），
// 所以這裡不需要清使用者的個人快取。
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

  // 未具名遊戲尚未開放收藏（見 migration 20261118_unnamed_games.sql）：
  // 否則它們會透過收藏排行（/ranking 只列有收藏的遊戲）曝光。
  // is_unnamed 欄位還沒建時查詢失敗，視為具名、照常收藏。
  const { data: flag, error: flagError } = await supabase
    .from("games")
    .select("is_unnamed")
    .eq("id", game.id)
    .maybeSingle();
  if (
    !flagError &&
    (flag as { is_unnamed?: boolean } | null)?.is_unnamed === true
  ) {
    return NextResponse.json(
      { error: "未命名商品尚未開放收藏" },
      { status: 400 }
    );
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
    revalidateTag("games-page");
    revalidateTag("game");
    revalidateTag("ranking");
    revalidateTag("near-low");
    return NextResponse.json({ collected: false });
  }

  const { error } = await supabase
    .from("collections")
    .insert({ user_id: user.id, game_id: game.id });
  if (error) {
    return NextResponse.json({ error: "收藏失敗" }, { status: 500 });
  }
  revalidateTag("games-page");
  revalidateTag("game");
  revalidateTag("ranking");
  revalidateTag("near-low");
  return NextResponse.json({ collected: true });
}
