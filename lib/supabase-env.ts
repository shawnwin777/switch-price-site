// Supabase 連線設定共用常數（不含 next/headers，瀏覽器端與伺服器端都可 import）。
// Supabase 專案還不存在時，用 placeholder 讓 client 可以建立、
// npm run build 能通過；實際查詢會失敗，lib/data.ts 會把失敗當成「尚無資料」處理，
// 不會在建置或執行時拋錯。
export const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
export const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://placeholder.supabase.co"
  );
}

// 帶逾時的 fetch：Supabase 專案還不存在或連不上時，查詢 8 秒就放棄，
// 頁面顯示「尚無資料」，而不是讓請求一直掛著（lib/data.ts 會把失敗當空資料處理）。
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

