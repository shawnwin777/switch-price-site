// 登入後返回路徑驗證（/login 與 /auth/callback 共用）。
// 只接受站內相對路徑：以 / 開頭且不是 // 開頭，擋 //evil.com 這類
// open redirect；/login 與 /auth/* 不接受（登入後再導回登入頁或
// callback 會造成迴圈）。不合規格或缺失時回 fallback（預設 /home）。
export function safeNext(
  raw: string | null | undefined,
  fallback = "/home"
): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/"))
    return fallback;
  if (raw.startsWith("/auth/")) return fallback;
  return raw;
}
