"use client";

import { useState } from "react";
import type { DealsCarouselItem } from "@/lib/deals-carousel";
import { pageWindow } from "@/lib/pagination";
import DealCard from "./DealCard";
import MembershipServiceSection from "./MembershipTabs";

/** 每頁顯示款數（shawn 定：一次只呈現 30 款，510 款剛好 17 頁）。 */
const PAGE_SIZE = 30;

type TabKey = "free" | "steam" | "xbox" | "gamepass";

const TABS: { key: TabKey; label: string }[] = [
  { key: "free", label: "免費遊戲" },
  { key: "steam", label: "STEAM" },
  { key: "xbox", label: "XBOX PC" },
  { key: "gamepass", label: "PC Game Pass" },
];

/** /deals 分頁框：同一頁上方四個分頁，點了不跳頁、不換路由，
 *  當下就切換顯示該平台的遊戲（client-side 切換）。
 *  面板永遠展開、不摺疊（2026-11-23：分頁框模式下摺疊沒意義）。
 *  免費遊戲分頁：Epic 免費遊戲（本週＋下週預告）＋Steam 限時免費領取
 *  （折扣 100% 的付費遊戲，可永久保留；免費遊玩 F2P 不在這裡）。
 *  每平台取前 510 款（2026-11-23 從 200 改成 350、再改成 510），一次只顯示 30 款，在頁內翻頁（510 款剛好 17 頁）。
 *  家機不在這頁：2026-11-23 12:17 shawn 改方向，Xbox 家機改去獨立頁
 *  /console，本頁維持 PC 頁（免費遊戲／STEAM／XBOX PC）。
 *  GAME PASS 分頁（2026-11-23 新增，標籤「PC Game Pass」）：
 *  Game Pass 最近新增（PC），官方最近新增清單順序、卡片標「新進」、
 *  不寫價格（訂閱內含）；下方接 Game Pass 方案價目。分頁永遠顯示，
 *  新進遊戲沒資料時只在遊戲區顯示空狀態。 */
export default function DealsTabs({
  epicCurrent,
  epicUpcoming,
  steamFree,
  steam,
  steamTotalCount,
  xbox,
  xboxTotalCount,
  gamepass,
  gamepassTotalCount,
}: {
  epicCurrent: DealsCarouselItem[];
  epicUpcoming: DealsCarouselItem[];
  steamFree: DealsCarouselItem[];
  steam: DealsCarouselItem[];
  steamTotalCount: number;
  xbox: DealsCarouselItem[];
  xboxTotalCount: number;
  gamepass: DealsCarouselItem[];
  gamepassTotalCount: number;
}) {
  // 預設 Steam（內容最多，特賣會期間第一眼就有 30 款可看）。
  const [active, setActive] = useState<TabKey>("steam");
  const [pages, setPages] = useState<Record<TabKey, number>>({
    free: 1,
    steam: 1,
    xbox: 1,
    gamepass: 1,
  });

  const counts: Record<TabKey, number> = {
    free: epicCurrent.length + epicUpcoming.length + steamFree.length,
    steam: steam.length,
    xbox: xbox.length,
    gamepass: gamepass.length,
  };
  const totalPages = (key: TabKey) =>
    Math.max(1, Math.ceil(counts[key] / PAGE_SIZE));
  const pageItems = (key: TabKey, all: DealsCarouselItem[]) => {
    const p = Math.min(Math.max(1, pages[key]), totalPages(key));
    return all.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  };
  const goPage = (key: TabKey, p: number) =>
    setPages((prev) => ({ ...prev, [key]: p }));

  // 浮動分頁的跳頁彈框：點中間「第 X / Y 頁」才打開（跟牆頁同一套做法）。
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");

  /** 手機浮動分頁（跟牆頁同一套：左下角 fixed、一排三顆、點中間跳頁；
   *  只有當前分頁超過 1 頁時才出現；免費遊戲分頁不翻頁所以沒有）。 */
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

  const steamPage = pageItems("steam", steam);
  const xboxPage = pageItems("xbox", xbox);
  const gamepassPage = pageItems("gamepass", gamepass);

  return (
    <div>
      <div className="deals-tabs" role="tablist" aria-label="平台切換">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`deals-tab ${active === t.key ? "active" : ""}`}
            onClick={() => {
              setJumpOpen(false);
              setActive(t.key);
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
            `Epic 本週 ${epicCurrent.length} 款 · 下週預告 ${epicUpcoming.length} 款 · Steam 限時免費 ${steamFree.length} 款`
          )}
          <div className="deals-section-body">
            {epicCurrent.length > 0 ? (
              <>
                <h3 className="deals-subhead">Epic 本週免費領取</h3>
                <div className="deals-grid">
                  {epicCurrent.map((item) => (
                    <DealCard key={item.key} item={item} />
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">
                本週 Epic 台灣區暫無進行中的免費遊戲，下週預告如下。
              </p>
            )}
            {epicUpcoming.length > 0 && (
              <>
                <h3 className="deals-subhead">Epic 下週預告</h3>
                <div className="deals-grid">
                  {epicUpcoming.map((item) => (
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
                目前 Epic 與 Steam 台灣區都沒有免費遊戲資訊，請稍後再試。
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

      {renderFab()}
    </div>
  );
}
