// 每日更新的遊戲切片與輪轉（純函式，可單元驗算，不碰 DB / 網路）。
//
// 背景：Vercel Hobby 的 serverless 執行上限是 60 秒，幾千款遊戲 × 35 國
// 一次跑不完，所以把遊戲按 slug 排序切成片，一天跑一片，n 天跑完一輪。
// 匯率每天都更新（便宜），價格按切片更新。
//
// 切分規則：
//   - 全部遊戲按 slug 排序（決定性，與資料庫回傳順序無關）。
//   - slices = ceil(遊戲總數 / sliceSize)，預設 sliceSize = 400。
//   - 輪轉：slice = 台北日期的 dayOfYear % slices。同一天不論何時打都選同一片；
//     連續 slices 天恰好跑完每一片一次，再回到起點。
//   - 遊戲總數變動時 slices 會跟著變，切片邊界可能移動（可接受：每款遊戲
//     仍約每 slices 天被更新一次；不要在中途手動改 sliceSize 就不會亂跳）。

import { taipeiDateKey } from "./nintendo";

/** 預設每片遊戲數（實測支撐，見 SETUP.md §8.3）：400 款 × 35 國抓價約 22 秒，
 *  留約 35 秒給匯率、寫庫與重試，60 秒上限內有餘裕。 */
export const DEFAULT_SLICE_SIZE = 400;
/** sliceSize 允許範圍：太小浪費每天一次的 cron，太大有超時風險。 */
export const MIN_SLICE_SIZE = 50;
export const MAX_SLICE_SIZE = 1000;

export function clampSliceSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SLICE_SIZE;
  return Math.min(MAX_SLICE_SIZE, Math.max(MIN_SLICE_SIZE, Math.floor(n)));
}

/** 台北日期的 day-of-year（0-based：1 月 1 日 = 0）。 */
export function dayOfYearTaipei(date: Date = new Date()): number {
  const key = taipeiDateKey(date); // YYYY-MM-DD（台北）
  const [y, m, d] = key.split("-").map(Number);
  const start = Date.UTC(y, 0, 1);
  const day = Date.UTC(y, m - 1, d);
  return Math.round((day - start) / 86_400_000);
}

/** 總片數：至少 1 片。 */
export function sliceCount(totalGames: number, sliceSize: number): number {
  const size = clampSliceSize(sliceSize);
  if (totalGames <= 0) return 1;
  return Math.max(1, Math.ceil(totalGames / size));
}

/** 輪轉：今天（台北日期）該跑第幾片（0-based）。 */
export function rotationSlice(
  date: Date = new Date(),
  totalGames: number,
  sliceSize: number = DEFAULT_SLICE_SIZE
): { slice: number; slices: number } {
  const slices = sliceCount(totalGames, sliceSize);
  return { slice: dayOfYearTaipei(date) % slices, slices };
}

/** 第 slice 片在排序後遊戲清單中的範圍（0-based offset / 實際款數）。 */
export function sliceRange(
  slice: number,
  slices: number,
  totalGames: number,
  sliceSize: number = DEFAULT_SLICE_SIZE
): { offset: number; count: number } {
  const size = clampSliceSize(sliceSize);
  const s = Math.min(Math.max(0, Math.floor(slice)), Math.max(0, slices - 1));
  const offset = s * size;
  return { offset, count: Math.max(0, Math.min(size, totalGames - offset)) };
}

/** 下一片（輪轉回到起點時為 0）。 */
export function nextSlice(slice: number, slices: number): number {
  return slices <= 1 ? 0 : (slice + 1) % slices;
}

/** 本輪完整跑完的台北日期（YYYY-MM-DD）：本輪最後一片的那一天。
 *  本輪起點 = dayOfYear - (dayOfYear % slices)，終點 = 起點 + slices - 1。
 *  跨年時 Date.UTC 會自動進到下一年。 */
