import type { Metadata } from "next";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  description:
    "Switch / Switch 2 遊戲跨區比價：35 國 eShop 價格、歷史低價、特價提醒、收藏排行。",
  metadataBase: new URL("https://shawn-game-studio.vercel.app"),
  openGraph: {
    description:
      "Switch / Switch 2 遊戲跨區比價：35 國 eShop 價格、歷史低價、特價提醒、收藏排行。",
    images: [
      {
        alt: "Shawn Game Studio",
        height: 724,
        url: "https://shawn-game-studio.vercel.app/sgs-logo.png",
        width: 2172,
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
      "Switch / Switch 2 遊戲跨區比價：35 國 eShop 價格、歷史低價、特價提醒、收藏排行。",
    images: ["https://shawn-game-studio.vercel.app/sgs-logo.png"],
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
              Shawn Game Studio ｜ 價格取自各官方商店公開資料，匯率為即時抓取（每小時快取）。
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
          </div>
        </footer>
      </body>
    </html>
  );
}
