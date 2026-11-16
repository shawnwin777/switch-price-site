import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase-env";

// Supabase Auth OAuth 回呼：GET /auth/callback?code=...&next=...
//   Google / Discord 登入按鈕（components/LoginClient.tsx）的 redirectTo 指向這裡。
// 流程：用授權碼向 Supabase 交換 session（PKCE code verifier 存在 cookie，
// 由 @supabase/ssr 自動帶上），成功後導回首頁或 ?next= 指定的站內頁。
//
// 回呼網址由 NEXT_PUBLIC_SITE_URL 組合（${NEXT_PUBLIC_SITE_URL}/auth/callback），
// 絕對不要在程式碼寫死網址。部署後要把這個網址填回：
//   - Google Cloud Console → OAuth 用戶端 → 已授權的重新導向 URI
//   - Discord Developer Portal → OAuth2 → Redirects
//   - Supabase 後台 → Authentication → URL Configuration → Site URL / Redirect URLs
// 詳見 SETUP.md。

function siteUrl(request: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    request.nextUrl.origin
  );
}

/** 只允許站內相對路徑，避免 open redirect。 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  const base = siteUrl(request);

  // 先建好導向回應，再把 session cookie 寫在這份回應上
  //（Supabase SSR 官方寫法：exchangeCodeForSession 前就要有 response 物件）。
  const response = NextResponse.redirect(`${base}${next}`);

  if (!code) {
    return NextResponse.redirect(`${base}/login?error=missing_code`);
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${base}/login?error=auth_callback_failed`
    );
  }

  return response;
}
