import { redirect } from "next/navigation";

// 必須 force-dynamic：本頁若靜態預渲染，redirect() 只會寫進 RSC payload
// （REDIRECT;replace;/console;307），HTTP 回應是 307 卻沒有 Location header，
// curl／爬蟲／無 JS 拿不到目標（2026-11-23 第二輪稽核中 B-1；
// 根目錄 / 的同問題就是加 force-dynamic 修好的，見 app/page.tsx）。
// 保持 307（redirect() 預設就是 307），不要改成 308。
export const dynamic = "force-dynamic";

/** 舊會員方案頁：2026-11-23 13:55 shawn 決定把會員方案移進 /console、
 *  擺第一分頁，PS Plus／Game Pass 在裡面切換、不跳頁。
 *  本路由保留，只導向 /console（舊連結不斷）。 */
export default function MembershipPage() {
  redirect("/console");
}
