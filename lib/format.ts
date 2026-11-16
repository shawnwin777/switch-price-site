// 顯示用格式化工具（皆以台北時間呈現）。

export function formatTwd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `NT$ ${Math.round(n).toLocaleString("zh-Hant-TW")}`;
}

export function formatRaw(
  raw: number | null | undefined,
  currency: string | null | undefined
): string {
  if (raw == null || Number.isNaN(raw)) return "—";
  const cur = currency ?? "";
  // 日圓、韓元等無小數貨幣直接顯示整數；其餘保留兩位小數。
  const noDecimal = ["JPY", "KRW", "TWD", "CLP", "COP", "ARS", "IDR", "VND"];
  const text = noDecimal.includes(cur)
    ? Math.round(raw).toLocaleString("zh-Hant-TW")
    : raw.toLocaleString("zh-Hant-TW", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      });
  return cur ? `${cur} ${text}` : text;
}

/** ISO 時間 → 台北時間「2026/11/15 18:30」；無效回 "—"。 */
export function formatTaipei(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).format(d);
}

/** ISO 日期 → 台北時間「2026/11/15」；無效回 "—"。 */
export function formatTaipeiDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).format(d);
}

/** 特價結束時間 → 剩餘天數（無條件進位；已結束回 0；無結束時間回 null）。 */
export function daysLeft(saleEnd: string | null | undefined): number | null {
  if (!saleEnd) return null;
  const end = new Date(saleEnd).getTime();
  if (Number.isNaN(end)) return null;
  const diff = end - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function saleEndLabel(saleEnd: string | null | undefined): string {
  if (!saleEnd) return "長期特價";
  const left = daysLeft(saleEnd);
  if (left === null) return "—";
  if (left <= 0) return "已結束";
  return `${formatTaipei(saleEnd)}（剩 ${left} 天）`;
}

/** 今天的台北日期 YYYY-MM-DD（給 fx_rates.date_key 用）。 */
export function taipeiDateKey(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).format(d);
  return parts; // en-CA 輸出 YYYY-MM-DD
}
