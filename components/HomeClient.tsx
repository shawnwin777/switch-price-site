"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { type GamesPageFilters } from "@/lib/data";
import { pageWindow } from "@/lib/pagination";
import {
  COUNTRIES,
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
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, blockedLoaded, clientScope, serverVisibleScope]);

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
    const blockedSet = new Set(blocked);
    return new Set(
      COUNTRIES.filter((c) => !blockedSet.has(c.code)).map((c) => c.code)
    );
  }, [blocked, filters.country]);

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
    if (f.productType) sp.set("type", f.productType);
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
              onClick={() => applyFilter({ productType: "all" })}
            >
              全部
            </button>
            {productTypes.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip ${filters.productType === t ? "active" : ""}`}
                onClick={() => applyFilter({ productType: t })}
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

      <CountrySettings blocked={blocked} onChange={setBlocked} />

      {games.length === 0 ? (
        <div className="empty">
          {loadError ? (
            <p>⚠️ 資料載入失敗，請稍後再試。</p>
          ) : (
            <>
              <p>沒有符合條件的遊戲。</p>
              <p>
                試試清除搜尋或篩選。
                {isAdmin && (
                  <>
                    或到 <Link href="/add">新增遊戲</Link> 手動加入。
                  </>
                )}
              </p>
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
        </>
      )}
    </>
  );
}