export function cycleCompleteDateKey(
  date: Date = new Date(),
  totalGames: number,
  sliceSize: number = DEFAULT_SLICE_SIZE
): string {
  const slices = sliceCount(totalGames, sliceSize);
  const doy = dayOfYearTaipei(date);
  const cycleStart = doy - (doy % slices);
  const cycleEnd = cycleStart + slices - 1;
  const key = taipeiDateKey(date);
  const year = Number(key.slice(0, 4));
  const end = new Date(Date.UTC(year, 0, 1 + cycleEnd));
  return end.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 工作量切片（30,000 款規模用；見 DATA_NOTES.md §12.5）
//
// 問題：按「款數」切片時，每款遊戲的成本差 35 倍——JP-only 的遊戲
// 1 個 (遊戲、國家) 對、35 國全覆蓋的遊戲 32 個對。400 款一片在
// JP-only 區段 1 秒跑完（預算浪費）、在全覆蓋區段 22 秒。
// 改按「(遊戲、國家) 對數」切片：每片固定約 12,000 對（約 240 次
// 價格 API 呼叫、約 18–25 秒抓價＋約 5–8 秒寫庫），不論該片是
// 375 款全覆蓋遊戲還是 12,000 款 JP-only 遊戲。
// 對數來源：games.price_countries（sync-catalog 維護、migration 回填；
// 為 null 時以 35 計＝舊行為，不會低估預算）。
// ---------------------------------------------------------------------------

/** 預設每片 (遊戲、國家) 對數上限（實測速率推算，見 SETUP.md §8.3／§8.10）。 */
export const DEFAULT_PAIR_BUDGET = 12_000;
/** pairBudget 允許範圍。 */
export const MIN_PAIR_BUDGET = 1_000;
export const MAX_PAIR_BUDGET = 50_000;

export function clampPairBudget(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PAIR_BUDGET;
  return Math.min(MAX_PAIR_BUDGET, Math.max(MIN_PAIR_BUDGET, Math.floor(n)));
}

/** 單款遊戲的對數：price_countries（null 時以 35 計＝舊行為）。 */
export function pairsForGame(priceCountries: number | null | undefined): number {
  if (priceCountries == null || !Number.isFinite(priceCountries)) return 35;
  return Math.max(0, Math.floor(priceCountries));
}

/** 工作量切片：依 slug 排序的遊戲清單，按累積對數切成片。
 *  單款遊戲對數超過預算時自成一片（不會被拆開）。 */
export function planWorkSlices(
  pairCounts: number[],
  pairBudget: number = DEFAULT_PAIR_BUDGET
): { offset: number; count: number; pairs: number }[] {
  const budget = clampPairBudget(pairBudget);
  const slices: { offset: number; count: number; pairs: number }[] = [];
  let offset = 0;
  let pairs = 0;
  let count = 0;
  for (let i = 0; i < pairCounts.length; i++) {
    const p = pairCounts[i];
    if (count > 0 && pairs + p > budget) {
      slices.push({ offset, count, pairs });
      offset = i;
      pairs = 0;
      count = 0;
    }
    pairs += p;
    count++;
  }
  if (count > 0 || slices.length === 0) slices.push({ offset, count, pairs });
  return slices;
}

/** 台北絕對日數（以 2026-01-01 為第 0 天；只用於多輪次輪轉的跨日計算）。 */
export function absoluteDayTaipei(date: Date = new Date()): number {
  const key = taipeiDateKey(date);
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(
    (Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86_400_000
  );
}

/** 台北小時（0–23）。 */
export function taipeiHour(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      hour: "numeric",
      hour12: false,
    }).format(date)
  ) % 24;
}

/** 多輪次輪轉：每天跑 runsPerDay 次（例如 8 次＝每 3 小時一次），
 *  每次跑一片。slot = 當前台北小時所在的時段（0-based）；
 *  全域序號 = 絕對日數 × runsPerDay + slot；slice = 全域序號 % slices。
 *  連續 slices 次執行恰好每片一次；抖動 ±59 分鐘不會跨時段
 *  （cron 時刻選在時段中間，見 SETUP.md §8.10）。 */
export function rotationWorkSlice(
  date: Date = new Date(),
  slices: number,
  runsPerDay = 8
): { slice: number; slot: number; runsPerDay: number } {
  const runs = Math.max(1, Math.floor(runsPerDay));
  const slotHours = 24 / runs;
  const slot = Math.min(runs - 1, Math.floor(taipeiHour(date) / slotHours));
  const globalIndex = absoluteDayTaipei(date) * runs + slot;
  return {
    slice: slices <= 1 ? 0 : ((globalIndex % slices) + slices) % slices,
    slot,
    runsPerDay: runs,
  };
}

/** 工作量切片的一輪要幾天（每天 runsPerDay 次執行）。 */
export function workCycleDays(slices: number, runsPerDay = 8): number {
  return Math.max(1, Math.ceil(slices / Math.max(1, runsPerDay)));
}

/** 工作量切片本輪完整跑完的台北日期（YYYY-MM-DD）。 */
export function workCycleCompleteDateKey(
  date: Date = new Date(),
  slices: number,
  runsPerDay = 8
): string {
  const runs = Math.max(1, Math.floor(runsPerDay));
  const globalIndex = absoluteDayTaipei(date) * runs + rotationWorkSlice(date, slices, runs).slot;
  const cycleStart = globalIndex - (globalIndex % Math.max(1, slices));
  const cycleEnd = cycleStart + Math.max(1, slices) - 1;
  const endDay = Math.floor(cycleEnd / runs);
  const end = new Date(Date.UTC(2026, 0, 1 + endDay));
  return end.toISOString().slice(0, 10);
}
