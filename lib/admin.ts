// 網站管理員：只有這個帳號是管理員。
// 現況（2026-11-23）：此檔只用於 (1) /taiwan 台灣完整目錄的管理員判斷，
// (2) 留言區的管理員刪文判斷（app/api/comments/route.ts 的 DELETE）。
// 注意：supabase/migrations/20261117_admin_only_add.sql 已作廢、不要執行，
// /add 新增遊戲頁也已拔掉；寫入防護靠 Supabase RLS（社群四表已有公開
// SELECT＋own insert／delete 政策），不是靠這個 email 判斷擋下。
export const ADMIN_EMAIL = "shawnwin777@gmail.com";

export function isAdminEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === ADMIN_EMAIL;
}
