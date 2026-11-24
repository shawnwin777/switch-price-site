"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { type GamesPageFilters } from "@/lib/data";
import { pageWindow } from "@/lib/pagination";
import {
  COUNTRIES,
  COUNTRY_MAP,
  DEFAULT_BLOCKED_CODES,
  VISIBLE_COUNTRIES_COOKIE,
  productTypeLabel,
  serializeVisibleCountries,
} from "@/lib/countries";
import type { GameWithPrices } from "@/lib/types";
import GameCard from "./GameCard";
import CountrySettings from "./CountrySettings";
import SaleBanner from "./SaleBanner";

const BLOCKED_KEY = "spc-blocked-countries";

/** 可見國家設定寫進 cookie（瀏覽器每次開頁面都會自動帶給伺服器，
 *  伺服器端查遊戲名單前就讀得到；localStorage 伺服器端看不到）。
 *  值是 "ALL" 或逗號串接的代碼，有效期 1 年。 */
function writeVisibleCookie(scope: string) {
  try {
    document.cookie = `${VISIBLE_COUNTRIES_COOKIE}=${encodeURIComponent(scope)}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // 寫入失敗不影響使用（伺服器端會用預設 TW/HK）。
  }
}

/** 讀回可見國家 cookie（驗證寫入是否真的生效；寫不進去時不重載頁面）。 */
function readVisibleCookie(): string | null {
  try {
    const m = document.cookie.match(
      new RegExp(`(?:^|; )${VISIBLE_COUNTRIES_COOKIE}=([^;]*)`)
    );
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export type HomeFilters = Omit<GamesPageFilters, "userId"> & { page: number };

type SortKey = "deals" | "cheap-asc" | "cheap-desc" | "title" | "discount" | "release";

export default function HomeClient({
  games,
  total,
  page,
  totalPages,
  loadError,
  filters,
  productTypes,
  loggedInUserId,
  isAdmin,
  serverVisibleScope,
}: {
  games: GameWithPrices[];
  total: number;
  page: number;
  totalPages: number;
  /** 首頁查詢失敗時的錯誤訊息（有值 = 查詢失敗、不是真的沒遊戲；
   *  空狀態改顯示「資料載入失敗」，見下方）。 */
  loadError?: string | null;
  filters: HomeFilters;
  productTypes: string[];
  loggedInUserId: string | null;
  isAdmin: boolean;
  /** 伺服器端這次查詢用的可見國家範圍（"ALL" 或逗號代碼，見 app/page.tsx）；
   *  瀏覽器端拿它比對 localStorage 的設定，不一致時寫 cookie 並重整。 */
  serverVisibleScope: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [input, setInput] = useState(filters.q ?? "");
  const [blocked, setBlocked] = useState<string[]>(DEFAULT_BLOCKED_CODES);
  const [blockedLoaded, setBlockedLoaded] = useState(false);
  const [userId, setUserId] = useState<string | null>(loggedInUserId);
  // 浮動分頁的跳頁彈框：點中間「第 X / Y 頁」才打開，輸入頁數後前往。
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");

  // 封鎖清單：localStorage（只在瀏覽器讀，避免 SSR / hydration 不一致）。
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BLOCKED_KEY);
      if (raw) {
        const list = JSON.parse(raw) as string[];
        if (Array.isArray(list)) setBlocked(list.filter((c) => typeof c === "string"));
      }
    } catch {
      // 讀不到就用預設（只留台港）。
    }
    setBlockedLoaded(true);
  }, []);

  // 瀏覽器端的可見國家範圍（canonical 字串，與伺服器端同一格式）。
  const clientScope = useMemo(() => {
    const blockedSet = new Set(blocked);
    return serializeVisibleCountries(
      COUNTRIES.filter((c) => !blockedSet.has(c.code)).map((c) => c.code)
    );
  }, [blocked]);

  // 伺服器端這次查詢用的可見國家（props 傳來的 serverVisibleScope，
  // canonical 字串；"ALL" = 全部 35 國）。卡片首屏／SSR 時先用它渲染，
  // 名單與卡片才會是同一套國家。
  const serverVisibleCountries = useMemo(() => {
    if (serverVisibleScope === "ALL") {
      return new Set(COUNTRIES.map((c) => c.code));
    }
    return new Set(
      serverVisibleScope.split(",").filter((c) => COUNTRY_MAP[c])
    );
  }, [serverVisibleScope]);

  // 同步 effect 要求重整的時間（router.refresh() 若沒讓伺服器端跟上，
  // 下面的 effect 會在 2 秒後整頁重載一次當作退路）。
  const syncRefreshAt = useRef<number | null>(null);

  useEffect(() => {
    if (!blockedLoaded) return;
    try {
      window.localStorage.setItem(BLOCKED_KEY, JSON.stringify(blocked));
    } catch {
      // 寫入失敗不影響使用。
    }
    // 同步寫進 cookie，讓伺服器端下次查詢前就知道要撈哪些國家。
    writeVisibleCookie(clientScope);
    // 設定變了（例如第一次載入時 localStorage 是「全部國家」、
    // 但伺服器端這次用預設 TW/HK 查的），重整頁面讓伺服器端用新的
    // cookie 重查名單。?country=XX 或只看我的收藏時名單不受 cookie
    // 影響，就不重整。重整後 serverVisibleScope 會變成一致，不會循環。
    if (
      !filtersRef.current.country &&
      !filtersRef.current.onlyMine &&
      clientScope !== serverVisibleScope
    ) {
      syncRefreshAt.current = Date.now();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, blockedLoaded, clientScope, serverVisibleScope]);

  // router.refresh() 若沒讓伺服器端跟上（例如拿到舊的快取頁），
  // 兩邊設定會一直不一致；等 2 秒後仍不一致、且 cookie 已經是
  // 本地設定（寫入確實生效、伺服器端理應採用），就整頁重載一次，
  // 讓瀏覽器帶著新 cookie 重新請求。同一分頁 120 秒內最多一次，
  // 且 cookie 寫不進去時不重載，避免重載循環。
  useEffect(() => {
    if (!blockedLoaded) return;
    if (filtersRef.current.country || filtersRef.current.onlyMine) return;
    if (clientScope === serverVisibleScope) return;
    if (!syncRefreshAt.current || !clientScope) return;
    const t = window.setTimeout(() => {
      try {
        const last = Number(
          window.sessionStorage.getItem("spc-scope-hard-reload") ?? "0"
        );
        if (Date.now() - last < 120_000) return;
        if (readVisibleCookie() !== clientScope) return;
        window.sessionStorage.setItem(
          "spc-scope-hard-reload",
          String(Date.now())
        );
        window.location.reload();
      } catch {
        // 讀寫失敗就不重載（不要為了修一致性製造新問題）。
      }
    }, 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedLoaded, clientScope, serverVisibleScope]);

  // 登入狀態（server 傳來的 userId 優先；瀏覽器端再確認一次，登入後免重整）。
  useEffect(() => {
    if (userId) return;
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [userId]);

  const visibleCountries = useMemo(() => {
    // 選了國家篩選時，卡片只顯示該國的價格（最低價、特價徽章、
    // 特價至都以該國為準）；沒選時沿用下方的國家顯示設定（預設只留台港）。
    if (filters.country) return new Set([filters.country]);
    // 名單與卡片永遠用同一套可見國家：localStorage 還沒讀完（首屏／SSR
    // 時 blocked 還是預設值）、或本地設定與伺服器端不一致（等重整收斂）
    // 時，先用伺服器端這次查詢的範圍渲染卡片；否則會出現「名單有列、
    // 卡片無價」（例如 cookie 是 ALL、本地卻擋了日本的遊戲）。兩邊
    // 一致後才用本地設定。
    if (!blockedLoaded || clientScope !== serverVisibleScope) {
      return serverVisibleCountries;
    }
    const blockedSet = new Set(blocked);
    return new Set(
      COUNTRIES.filter((c) => !blockedSet.has(c.code)).map((c) => c.code)
    );
  }, [
    blocked,
    blockedLoaded,
    clientScope,
    filters.country,
    serverVisibleCountries,
    serverVisibleScope,
  ]);

  // ---- 篩選／排序／分頁都走 URL，伺服器端重新抓資料 ----
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // 瀏覽器上一頁／下一頁回到不同搜尋條件時，輸入框跟著更新。
  useEffect(() => {
    setInput(filters.q ?? "");
  }, [filters.q]);

  function buildUrl(patch: Partial<HomeFilters>): string {
    const f = { ...filtersRef.current, ...patch };
    const sp = new URLSearchParams();
    if (f.q) sp.set("q", f.q);
    if (f.platform) sp.set("platform", f.platform);
    // 只有明確指定的 type 才寫進 URL；隱含預設（Switch 2→全部、
    // 其餘→遊戲本體）由伺服器端依主機決定，寫死會蓋掉它（例如在
    // 遊戲牆點主機 Switch 2 時，把隱含的 game 寫成 ?type=game）。
    if (f.typeExplicit && f.productType) sp.set("type", f.productType);
    if (f.demo != null) sp.set("demo", String(f.demo));
    if (f.country) sp.set("country", f.country);
    if (f.sort && f.sort !== "deals") sp.set("sort", f.sort);
    if (f.onlySale) sp.set("sale", "1");
    if (f.onlyMine) sp.set("mine", "1");
    if (f.excludePurchased === false) sp.set("showpurchased", "1");
    if (f.page > 1) sp.set("page", String(f.page));
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  // 改篩選條件時回到第 1 頁；用 replace 避免每點一次就多一筆瀏覽紀錄。
  function applyFilter(patch: Partial<HomeFilters>) {
    router.replace(buildUrl({ ...patch, page: 1 }));
  }

  // 搜尋輸入：本地 state + 400ms debounce 後寫入 URL。
  useEffect(() => {
    const t = setTimeout(() => {
      if (input !== (filtersRef.current.q ?? "")) {
        router.replace(buildUrl({ q: input || undefined, page: 1 }));
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  function goPage(p: number) {
    router.push(buildUrl({ page: p }));
  }

  // 分頁按鈕：每 10 頁一組（1–10、11–20…），組後有 …＋最末頁；
  // 總頁數 ≤ 10 時只列出全部頁碼（見 lib/pagination）。
  const pageNums = useMemo(
    () => pageWindow(page, totalPages),
    [page, totalPages]
  );

  return (
    <>
      <SaleBanner />

      <div className="filter-panel">
        <div className="filter-row">
          <input
            className="input search-box"
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="搜尋遊戲名（中文 / 英文）…"
            aria-label="搜尋遊戲"
          />
          <select
            className="input"
            style={{ width: "auto" }}
            value={filters.sort ?? "deals"}
            onChange={(e) => applyFilter({ sort: e.target.value as SortKey })}
            aria-label="排序"
          >
            <option value="deals">特價優先：即將結束</option>
            <option value="cheap-asc">價格：低 → 高</option>
            <option value="cheap-desc">價格：高 → 低</option>
            <option value="discount">折扣：大 → 小</option>
            <option value="release">上市日期：新 → 舊</option>
            <option value="title">名稱：A → Z</option>
          </select>
          <select
            className="input"
            style={{ width: "auto" }}
            value={filters.country ?? ""}
            onChange={(e) =>
              applyFilter({ country: e.target.value || undefined })
            }
            aria-label="國家"
          >
            <option value="">國家：全部</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-row">
          <div className="filter-group">
            <span>主機</span>
            {["all", "Switch", "Switch 2"].map((p) => (
              <button
                key={p}
                type="button"
                className={`chip ${(filters.platform ?? "all") === p ? "active" : ""}`}
                onClick={() =>
                  applyFilter({ platform: p === "all" ? undefined : p })
                }
              >
                {p === "all" ? "全部" : p}
              </button>
            ))}
          </div>
          <div className="filter-group">
            <span>商品類型</span>
            <button
              type="button"
              className={`chip ${filters.productType === "all" ? "active" : ""}`}
              onClick={() =>
                applyFilter({ productType: "all", typeExplicit: true })
              }
            >
              全部
            </button>
            {productTypes.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip ${filters.productType === t ? "active" : ""}`}
                onClick={() =>
                  applyFilter({ productType: t, typeExplicit: true })
                }
              >
                {productTypeLabel(t)}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-group">
            <span>試玩類型</span>
            {[
              { v: "all", label: "全部" },
              { v: "1", label: "免費 Demo" },
              { v: "2", label: "免費試玩" },
              { v: "3", label: "NSO 限時試玩" },
            ].map((d) => (
              <button
                key={d.v}
                type="button"
                className={`chip ${
                  String(filters.demo ?? "all") === d.v ? "active" : ""
                }`}
                onClick={() =>
                  applyFilter({
                    demo: d.v === "all" ? undefined : Number(d.v),
                  })
                }
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="toggle-line">
          <label>
            <input
              type="checkbox"
              checked={filters.onlySale ?? false}
              onChange={(e) => applyFilter({ onlySale: e.target.checked })}
            />
            只看特價
          </label>
          <label title={userId ? "" : "需先登入"}>
            <input
              type="checkbox"
              checked={filters.onlyMine ?? false}
              disabled={!userId}
              onChange={(e) => applyFilter({ onlyMine: e.target.checked })}
            />
            只看我的收藏{userId ? "" : "（需登入）"}
          </label>
          <label title={userId ? "" : "需先登入"}>
            <input
              type="checkbox"
              checked={filters.excludePurchased !== false}
              disabled={!userId}
              onChange={(e) =>
                applyFilter({
                  excludePurchased: e.target.checked ? undefined : false,
                })
              }
            />
            排除已購買{userId ? "" : "（需登入）"}
          </label>
          <span className="muted">
            共 {total} 款
            {totalPages > 0 && ` · 第 ${page} / ${totalPages} 頁`}
          </span>
        </div>
      </div>

      {(filters.productType === "dlc" || filters.productType === "bundle") && (
        <p className="muted">
          以下{productTypeLabel(filters.productType)}
          名稱為 TitleDB 候選名，非官方譯名。
        </p>
      )}

      <CountrySettings blocked={blocked} onChange={setBlocked} />

      {games.length === 0 ? (
        <div className="empty">
          {loadError ? (
            <p>⚠️ 資料載入失敗，請稍後再試。</p>
          ) : (
            <>
              <p>沒有符合條件的遊戲。</p>
              <p>試試清除搜尋或篩選。</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="game-grid">
            {games.map((g) => (
              <GameCard key={g.id} game={g} visibleCountries={visibleCountries} />
            ))}
          </div>
          {totalPages > 1 && (
            <nav className="pagination" aria-label="分頁">
              <button
                type="button"
                className="btn"
                disabled={page <= 1}
                onClick={() => goPage(page - 1)}
              >
                ← 上一頁
              </button>
              {pageNums.map((n, i) =>
                n === "…" ? (
                  <span key={`e${i}`} className="ellipsis">
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    className={`chip page-num ${n === page ? "active" : ""}`}
                    onClick={() => goPage(n)}
                    aria-current={n === page ? "page" : undefined}
                  >
                    {n}
                  </button>
                )
              )}
              <button
                type="button"
                className="btn"
                disabled={page >= totalPages}
                onClick={() => goPage(page + 1)}
              >
                下一頁 →
              </button>
            </nav>
          )}
          {/* 手機浮動分頁：固定左下角（見 globals.css），一排三顆；
              點中間頁數可跳頁；跟最下面的分頁並存、看使用者喜歡用哪個，
              牆上方那組已拿掉，手機版只有這兩組。 */}
          {totalPages > 1 && (
            <nav className="pagination-fab" aria-label="分頁（浮動）">
              <button
                type="button"
                className="btn"
                disabled={page <= 1}
                onClick={() => {
                  setJumpOpen(false);
                  goPage(page - 1);
                }}
                aria-label="上一頁"
              >
                ← 上一頁
              </button>
              <button
                type="button"
                className="pagination-fab-page"
                onClick={() => {
                  setJumpValue(String(page));
                  setJumpOpen((v) => !v);
                }}
                aria-expanded={jumpOpen}
                aria-label="跳到指定頁數"
              >
                第 {page} / {totalPages} 頁
              </button>
              <button
                type="button"
                className="btn"
                disabled={page >= totalPages}
                onClick={() => {
                  setJumpOpen(false);
                  goPage(page + 1);
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
                    const n = Math.max(
                      1,
                      Math.min(totalPages, Number(jumpValue) || page)
                    );
                    setJumpOpen(false);
                    if (n !== page) goPage(n);
                  }}
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={totalPages}
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
          )}
        </>
      )}
    </>
  );
}
