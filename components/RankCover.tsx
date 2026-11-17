"use client";

// 排行榜封面圖（Client Component）：<img onError> 是事件處理器，
// 不能寫在 Server Component（app/ranking/page.tsx）裡，否則有收藏的遊戲
// 一出現就會整頁 server-side exception。抽出來是唯一需要互動的部分。
export default function RankCover({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  return (
    <img
      className="rank-cover"
      src={src}
      alt={alt}
      loading="lazy"
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.src.endsWith("/covers/placeholder.svg")) {
          img.src = "/covers/placeholder.svg";
        }
      }}
    />
  );
}
