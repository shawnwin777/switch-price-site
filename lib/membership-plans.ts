// ============================================================================
// 會員方案價目（/console 第一個分頁，2026-11-23 從 /membership 移進來）：
// PS Plus 與 Xbox Game Pass 台灣方案。
// 2026-11-23 上線。資料來源是 shawn 傳的兩張官方商店截圖（2026-11-23），
// 並用官方頁面再核對過一次權益：
//   PS Plus：playstation.com/zh-hant-tw/ps-plus/ ——三級距的權益勾選與截圖
//     完全一致（基本 6 項、升級 8 項、高級 10 項）；基本 1 個月 NT$290 也對
//     得上（頁面 JSON-LD Product.offers）。12 個月曾有 Black Friday 優惠價
//     （至 2026/11/30），2026-11-25 shawn 說直接改回原價（要買的還是會買），
//     不等優惠到期；以下 12 個月價格已是原價。
//   Xbox Game Pass：xbox.com/zh-TW/xbox-game-pass ——四方案的權益與截圖
//     完全一致（款數、首發當日／發佈後一年內、EA Play、Rewards 倍數）；
//     價格在官網是遮罩的（$XX.XX，需登入才顯示），所以價格以截圖為準。
// 注意：兩個服務放在同一頁，但各自呈現、不做對比表——讓玩家自己看
// （shawn：省得麻煩）。價格是靜態表，變動時手動改這裡。
// ============================================================================

/** 價格查核日期（截圖日期）。 */
export const MEMBERSHIP_CHECK_DATE = "2026-11-23";

export interface MembershipPrice {
  months: number;
  /** 特價（優惠價）。 */
  price: number;
  /** 原價（12 個月方案才有）。 */
  original?: number;
  /** 折扣（12 個月方案才有），例如 20 表示省 20%。 */
  savePct?: number;
}

export interface MembershipPlan {
  name: string;
  tagline: string;
  /** 官方標示的推薦徽章（例如截圖上高級 12 個月的「最超值」）。 */
  highlight?: string;
  /** 每月約 NT$（12 個月方案的特價 / 12，四捨五入）。 */
  monthlyApprox: number;
  prices: MembershipPrice[];
  /** 權益清單：有打勾的為 true，沒有的為 false（照截圖勾選呈現）。 */
  benefits: { label: string; included: boolean; note?: string }[];
}

export interface MembershipService {
  id: "ps-plus" | "game-pass";
  title: string;
  subtitle: string;
  officialUrl: string;
  officialLabel: string;
  /** 本服務的備註（例如優惠期限、隨時可取消）。 */
  notes: string[];
  plans: MembershipPlan[];
}

