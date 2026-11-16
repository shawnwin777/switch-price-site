// 網站管理員：只有這個帳號可以在站上新增遊戲。
// 判斷只看登入帳號的 email；RLS 政策
// （supabase/migrations/20261117_admin_only_add.sql）也用同一個 email
// 擋下非管理員的寫入，所以就算有人直接呼叫 Supabase 也加不進去。
export const ADMIN_EMAIL = "shawnwin777@gmail.com";

export function isAdminEmail(email: string | null | undefined): boolean {
  return (email ?? "").toLowerCase() === ADMIN_EMAIL;
}
