"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { DealsCarouselItem, FreeKind } from "@/lib/deals-carousel";
import { pageWindow } from "@/lib/pagination";
import DealCard from "./DealCard";
import MembershipServiceSection from "./MembershipTabs";

/** 每頁顯示款數（shawn 定：一次只呈現 30 款，900 款剛好 30 頁）。 */
const PAGE_SIZE = 30;

type TabKey = "free" | "steam" | "xbox" | "gamepass" | "ea" | "ubisoft" | "fanatical";

const TABS: { key: TabKey; label: string }[] = [
  { key: "free", label: "免費遊戲" },
  { key: "steam", label: "STEAM" },
  { key: "xbox", label: "XBOX PC" },
  { key: "gamepass", label: "PC Game Pass" },
  { key: "ea", label: "EA" },
  { key: "ubisoft", label: "UBISOFT" },
  { key: "fanatical", label: "FANATICAL" },
];

/** /deals 分頁框：同一頁上方四個分頁，點了不跳頁（同路由，只更新
 *  ?tab=／?page=，見下方 URL 同步），當下就切換顯示該平台的遊戲。
 *  分頁狀態進 URL（低 B-3，2026-11-23）：server 從 ?tab=／?page=
 *  讀初始分頁／頁碼（app/deals/page.tsx 傳 initialTab／initialPage），
 *  切分頁用 router.push（上一頁能還原分頁），同分頁翻頁用
 *  router.replace（不污染上一頁紀錄）；瀏覽器上一頁／下一頁靠
 *  popstate 把 URL 讀回 state（元件不重掛，useSearchParams 會要
 *  Suspense 包裝所以不用它）。
 *  面板永遠展開、不摺疊（2026-11-23：分頁框模式下摺疊沒意義）。
 *  免費遊戲分頁（2026-11-26 改吃免費資源自動抓的清單）：
 *  免費資源自動抓（Epic 官方＋GOG 官方＋GamerPower 聚合）的 PC 完整遊戲
 *  （進行中＋即將免費）＋Steam 限時免費領取（折扣 100% 的付費遊戲，
 *  可永久保留；免費遊玩 F2P 不在這裡）。Epic 本來就在免費資源清單裡，
 *  所以原本只顯示 Epic 的專區已併入免費資源清單，不再單獨列。
 *  每平台取前 900 款（2026-11-24 從 510 改成 900），一次只顯示 30 款，在頁內翻頁（900 款剛好 30 頁）。
 *  家機不在這頁：2026-11-23 12:17 shawn 改方向，Xbox 家機改去獨立頁
 *  /console，本頁維持 PC 頁（免費遊戲／STEAM／XBOX PC）。
 *  GAME PASS 分頁（2026-11-23 新增，標籤「PC Game Pass」）：
 *  Game Pass 最近新增（PC），官方最近新增清單順序、卡片標「新進」、
 *  不寫價格（訂閱內含）；下方接 Game Pass 方案價目。分頁永遠顯示，
 *  新進遊戲沒資料時只在遊戲區顯示空狀態。
 *  EA／UBISOFT／FANATICAL 分頁（2026-11-26 新增）：
 *  三家都是美國商店、美元計價；EA 抓特價頁全清單（104 款，見
 *  lib/ea-deals.ts）、Ubisoft 抓特價頁前 36 款（見 lib/ubisoft-deals.ts）、
 *  Fanatical 抓官方 MCP 特價前 100 款（見 lib/fanatical-deals.ts）。
 *  單一來源失敗只讓該分頁顯示空狀態，不拖垮其他分頁。 */
