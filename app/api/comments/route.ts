import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, resolveGame } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// POST /api/comments { gameId, body, author_name?, parent_comment_id? } → 留言物件
// 新增留言。未登入回 401；內文為空或超過 1000 字回 400；
// 名字 trim 後超過 10 個字回 400「名字最多 10 個字」，空字串視為不填
// （存 NULL，前端顯示「玩家」）。
// 一層回覆：parent_comment_id 指向上層留言；parent 不存在回 400，
// parent 本身是回覆（其 parent_comment_id 非 null）回 400；
// parent migration（20261124_add_comment_parent）還沒跑時，帶
// parent_comment_id 的寫入回 503「回覆功能尚未啟用，請稍後再試」。
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

  // 封鎖檢查：被封鎖者不能再留言。comment_blocks 只有 service-role
  // 可讀，用 admin client 查；表還沒建（migration 空窗期）或 key 未設
  // 時放行（fail-open），留言功能不中斷，見下方 catch。
  let blocked = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data: blockRow, error: blockError } = await admin
      .from("comment_blocks")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (blockError) throw blockError;
    blocked = !!blockRow;
  } catch (e) {
    console.warn(
      "[comments] 封鎖檢查失敗，放行：",
      e instanceof Error ? e.message : e
    );
  }
  if (blocked) {
    // 訊息刻意寫得籠統（不直接說「你被封鎖了」）：只說留言失敗，
    // 帳號未登入或是曾經違規，請聯絡我。
    return NextResponse.json(
      { error: "留言失敗：帳號未登入或是曾經違規，請聯絡我。" },
      { status: 403 }
    );
  }

  let body: {
    gameId?: unknown;
    body?: unknown;
    author_name?: unknown;
    parent_comment_id?: unknown;
  };
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

  // 一層回覆：parent 必須是該遊戲的上層留言（存在、且本身不是回覆）。
  let parentCommentId: string | null = null;
  if (
    typeof body.parent_comment_id === "string" &&
    body.parent_comment_id.trim()
  ) {
    parentCommentId = body.parent_comment_id.trim();
    const { data: parent, error: parentError } = await supabase
      .from("comments")
      .select("id, game_id, parent_comment_id")
      .eq("id", parentCommentId)
      .maybeSingle();
    // 容錯：parent migration 還沒跑時，讀 parent_comment_id 會因欄位
    // 不存在而失敗——回 503（不是 500），前端提示回覆功能尚未啟用。
    if (
      parentError &&
      isMissingColumnErrorFor(parentError, "parent_comment_id")
    ) {
      return NextResponse.json(
        { error: "回覆功能尚未啟用，請稍後再試" },
        { status: 503 }
      );
    }
    if (parentError) {
      return NextResponse.json({ error: "讀取父留言失敗" }, { status: 500 });
    }
    if (!parent) {
      return NextResponse.json({ error: "找不到要回覆的留言" }, { status: 400 });
    }
    if ((parent as { game_id?: string }).game_id !== game.id) {
      return NextResponse.json(
        { error: "只能回覆同一款遊戲的留言" },
        { status: 400 }
      );
    }
    if ((parent as { parent_comment_id?: string | null }).parent_comment_id) {
      return NextResponse.json(
        { error: "只能回覆上層留言，不能回覆回覆" },
        { status: 400 }
      );
    }
  }

  const insertRow: Record<string, string> = {
    user_id: user.id,
    game_id: game.id,
    body: text,
  };
  if (authorNameValue) insertRow.author_name = authorNameValue;
  if (parentCommentId) insertRow.parent_comment_id = parentCommentId;

  // select 欄位跟著 parent 走：沒要求回覆就不問 parent_comment_id，
  // migration 空窗期上層留言的寫入才不會被不存在的欄位拖垮。
  // （selectCols 是動態字串，supabase-js 無法從它推斷列型別，這裡把
  // 回傳結果註明為一般物件，避免 ...data 展開時 TS2698。）
  const selectCols =
    "id, game_id, user_id, body, author_name, created_at" +
    (parentCommentId ? ", parent_comment_id" : "");
  const inserted = (await supabase
    .from("comments")
    .insert(insertRow)
    .select(selectCols)
    .single()) as {
    data: Record<string, unknown> | null;
    error: { code?: string; message?: string } | null;
  };
  let { data, error } = inserted;

  // 容錯：parent migration 還沒跑時，帶 parent_comment_id 的 insert 會因
  // 欄位不存在而失敗（PGRST204／42703）。此時回 503（不是 500）。
  if (
    error &&
    parentCommentId &&
    isMissingColumnErrorFor(error, "parent_comment_id")
  ) {
    return NextResponse.json(
      { error: "回覆功能尚未啟用，請稍後再試" },
      { status: 503 }
    );
  }

  // 容錯：migration（20261123_add_comment_author_name）還沒跑時，上面
  // 帶 author_name 的 insert／select 會因欄位不存在而失敗（PGRST204／
  // 42703）。此時重試一次不帶 author_name 的寫入，留言功能不中斷。
  // （重試仍保留 parent_comment_id——回覆不能因為重試變成上層留言。）
  if (error && isMissingColumnError(error)) {
    const retryInsert: Record<string, string> = {
      user_id: user.id,
      game_id: game.id,
      body: text,
    };
    if (parentCommentId) retryInsert.parent_comment_id = parentCommentId;
    const retrySelect =
      "id, game_id, user_id, body, created_at" +
      (parentCommentId ? ", parent_comment_id" : "");
    const retried = (await supabase
      .from("comments")
      .insert(retryInsert)
      .select(retrySelect)
      .single()) as typeof inserted;
    data = retried.data;
    error = retried.error;
  }

  if (error || !data) {
    return NextResponse.json({ error: "留言失敗" }, { status: 500 });
  }

  return NextResponse.json({
    ...data,
    author_name: (data as { author_name?: string | null }).author_name ?? null,
    parent_comment_id:
      (data as { parent_comment_id?: string | null }).parent_comment_id ??
      parentCommentId,
    likes_count: 0,
    liked_by_me: false,
  });
}

// PostgREST 缺指定欄位錯誤：code 是 PGRST204／42703 且 message 帶欄位名。
// 欄位名是判別依據——insert 同時帶 author_name 和 parent_comment_id 時，
// 只看 code 無法分辨是哪個欄位不存在。
function isMissingColumnErrorFor(
  error: { code?: string; message?: string },
  column: string
) {
  return (
    (error.code === "PGRST204" || error.code === "42703") &&
    typeof error.message === "string" &&
    error.message.includes(column)
  );
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