export const MEMBERSHIP_SERVICES: MembershipService[] = [
  {
    id: "ps-plus",
    title: "PlayStation Plus",
    subtitle: "PS4／PS5 會員：每月遊戲、線上多人遊玩、遊戲目錄與經典遊戲",
    officialUrl: "https://www.playstation.com/zh-hant-tw/ps-plus/",
    officialLabel: "PlayStation 官方 PS Plus 頁面",
    notes: [
      "定期服務會持續至取消為止，可隨時取消。",
    ],
    plans: [
      {
        name: "基本",
        tagline: "每月遊戲、線上多人遊玩，以及更多內容",
        monthlyApprox: 172,
        prices: [
          { months: 12, price: 2068 },
          { months: 3, price: 750 },
          { months: 1, price: 290 },
        ],
        benefits: [
          { label: "每月遊戲", included: true },
          { label: "線上多人遊玩", included: true },
          { label: "專屬折扣", included: true },
          { label: "獨家組合包", included: true },
          { label: "雲端儲存空間", included: true, note: "100GB" },
          { label: "分享遊玩", included: true },
          { label: "遊戲目錄", included: false },
          { label: "Ubisoft+ Classics", included: false },
          { label: "經典遊戲目錄", included: false },
          { label: "遊戲試玩", included: false },
        ],
      },
      {
        name: "升級",
        tagline: "探索數百款遊戲",
        monthlyApprox: 291,
        prices: [
          { months: 12, price: 3488 },
          { months: 3, price: 1210 },
          { months: 1, price: 430 },
        ],
        benefits: [
          { label: "每月遊戲", included: true },
          { label: "線上多人遊玩", included: true },
          { label: "專屬折扣", included: true },
          { label: "獨家組合包", included: true },
          { label: "雲端儲存空間", included: true, note: "100GB" },
          { label: "分享遊玩", included: true },
          { label: "遊戲目錄", included: true, note: "數百款" },
          { label: "Ubisoft+ Classics", included: true },
          { label: "經典遊戲目錄", included: false },
          { label: "遊戲試玩", included: false },
        ],
      },
      {
        name: "高級",
        tagline: "享受所有福利",
        highlight: "最超值",
        monthlyApprox: 340,
        prices: [
          { months: 12, price: 4078 },
          { months: 3, price: 1430 },
          { months: 1, price: 500 },
        ],
        benefits: [
          { label: "每月遊戲", included: true },
          { label: "線上多人遊玩", included: true },
          { label: "專屬折扣", included: true },
          { label: "獨家組合包", included: true },
          { label: "雲端儲存空間", included: true, note: "100GB" },
          { label: "分享遊玩", included: true },
          { label: "遊戲目錄", included: true, note: "數百款" },
          { label: "Ubisoft+ Classics", included: true },
          { label: "經典遊戲目錄", included: true },
          { label: "遊戲試玩", included: true },
        ],
      },
    ],
  },
  {
    id: "game-pass",
    title: "Xbox Game Pass",
    subtitle: "主機與 PC 遊戲庫，每月都有新遊戲加入",
    officialUrl: "https://www.xbox.com/zh-TW/xbox-game-pass",
    officialLabel: "Xbox 官方 Game Pass 頁面",
    notes: [
      "四個方案前 14 天皆為 $30，之後按月收費；訂閱會自動延續，可隨時取消。",
      "遊戲庫與福利不時變更且依地區、裝置與方案而異。",
    ],
    plans: [
      {
        name: "Essential",
        tagline: "入門方案：線上多人遊玩與專屬好處",
        monthlyApprox: 259,
        prices: [
          { months: 1, price: 259 },
        ],
        benefits: [
          { label: "超過 50 款遊戲（主機＋電腦）", included: true },
          { label: "《League of Legends》《Call of Duty: Warzone》等遊戲專屬好處", included: true },
          { label: "線上主機多人遊玩", included: true },
          { label: "賺取 Rewards 點數", included: true },
          { label: "首發當日暢玩全新遊戲", included: false },
          { label: "EA Play", included: false },
          { label: "Ubisoft+ Classics", included: false },
        ],
      },
      {
        name: "Premium",
        tagline: "200+ 款遊戲，發佈後一年內的新遊戲",
        monthlyApprox: 349,
        prices: [
          { months: 1, price: 349 },
        ],
        benefits: [
          { label: "超過 200 款遊戲（主機＋電腦）", included: true },
          { label: "Xbox 發佈後一年內的新遊戲", included: true },
          { label: "《League of Legends》《Call of Duty: Warzone》等遊戲專屬好處", included: true },
          { label: "線上主機多人遊玩", included: true },
          { label: "賺取 2 倍 Rewards 點數", included: true },
          { label: "首發當日暢玩全新遊戲", included: false },
          { label: "EA Play", included: false },
          { label: "Ubisoft+ Classics", included: false },
        ],
      },
      {
        name: "Ultimate",
        tagline: "最完整：400+ 款遊戲，首發當日全數新遊戲",
        monthlyApprox: 449,
        prices: [
          { months: 1, price: 449 },
        ],
        benefits: [
          { label: "超過 400 款遊戲（主機＋電腦）", included: true },
          { label: "首發當日即可暢玩全新遊戲", included: true },
          { label: "EA Play 和 Ubisoft+ Classics", included: true },
          { label: "《League of Legends》《Call of Duty: Warzone》等遊戲專屬好處", included: true },
          { label: "線上主機多人遊玩", included: true },
          { label: "賺取 4 倍 Rewards 點數", included: true },
        ],
      },
      {
        name: "僅限電腦",
        tagline: "PC 專用：300+ 款遊戲，首發當日新遊戲",
        monthlyApprox: 339,
        prices: [
          { months: 1, price: 339 },
        ],
        benefits: [
          { label: "超過 300 款遊戲（僅限電腦）", included: true },
          { label: "首發當日即可暢玩全新遊戲", included: true },
          { label: "EA Play", included: true },
          { label: "《League of Legends》《Call of Duty: Warzone》等遊戲專屬好處", included: true },
          { label: "賺取 2 倍 Rewards 點數", included: true },
          { label: "線上主機多人遊玩", included: false },
          { label: "Ubisoft+ Classics", included: false },
        ],
      },
    ],
  },
];
