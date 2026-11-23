import { redirect } from "next/navigation";

// 根網址導向 /home（2026-11-23：比價牆搬到 /switch-price，首頁是 /home；
// 舊的 / 連結靠這個導向不會死）。
// 必須 force-dynamic：本頁若靜態預渲染，redirect() 只會寫進 RSC payload
// （REDIRECT;replace;/home;307），HTTP 回應是 307 卻沒有 Location header，
// curl／爬蟲／無 JS 拿不到目標（2026-11-23 稽核高-2，線上實測確認）。
// /taiwan 同樣用 redirect() 但有 force-dynamic，每次請求都在伺服器端
// 做導向，所以 307 帶正確 Location——本頁跟它同一套做法。
// 保持 307（redirect() 預設就是 307），不要改成 308。
export const dynamic = "force-dynamic";

export default function RootPage() {
  redirect("/home");
}
