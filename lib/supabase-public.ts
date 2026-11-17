import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout, supabaseAnonKey, supabaseUrl } from "./supabase-env";

// 不帶 cookie 的公開唯讀 client，給快取層（lib/cached-data.ts）用。
// unstable_cache 的函式不能讀 cookies()/headers()，所以不能用
// createSupabaseServerClient()；這把只讀公開資料（games / prices /
// fx_rates / collections 計數），不帶任何登入狀態。
// 寫入與個人狀態（我的收藏／按讚／已購買）一律走原本的 server client
// 或 /api/* 路由，不走這把。
export function createPublicClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: fetchWithTimeout },
  });
}
