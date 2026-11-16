import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./supabase-env";

// Service Role client：只給伺服器端排程／種子腳本使用，會繞過 RLS。
// 絕對不要在瀏覽器端 import 這個檔案，也不要把 SUPABASE_SERVICE_ROLE_KEY
// 傳給前端。沒有設定 key 時直接拋錯，避免用 anon key 誤寫公開表。
export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "缺少 SUPABASE_SERVICE_ROLE_KEY：請在 Vercel / .env.local 設定後再執行排程。"
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
