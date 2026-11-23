"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { cheapestPrice, isOnSale, saleEndOf } from "@/lib/data";
import { COUNTRIES, DEFAULT_BLOCKED_CODES, demoLabel, eshopUrl, productTypeLabel } from "@/lib/countries";
import { formatRaw, formatTwd, isSaleEndingSoon, saleEndLabel } from "@/lib/format";
import type { CommentItem, GameWithPrices } from "@/lib/types";
import CollectionButton from "./CollectionButton";
import PurchaseButton from "./PurchaseButton";
import LikeButton from "./LikeButton";
import CommentsSection from "./CommentsSection";
import CountrySettings from "./CountrySettings";

const BLOCKED_KEY = "spc-blocked-countries";

export default function GameDetailClient({
  game,
  initialComments,
  collectedByMe,
  purchasedByMe,
}: {
  game: GameWithPrices;
  initialComments: CommentItem[];
  collectedByMe: boolean;
  purchasedByMe: boolean;
}) {
  const router = useRouter();
  const [blocked, setBlocked] = useState<string[]>(DEFAULT_BLOCKED_CODES);
  const [blockedLoaded, setBlockedLoaded] = useState(false);
  const [isCollected, setIsCollected] = useState(collectedByMe);
  const [isPurchased, setIsPurchased] = useState(purchasedByMe);

  // 返回上一頁；沒有上一頁紀錄（例如直接開連結進來）時導向 /home。
  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/home");
    }
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BLOCKED_KEY);
      if (raw) {
        const list = JSON.parse(raw) as string[];
        if (Array.isArray(list)) setBlocked(list);
      }
    } catch {
      // 忽略
    }
    setBlockedLoaded(true);
  }, []);

  useEffect(() => {
    if (!blockedLoaded) return;
    try {
      window.localStorage.setItem(BLOCKED_KEY, JSON.stringify(blocked));
    } catch {
      // 忽略
    }
  }, [blocked, blockedLoaded]);

  // 登入後從卡片收藏了這款遊戲，回到詳細頁時也要同步提醒狀態。
  useEffect(() => {
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: row } = await db
        .from("collections")
        .select("id")
        .eq("game_id", game.id)
        .eq("user_id", data.user.id)
        .maybeSingle();
      setIsCollected(Boolean(row));
      const { data: purchaseRow } = await db
        .from("user_purchases")
        .select("id")
        .eq("game_id", game.id)
        .eq("user_id", data.user.id)
        .maybeSingle();
      setIsPurchased(Boolean(purchaseRow));
    });
  }, [game.id]);

  const visibleCountries = useMemo(() => {
    const blockedSet = new Set(blocked);
    return new Set(
      COUNTRIES.filter((c) => !blockedSet.has(c.code)).map((c) => c.code)
    );
  }, [blocked]);

  const visiblePrices = useMemo(
    () =>
      game.prices
        .filter((p) => visibleCountries.has(p.country))
        .sort((a, b) => (a.price_twd ?? Infinity) - (b.price_twd ?? Infinity)),
    [game.prices, visibleCountries]
  );

  const cheapest = cheapestPrice(visiblePrices);
  const twPrice = game.prices.find((p) => p.country === "TW");
  const onSale = isOnSale(game.prices);
  const saleEnd = saleEndOf(game.prices);
  const hiddenCount = game.prices.length - visiblePrices.length;

  // 比台版省多少：台版有價時才算；台版無價則不顯示。
  const savings =
    twPrice?.price_twd != null && cheapest?.price_twd != null
      ? twPrice.price_twd - cheapest.price_twd
      : null;

  const youtubeUrl = game.youtube_id
    ? `https://www.youtube.com/watch?v=${game.youtube_id}`
    : null;

  return (
    <>
      <button type="button" className="btn back-btn" onClick={goBack}>
        ← 返回
      </button>
      <div className="detail-head">
        {youtubeUrl ? (
          <a
            className="detail-cover-link"
            href={youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="點封面在新分頁開官方 YouTube 介紹影片"
          >
            <img
              className="detail-cover"
              src={game.cover_url ?? "/covers/placeholder.svg"}
              alt={game.title_zh}
              onError={(e) => {
                const img = e.currentTarget;
                if (!img.src.endsWith("/covers/placeholder.svg")) {
                  img.src = "/covers/placeholder.svg";
                }
              }}
            />
            <span className="play-hint">▶ 官方介紹影片（YouTube，新分頁）</span>
          </a>
        ) : (
          <img
            className="detail-cover"
            src={game.cover_url ?? "/covers/placeholder.svg"}
            alt={game.title_zh}
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.src.endsWith("/covers/placeholder.svg")) {
                img.src = "/covers/placeholder.svg";
              }
            }}
          />
        )}
        <div className="detail-info">
          <h1>{game.title_zh}</h1>
          {game.title_en && <p className="muted">{game.title_en}</p>}
          <div className="game-card-badges">
            <span className="badge badge-platform">{game.platform ?? "Switch"}</span>
            {game.genre && <span className="badge badge-gray">{game.genre}</span>}
            <span className="badge badge-gray">
              {productTypeLabel(game.product_type)}
            </span>
            {game.publisher && (
              <span className="badge badge-gray">{game.publisher}</span>
            )}
            {game.has_demo != null && game.has_demo > 0 && (
              <span className="badge badge-gray">{demoLabel(game.has_demo)}</span>
            )}
            {game.is_manual && <span className="badge badge-gray">玩家手動新增</span>}
          </div>
          {cheapest && (
            <p>
              最低價：{" "}
              <b style={{ color: "var(--cyan)", fontSize: 22 }}>
                {formatTwd(cheapest.price_twd)}
              </b>{" "}
              （{cheapest.country_name ?? cheapest.country}）
              {cheapest.is_historical_low && (
                <span className="badge badge-histlow"> 歷史低價</span>
              )}
              {onSale && <span className="badge badge-sale"> 特價中</span>}
            </p>
          )}
          {game.historical_low_twd != null && (
            <p className="muted">
              歷史低價：{formatTwd(game.historical_low_twd)}
              {cheapest?.is_historical_low ? "（目前就是歷史低價）" : ""}
            </p>
          )}
          {savings != null && savings > 0 && cheapest && (
            <p>
              比台版省{" "}
              <b style={{ color: "var(--green)" }}>{formatTwd(savings)}</b>
              {twPrice?.price_twd
                ? `（台版 ${formatTwd(twPrice.price_twd)}，省 ${Math.round(
                    (savings / twPrice.price_twd) * 100
                  )}%）`
                : ""}
            </p>
          )}
          {saleEnd && (
            <p className={isSaleEndingSoon(saleEnd) ? "sale-urgent" : "muted"}>
              特價結束：{saleEndLabel(saleEnd)}
              {isSaleEndingSoon(saleEnd) && (
                <span
                  className="sale-urgent-icon"
                  role="img"
                  aria-label="特價即將結束"
                >
                  ⚠
                </span>
              )}
            </p>
          )}
          <div className="detail-actions">
            <LikeButton
              gameId={game.id}
              initialLiked={game.liked_by_me}
              initialCount={game.likes_count}
            />
            <CollectionButton
              gameId={game.id}
              initialCollected={isCollected}
            />
            <PurchaseButton
              gameId={game.id}
              initialPurchased={isPurchased}
            />
            <span className="muted">
              ♥ {game.collections_count} 人收藏
            </span>
          </div>
        </div>
      </div>

      {isCollected && onSale && cheapest && (
        <div className="sale-banner" role="alert">
          <h2>🔥 你收藏的這款遊戲正在特價！</h2>
          <p>
            最低 {formatTwd(cheapest.price_twd)}（
            {cheapest.country_name ?? cheapest.country}
            {cheapest.discount_pct ? `，-${cheapest.discount_pct}%` : ""}）
            {cheapest.sale_end && `，${saleEndLabel(cheapest.sale_end)}`}。
            別錯過！
          </p>
        </div>
      )}

      <CommentsSection gameId={game.id} initialComments={initialComments} />

      <h2>💰 各區價格（依台幣由低到高）</h2>
      <CountrySettings blocked={blocked} onChange={setBlocked} />
      {hiddenCount > 0 && (
        <p className="muted">
          已隱藏 {hiddenCount} 個被封鎖國家的價格（在上方國家設定中恢復）。
        </p>
      )}
      {visiblePrices.length === 0 ? (
        <div className="empty">可見國家尚無價格。</div>
      ) : (
        <div className="price-table-wrap">
          <table className="price-table">
            <thead>
              <tr>
                <th>國家</th>
                <th className="num">當地售價</th>
                <th className="num">台幣約</th>
                <th>折扣</th>
                <th>特價結束</th>
                <th>eShop</th>
              </tr>
            </thead>
            <tbody>
              {visiblePrices.map((p) => {
                const isCheapest = cheapest && p.id === cheapest.id;
                return (
                  <tr key={p.id} className={isCheapest ? "cheapest-row" : ""}>
                    <td>
                      {p.country_name ?? p.country}（{p.country}）
                      {isCheapest && (
                        <span className="badge badge-cheapest"> 最便宜</span>
                      )}
                      {p.is_historical_low && (
                        <span className="badge badge-histlow"> 歷史低價</span>
                      )}
                    </td>
                    <td className="num">
                      {formatRaw(p.effective_raw, p.currency)}
                      {p.regular_raw != null &&
                        p.effective_raw != null &&
                        p.regular_raw !== p.effective_raw && (
                          <div className="muted">
                            <s>{formatRaw(p.regular_raw, p.currency)}</s>
                          </div>
                        )}
                    </td>
                    <td className="num">
                      <b>{formatTwd(p.price_twd)}</b>
                    </td>
                    <td>
                      {p.discount_pct ? (
                        <span className="badge badge-sale">
                          -{p.discount_pct}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{p.sale_end ? saleEndLabel(p.sale_end) : "—"}</td>
                    <td>
                      <a
                        href={eshopUrl(p.country)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        前往 eShop ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
