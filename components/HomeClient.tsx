"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { type GamesPageFilters } from "@/lib/data";
import {
  COUNTRIES,
  DEFAULT_BLOCKED_CODES,
  productTypeLabel,
} from "@/lib/countries";
import type { GameWithPrices } from "@/lib/types";
import GameCard from "./GameCard";
import CountrySettings from "./CountrySettings";
import SaleBanner from "./SaleBanner";

const BLOCKED_KEY = "spc-blocked-countries";

export type HomeFilters = Omit<GamesPageFilters, "userId"> & { page: number };

type SortKey = "cheap-asc" | "cheap-desc" | "title" | "discount";

export default function HomeClient({
  games,
  total,
  page,
  totalPages,
  filters,
  productTypes,
  loggedInUserId,
  isAdmin,
}: {
  games: GameWithPrices[];
  total: number;
  page: number;
  totalPages: number;
  filters: HomeFilters;
  productTypes: string[];
  loggedInUserId: string | null;
  isAdmin: boolean;
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

  useEffect(() => {
    if (!blockedLoaded) return;
    try {
      window.localStorage.setItem(BLOCKED_KEY, JSON.stringify(blocked));
    } catch {
      // 寫入失敗不影響使用。
    }
  }, [blocked, blockedLoaded]);

  // 登入狀態（server 傳來的 userId 優先；瀏覽器端再確認一次，登入後免重整）。
  useEffect(() => {
    if (userId) return;
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [userId]);

  const visibleCountries = useMemo(() => {
    const blockedSet = new Set(blocked);
    return new Set(
      COUNTRIES.filter((c) => !blockedSet.has(c.code)).map((c) => c.code)
    );
  }, [blocked]);

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
    if (f.sort && f.sort !== "cheap-asc") sp.set("sort", f.sort);
    if (f.onlySale) sp.set("sale", "1");
    if (f.onlyMine) sp.set("mine", "1");
    if (f.onlyPurchased) sp.set("purchased", "1");
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

  // 分頁按鈕：最多顯示 7 個頁碼（首尾＋當前前後各一），中間用 … 連接。
  const pageNums = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const set = new Set([1, totalPages, page - 1, page, page + 1]);
    return [...set].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  }, [page, totalPages]);

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
            value={filters.sort ?? "cheap-asc"}
            onChange={(e) => applyFilter({ sort: e.target.value as SortKey })}
            aria-label="排序"
          >
            <option value="cheap-asc">價格：低 → 高</option>
            <option value="cheap-desc">價格：高 → 低</option>
            <option value="discount">折扣：大 → 小</option>
            <option value="release">上市日期：新 → 舊</option>
            <option value="title">名稱：A → Z</option>
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
              className={`chip ${!filters.productType ? "active" : ""}`}
              onClick={() => applyFilter({ productType: undefined })}
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
              checked={filters.onlyPurchased ?? false}
              disabled={!userId}
              onChange={(e) => applyFilter({ onlyPurchased: e.target.checked })}
            />
            只看已購買{userId ? "" : "（需登入）"}
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
          <p>沒有符合條件的遊戲。</p>
          <p>
            試試清除搜尋或篩選。
            {isAdmin && (
              <>
                或到 <Link href="/add">新增遊戲</Link> 手動加入。
              </>
            )}
          </p>
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
              {pageNums.map((n, i) => (
                <span key={n} style={{ display: "contents" }}>
                  {i > 0 && n > pageNums[i - 1] + 1 && (
                    <span className="ellipsis">…</span>
                  )}
                  <button
                    type="button"
                    className={`chip page-num ${n === page ? "active" : ""}`}
                    onClick={() => goPage(n)}
                    aria-current={n === page ? "page" : undefined}
                  >
                    {n}
                  </button>
                </span>
              ))}
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
