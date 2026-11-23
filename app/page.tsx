import { redirect } from "next/navigation";

// 根網址導向 /home（2026-11-23：比價牆搬到 /switch-price，首頁是 /home；
// 舊的 / 連結靠這個導向不會死）。
export default function RootPage() {
  redirect("/home");
}
