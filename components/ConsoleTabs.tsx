"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { DealsCarouselItem } from "@/lib/deals-carousel";
import { pageWindow } from "@/lib/pagination";
import DealCard from "./DealCard";
import MembershipServiceSection from "./MembershipTabs";

/** 每頁顯示款數（比照 /deals：一次只呈現 30 款，Xbox 900 款剛好 30 頁、PS 1621 款 55 頁）。 */
const PAGE_SIZE = 30;

type TabKey = "xbox-console" | "gamepass" | "ps" | "psplus" | "free";

const TABS: { key: TabKey; label: string }[] = [
  { key: "free", label: "免費遊戲" },
  { key: "xbox-console", label: "XBOX 家機" },
  { key: "gamepass", label: "XGP 家機" },
  { key: "ps", label: "PlayStation" },
  { key: "psplus", label: "PS Plus" },
];

/** /console 家機頁的分頁框：五個分頁、順序固定，點了不跳頁
 *  （同路由，只更新 ?tab=／?page=，見下方 URL 同步）。
 *  分頁狀態進 URL（低 B-3，2026-11-23）：server 從 ?tab=／?page=
 *  讀初始分頁／頁碼（app/console/page.tsx 傳 initialTab／initialPage），
 *  切分頁用 history.pushState（上一頁能還原分頁），同分頁翻頁用
 *  history.replaceState；瀏覽器上一頁／下一頁靠 popstate 把 URL 讀回
 *  state（元件不重掛，useSearchParams 會要 Suspense 包裝所以不用它）。
 *  不用 router.push／replace：分頁內容全在前端，router 導覽會觸發
 *  伺服器端重新渲染、網址要 1–2 秒才跟上；pushState 只改網址不發請求。
 *  面板永遠展開、不摺疊（跟 /deals 一樣）。
 *  1. 免費遊戲（2026-11-26 新增，2026-11-26 移到最左、跟 /deals
 *     統一做法）：家機免費遊戲（GamerPower 聚合，freeKinds 含
 *     console／console-dlc 者；純家機＋跨平台品項，跨平台品項在
 *     /deals 跟 /console 兩邊都顯示），內有分類篩選（全部／家機／
 *     家機 DLC）；卡片格式、截止日、DLC／主機備註沿用 /deals 免費
 *     區寫法，點卡片去官方頁面領取。
 *  2. XBOX 家機：Reco 清單＋Display Catalog（filter Windows.Xbox），
 *     最多 900 款、折扣大→小，預設顯示；實際去重後有效款數以 live 為準
 *     （中-5：寫死 900 會在款數浮動到 470 時變錯）。
 *  3. XGP 家機：Game Pass 最近新增（家機），官方清單順序、卡片標「新進」；
 *     下方接 Game Pass 方案價目。
 *  4. PlayStation：官方優惠分類，折扣 ≥50%、折扣大→小；列出款數與
 *     分類原始總數都用 live 數字（見 PS 分頁附註，不寫死 1621／2,862）。
 *  5. PS Plus：PS Plus 本月新進（遊戲目錄＋每月遊戲），PS Blog 當月文章
 *     解析、官方搜尋對應商店商品；下方接 PS Plus 方案價目。
 *  2026-11-23 14:00 shawn 再定：獨立的「🎫 會員方案」分頁拿掉，
 *  方案價目改放進 XGP 家機與 PS Plus 兩個分頁裡（新進遊戲在上、
 *  方案價目在下，各自呈現、不做對比表）。
 *  XGP 家機、PS Plus 兩個分頁永遠顯示——裡面有靜態方案價目，
 *  就算新進遊戲沒資料也不能整個分頁消失；新進遊戲區沒資料時
 *  只在區內顯示「目前沒有資訊，請稍後再試」。 */
