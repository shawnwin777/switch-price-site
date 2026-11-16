"use client";

import Link from "next/link";
import { cheapestPrice, isOnSale, saleEndOf, PLACEHOLDER_COVER } from "@/lib/data";
import { demoLabel, productTypeLabel } from "@/lib/countries";
import { formatTwd, saleEndLabel } from "@/lib/format";
import type { GameWithPrices } from "@/lib/types";
import CollectionButton from "./CollectionButton";

export default function GameCard({
  game,
  visibleCountries,
}: {
  game: GameWithPrices;
  visibleCountries: Set<string>;
}) {
  const visiblePrices = game.prices.filter((p) =>
    visibleCountries.has(p.country)
  );
  const cheapest = cheapestPrice(visiblePrices);
  const onSale = isOnSale(visiblePrices);
  const saleEnd = saleEndOf(visiblePrices);
  const cheapestIsHistLow = cheapest?.is_historical_low ?? false;

  return (
    <article className="game-card">
      <Link href={`/games/${game.slug}`}>
        <img
          className="game-card-cover"
          src={game.cover_url ?? PLACEHOLDER_COVER}
          alt={game.title_zh}
          loading="lazy"
          onError={(e) => {
            const img = e.currentTarget;
            if (img.src !== window.location.origin + PLACEHOLDER_COVER) {
              img.src = PLACEHOLDER_COVER;
            }
          }}
        />
      </Link>
      <div className="game-card-body">
        <h3 className="game-card-title">
          <Link href={`/games/${game.slug}`}>{game.title_zh}</Link>
        </h3>
        {game.title_en && <div className="game-card-en">{game.title_en}</div>}
        <div className="game-card-badges">
          <span className="badge badge-platform">{game.platform ?? "Switch"}</span>
          {game.genre && <span className="badge badge-gray">{game.genre}</span>}
          <span className="badge badge-gray">
            {productTypeLabel(game.product_type)}
          </span>
          {game.has_demo != null && game.has_demo > 0 && (
            <span className="badge badge-gray">{demoLabel(game.has_demo)}</span>
          )}
          {cheapestIsHistLow && (
            <span className="badge badge-histlow">歷史低價</span>
          )}
          {onSale && <span className="badge badge-sale">特價中</span>}
        </div>
        <div className="game-card-price">
          {cheapest ? (
            <>
              <div className="price-label">
                最低價 · {cheapest.country_name ?? cheapest.country}
                {cheapest.discount_pct ? `（-${cheapest.discount_pct}%）` : ""}
              </div>
              <div className="price-value">
                {formatTwd(cheapest.price_twd)}{" "}
                <small>
                  {cheapest.currency} {cheapest.effective_raw}
                </small>
              </div>
              {game.historical_low_twd != null && (
                <div className="muted">
                  歷史低價：{formatTwd(game.historical_low_twd)}
                </div>
              )}
              {saleEnd && (
                <div className="muted">特價至：{saleEndLabel(saleEnd)}</div>
              )}
            </>
          ) : (
            <div className="muted">可見國家尚無價格</div>
          )}
        </div>
        <div className="game-card-foot">
          <span className="muted">
            👍 {game.likes_count} · ♥ {game.collections_count} 人收藏
          </span>
          <CollectionButton
            gameId={game.id}
            initialCollected={game.collected_by_me}
          />
        </div>
      </div>
    </article>
  );
}
