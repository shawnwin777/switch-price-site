import { redirect } from "next/navigation";

// /add 已於 2026-11-23 移除（shawn：新增遊戲直接拔掉，用不到了）。
// 不再有任何新增表單或瀏覽器端寫入 games／prices 的邏輯。
// 檔案本身留著（push-files 不能刪檔），路由已死、直接導回首頁；
// 若要清乾淨，需 shawn 從 GitHub 網頁刪除 app/add/page.tsx。
export default function AddGamePage() {
  redirect("/home");
}
