import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  description:
    "Switch / Switch 2 遊戲跨區比價：35 國 eShop 價格、歷史低價、特價提醒、收藏排行。",
  title: "Switch 遊戲比價",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>
        <SiteHeader />
        <main className="container">{children}</main>
        <footer className="footer">
          <div className="container">
            <p>
              Switch 遊戲比價 ｜ 價格來自各區 Nintendo eShop 官方價格 API，匯率以當天
              08:00 台北時間為準。
            </p>
            <p className="footer-sub">
              本站為玩家自發整理的比價工具，與任天堂無關。價格僅供參考，實際結帳金額以
              eShop 為準。
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
