/** 分頁數字列：每 10 頁一組（1–10、11–20、…），組內頁碼全部列出；
 *  組前面有「1 …」（組不是從 1 開始時），組後面有「… 最末頁」
 *  （組沒含最末頁時）。總頁數 ≤ 10 時只列出全部頁碼，不顯示 …。 */
export type PageItem = number | "…";

export function pageWindow(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 0) return [];
  const p = Math.min(Math.max(1, page), totalPages);
  if (totalPages <= 10) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const start = Math.floor((p - 1) / 10) * 10 + 1;
  const end = Math.min(start + 9, totalPages);
  const items: PageItem[] = [];
  if (start > 1) items.push(1, "…");
  for (let n = start; n <= end; n++) items.push(n);
  if (end < totalPages) items.push("…", totalPages);
  return items;
}
