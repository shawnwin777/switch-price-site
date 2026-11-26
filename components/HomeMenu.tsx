"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";

/** /home 首頁斜切抽屜選單（2026-11-23 shawn 定）。
 *  左邊是斜切品牌板（SGS logo＋標語），右邊是五個選單；
 *  第一排「會員登入」→ /login?next=/home（首頁不顯示上方導覽列，登入入口在這裡），
 *  點了直接進登入頁、不開抽屜（2026-11-25 shawn：抽屜裡的「前往登入」不好按）；
 *  再來 SWITCH → /switch-price、PC GAMES → /deals、
 *  GAMING CONSOLE → /console、關於我 → /about（第五格，2026-11-26 從
 *  展開面板拉出來獨立成頁，點了直接進頁面、不再跳到封面；滑過去
 *  照樣展開預覽，跟其他選單一樣）。
 *  hover／點按其他選單時，品牌板像抽屜一樣被抽走（向左滑出＋微斜），
 *  露出底下的預覽圖列，停在那裡不彈回；移開後延遲一下才收回。
 *  SWITCH 預覽 = 站內特價 Switch 遊戲（Nintendo CDN 封面）；
 *  PC 預覽 = Steam＋Xbox PC 特價（官方圖）；家機預覽 = Xbox＋PS 特價；
 *  關於我預覽 = 介紹文字＋IG／Threads／Discord 圖標。
 *  預覽圖由 server 端 page.tsx 抓好當 props 傳進來，失敗時這裡
 *  顯示漸層佔位、不讓整頁掛掉。
 *  手機（≤860px）不玩抽屜：上下堆疊看不到品牌板滑開，選單點一下
 *  直接進連結（hover／focus 也不展開預覽，避免點按時頁面先被拉長）；
 *  品牌板的滑出動畫在手機版停用。 */

export interface HomePreviewItem {
  key: string;
  title: string;
  /** 官方圖（Nintendo／Steam／Microsoft／PlayStation CDN）。 */
  image: string;
  url: string;
  badge: string;
  priceLine: string;
  /** 來源標籤：Switch／Steam／Xbox PC／Xbox／PlayStation。 */
  source: string;
  /** true = 外站商店連結（新分頁開）；false = 站內遊戲頁。 */
  external: boolean;
}

export interface HomePreviews {
  switch: HomePreviewItem[];
  pc: HomePreviewItem[];
  console: HomePreviewItem[];
}

type MenuKey = "login" | "switch" | "pc" | "console" | "about";

/** 關抽屜前的停頓（毫秒）：滑鼠離開選單／預覽區後先等一下，
 *  避免在兩個區域之間移動時閃爍、也做出「停在那裡」的感覺。 */
const CLOSE_DELAY_MS = 450;

const MENU: {
  key: MenuKey;
  href: string;
  title: string;
  sub: string;
  icon: ReactNode;
}[] = [
  {
    key: "login",
    href: "/login?next=/home",
    title: "會員登入",
    sub: "登入會員 · 收藏遊戲、同步已購買",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="11" r="2" />
        <path d="M5.5 16.5c.8-2 2-2.8 3.5-2.8s2.7.8 3.5 2.8" />
        <path d="M15.5 9.5h4" />
        <path d="M15.5 13h4" />
      </svg>
    ),
  },
  {
    key: "switch",
    href: "/switch-price",
    title: "SWITCH",
    sub: "Switch 比價 · 35 國 eShop 跨區比價",
    icon: (
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
    ),
  },
  {
    key: "pc",
    href: "/deals",
    title: "PC GAMES",
    sub: "PC遊戲特價 · Steam、Xbox PC、Epic 免費遊戲",
    icon: (
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
    ),
  },
  {
    key: "console",
    href: "/console",
    title: "GAMING CONSOLE",
    sub: "家機特價 · Xbox 家機、PlayStation",
    icon: (
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
    ),
  },
  {
    key: "about",
    href: "/about",
    title: "關於我",
    sub: "SHAWN GAME STUDIO · Instagram／Threads／Discord",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
      </svg>
    ),
  },
];

