"use client";

import { useEffect, useState } from "react";

/** 浮動「TOP」按鈕：固定右下角，往下捲超過 300px 才出現，
 *  點了平滑捲回最上方。跟左下角的手機浮動分頁不同角、不重疊。 */
export default function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      type="button"
      className="back-to-top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="回到最上方"
    >
      TOP
    </button>
  );
}
