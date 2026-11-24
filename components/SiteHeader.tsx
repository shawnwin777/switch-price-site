"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { isAdminEmail } from "@/lib/admin";

/** 導覽列連結圖標：跟首頁選單同一套 inline SVG（stroke 1.8、圓角），
 *  18px，只做裝飾、文字才是連結名稱。 */
function NavIcon({ children }: { children: ReactNode }) {
  return (
    <span className="nav-link-icon" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

export default function SiteHeader() {
  const [email, setEmail] = useState<string | null>(null);
  /* 手機版導覽：橫條整個隱藏，改成右上角一顆 48×48 浮動小方塊
   *  （.nav-fab，position: fixed，跟著捲動一直在）；點開後選單是
   *  固定在按鈕下方的下拉面板（.nav.nav-open），點連結或換頁自動收起。 */
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  /* 登入連結帶 next=目前路徑（含 query），登入完成後回到這一頁。
   * （在 /login 本身時 next=/login，登入頁的 server 端檢查會把它
   *  擋下、改導 /home，不會迴圈。） */
  const search = searchParams.toString();
  const loginHref = `/login?next=${encodeURIComponent(
    (pathname ?? "/home") + (search ? `?${search}` : "")
  )}`;

  /* 換頁時收起手機版漢堡選單。 */
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    const db = createSupabaseBrowserClient();
    await db.auth.signOut();
    setEmail(null);
    router.refresh();
  }

  /* 首頁 /home 不顯示上方導覽列：首頁本身就是選單，登入入口改在
   * 首頁選單第一排「會員登入」；其他頁的導覽列完全不受影響。 */
  if (pathname === "/home" || pathname === "/") return null;

  return (
    <>
      {/* 手機版浮動導覽小方塊：桌機版不顯示（見 globals.css），只在
          ≤760px 出現，固定右上角、跟著捲動；點開／收起下拉選單。 */}
      <button
        type="button"
        className="nav-fab"
        aria-expanded={menuOpen}
        aria-controls="site-nav"
        aria-label={menuOpen ? "關閉選單" : "開啟選單"}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {menuOpen ? "✕" : "☰"}
      </button>
      <header className="site-header">
        <div className="site-header-inner">
          <Link href="/home" className="logo" aria-label="SHAWN GAME STUDIO 首頁">
            <Image
              src="/sgs-logo.png"
              alt="SHAWN GAME STUDIO"
              width={2172}
              height={724}
              priority
            />
          </Link>
          <nav
          id="site-nav"
          className={`nav${menuOpen ? " nav-open" : ""}`}
          onClick={() => setMenuOpen(false)}
        >
          <Link href="/home">
            <NavIcon>
              <path d="M4 11l8-7 8 7" />
              <path d="M6 9.5V20h12V9.5" />
            </NavIcon>
            首頁
          </Link>
          <Link href="/switch-price">
            <NavIcon>
              <rect x="2.5" y="6" width="19" height="12" rx="3" />
              <rect x="8" y="9" width="8" height="6" rx="1" />
              <circle cx="5.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
              <circle cx="18.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
            </NavIcon>
            Switch 比價
          </Link>
          <Link href="/deals">
            <NavIcon>
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M9 20h6" />
              <path d="M12 16v4" />
            </NavIcon>
            PC遊戲特價
          </Link>
          <Link href="/console">
            <NavIcon>
              <path d="M7 7h10a5 5 0 0 1 5 5v1a3 3 0 0 1-3 3c-1.2 0-2-.7-2.6-1.8H7.6C7 15.3 6.2 16 5 16a3 3 0 0 1-3-3v-1a5 5 0 0 1 5-5Z" />
              <path d="M8 10.5v3M6.5 12h3" />
              <circle cx="16" cy="11" r="0.8" fill="currentColor" stroke="none" />
              <circle cx="18" cy="13" r="0.8" fill="currentColor" stroke="none" />
            </NavIcon>
            家機特價
          </Link>
          {email && isAdminEmail(email) && (
            <Link href="/taiwan">台灣完整目錄</Link>
          )}
          {email && isAdminEmail(email) && (
            <Link href="/admin/reports">檢舉管理</Link>
          )}
          <Link href="/ranking">
            <NavIcon>
              <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
              <path d="M8 6H5.5a2.5 2.5 0 0 0 2.5 3" />
              <path d="M16 6h2.5a2.5 2.5 0 0 1-2.5 3" />
              <path d="M12 13v4" />
              <path d="M8.5 17h7" />
            </NavIcon>
            收藏排行
          </Link>
          {email ? (
            <>
              <span className="user-chip">{email}</span>
              <button type="button" className="btn" onClick={signOut}>
                登出
              </button>
            </>
          ) : (
            <Link href={loginHref}>
              <NavIcon>
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
              </NavIcon>
              登入
            </Link>
          )}
        </nav>
      </div>
    </header>
    </>
  );
}
