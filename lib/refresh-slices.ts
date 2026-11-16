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
