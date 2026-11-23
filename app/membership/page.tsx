import { redirect } from "next/navigation";

/** 舊會員方案頁：2026-11-23 13:55 shawn 決定把會員方案移進 /console、
 *  擺第一分頁，PS Plus／Game Pass 在裡面切換、不跳頁。
 *  本路由保留，只導向 /console（舊連結不斷）。 */
export default function MembershipPage() {
  redirect("/console");
}