function PreviewTiles({ items }: { items: HomePreviewItem[] }) {
  if (items.length === 0) {
    return (
      <div className="home-preview-empty">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="home-preview-tile home-preview-tile-empty" aria-hidden="true">
            <span className="home-preview-tile-shimmer" />
            <span className="home-preview-tile-text">預覽準備中…</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="home-preview-grid">
      {items.map((item) => {
        const inner = (
          <>
            <span className="home-preview-thumb">
              <img src={item.image} alt={item.title} loading="lazy" />
              {item.badge ? <span className="home-preview-badge">{item.badge}</span> : null}
              <span className="home-preview-source">{item.source}</span>
            </span>
            <span className="home-preview-tile-title">{item.title}</span>
            <span className="home-preview-tile-price">{item.priceLine}</span>
          </>
        );
        return item.external ? (
          <a
            key={item.key}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="home-preview-tile"
          >
            {inner}
          </a>
        ) : (
          <Link key={item.key} href={item.url} className="home-preview-tile">
            {inner}
          </Link>
        );
      })}
    </div>
  );
}

function AboutPreview() {
  return (
    <div className="home-about-preview">
      <p className="home-about-preview-text">
        SHAWN GAME STUDIO
        是個人經營的非官方遊戲比價站：Switch 跨區比價、PC
        與家機特價、NSO 會員跨區比價與歷史低價，價格取自 Nintendo、Sony、
        Microsoft、Valve、Epic 各官方商店的公開資料，僅供參考，實際價格以商店頁面為準。
        本站與任天堂、索尼、微軟、Valve、Epic、EA、Ubisoft、Fanatical、GamerPower、GOG
        沒有任何關聯。
      </p>
      <ul className="home-about-social">
        <li>
          <a
            href="https://www.instagram.com/shawn1106_"
            target="_blank"
            rel="noopener noreferrer"
            className="home-about-social-link"
          >
            <span className="home-about-social-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="home-about-social-text">
              <span className="home-about-social-name">Instagram</span>
              <span className="home-about-social-handle">shawn1106_</span>
            </span>
          </a>
        </li>
        <li>
          <a
            href="https://www.threads.net/@shawn1106_"
            target="_blank"
            rel="noopener noreferrer"
            className="home-about-social-link"
          >
            <span className="home-about-social-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <text
                  x="12"
                  y="16.5"
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="800"
                  fill="currentColor"
                >
                  @
                </text>
              </svg>
            </span>
            <span className="home-about-social-text">
              <span className="home-about-social-name">Threads</span>
              <span className="home-about-social-handle">shawn1106_</span>
            </span>
          </a>
        </li>
        <li>
          <a
            href="https://discord.com/users/913092036079517717"
            target="_blank"
            rel="noopener noreferrer"
            className="home-about-social-link"
          >
            <span className="home-about-social-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 17c-2.5 0-4.5-1.8-4.5-4.5v-1C3.5 8 6 5.5 9 5.5h6c3 0 5.5 2.5 5.5 5.5v1C20.5 15.2 18.5 17 16 17c-1 0-1.8-.5-2.4-1.3H10.4C9.8 16.5 9 17 8 17Z" />
                <circle cx="9" cy="11" r="0.9" fill="currentColor" stroke="none" />
                <circle cx="15" cy="11" r="0.9" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="home-about-social-text">
              <span className="home-about-social-name">Discord</span>
              <span className="home-about-social-handle">shawn1106</span>
            </span>
          </a>
        </li>
      </ul>
      <div className="home-about-donate">
        <p className="home-about-donate-text">
          你的贊助，是我繼續抓價格的燃料。
        </p>
        <a
          href="https://shawn-game-studio.bobaboba.me"
          target="_blank"
          rel="noopener noreferrer"
          className="home-about-donate-btn"
        >
          <img
            src="https://s3.ap-southeast-1.amazonaws.com/media.anyonelab.com/images/boba/boba-embed-icon.png"
            alt=""
            aria-hidden="true"
            className="home-about-donate-icon"
          />
          請我喝珍奶！
        </a>
      </div>
    </div>
  );
}

export default function HomeMenu({ previews }: { previews: HomePreviews }) {
  const [active, setActive] = useState<MenuKey | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 已登入時藏起「會員登入」卡（點了只會導回首頁、容易誤導）；
  // 跟上方導覽列一樣用瀏覽器端 auth 狀態（首頁是 ISR 快取，不能由 server 端依使用者決定）。
  useEffect(() => {
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(({ data }) => setLoggedIn(!!data.user));
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, session) =>
      setLoggedIn(!!session?.user)
    );
    return () => subscription.unsubscribe();
  }, []);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setActive(null), CLOSE_DELAY_MS);
  };

  const open = (key: MenuKey) => {
    cancelClose();
    setActive(key);
  };

  /** 手機寬度（≤860px）：上下堆疊不玩抽屜，選單點了直接進連結。 */
  const isMobileWidth = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 860px)").matches;

  /** 觸控裝置點連結：第一次點先展開預覽、留在本頁，
   *  已經展開時再點才真的進連結；手機寬度不攔截、直接進連結，
   *  桌機 hover 不受影響。會員登入不攔截：點了直接進 /login。 */
  const handleLinkClick = (key: MenuKey, e: MouseEvent) => {
    if (
      key !== "login" &&
      typeof window !== "undefined" &&
      window.matchMedia("(hover: none)").matches &&
      !isMobileWidth()
    ) {
      if (active !== key) {
        e.preventDefault();
        open(key);
      }
    }
  };

  const previewItems: HomePreviewItem[] =
    active === "switch" ? previews.switch : active === "pc" ? previews.pc : active === "console" ? previews.console : [];

  return (
    <section
      className={`home-diagonal${active ? " drawer-open" : ""}`}
      data-active={active ?? ""}
      onMouseLeave={scheduleClose}
    >
      <div className="home-drawer-zone">
        {/* 抽屜底層：預覽圖列，品牌板被抽走後露出來 */}
        <div
          className="home-preview-panel"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          aria-hidden={active === null}
        >
          {active === "about" ? (
            <AboutPreview key="about" />
          ) : active ? (
            <PreviewTiles key={active} items={previewItems} />
          ) : null}
        </div>

        {/* 抽屜前板：斜切品牌區，hover 時向左滑出 */}
        <div className="home-brand-panel" onMouseEnter={cancelClose}>
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
      </div>

      <nav className="home-menu-list" aria-label="遊戲選單">
        {MENU.filter((item) => !loggedIn || item.key !== "login").map((item) => {
          const isActive = active === item.key;
          const body = (
            <>
              <span className="home-menu-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="home-menu-item-text">
                <span className="home-menu-item-title">{item.title}</span>
                <span className="home-menu-item-sub">{item.sub}</span>
              </span>
              <span className="home-menu-arrow" aria-hidden="true">
                →
              </span>
            </>
          );
          const common = {
            className: `home-menu-item${isActive ? " is-active" : ""}`,
            /* 會員登入不開抽屜：hover／focus 也不展開預覽，點了直接進 /login。
             * 手機寬度不展開預覽：點按時 hover／focus 的合成事件
             *  也不要先把預覽展開、把頁面拉長。
             * 關於我現在是連到 /about 的連結（2026-11-26），跟其他選項一樣
             *  滑過去就展開預覽、點了進頁面，不再是開關面板的按鈕。 */
            onMouseEnter: () => {
              if (item.key !== "login" && !isMobileWidth()) open(item.key);
            },
            onFocus: () => {
              if (item.key !== "login" && !isMobileWidth()) open(item.key);
            },
          };
          return (
            <Link
              key={item.key}
              href={item.href}
              {...common}
              onClick={(e) => handleLinkClick(item.key, e)}
            >
              {body}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
