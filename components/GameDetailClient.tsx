"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { cheapestPrice, isOnSale, isPriceOnSale, isVerifiedPrice, saleEndOf } from "@/lib/data";
import { COUNTRIES, DEFAULT_BLOCKED_CODES, demoLabel, eshopUrl, productTypeLabel } from "@/lib/countries";
import { formatRaw, formatTaipeiDate, formatTwd, isSaleEndingSoon, saleEndLabel } from "@/lib/format";
import type { CommentItem, GameWithPrices, RelatedGameGroups } from "@/lib/types";
import CollectionButton from "./CollectionButton";
import PurchaseButton from "./PurchaseButton";
import LikeButton from "./LikeButton";
import CommentsSection from "./CommentsSection";
import RelatedGamesSection from "./RelatedGamesSection";
import CountrySettings from "./CountrySettings";

const BLOCKED_KEY = "spc-blocked-countries";

export default function GameDetailClient({
  game,
  initialComments,
  collectedByMe,
  purchasedByMe,
  related,
}: {
  game: GameWithPrices;
  initialComments: CommentItem[];
  collectedByMe: boolean;
  purchasedByMe: boolean;
  related: RelatedGameGroups;
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
        // 未確認價格排最後面，組內再依台幣價由低到高。
        .sort(
          (a, b) =>
            Number(isVerifiedPrice(b)) - Number(isVerifiedPrice(a)) ||
            (a.price_twd ?? Infinity) - (b.price_twd ?? Infinity)
        ),
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

  // 畫廊：影片（youtube_id）＋截圖（games.screenshots），點封面開啟，
  // 左右切換（按鈕／觸控滑動／鍵盤左右鍵），ESC 關閉。沒有影片也沒有
  // 截圖時不開 viewer，封面維持舊行為。
  type GallerySlide =
    | { kind: "video"; youtubeId: string }
    | { kind: "image"; url: string };

  const slides: GallerySlide[] = useMemo(() => {
    const list: GallerySlide[] = [];
    if (game.youtube_id) {
      list.push({ kind: "video", youtubeId: game.youtube_id });
    }
    const shots = Array.isArray(game.screenshots) ? game.screenshots : [];
    for (const url of shots) {
      if (typeof url === "string" && url.trim() !== "") {
        list.push({ kind: "image", url: url.trim() });
      }
    }
    return list;
  }, [game.youtube_id, game.screenshots]);

  const screenshotCount = slides.filter((s) => s.kind === "image").length;

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const viewerOpen = viewerIndex !== null;
  const currentSlide = viewerIndex != null ? slides[viewerIndex] : null;

  const closeViewer = () => setViewerIndex(null);
  const showPrev = () =>
    setViewerIndex((i) =>
      i == null ? i : (i - 1 + slides.length) % slides.length
    );
  const showNext = () =>
    setViewerIndex((i) => (i == null ? i : (i + 1) % slides.length));

  // 切換圖片時重設載入失敗狀態。
  useEffect(() => {
    setImgFailed(false);
  }, [viewerIndex]);

  // viewer 開著時：鍵盤左右鍵切換、ESC 關閉、鎖住背景捲動。
  useEffect(() => {
    if (!viewerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowLeft") showPrev();
      else if (e.key === "ArrowRight") showNext();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // showPrev/showNext 只依賴 slides.length，viewer 開關期間不變。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerOpen]);

  return (
    <>
      <button type="button" className="btn back-btn" onClick={goBack}>
        ← 返回
      </button>
      <div className="detail-head">
        {slides.length > 0 ? (
          <button
            type="button"
            className="detail-cover-btn"
            onClick={() => setViewerIndex(0)}
            title={
              game.youtube_id
                ? "點封面看官方介紹影片與截圖"
                : "點封面看截圖"
            }
            aria-label={game.youtube_id ? "開啟影片與截圖" : "開啟截圖"}
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
            <span className="play-hint">
              {game.youtube_id
                ? `▶ 官方介紹影片（YouTube）${
                    screenshotCount > 0
                      ? ` · ${screenshotCount} 張截圖`
                      : ""
                  }`
                : `點封面看截圖（共 ${screenshotCount} 張）`}
            </span>
          </button>
        ) : youtubeUrl ? (
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
          {(game.product_type === "dlc" || game.product_type === "bundle" || game.name_source === "titledb") && (
            <p className="muted">名稱來源：TitleDB 候選名（非官方譯名）</p>
          )}
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

      <RelatedGamesSection groups={related} />

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
                <th>更新於</th>
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
                      {isVerifiedPrice(p) && p.is_historical_low && (
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
                      {isPriceOnSale(p) && p.discount_pct ? (
                        <span className="badge badge-sale">
                          -{p.discount_pct}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{p.sale_end ? saleEndLabel(p.sale_end) : "—"}</td>
                    <td>{formatTaipeiDate(p.updated_at)}</td>
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

      {viewerOpen && currentSlide && (
        <div
          className="gallery-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="影片與截圖"
          onClick={closeViewer}
        >
          <div className="gallery-topbar">
            <span className="gallery-counter">
              {(viewerIndex ?? 0) + 1} / {slides.length}
            </span>
            <button
              type="button"
              className="gallery-close"
              onClick={closeViewer}
              aria-label="關閉"
            >
              ✕
            </button>
          </div>
          <div
            className="gallery-stage"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) =>
              setTouchStartX(e.touches[0]?.clientX ?? null)
            }
            onTouchEnd={(e) => {
              if (touchStartX == null) return;
              const dx =
                (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
              if (dx > 50) showPrev();
              else if (dx < -50) showNext();
              setTouchStartX(null);
            }}
          >
            {currentSlide.kind === "video" ? (
              <div className="gallery-video">
                <img
                  className="gallery-video-thumb"
                  src={`https://i.ytimg.com/vi/${currentSlide.youtubeId}/hqdefault.jpg`}
                  alt="官方介紹影片縮圖"
                />
                <a
                  className="gallery-play-btn"
                  href={`https://www.youtube.com/watch?v=${currentSlide.youtubeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ▶ 在 YouTube 觀看官方介紹影片
                </a>
                <p className="muted">影片在 YouTube 播放（新分頁，不內嵌）。</p>
              </div>
            ) : imgFailed ? (
              <p className="gallery-error">圖片載入失敗</p>
            ) : (
              <img
                className="gallery-img"
                src={currentSlide.url}
                alt={`截圖 ${(viewerIndex ?? 0) + 1 - (game.youtube_id ? 1 : 0)}`}
                onError={() => setImgFailed(true)}
              />
            )}
            {slides.length > 1 && (
              <>
                <button
                  type="button"
                  className="gallery-nav gallery-nav-prev"
                  onClick={showPrev}
                  aria-label="上一張"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="gallery-nav gallery-nav-next"
                  onClick={showNext}
                  aria-label="下一張"
                >
                  ›
                </button>
              </>
            )}
          </div>
          <p className="gallery-caption">
            {currentSlide.kind === "video"
              ? "官方介紹影片"
              : `截圖 ${(viewerIndex ?? 0) + 1 - (game.youtube_id ? 1 : 0)} / ${screenshotCount}`}
          </p>
        </div>
      )}
    </>
  );
}
