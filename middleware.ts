import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "./lib/supabase-env";

// Supabase Auth session 刷新中介層（標準 @supabase/ssr 寫法）。
// 每個請求都用 getUser() 刷新 session，確保登入狀態在 server component
// 與 route handler 都讀得到；不做擋路（未登入也能看公開頁面，
// 需要登入的操作由各 API 路由自己回 401，前端再導向 /login）。
export async function middleware(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // 刷新 session（同時驗證 access token 是否仍有效）。
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    // 全部路徑都跑 session 刷新，排除靜態資源與圖片。
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
