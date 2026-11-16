import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { fetchWithTimeout, supabaseAnonKey, supabaseUrl } from "./supabase-env";

// 伺服器端 client（server component 用，帶 cookie 以讀取登入狀態）。
// 這個檔案只能被 server component / route handler import，絕對不要被 client component 引用。
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: fetchWithTimeout },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[]
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Component 中 set cookie 會拋錯，讀取流程可忽略。
        }
      },
    },
  });
}
