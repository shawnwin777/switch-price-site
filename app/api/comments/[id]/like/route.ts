import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// POST /api/comments/[id]/like → { liked: boolean, count: number }
// 切換留言讚。未登入回 401；留言不存在回 404。
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }

  const commentId = params.id;
  const { data: comment } = await supabase
    .from("comments")
    .select("id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) {
    return NextResponse.json({ error: "找不到留言" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("comment_likes")
    .select("id")
    .eq("user_id", user.id)
    .eq("comment_id", commentId)
    .maybeSingle();

  let liked: boolean;
  if (existing) {
    const { error } = await supabase
      .from("comment_likes")
      .delete()
      .eq("user_id", user.id)
      .eq("comment_id", commentId);
    if (error) {
      return NextResponse.json({ error: "取消讚失敗" }, { status: 500 });
    }
    liked = false;
  } else {
    const { error } = await supabase
      .from("comment_likes")
      .insert({ user_id: user.id, comment_id: commentId });
    if (error) {
      return NextResponse.json({ error: "按讚失敗" }, { status: 500 });
    }
    liked = true;
  }

  const { count } = await supabase
    .from("comment_likes")
    .select("id", { count: "exact", head: true })
    .eq("comment_id", commentId);

  return NextResponse.json({ liked, count: count ?? 0 });
}
