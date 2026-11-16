import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabase-server";

// 登入相關 helper（route handler / server component 共用）。
// 讀 session 一律走 lib/supabase-server.ts 的 server client（帶 cookie），
// 這裡不另外建 client，避免兩份 session 邏輯。

/** 取目前登入使用者；未登入回傳 null（不拋錯）。 */
export async function getCurrentUser(
  db?: SupabaseClient
): Promise<User | null> {
  const supabase = db ?? createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

/**
 * 解析前端傳來的 gameId。
 *
 * 前端元件（CollectionButton / LikeButton / CommentsSection）傳的是
 * Supabase games.id（uuid 字串，元件型別上寫 number 是沿用種子檔的寫法，
 * 實際跑起來是 uuid）。同時也接受 slug 字串，方便除錯與手動呼叫。
 * 種子檔的數字 id（1..32）沒有寫進資料庫，無法對照，傳數字會回 404。
 */
export async function resolveGame(
  db: SupabaseClient,
  gameId: unknown
): Promise<{ id: string; slug: string } | null> {
  if (typeof gameId !== "string" || gameId.length === 0) return null;

  // 1) 先當 uuid 查 id
  const byId = await db
    .from("games")
    .select("id, slug")
    .eq("id", gameId)
    .maybeSingle();
  if (byId.data) return byId.data as { id: string; slug: string };

  // 2) 再當 slug 查
  const bySlug = await db
    .from("games")
    .select("id, slug")
    .eq("slug", gameId)
    .maybeSingle();
  if (bySlug.data) return bySlug.data as { id: string; slug: string };

  return null;
}
