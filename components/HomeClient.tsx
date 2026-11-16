"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { cheapestPrice, getUserCollectionGameIds, isOnSale } from "@/lib/data";
import { COUNTRIES } from "@/lib/countries";
import type { GameWithPrices } from "@/lib/types";
import GameCard from "./GameCard";
import CountrySettings from "./CountrySettings";
import SaleBanner from "./SaleBanner";

const BLOCKED_KEY = "spc-blocked-countries";

type SortKey = "cheap-asc" | "cheap-desc" | "title" | "discount";

export default function HomeClient({
  games,
  loggedInUserId,
}: {
  games: GameWithPrices[];
  loggedInUserId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [productType, setProductType] = useState("all");
  const [demo, setDemo] = useState("all");
  const [sort, setSort] = useState<SortKey>("cheap-asc");
  const [onlySale, setOnlySale] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [blockedLoaded, setBlockedLoaded] = useState(false);
  const [myCollection, setMyCollection] = useState<Set<string> | null>(null);
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
      // 讀不到就用空清單。
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

  // 我的收藏 id（只看我的收藏時用）。
  useEffect(() => {
    if (!userId) {
      setMyCollection(null);
      return;
    }
    const db = createSupabaseBrowserClient();
    getUserCollectionGameIds(db, userId).then((ids) =>
      setMyCollection(new Set(ids))
    );
  }, [userId]);

  const visibleCountries = useMemo(() => {
    const blockedSet = new Set(blocked);
    return new Set(
      COUNTRIES.filter((c) => !blockedSet.has(c.code)).map((c) => c.code)
    );
  }, [blocked]);

  const productTypes = useMemo(
    () => [...new Set(games.map((g) => g.product_type ?? "game"))],
    [games]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = games.filter((g) => {
      if (platform !== "all" && g.platform !== platform) return false;
      if (productType !== "all" && (g.product_type ?? "game") !== productType)
        return false;
      if (demo !== "all" && String(g.has_demo ?? 0) !== demo) return false;
      const visiblePrices = g.prices.filter((p) =>
        visibleCountries.has(p.country)
      );
      if (onlySale && !isOnSale(visiblePrices)) return false;
      if (onlyMine) {
        if (!myCollection) return false;
        if (!myCollection.has(g.id) && !g.collected_by_me) return false;
      }
      if (q) {
        const hay = [g.title_zh, g.title_en ?? "", g.genre ?? "", g.publisher ?? ""]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const cheap = (g: GameWithPrices) =>
      cheapestPrice(g.prices.filter((p) => visibleCountries.has(p.country)))
        ?.price_twd ?? Infinity;
    const discount = (g: GameWithPrices) =>
      Math.max(
        0,
        ...g.prices
          .filter((p) => visibleCountries.has(p.country))
          .map((p) => p.discount_pct ?? 0)
      );
    if (sort === "cheap-asc") list = [...list].sort((a, b) => cheap(a) - cheap(b));
    if (sort === "cheap-desc") list = [...list].sort((a, b) => cheap(b) - cheap(a));
    if (sort === "title")
      list = [...list].sort((a, b) => a.title_zh.localeCompare(b.title_zh, "zh-Hant"));
    if (sort === "discount")
      list = [...list].sort((a, b) => discount(b) - discount(a));
    return list;
  }, [games, query, platform, productType, demo, sort, onlySale, onlyMine, visibleCountries, myCollection]);

  return (
    <>
      <SaleBanner />

      <div className="filter-panel">
        <div className="filter-row">
          <input
            className="input search-box"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋遊戲名（中文 / 英文）、類型、發行商…"
            aria-label="搜尋遊戲"
          />
          <select
            className="input"
            style={{ width: "auto" }}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="排序"
          >
            <option value="cheap-asc">最低價：低 → 高</option>
            <option value="cheap-desc">最低價：高 → 低</option>
            <option value="discount">折扣：大 → 小</option>
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
                className={`chip ${platform === p ? "active" : ""}`}
                onClick={() => setPlatform(p)}
              >
                {p === "all" ? "全部" : p}
              </button>
            ))}
          </div>
          <div className="filter-group">
            <span>商品類型</span>
            <button
              type="button"
              className={`chip ${productType === "all" ? "active" : ""}`}
              onClick={() => setProductType("all")}
            >
              全部
            </button>
            {productTypes.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip ${productType === t ? "active" : ""}`}
                onClick={() => setProductType(t)}
              >
                {t === "game" ? "遊戲本體" : t}
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
                className={`chip ${demo === d.v ? "active" : ""}`}
                onClick={() => setDemo(d.v)}
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
              checked={onlySale}
              onChange={(e) => setOnlySale(e.target.checked)}
            />
            只看特價
          </label>
          <label title={userId ? "" : "需先登入"}>
            <input
              type="checkbox"
              checked={onlyMine}
              disabled={!userId}
              onChange={(e) => setOnlyMine(e.target.checked)}
            />
            只看我的收藏{userId ? "" : "（需登入）"}
          </label>
          <span className="muted">
            共 {filtered.length} 款（全部 {games.length} 款）
          </span>
        </div>
      </div>

      <CountrySettings blocked={blocked} onChange={setBlocked} />

      {filtered.length === 0 ? (
        <div className="empty">
          <p>沒有符合條件的遊戲。</p>
          <p>
            試試清除搜尋或篩選；或到 <Link href="/add">新增遊戲</Link> 手動加入。
          </p>
        </div>
      ) : (
        <div className="game-grid">
          {filtered.map((g) => (
            <GameCard key={g.id} game={g} visibleCountries={visibleCountries} />
          ))}
        </div>
      )}
    </>
  );
}
