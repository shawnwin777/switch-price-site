import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// POST /api/comments/[id]/report { reason?: string } → { ok: true, already?: boolean }
// 檢舉留言。未登入回 401；留言不存在回 404；
// reason 可空、trim 後最多 200 字，超長回 400。
// 同一人同一留言重複檢舉採「冪等成功」：已檢舉過就直接回
// { ok: true, already: true }，不重複寫入（comment_reports 另有
// unique(comment_id, reporter_id) 當第二道防線；若兩個請求同時
// 寫入、unique 擋下第二筆，也視為 already）。
// 注意：comment_reports 表由 20261124_add_comment_reports migration
// 建立；migration 還沒跑時寫入會失敗（回 500），跑完才生效。
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }

  // 被封鎖者不能再檢舉（避免拿檢舉報復別人）。表還沒建時放行。
  try {
    const admin = createSupabaseAdminClient();
    const { data: blockRow } = await admin
      .from("comment_blocks")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (blockRow) {
      return NextResponse.json(
        { error: "你已被禁止留言與檢舉" },
        { status: 403 }
      );
    }
  } catch {
    // comment_blocks 表未建（migration 空窗期）時放行。
  }

  let body: { reason?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // 沒有 JSON body 就當作沒給 reason，照無理由檢舉處理。
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > 200) {
    return NextResponse.json({ error: "檢舉理由最多 200 字" }, { status: 400 });
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
    .from("comment_reports")
    .select("id")
    .eq("reporter_id", user.id)
    .eq("comment_id", commentId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, already: true });
  }

  const { error } = await supabase.from("comment_reports").insert({
    comment_id: commentId,
    reporter_id: user.id,
    reason: reason ? reason : null,
  });
  if (error) {
    // 並行請求同時寫入時 unique 擋下第二筆（23505）：視為已檢舉。
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, already: true });
    }
    return NextResponse.json({ error: "檢舉失敗" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, already: false });
}
