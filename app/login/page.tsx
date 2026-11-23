import { Suspense } from "react";
import { redirect } from "next/navigation";
import LoginClient from "@/components/LoginClient";
import { getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";

// force-dynamic：登入頁用 useSearchParams 讀 ?next，建置時不預渲染。
export const dynamic = "force-dynamic";

type Params = { [key: string]: string | string[] | undefined };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Params;
}) {
  // 已登入者打開 /login 不停在登入頁，直接導去 ?next= 指定的站內頁
  //（未帶 next 或 next 不合規格時回 /home）。
  const user = await getCurrentUser();
  if (user) {
    const raw = searchParams.next;
    redirect(safeNext(Array.isArray(raw) ? raw[0] : raw));
  }

  return (
    <Suspense fallback={<div className="narrow"><p>載入中…</p></div>}>
      <LoginClient />
    </Suspense>
  );
}
