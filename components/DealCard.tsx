import type { DealsCarouselItem } from "@/lib/deals-carousel";

const SOURCE_LABEL: Record<DealsCarouselItem["source"], string> = {
  steam: "Steam",
  epic: "Epic",
  xbox: "Xbox",
  ps: "PlayStation",
  gamerpower: "GamerPower",
  gog: "GOG",
};

const SOURCE_BADGE_CLASS: Record<DealsCarouselItem["source"], string> = {
  steam: "deals-badge-steam",
  epic: "deals-badge-epic",
  xbox: "deals-badge-xbox",
  ps: "deals-badge-ps",
  gamerpower: "deals-badge-gamerpower",
  gog: "deals-badge-gog",
};

/** /deals 用的單一特價／免費遊戲卡片：圖片在上、標題＋價格在下，
 *  點了另開新視窗去 Steam／Epic／Xbox 商店（台灣區）。 */
export default function DealCard({ item }: { item: DealsCarouselItem }) {
  return (
    <a
      className="deals-card"
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${item.title}（${SOURCE_LABEL[item.source]}，另開新視窗前往商店）`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="deals-card-img"
        src={item.image}
        alt={item.title}
        loading="lazy"
      />
      <span className="deals-card-body">
        <span
          className={`badge deals-badge ${SOURCE_BADGE_CLASS[item.source]}`}
        >
          <span>{SOURCE_LABEL[item.source]}</span>
          <span>{item.badge}</span>
        </span>
        <span className="deals-card-title">{item.title}</span>
        <span className="deals-price">{item.priceLine}</span>
        {item.subLine && (
          <span className={item.endingSoon ? "sale-urgent" : "deals-sub"}>
            {item.subLine}
            {item.endingSoon && (
              <span
                className="sale-urgent-icon"
                role="img"
                aria-label="領取期限即將截止"
              >
                ⚠
              </span>
            )}
          </span>
        )}
      </span>
    </a>
  );
}
