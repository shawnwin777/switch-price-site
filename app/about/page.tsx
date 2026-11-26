export const metadata = {
  title: "關於我｜Shawn Game Studio",
  description:
    "SHAWN GAME STUDIO 是個人經營的非官方遊戲比價站：Switch 跨區比價、PC 與家機特價、NSO 會員跨區比價與歷史低價。",
};

/** 關於我（2026-11-26 從 /home 的展開面板拉出來獨立成頁）：
 *  首頁選單「關於我」現在是連到這頁的連結，滑過去照樣有預覽，
 *  點了直接進這頁，不會再展開面板跳到封面。 */
export default function AboutPage() {
  return (
    <div className="narrow">
      <h1>👤 關於我</h1>
      <p>
        SHAWN GAME STUDIO
        是個人經營的非官方遊戲比價站：Switch 跨區比價、PC
        與家機特價、NSO 會員跨區比價與歷史低價，價格取自 Nintendo、Sony、
        Microsoft、Valve、Epic 各官方商店的公開資料，僅供參考，實際價格以商店頁面為準。
        本站與任天堂、索尼、微軟、Valve、Epic、EA、Ubisoft、Fanatical、GamerPower、GOG
        沒有任何關聯。
      </p>

      <h2>聯絡我</h2>
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
          <span className="home-about-social-link home-about-social-static">
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
          </span>
        </li>
      </ul>

      <h2>支持本站</h2>
      <p>你的贊助，是我繼續抓價格的燃料。</p>
      <p>
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
      </p>
    </div>
  );
}
