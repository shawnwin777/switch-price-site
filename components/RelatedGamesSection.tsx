"use client";

import { useState } from "react";
import Link from "next/link";
import { formatTwd } from "@/lib/format";
import type { RelatedGameGroups, RelatedGameItem } from "@/lib/types";

// 詳情頁「相關內容」區：各區價格區塊的上方。
// 沒有任何相關內容時整個區不顯示（回傳 null）。
// 有內容時預設展開，折疊按鈕用 useState 記住當頁狀態即可。
const GROUP_ORDER: { key: keyof RelatedGameGroups; title: string }[] = [
  { key: "parent", title: "🎮 所屬本體" },
  { key: "dlc", title: "🧩 DLC" },
  { key: "language_pack", title: "🌐 語言包" },
  { key: "upgrade_pass", title: "⬆️ 升級通行證" },
  { key: "bundle", title: "📦 組合包" },
  { key: "edition", title: "🔄 一或二代主程式" },
];

function RelatedCard({ item }: { item: RelatedGameItem }) {
  return (
    <Link className="related-card" href={`/games/${item.slug}`}>
      <img
        className="related-cover"
        src={item.cover_url ?? "/covers/placeholder.svg"}
        alt={item.title_zh}
        loading="lazy"
        onError={(e) => {
          const img = e.currentTarget;
          if (!img.src.endsWith("/covers/placeholder.svg")) {
            img.src = "/covers/placeholder.svg";
          }
        }}
      />
      <span className="related-card-body">
        {item.relation_type === "edition" && (
          <span className="badge badge-platform">
            {item.platform ? `${item.platform} 版` : "另一代主程式"}
          </span>
        )}
        {item.relation_type === "language_pack" && (
          <span className="badge badge-gray">語言包</span>
        )}
        <span className="related-title">{item.title_zh}</span>
        {item.title_en && (
          <span className="related-en">{item.title_en}</span>
        )}
        <span className="related-price">
          {item.cheapest_twd != null
            ? `最低價 ${formatTwd(item.cheapest_twd)}`
            : "尚無價格"}
        </span>
      </span>
    </Link>
  );
}

export default function RelatedGamesSection({
  groups,
}: {
  groups: RelatedGameGroups;
}) {
  const [expanded, setExpanded] = useState(true);
  const total = GROUP_ORDER.reduce(
    (n, g) => n + (groups[g.key]?.length ?? 0),
    0
  );
  if (total === 0) return null;

  return (
    <section className="related-section" aria-label="相關內容">
      <div className="related-head">
        <h2 className="related-title-h">🔗 相關內容（共 {total} 項）</h2>
        <button
          type="button"
          className="btn related-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "收起 ▲" : "展開 ▼"}
        </button>
      </div>
      {expanded && (
        <div className="related-groups">
          {GROUP_ORDER.map(({ key, title }) => {
            const items = groups[key] ?? [];
            if (items.length === 0) return null;
            return (
              <div key={key} className="related-group">
                <h3>
                  {title}（{items.length}）
                </h3>
                <div className="related-row">
                  {items.map((item) => (
                    <RelatedCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
