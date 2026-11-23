import type { Metadata } from "next";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  description:
    "Switch / Switch 2 遊戲跨區比價：35 國 eShop 價格、歷史低價、特價提醒、收藏排行。",
  title: "Shawn Game Studio",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>
        {/* SiteHeader 用 useSearchParams 組登入連結的 next，
            依 Next.js 規定需包在 Suspense 裡。 */}
        <Suspense>
          <SiteHeader />
        </Suspense>
        <main className="container">{children}</main>
        <footer className="footer">
          <div className="container">
            <p>
              Shawn Game Studio ｜ 價格來自各區 Nintendo eShop 官方價格 API，匯率以當天
              08:00 台北時間為準。
            </p>
            <p className="footer-sub">
              本站為非官方網站，與任天堂、索尼互動娛樂、微軟、Valve、Epic
              Games 無關。Nintendo Switch、PlayStation、Xbox、Steam、Epic
              Games 等名稱與商標屬各權利人所有。價格與特價資訊取自各官方商店公開資料，僅供參考，實際價格以商店頁面為準。
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
