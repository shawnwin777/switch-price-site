"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { getCollectedOnSale } from "@/lib/data";
import { formatTwd, saleEndLabel } from "@/lib/format";
import type { CollectedOnSale } from "@/lib/types";

// 進站上方提醒：已收藏且正在特價的遊戲清單（需登入；未登入不顯示）。
export default function SaleBanner() {
  const [items, setItems] = useState<CollectedOnSale[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const db = createSupabaseBrowserClient();
    db.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!user) {
        setItems([]);
        return;
      }
      try {
        const list = await getCollectedOnSale(db, user.id);
        setItems(list);
      } catch (e) {
        console.warn("特價提醒讀取失敗：", e);
        setItems([]);
      }
    });
  }, []);

  if (!items || items.length === 0 || dismissed) return null;

  return (
    <section className="sale-banner" aria-label="收藏特價提醒">
      <button
        type="button"
        className="dismiss"
        onClick={() => setDismissed(true)}
      >
        ✕ 關閉
      </button>
      <h2>🔥 你收藏的遊戲正在特價！（{items.length} 款）</h2>
      <ul>
        {items.map(({ game, cheapest_sale }) => (
          <li key={game.id}>
            <Link href={`/games/${game.slug}`}>{game.title_zh}</Link>
            {cheapest_sale && (
              <>
                {" — "}
                最低 {formatTwd(cheapest_sale.price_twd)}（
                {cheapest_sale.country_name ?? cheapest_sale.country}
                {cheapest_sale.discount_pct
                  ? `，-${cheapest_sale.discount_pct}%`
                  : ""}
                ）
                {cheapest_sale.sale_end &&
                  `，${saleEndLabel(cheapest_sale.sale_end)}`}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