export default function DealsTabs({
  freeGames,
  freeGamesUpcoming,
  steamFree,
  steam,
  steamTotalCount,
  steamFromFallback,
  xbox,
  xboxTotalCount,
  gamepass,
  gamepassTotalCount,
  ea,
  ubisoft,
  fanatical,
  initialTab,
  initialPage,
}: {
  freeGames: DealsCarouselItem[];
  freeGamesUpcoming: DealsCarouselItem[];
  steamFree: DealsCarouselItem[];
  steam: DealsCarouselItem[];
  steamTotalCount: number;
  steamFromFallback: boolean;
  xbox: DealsCarouselItem[];
  xboxTotalCount: number;
  gamepass: DealsCarouselItem[];
  gamepassTotalCount: number;
  ea: DealsCarouselItem[];
  ubisoft: DealsCarouselItem[];
  fanatical: DealsCarouselItem[];
  /** server 從 ?tab=／?page= 讀到的初始分頁／頁碼（無效值已在 page 層濾掉）。 */
  initialTab?: TabKey;
  initialPage?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // 分頁區塊頂部錨點：手機浮動分頁／頁內分頁翻頁後捲回這裡，避免留在頁面
  // 底部看不到新內容；scrollMarginTop 64 是給 sticky 頁首留的空間。
  const tabsRef = useRef<HTMLDivElement>(null);
  // 預設 Steam（內容最多，特賣會期間第一眼就有 30 款可看）；?tab= 有值時用它。
  const [active, setActive] = useState<TabKey>(initialTab ?? "steam");
  const [pages, setPages] = useState<Record<TabKey, number>>({
    free: 1,
    steam: 1,
    xbox: 1,
    gamepass: 1,
    ea: 1,
    ubisoft: 1,
    fanatical: 1,
    ...(initialTab && initialPage && initialPage > 1
      ? { [initialTab]: initialPage }
      : {}),
  });

  // 免費遊戲領取的分類篩選（全部／PC／DLC／家機／家機 DLC），
  // 切換時回到第 1 頁（篩選後總頁數變了，殘留頁碼會超出範圍）。
  const [freeFilter, setFreeFilter] = useState<"all" | FreeKind>("all");
  const freeFilterCounts: Record<"all" | FreeKind, number> = {
    all: freeGames.length,
    pc: freeGames.filter((it) => it.freeKinds?.includes("pc")).length,
    dlc: freeGames.filter((it) => it.freeKinds?.includes("dlc")).length,
    console: freeGames.filter((it) => it.freeKinds?.includes("console"))
      .length,
    "console-dlc": freeGames.filter((it) =>
      it.freeKinds?.includes("console-dlc")
    ).length,
  };
  const freeFiltered =
    freeFilter === "all"
      ? freeGames
      : freeGames.filter((it) => it.freeKinds?.includes(freeFilter));

  /** 分頁 URL：?tab= 一定帶，?page= 只有 >1 才帶（第 1 頁保持短網址）。 */
  const tabUrl = (tab: TabKey, page: number) =>
    page > 1 ? `${pathname}?tab=${tab}&page=${page}` : `${pathname}?tab=${tab}`;

  /** 切分頁：push 進歷史紀錄，瀏覽器上一頁能還原上一個分頁。 */
  const switchTab = (key: TabKey) => {
    if (key === active) return;
    setJumpOpen(false);
    setActive(key);
    router.push(tabUrl(key, pages[key] ?? 1), { scroll: false });
  };

  // 瀏覽器上一頁／下一頁：URL 變了但元件不重掛，靠 popstate 把
  // ?tab=／?page= 讀回 state（router.push／replace 不觸發 popstate，
  // 所以這裡不會跟切換邏輯打架）。
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const rawTab = params.get("tab");
      const tab: TabKey | null =
        rawTab === "free" ||
        rawTab === "steam" ||
        rawTab === "xbox" ||
        rawTab === "gamepass" ||
        rawTab === "ea" ||
        rawTab === "ubisoft" ||
        rawTab === "fanatical"
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
    free: freeGames.length + freeGamesUpcoming.length + steamFree.length,
    steam: steam.length,
    xbox: xbox.length,
    gamepass: gamepass.length,
    ea: ea.length,
    ubisoft: ubisoft.length,
    fanatical: fanatical.length,
  };
  /** 免費分頁的分頁數以「目前篩選後的清單」為準（篩選切換時總頁數跟著變），
   *  其他分頁以該平台總款數為準。 */
  const visibleCount = (key: TabKey) =>
    key === "free" ? freeFiltered.length : counts[key];
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
    if (key === active) router.replace(tabUrl(key, next), { scroll: false });
    // 翻頁後捲回分頁區塊頂部，避免留在頁面底部看不到新內容
    // （手機浮動分頁／頁內分頁都在頁面下方，翻頁後不捲回就看不到新頁）。
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 浮動分頁的跳頁彈框：點中間「第 X / Y 頁」才打開（跟牆頁同一套做法）。
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");

  /** 手機浮動分頁（跟牆頁同一套：左下角 fixed、一排三顆、點中間跳頁；
   *  只有當前分頁超過 1 頁時才出現；免費分頁也分頁（篩選後的清單每頁 30 款）。
   *  桌機隱藏、手機才顯示是 CSS 控制（.pagination-fab，見 globals.css）。 */
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

  const freePage = pageItems("free", freeFiltered);
  const steamPage = pageItems("steam", steam);
  const xboxPage = pageItems("xbox", xbox);
  const gamepassPage = pageItems("gamepass", gamepass);
  const eaPage = pageItems("ea", ea);
  const ubisoftPage = pageItems("ubisoft", ubisoft);
  const fanaticalPage = pageItems("fanatical", fanatical);

  return (
    <div ref={tabsRef} style={{ scrollMarginTop: 64 }}>
      <div className="deals-tabs" role="tablist" aria-label="平台切換">
        {TABS.map((t) => (
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

      {active === "free" && (
        <section className="deals-section" aria-label="免費遊戲">
          {sectionHead(
            "🎮 免費遊戲",
            `免費領取 ${freeGames.length} 款 · 即將免費 ${freeGamesUpcoming.length} 款 · Steam 限時免費 ${steamFree.length} 款`
          )}
          <div className="deals-section-body">
            {freeGames.length > 0 ? (
              <>
                <div className="deals-filter-row">
                  <h3 className="deals-subhead">免費遊戲領取</h3>
                  <div
                    className="deals-filter-btns"
                    role="group"
                    aria-label="免費遊戲分類"
                  >
                    {(
                      [
                        ["all", "全部"],
                        ["pc", "PC"],
                        ["dlc", "DLC"],
                        ["console", "家機"],
                        ["console-dlc", "家機 DLC"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`chip ${freeFilter === key ? "active" : ""}`}
                        aria-pressed={freeFilter === key}
                        onClick={() => {
                          setFreeFilter(key);
                          // 分類切換時回到第 1 頁（篩選後總頁數變了，殘留頁碼會超出範圍），URL 的 ?page= 也清掉。
                          setPages((prev) => ({ ...prev, free: 1 }));
                          router.replace(tabUrl("free", 1), { scroll: false });
                        }}
                      >
                        {label} ({freeFilterCounts[key]})
                      </button>
                    ))}
                  </div>
                </div>
                <p className="muted">
                  免費領取（Epic／GOG／GamerPower 聚合，點卡片去官方頁面領取；DLC
                  與家機遊戲有標註）。
                </p>
                {freeFiltered.length > 0 ? (
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
                目前沒有進行中的免費遊戲領取，下週預告如下。
              </p>
            )}
            {freeGamesUpcoming.length > 0 && (
              <>
                <h3 className="deals-subhead">即將免費</h3>
                <div className="deals-grid">
                  {freeGamesUpcoming.map((item) => (
                    <DealCard key={item.key} item={item} />
                  ))}
                </div>
              </>
            )}
            {steamFree.length > 0 && (
              <>
                <h3 className="deals-subhead">Steam 限時免費領取</h3>
                <div className="deals-grid">
                  {steamFree.map((item) => (
                    <DealCard key={item.key} item={item} />
                  ))}
                </div>
              </>
            )}
            {counts.free === 0 && (
              <p className="muted">
                目前沒有免費遊戲資訊，請稍後再試。
              </p>
            )}
          </div>
        </section>
      )}

      {active === "steam" && (
        <section className="deals-section" aria-label="STEAM">
          {sectionHead(
            "🔥 STEAM",
            `折扣大→小 · 前 ${steam.length} 款` +
              (steamTotalCount > 0
                ? ` · 台灣區特價中 ${steamTotalCount.toLocaleString("zh-Hant-TW")} 款`
                : "")
          )}
          {/* 高-1：Steam 顯示 specials 備援（只有 10 款精選）時，在 STEAM
              分頁內顯示「資料暫時不完整」提示（頁面層分頁框上方另有一份，
              切換分頁後仍顯示的那份就是這裡；見 app/deals/page.tsx）。 */}
          {steamFromFallback && (
            <p className="muted">
              ⚠️ Steam 資料暫時不完整：特價搜尋暫時抓不到，目前 STEAM 只顯示{" "}
              {steam.length} 款精選（不是完整特價清單）；每小時會重新抓取，
              恢復後自動回到完整清單。Epic 免費遊戲與其他分頁不受影響。
            </p>
          )}
          {steamPage.length > 0 ? (
            <div className="deals-grid">
              {steamPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 Steam 台灣區沒有特價資訊，請稍後再試。
            </p>
          )}
          {renderPager("steam")}
          {/* 中-6：STEAM 取數範圍附註——抓前 10 頁 1000 列再取前 900，
              不是全台灣特價款裡的全域前 900（程式現況，見
              lib/deals-carousel.ts）；總數用 live steamTotalCount。 */}
          <p className="muted">
            STEAM 取數範圍：先抓特價搜尋前 10 頁（1000 列）再按折扣大→小取前
            900 款，不是全台灣特價中
            {steamTotalCount > 0
              ? ` ${steamTotalCount.toLocaleString("zh-Hant-TW")} 款`
              : "約 15,020 款"}
            裡的全域前 900 款。
          </p>
        </section>
      )}

      {active === "xbox" && (
        <section className="deals-section" aria-label="XBOX PC">
          {sectionHead(
            "🟢 XBOX PC",
            `折扣最大的 ${xbox.length} 款` +
              (xboxTotalCount > 0
                ? ` · 台灣區共 ${xboxTotalCount.toLocaleString("zh-Hant-TW")} 款特價`
                : "")
          )}
          {xboxPage.length > 0 ? (
            <div className="deals-grid">
              {xboxPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 Xbox PC 台灣區沒有特價資訊，請稍後再試。
            </p>
          )}
          {renderPager("xbox")}
          <p className="muted">
            完整清單請看{" "}
            <a
              href="https://www.microsoft.com/zh-tw/store/top-paid/games/pc?isdeal=true"
              target="_blank"
              rel="noopener noreferrer"
            >
              微軟商店台灣區 PC 特價頁 →
            </a>
          </p>
        </section>
      )}

      {active === "gamepass" && (
        <section className="deals-section" aria-label="PC Game Pass">
          {sectionHead(
            "🎮 Game Pass 最近新增（PC）",
            `本期新增 ${gamepass.length} 款` +
              (gamepassTotalCount > 0
                ? ` · 官方最近新增清單共 ${gamepassTotalCount} 款`
                : "")
          )}
          {gamepassPage.length > 0 ? (
            <div className="deals-grid">
              {gamepassPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 Game Pass PC 沒有最近新增的資訊，請稍後再試。
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

      {active === "ea" && (
        <section className="deals-section" aria-label="EA">
          {sectionHead(
            "🟠 EA",
            `折扣大→小 · 特價中 ${ea.length} 款`
          )}
          {eaPage.length > 0 ? (
            <div className="deals-grid">
              {eaPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 EA 美國商店沒有特價資訊，請稍後再試。
            </p>
          )}
          {renderPager("ea")}
          <p className="muted">
            EA 特價為美元計價（EA 美國商店）。完整清單請看{" "}
            <a
              href="https://www.ea.com/sales/deals/"
              target="_blank"
              rel="noopener noreferrer"
            >
              EA 特價頁 →
            </a>
          </p>
        </section>
      )}

      {active === "ubisoft" && (
        <section className="deals-section" aria-label="UBISOFT">
          {sectionHead(
            "🟣 UBISOFT",
            `折扣大→小 · 特價頁前 ${ubisoft.length} 款`
          )}
          {ubisoftPage.length > 0 ? (
            <div className="deals-grid">
              {ubisoftPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 Ubisoft 美國商店沒有特價資訊，請稍後再試。
            </p>
          )}
          {renderPager("ubisoft")}
          <p className="muted">
            Ubisoft 特價為美元計價（Ubisoft 美國商店）；目前只列特價頁前 36
            款。完整清單請看{" "}
            <a
              href="https://store.ubisoft.com/us/bargain-bin-sale"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ubisoft 特價頁 →
            </a>
          </p>
        </section>
      )}

      {active === "fanatical" && (
        <section className="deals-section" aria-label="FANATICAL">
          {sectionHead(
            "💎 FANATICAL",
            `折扣大→小 · 特價中 ${fanatical.length} 款`
          )}
          {fanaticalPage.length > 0 ? (
            <div className="deals-grid">
              {fanaticalPage.map((item) => (
                <DealCard key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="muted">
              目前 Fanatical 沒有特價資訊，請稍後再試。
            </p>
          )}
          {renderPager("fanatical")}
          <p className="muted">
            Fanatical 特價為美元計價（美國商店）；官方授權序號商，賣
            Steam／Epic／GOG 序號。完整清單請看{" "}
            <a
              href="https://www.fanatical.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Fanatical 商店 →
            </a>
          </p>
        </section>
      )}

      {renderFab()}
    </div>
  );
}
