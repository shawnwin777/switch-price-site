import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Shawn Game Studio｜遊戲比價首頁",
  description:
    "Switch 跨區比價、PC 與家機特價、NSO 會員跨區比價、歷史低價：價格取自各官方商店公開資料。",
};

/** 新首頁 /home（2026-11-23 改版，shawn 定）：遊戲選單風格。
 *  左邊放大圖標（SGS 標誌 public/sgs-logo.png）＋招牌語，
 *  右邊三個選單：SWITCH → /switch-price、PC GAMES → /deals、
 *  Gaming console → /console；最下面「關於我」。
 *  2026-11-23 下午 shawn 說下面兩組入口卡片（特價情報、會員・收藏）
 *  用不太到，整組刪掉——那些頁面（/upcoming、/near-low、
 *  /historical-low、/nso、/ranking、/taiwan）本身不動、還在站上，
 *  只是不在 /home 列出來。選單圖標是 inline SVG，不用 emoji。
 *  本頁不抓資料、純靜態。 */
export default function HomeLandingPage() {
  return (
    <>
      <section className="home-menu">
        <div className="home-menu-brand">
          <Image
            src="/sgs-logo.png"
            alt="SHAWN GAME STUDIO"
            width={2172}
            height={724}
            priority
            className="home-menu-logo"
          />
          <h1 className="home-hero-title">
            遊戲比價，<span>從這裡開始</span>
          </h1>
          <p className="home-hero-sub">
            Switch 跨區比價、PC 與家機特價、NSO 會員跨區比價、歷史低價——
            價格取自各官方商店公開資料，僅供參考。
          </p>
        </div>

        <nav className="home-menu-list" aria-label="遊戲選單">
          <Link href="/switch-price" className="home-menu-item">
            <span className="home-menu-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2.5" y="6" width="19" height="12" rx="3" />
                <rect x="8" y="9" width="8" height="6" rx="1" />
                <circle cx="5.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
                <circle cx="18.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="home-menu-item-text">
              <span className="home-menu-item-title">SWITCH</span>
              <span className="home-menu-item-sub">
                Switch 比價 · 35 國 eShop 跨區比價
              </span>
            </span>
            <span className="home-menu-arrow" aria-hidden="true">
              →
            </span>
          </Link>

          <Link href="/deals" className="home-menu-item">
            <span className="home-menu-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M9 20h6" />
                <path d="M12 16v4" />
              </svg>
            </span>
            <span className="home-menu-item-text">
              <span className="home-menu-item-title">PC GAMES</span>
              <span className="home-menu-item-sub">
                PC遊戲特價 · Steam、Xbox PC、Epic 免費遊戲
              </span>
            </span>
            <span className="home-menu-arrow" aria-hidden="true">
              →
            </span>
          </Link>

          <Link href="/console" className="home-menu-item">
            <span className="home-menu-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 7h10a5 5 0 0 1 5 5v1a3 3 0 0 1-3 3c-1.2 0-2-.7-2.6-1.8H7.6C7 15.3 6.2 16 5 16a3 3 0 0 1-3-3v-1a5 5 0 0 1 5-5Z" />
                <path d="M8 10.5v3M6.5 12h3" />
                <circle cx="16" cy="11" r="0.8" fill="currentColor" stroke="none" />
                <circle cx="18" cy="13" r="0.8" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="home-menu-item-text">
              <span className="home-menu-item-title">Gaming console</span>
              <span className="home-menu-item-sub">
                家機特價 · Xbox 家機、PlayStation
              </span>
            </span>
            <span className="home-menu-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </nav>
      </section>

      <section className="home-about">
        <h2 className="deals-section-title">關於我</h2>
        <p>
          SHAWN GAME STUDIO
          是個人經營的非官方遊戲比價站：Switch 跨區比價、PC
          與家機特價、NSO 會員跨區比價與歷史低價，價格取自 Nintendo、Sony、
          Microsoft、Valve、Epic 各官方商店的公開資料，僅供參考，實際價格以商店頁面為準。
          本站與任天堂、索尼、微軟、Valve、Epic 沒有任何關聯。
        </p>
        <ul className="home-about-links">
          <li>
            Instagram：
            <a
              href="https://www.instagram.com/shawn1106_"
              target="_blank"
              rel="noopener noreferrer"
            >
              shawn1106_
            </a>
          </li>
          <li>
            Threads：
            <a
              href="https://www.threads.net/@shawn1106_"
              target="_blank"
              rel="noopener noreferrer"
            >
              shawn1106_
            </a>
          </li>
          <li>Discord：shawn1106</li>
        </ul>
      </section>
    </>
  );
}
