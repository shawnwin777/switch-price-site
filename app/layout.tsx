import type { Metadata } from "next";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  description:
    "Switch 跨區比價、PC 與家機特價、NSO 會員跨區比價、歷史低價：價格取自各官方商店公開資料。",
  metadataBase: new URL("https://shawn-game-studio.vercel.app"),
  openGraph: {
    description:
      "Switch 跨區比價、PC 與家機特價、NSO 會員跨區比價、歷史低價：價格取自各官方商店公開資料。",
    images: [
      {
        alt: "Shawn Game Studio",
        height: 630,
        url: "https://shawn-game-studio.vercel.app/og-image.png",
        width: 1200,
      },
    ],
    locale: "zh_Hant",
    siteName: "Shawn Game Studio",
    title: "Shawn Game Studio",
    type: "website",
  },
  title: "Shawn Game Studio",
  twitter: {
    card: "summary_large_image",
    description:
      "Switch 跨區比價、PC 與家機特價、NSO 會員跨區比價、歷史低價：價格取自各官方商店公開資料。",
    images: ["https://shawn-game-studio.vercel.app/og-image.png"],
    title: "Shawn Game Studio",
  },
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
              Shawn Game Studio ｜ 價格取自各官方商店公開資料；牆面匯率以當天 08:00
              台北時間快照為準，NSO 比價頁匯率為即時抓取（每小時快取）。
            </p>
            <p className="footer-sub">
              本站為非官方網站，與任天堂、索尼互動娛樂、微軟、Valve、Epic
              Games 無關，亦未經其授權或認可。Nintendo Switch、PlayStation、Xbox、Steam、Epic
              Games 等名稱與商標屬各權利人所有。價格與特價資訊取自各官方商店公開資料，僅供參考，實際價格以商店頁面為準。
            </p>
            <p className="footer-sub">
              部分封面圖片來源：
              <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer">
                IGDB（igdb.com）
              </a>
              。
            </p>
            <p className="footer-sub">
              <Link href="/home">關於我</Link>｜
              <Link href="/privacy">隱私權政策</Link>｜
              <Link href="/terms">網站使用條款</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
