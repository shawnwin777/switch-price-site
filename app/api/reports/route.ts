import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// DELETE /api/reports?id=<report uuid> → { ok: true }
// 管理員忽略檢舉：刪掉 comment_reports 的一列，留言本身保留。
// 未登入回 401；非管理員回 403；檢舉不存在回 404。
// comment_reports 沒有公開 SELECT／DELETE policy，所以用 service role 的
// server 端 client（lib/supabase-admin.ts，沿用 DELETE /api/comments 的
// 現成用法）；管理員身分由 isAdminEmail 在路由內再檢查一次。
export async function DELETE(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "只有管理員可以忽略檢舉" }, { status: 403 });
  }

  let reportId = request.nextUrl.searchParams.get("id") ?? "";
  if (!reportId) {
    try {
      const body: { id?: unknown; reportId?: unknown } =
        await request.json();
      const raw = body.id ?? body.reportId;
      reportId = typeof raw === "string" ? raw : "";
    } catch {
      // 沒有 JSON body 就當作沒給 id，下面回 400。
    }
  }
  if (!reportId) {
    return NextResponse.json({ error: "缺少檢舉 id" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("comment_reports")
    .delete()
    .eq("id", reportId)
    .select("id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "忽略檢舉失敗" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "找不到檢舉" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
