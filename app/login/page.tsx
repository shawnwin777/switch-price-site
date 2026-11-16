import { Suspense } from "react";
import LoginClient from "@/components/LoginClient";

// force-dynamic：登入頁用 useSearchParams 讀 ?next，建置時不預渲染。
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="narrow"><p>載入中…</p></div>}>
      <LoginClient />
    </Suspense>
  );
}