export default function ConsoleTabs({
  xboxConsole,
  xboxConsoleTotalCount,
  ps,
  psTotalCount,
  gamepass,
  gamepassTotalCount,
  psplus,
  psplusMonth,
  psplusCatalogUrl,
  psplusMonthlyUrl,
  consoleFree,
  initialTab,
  initialPage,
}: {
  xboxConsole: DealsCarouselItem[];
  xboxConsoleTotalCount: number;
  ps?: DealsCarouselItem[];
  psTotalCount?: number;
  gamepass?: DealsCarouselItem[];
  gamepassTotalCount?: number;
  psplus?: DealsCarouselItem[];
  psplusMonth?: string | null;
  psplusCatalogUrl?: string | null;
  psplusMonthlyUrl?: string | null;
  /** 家機免費遊戲（GamerPower 聚合，freeKinds 含 console／console-dlc 者）。 */
  consoleFree?: DealsCarouselItem[];
  /** server 從 ?tab=／?page= 讀到的初始分頁／頁碼（無效值已在 page 層濾掉）。 */
  initialTab?: TabKey;
  initialPage?: number;
}) {
  const pathname = usePathname();
  // 五個分頁永遠顯示（XGP 家機、PS Plus 裡有靜態方案價目，
  // 新進遊戲沒資料時分頁也不消失，只在遊戲區顯示空狀態；
  // 免費遊戲沒資料時也顯示分頁，只在遊戲區顯示空狀態）。
  const tabs = TABS;
  // 預設 XBOX 家機（免費遊戲在最左，預設仍是 XBOX 家機）；?tab= 有值時用它。
  const [active, setActive] = useState<TabKey>(initialTab ?? "xbox-console");
  const [pages, setPages] = useState<Record<TabKey, number>>({
    "xbox-console": 1,
    gamepass: 1,
    ps: 1,
    psplus: 1,
    free: 1,
    ...(initialTab && initialPage && initialPage > 1
      ? { [initialTab]: initialPage }
      : {}),
  });

  // 家機免費遊戲的分類篩選（全部／家機／家機 DLC），切換時回到第 1 頁
  // （跟 /deals 免費區同一套寫法；跨平台品項算進家機或家機 DLC 計數）。
  const [consoleFreeFilter, setConsoleFreeFilter] = useState<
    "all" | "console" | "console-dlc"
  >("all");
  const consoleFreeList = consoleFree ?? [];
  const consoleFreeFilterCounts: Record<
    "all" | "console" | "console-dlc",
    number
  > = {
    all: consoleFreeList.length,
    console: consoleFreeList.filter((it) =>
      it.freeKinds?.includes("console")
    ).length,
    "console-dlc": consoleFreeList.filter((it) =>
      it.freeKinds?.includes("console-dlc")
    ).length,
  };
  const consoleFreeFiltered =
    consoleFreeFilter === "all"
      ? consoleFreeList
      : consoleFreeList.filter((it) =>
          it.freeKinds?.includes(consoleFreeFilter)
        );

  // 各特價分頁的本體／DLC 分類篩選（全部／本體／DLC），跟免費區同一套寫法。
  // kind 由各平台 fetcher 在抓取時標記（見 lib/*-deals.ts、lib/gamepass.ts、
  // lib/ps-plus.ts）；未標記的（舊快取）一律算本體，DLC 只算 kind === "dlc"
  // 者。切換時回到第 1 頁（篩選後總頁數變了，殘留頁碼會超出範圍）。
  type KindFilter = "all" | "game" | "dlc";
  const kindCounts = (
    items: DealsCarouselItem[]
  ): Record<KindFilter, number> => ({
    all: items.length,
    game: items.filter((it) => it.kind !== "dlc").length,
    dlc: items.filter((it) => it.kind === "dlc").length,
  });
  const kindFiltered = (items: DealsCarouselItem[], f: KindFilter) =>
    f === "all"
      ? items
      : f === "dlc"
        ? items.filter((it) => it.kind === "dlc")
        : items.filter((it) => it.kind !== "dlc");
  const [xboxConsoleFilter, setXboxConsoleFilter] =
    useState<KindFilter>("all");
  const [gamepassFilter, setGamepassFilter] = useState<KindFilter>("all");
  const [psFilter, setPsFilter] = useState<KindFilter>("all");
  const [psplusFilter, setPsplusFilter] = useState<KindFilter>("all");
  const xboxConsoleList = xboxConsole;
  const gamepassList = gamepass ?? [];
  const psList = ps ?? [];
  const psplusList = psplus ?? [];
  const xboxConsoleFilterCounts = kindCounts(xboxConsoleList);
  const gamepassFilterCounts = kindCounts(gamepassList);
  const psFilterCounts = kindCounts(psList);
  const psplusFilterCounts = kindCounts(psplusList);
  const xboxConsoleFiltered = kindFiltered(
    xboxConsoleList,
    xboxConsoleFilter
  );
  const gamepassFiltered = kindFiltered(gamepassList, gamepassFilter);
  const psFiltered = kindFiltered(psList, psFilter);
  const psplusFiltered = kindFiltered(psplusList, psplusFilter);

  /** 分頁 URL：?tab= 一定帶，?page= 只有 >1 才帶（第 1 頁保持短網址）。 */
  const tabUrl = (tab: TabKey, page: number) =>
    page > 1 ? `${pathname}?tab=${tab}&page=${page}` : `${pathname}?tab=${tab}`;

  /** 切分頁：push 進歷史紀錄，瀏覽器上一頁能還原上一個分頁。 */
  const switchTab = (key: TabKey) => {
    if (key === active) return;
    setJumpOpen(false);
    setActive(key);
    window.history.pushState(null, "", tabUrl(key, pages[key] ?? 1));
  };

  // 瀏覽器上一頁／下一頁：URL 變了但元件不重掛，靠 popstate 把
  // ?tab=／?page= 讀回 state（pushState／replaceState 不觸發 popstate，
  // 所以這裡不會跟切換邏輯打架）。
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const rawTab = params.get("tab");
      const tab: TabKey | null =
        rawTab === "xbox-console" ||
        rawTab === "gamepass" ||
        rawTab === "ps" ||
        rawTab === "psplus" ||
        rawTab === "free"
          ? rawTab
          : null;
      if (!tab) return;
      const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
      setJumpOpen(false);
      setActive(tab);
      setPages((prev) => ({ ...prev, [tab]: page }));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const counts: Record<TabKey, number> = {
    "xbox-console": xboxConsole.length,
    gamepass: gamepass?.length ?? 0,
    ps: ps?.length ?? 0,
    psplus: psplus?.length ?? 0,
    free: consoleFreeList.length,
  };
  /** 免費遊戲分頁與各特價分頁的分頁數都以「目前篩選後的清單」為準
   *  （篩選切換時總頁數跟著變；跟 /deals 免費區同一套做法）。 */
  const visibleCount = (key: TabKey) =>
    key === "free"
      ? consoleFreeFiltered.length
      : key === "xbox-console"
        ? xboxConsoleFiltered.length
        : key === "gamepass"
          ? gamepassFiltered.length
          : key === "ps"
            ? psFiltered.length
            : key === "psplus"
              ? psplusFiltered.length
              : counts[key];
  const totalPages = (key: TabKey) =>
    Math.max(1, Math.ceil(visibleCount(key) / PAGE_SIZE));
  const pageItems = (key: TabKey, all: DealsCarouselItem[]) => {
    const p = Math.min(Math.max(1, pages[key]), totalPages(key));
    return all.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  };
  const goPage = (key: TabKey, p: number) => {
    const next = Math.min(Math.max(1, p), totalPages(key));
    setPages((prev) => ({ ...prev, [key]: next }));
    // 同分頁翻頁用 replace（不污染上一頁紀錄），URL 的 ?page= 跟著變。
    if (key === active) window.history.replaceState(null, "", tabUrl(key, next));
  };

  // 浮動分頁的跳頁彈框：點中間「第 X / Y 頁」才打開（跟牆頁同一套做法）。
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");

  /** 手機浮動分頁（跟牆頁同一套：左下角 fixed、一排三顆、點中間跳頁；
   *  只有當前分頁超過 1 頁時才出現）。 */
  const renderFab = () => {
    const total = totalPages(active);
    if (total <= 1) return null;
    const p = Math.min(Math.max(1, pages[active]), total);
    return (
      <nav className="pagination-fab" aria-label="分頁（浮動）">
        <button
          type="button"
          className="btn"
          disabled={p <= 1}
          onClick={() => {
            setJumpOpen(false);
            goPage(active, p - 1);
          }}
          aria-label="上一頁"
        >
          ← 上一頁
        </button>
        <button
          type="button"
          className="pagination-fab-page"
          onClick={() => {
            setJumpValue(String(p));
            setJumpOpen((v) => !v);
          }}
          aria-expanded={jumpOpen}
          aria-label="跳到指定頁數"
        >
          第 {p} / {total} 頁
        </button>
        <button
          type="button"
          className="btn"
          disabled={p >= total}
          onClick={() => {
            setJumpOpen(false);
            goPage(active, p + 1);
          }}
          aria-label="下一頁"
        >
          下一頁 →
        </button>
        {jumpOpen && (
          <form
            className="pagination-fab-jump"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.max(1, Math.min(total, Number(jumpValue) || p));
              setJumpOpen(false);
              if (n !== p) goPage(active, n);
            }}
          >
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={total}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              aria-label="頁數"
              autoFocus
            />
            <button type="submit" className="btn">
              前往
            </button>
          </form>
        )}
      </nav>
    );
  };

  const renderPager = (key: TabKey) => {
    const total = totalPages(key);
    if (total <= 1) return null;
    const p = Math.min(Math.max(1, pages[key]), total);
    return (
      <nav className="pagination deals-pager" aria-label="分頁">
        <button
          type="button"
          className="chip"
          disabled={p <= 1}
          onClick={() => goPage(key, p - 1)}
        >
          ← 上一頁
        </button>
        {pageWindow(p, total).map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="ellipsis">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              className={`chip page-num ${n === p ? "active" : ""}`}
              aria-current={n === p ? "page" : undefined}
              onClick={() => goPage(key, n)}
            >
              {n}
            </button>
          )
        )}
        <button
          type="button"
          className="chip"
          disabled={p >= total}
          onClick={() => goPage(key, p + 1)}
        >
          下一頁 →
        </button>
      </nav>
    );
  };

  const sectionHead = (title: string, meta: string) => (
    <div className="deals-section-head">
      <h2 className="deals-section-title">{title}</h2>
      <span className="deals-section-meta">{meta}</span>
    </div>
  );

  /** 本體／DLC 分類篩選列（全部／本體／DLC，附各分類款數；跟免費區同一套寫法）。
   *  切換時回到第 1 頁（篩選後總頁數變了，殘留頁碼會超出範圍），URL 的
   *  ?page= 也清掉。 */
  const renderKindFilter = (
    tab: TabKey,
    filter: KindFilter,
    setFilter: (f: KindFilter) => void,
    filterCounts: Record<KindFilter, number>,
    label: string
  ) => (
    <div className="deals-filter-row">
      <h3 className="deals-subhead">分類</h3>
      <div className="deals-filter-btns" role="group" aria-label={label}>
        {(
          [
            ["all", "全部"],
            ["game", "本體"],
            ["dlc", "DLC"],
          ] as const
        ).map(([key, lab]) => (
          <button
            key={key}
            type="button"
            className={`chip ${filter === key ? "active" : ""}`}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
              setPages((prev) => ({ ...prev, [tab]: 1 }));
              window.history.replaceState(null, "", tabUrl(tab, 1));
            }}
          >
            {lab} ({filterCounts[key]})
          </button>
        ))}
      </div>
    </div>
  );

  const xboxConsolePage = pageItems("xbox-console", xboxConsoleFiltered);
  const psPage = pageItems("ps", psFiltered);
  const gamepassPage = pageItems("gamepass", gamepassFiltered);
  const psplusPage = pageItems("psplus", psplusFiltered);
  const freePage = pageItems("free", consoleFreeFiltered);

  return (
    <div>
      <div className="deals-tabs" role="tablist" aria-label="平台切換">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`deals-tab ${active === t.key ? "active" : ""}`}
            onClick={() => {
              switchTab(t.key);
            }}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {active === "xbox-console" && (
        <section className="deals-section" aria-label="XBOX 家機">
          {sectionHead(
            "🟢 XBOX 家機",
            `折扣最大的 ${xboxConsole.length} 款（去重後有效款數）` +
              (xboxConsoleTotalCount > 0
                ? ` · 台灣區共 ${xboxConsoleTotalCount.toLocaleString("zh-Hant-TW")} 款特價（清單 API 原始總數）`
                : "")
          )}
          {renderKindFilter(
            "xbox-console",
            xboxConsoleFilter,
            setXboxConsoleFilter,
            xboxConsoleFilterCounts,
            "XBOX 家機分類"
          )}
          {xboxConsolePage.length > 0 ? (
            <div className="deals-grid">
              {xboxConsolePage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : xboxConsoleFilter !== "all" && xboxConsoleList.length > 0 ? (
            <p className="muted">這個分類目前沒有項目。</p>
          ) : (
            <p className="muted">
              目前 Xbox 家機台灣區沒有特價資訊，請稍後再試。
            </p>
          )}
          {renderPager("xbox-console")}
          {/* 中-5：附註與 app/console/page.tsx 同一口徑——標題的 N 是去重後
              有效款數，「台灣區共 M 款」是清單 API 原始總數（未去重），兩者
              口徑不同；數字一律 live 插值，不寫死「約 500 款」「前 900 款」。 */}
          <p className="muted">
            Xbox 家機特價取自微軟商店台灣區特價清單（Reco Deal 清單），只列有折扣的遊戲、折扣大→小；
            本頁列出折扣最大的 {xboxConsole.length} 款（去重後的有效款數）
            {xboxConsoleTotalCount > 0
              ? `；「台灣區共 ${xboxConsoleTotalCount.toLocaleString("zh-Hant-TW")} 款」是清單 API 回報的原始總數（未去重），與去重後的有效款數口徑不同。`
              : "；清單 API 回報的原始總數（未去重）與去重後的有效款數口徑不同。"}
            款數會隨檔期浮動。
          </p>
          <p className="muted">
            完整清單請看{" "}
            <a
              href="https://www.microsoft.com/zh-tw/store/top-paid/games/xbox?isdeal=true"
              target="_blank"
              rel="noopener noreferrer"
            >
              微軟商店台灣區 Xbox 特價頁 →
            </a>
          </p>
        </section>
      )}

      {active === "ps" && (
        <section className="deals-section" aria-label="PlayStation">
          {sectionHead(
            "🔵 PlayStation",
            `折扣最大的 ${ps?.length ?? 0} 款` +
              (psTotalCount != null && psTotalCount > 0
                ? ` · 台灣區共 ${psTotalCount.toLocaleString("zh-Hant-TW")} 款特價`
                : "")
          )}
          {renderKindFilter(
            "ps",
            psFilter,
            setPsFilter,
            psFilterCounts,
            "PlayStation 分類"
          )}
          {psPage.length > 0 ? (
            <div className="deals-grid">
              {psPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : psFilter !== "all" && psList.length > 0 ? (
            <p className="muted">這個分類目前沒有項目。</p>
          ) : (
            <p className="muted">目前 PlayStation 台灣區沒有特價資訊，請稍後再試。</p>
          )}
          {renderPager("ps")}
          {/* 低 B-3 併入遺留：PS 附註與 Xbox 區同一口徑——標題的 N 是去重後
              有效款數，「台灣區共 M 款」是優惠分類回報的原始總數（未篩
              折扣 ≥50%、未去重），兩者口徑不同；數字一律 live 插值，
              不寫死「前 1621 款」「台灣區共 2,862 款」。 */}
          <p className="muted">
            PlayStation 特價取自官方商店的優惠分類（所有優惠），只列折扣
            ≥50% 的遊戲、折扣大→小；本頁列出折扣最大的 {ps?.length ?? 0}
            款（去重後的有效款數）
            {psTotalCount != null && psTotalCount > 0
              ? `；「台灣區共 ${psTotalCount.toLocaleString("zh-Hant-TW")} 款」是優惠分類回報的原始總數（未篩折扣 ≥50%、未去重），與去重後的有效款數口徑不同。`
              : "；優惠分類回報的原始總數（未篩折扣 ≥50%、未去重）與去重後的有效款數口徑不同。"}
            款數會隨檔期浮動。
          </p>
        </section>
      )}

      {active === "gamepass" && (
        <section className="deals-section" aria-label="XGP 家機">
          {sectionHead(
            "🎮 Game Pass 最近新增（家機）",
            `本期新增 ${gamepass?.length ?? 0} 款` +
              (gamepassTotalCount != null && gamepassTotalCount > 0
                ? ` · 官方最近新增清單共 ${gamepassTotalCount} 款`
                : "")
          )}
          {renderKindFilter(
            "gamepass",
            gamepassFilter,
            setGamepassFilter,
            gamepassFilterCounts,
            "XGP 家機分類"
          )}
          {gamepassPage.length > 0 ? (
            <div className="deals-grid">
              {gamepassPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : gamepassFilter !== "all" && gamepassList.length > 0 ? (
            <p className="muted">這個分類目前沒有項目。</p>
          ) : (
            <p className="muted">
              目前 Game Pass 家機沒有最近新增的資訊，請稍後再試。
            </p>
          )}
          {renderPager("gamepass")}
          <p className="muted">
            完整目錄請看{" "}
            <a
              href="https://www.xbox.com/zh-TW/xbox-game-pass/games"
              target="_blank"
              rel="noopener noreferrer"
            >
              Xbox Game Pass 遊戲目錄 →
            </a>
          </p>
          <MembershipServiceSection serviceId="game-pass" />
        </section>
      )}

      {active === "psplus" && (
        <section className="deals-section" aria-label="PS Plus">
          {sectionHead(
            "🔵 PS Plus 本月新進",
            `${psplusMonth ?? "本月"}新進 ${psplus?.length ?? 0} 款 · 遊戲目錄＋每月遊戲`
          )}
          {renderKindFilter(
            "psplus",
            psplusFilter,
            setPsplusFilter,
            psplusFilterCounts,
            "PS Plus 分類"
          )}
          {psplusPage.length > 0 ? (
            <div className="deals-grid">
              {psplusPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : psplusFilter !== "all" && psplusList.length > 0 ? (
            <p className="muted">這個分類目前沒有項目。</p>
          ) : (
            <p className="muted">
              目前 PS Plus 沒有本月新進的資訊，請稍後再試。
            </p>
          )}
          {renderPager("psplus")}
          <p className="muted">
            資料來源：PS Blog{" "}
            {psplusCatalogUrl && (
              <a href={psplusCatalogUrl} target="_blank" rel="noopener noreferrer">
                遊戲目錄文 →
              </a>
            )}
            {psplusCatalogUrl && psplusMonthlyUrl && " ／ "}
            {psplusMonthlyUrl && (
              <a href={psplusMonthlyUrl} target="_blank" rel="noopener noreferrer">
                每月遊戲文 →
              </a>
            )}
          </p>
          <MembershipServiceSection serviceId="ps-plus" />
        </section>
      )}

      {active === "free" && (
        <section className="deals-section" aria-label="免費遊戲">
          {sectionHead(
            "🎮 免費遊戲（家機）",
            `免費領取 ${consoleFreeList.length} 款`
          )}
          <div className="deals-section-body">
            {consoleFreeList.length > 0 ? (
              <>
                <div className="deals-filter-row">
                  <h3 className="deals-subhead">家機免費遊戲領取</h3>
                  <div
                    className="deals-filter-btns"
                    role="group"
                    aria-label="家機免費遊戲分類"
                  >
                    {(
                      [
                        ["all", "全部"],
                        ["console", "家機"],
                        ["console-dlc", "家機 DLC"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`chip ${consoleFreeFilter === key ? "active" : ""}`}
                        aria-pressed={consoleFreeFilter === key}
                        onClick={() => {
                          setConsoleFreeFilter(key);
                          // 分類切換時回到第 1 頁（篩選後總頁數變了，殘留頁碼會超出範圍），URL 的 ?page= 也清掉。
                          setPages((prev) => ({ ...prev, free: 1 }));
                          window.history.replaceState(null, "", tabUrl("free", 1));
                        }}
                      >
                        {label} ({consoleFreeFilterCounts[key]})
                      </button>
                    ))}
                  </div>
                </div>
                <p className="muted">
                  家機免費領取（GamerPower 聚合，點卡片去官方頁面領取；DLC
                  與主機平台有標註。跨平台品項在 /deals 免費區也有）。
                </p>
                {consoleFreeFiltered.length > 0 ? (
                  <>
                    <div className="deals-grid">
                      {freePage.map((item) => (
                        <DealCard key={item.key} item={item} />
                      ))}
                    </div>
                    {renderPager("free")}
                  </>
                ) : (
                  <p className="muted">
                    這個分類目前沒有免費領取的項目。
                  </p>
                )}
              </>
            ) : (
              <p className="muted">
                目前沒有家機免費遊戲領取，請稍後再試。
              </p>
            )}
          </div>
        </section>
      )}

      {renderFab()}
    </div>
  );
}
