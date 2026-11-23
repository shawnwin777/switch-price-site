// NSO 會員跨區比價：靜態查證價目表（v1）。
// NSO 價格很少變動（通常一年一次），先用靜態表＋查核日期；
// 若日後找到 NSO 訂閱的 price API 穩定抓法再改即時。
// 匯率：2026-11-23 起改伺服器端即時抓 open.er-api.com（見
// lib/cached-data.ts 的 getCachedNsoFx，每小時快取一次）；
// 下面的 NSO_FX_PER_USD／NSO_FX_DATE／NSO_FX_SOURCE 是靜態快照，
// 即時抓不到時才退回用它。價格表本身維持靜態不動。
//
// 價格來源（查核日期 2026-11-23）：
// - 底表：Bulbapedia「Nintendo Switch Online」價目（標示 accurate as of 2025-11-18）。
// - 2026 年已證實調價的國家以新價為準：韓國 2026-07-01 漲價（韓國任天堂
//   2026-05-08 公告，韓聯社／MK／Newsis 等多家韓媒）；巴西 2026-03 降價
//   （ComicBook 2026-03-09；matheuzera 2026-11-15 以巴西任天堂官方頁核對）；
//   墨西哥／秘魯／智利／哥倫比亞 2026 年調價（youfundceo 各國頁，讀任天堂官方頁，
//   2026-10-30 查核；阿根廷另以 Tilplay 2026-08-07 與 youfundceo 2026-11-16 交叉核對）。
// - 台灣價另以 ikura.page（2026-11，讀 nintendo.com/tw 官方價）與 youfundceo
//   （NT$79，2026-11）交叉核對；日本／美國／加拿大／英國／歐元區／瑞士／新加坡／泰國
//   12 個月個人價另以 ikura.page（2026-11，官方價）核對。
// - 兌換券：任天堂 2026-01-30 23:59 各區停售（任天堂支援 FAQ）；已買的自購買日起
//   12 個月內有效（最晚 2027-01-30）；僅列最後販售價。台灣未販售（UpToGo）；
//   香港期間限定 HKD 649（自由時報／巴哈姆特）。
// - 查不到的格子留 null，頁面顯示「未查到」，絕對不編價格。

/** 價目查核日期（台北日期）。 */
export const NSO_CHECK_DATE = "2026-11-23";

/** 換算台幣用的匯率快照日期（即時抓取失敗時的退回值）。 */
export const NSO_FX_DATE = "2026-11-23";
export const NSO_FX_SOURCE = "open.er-api.com（USD 基準，2026-11-23 00:02 UTC 快照）";

/** 每 1 美元兌各幣別（2026-11-23 快照，退回值）；台幣 = 當地價 ÷ 此值 × 32.968084。 */
export const NSO_FX_PER_USD: Record<string, number> = {
  TWD: 32.968084,
  JPY: 158.701406,
  HKD: 7.838987,
  KRW: 1343.597019,
  USD: 1,
  CAD: 1.433241,
  MXN: 19.113379,
  BRL: 5.945309,
  CLP: 1016.589577,
  COP: 3437.41712,
  ARS: 1575.9572,
  PEN: 3.442586,
  GBP: 0.763577,
  EUR: 0.911134,
  CHF: 0.840419,
  PLN: 4.064234,
  CZK: 22.283029,
  DKK: 6.806835,
  SEK: 10.221203,
  NOK: 9.751101,
  AUD: 1.507013,
  NZD: 1.826906,
  ZAR: 17.513472,
  SGD: 1.289081,
  MYR: 4.112368,
  THB: 33.943445,
};

export type NsoPlanKey = "m1" | "m3" | "y12" | "fam12" | "exp12" | "expFam12";

export const NSO_PLANS: { key: NsoPlanKey; label: string }[] = [
  { key: "m1", label: "一般 30 天" },
  { key: "m3", label: "一般 90 天" },
  { key: "y12", label: "一般 12 個月" },
  { key: "fam12", label: "家庭 12 個月" },
  { key: "exp12", label: "擴充個人 12 個月" },
  { key: "expFam12", label: "擴充家庭 12 個月" },
];

export interface NsoRow {
  /** lib/countries.ts 的國家代碼。 */
  code: string;
  currency: string;
  prices: Partial<Record<NsoPlanKey, number>>;
  /** 兌換券（2 張組）最後販售價；null／缺 = 未查到；"not-sold" = 該區未販售。 */
  voucher?: number | "not-sold" | null;
  voucherNote?: string;
}

export const NSO_ROWS: NsoRow[] = [
  { code: "TW", currency: "TWD", prices: { m1: 79, m3: 199, y12: 599, fam12: 1179, exp12: 1279, expFam12: 2399 }, voucher: "not-sold" },
  { code: "JP", currency: "JPY", prices: { m1: 400, m3: 1000, y12: 3000, fam12: 5800, exp12: 5900, expFam12: 9900 }, voucher: 9980 },
  { code: "HK", currency: "HKD", prices: { m1: 25, m3: 65, y12: 155, fam12: 295, exp12: 325, expFam12: 575 }, voucher: 649, voucherNote: "期間限定販售" },
  { code: "KR", currency: "KRW", prices: { m1: 5900, y12: 24900, fam12: 47900, exp12: 49900, expFam12: 84900 } },
  { code: "US", currency: "USD", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 49.99, expFam12: 79.99 }, voucher: 99.98 },
  { code: "CA", currency: "CAD", prices: { m1: 5.99, m3: 11.99, y12: 29.99, fam12: 49.99, exp12: 69.99, expFam12: 109.99 } },
  { code: "MX", currency: "MXN", prices: { m1: 79, y12: 409, fam12: 719, exp12: 1029, expFam12: 1649 } },
  { code: "BR", currency: "BRL", prices: { m1: 21.9, m3: 44.9, y12: 109.9, fam12: 194.9, exp12: 279.9, expFam12: 439.9 } },
  { code: "CL", currency: "CLP", prices: { m1: 3990, fam12: 35990, expFam12: 82990 } },
  { code: "CO", currency: "COP", prices: { fam12: 139900, expFam12: 319900 } },
  { code: "AR", currency: "ARS", prices: { m1: 5999, exp12: 75999 } },
  { code: "PE", currency: "PEN", prices: { m1: 16, fam12: 139, exp12: 199, expFam12: 319 } },
  { code: "GB", currency: "GBP", prices: { m1: 3.49, m3: 6.99, y12: 17.99, fam12: 31.49, exp12: 34.99, expFam12: 59.99 }, voucher: 84 },
  { code: "IE", currency: "EUR", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 39.99, expFam12: 69.99 } },
  { code: "DE", currency: "EUR", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 39.99, expFam12: 69.99 } },
  { code: "FR", currency: "EUR", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 39.99, expFam12: 69.99 } },
  { code: "ES", currency: "EUR", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 39.99, expFam12: 69.99 } },
  { code: "IT", currency: "EUR", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 39.99, expFam12: 69.99 } },
  { code: "NL", currency: "EUR", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 39.99, expFam12: 69.99 } },
  { code: "BE", currency: "EUR", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 39.99, expFam12: 69.99 } },
  { code: "AT", currency: "EUR", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 39.99, expFam12: 69.99 } },
  { code: "CH", currency: "CHF", prices: { m1: 3.9, m3: 7.9, y12: 19.9, fam12: 34.9, exp12: 39.9, expFam12: 69.9 } },
  { code: "PT", currency: "EUR", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 39.99, expFam12: 69.99 } },
  { code: "PL", currency: "PLN", prices: { m1: 16, m3: 32, y12: 80, fam12: 140, exp12: 170, expFam12: 290 } },
  { code: "CZ", currency: "CZK", prices: { m1: 99, m3: 199, y12: 499, fam12: 875, exp12: 999, expFam12: 1749 } },
  { code: "DK", currency: "DKK", prices: { m1: 30, m3: 60, y12: 150, fam12: 262.5, exp12: 299, expFam12: 519 } },
  { code: "FI", currency: "EUR", prices: { m1: 3.99, m3: 7.99, y12: 19.99, fam12: 34.99, exp12: 39.99, expFam12: 69.99 } },
  { code: "SE", currency: "SEK", prices: { m1: 40, m3: 80, y12: 200, fam12: 350, exp12: 429, expFam12: 689 } },
  { code: "NO", currency: "NOK", prices: { m1: 38, m3: 76, y12: 190, fam12: 333, exp12: 399, expFam12: 679 } },
  { code: "AU", currency: "AUD", prices: { m1: 5.95, m3: 11.95, y12: 29.95, fam12: 54.95, exp12: 59.95, expFam12: 109.95 } },
  { code: "NZ", currency: "NZD", prices: { m1: 6.55, m3: 13.15, y12: 32.95, fam12: 60.45, exp12: 69.95, expFam12: 119.95 } },
  { code: "ZA", currency: "ZAR", prices: { m1: 52, m3: 105, y12: 262, fam12: 459, exp12: 629, expFam12: 1129 } },
  { code: "SG", currency: "SGD", prices: { m1: 4.9, m3: 12.9, y12: 34.9, fam12: 64.9, exp12: 69.9, expFam12: 119.9 } },
  { code: "MY", currency: "MYR", prices: { m1: 13, m3: 33, y12: 89, fam12: 169, exp12: 179, expFam12: 319 } },
  { code: "TH", currency: "THB", prices: { m1: 99, m3: 249, y12: 699, fam12: 1299, exp12: 1399, expFam12: 2499 } },
];

/** 當地價 → 約台幣（四捨五入到整數；僅供比較，實際以當地幣別扣款）。
 *  perUsd 預設靜態快照；頁面傳入即時抓到的匯率表。 */
export function nsoTwd(
  price: number,
  currency: string,
  perUsd: Record<string, number> = NSO_FX_PER_USD
): number {
  const rate = perUsd[currency];
  if (!rate) return NaN;
  return Math.round((price / rate) * perUsd.TWD);
}

/** 某品項換算台幣最便宜的國家（只比有價的格子）；兌換券只比已查證的最後販售價。 */
export function nsoCheapest(
  plan: NsoPlanKey | "voucher",
  perUsd: Record<string, number> = NSO_FX_PER_USD
): { code: string; twd: number } | null {
  let best: { code: string; twd: number } | null = null;
  for (const row of NSO_ROWS) {
    const local =
      plan === "voucher"
        ? typeof row.voucher === "number"
          ? row.voucher
          : null
        : row.prices[plan] ?? null;
    if (local == null) continue;
    const twd = nsoTwd(local, row.currency, perUsd);
    if (Number.isNaN(twd)) continue;
    if (!best || twd < best.twd) best = { code: row.code, twd };
  }
  return best;
}

/** 列表排序：一般 12 個月換算台幣由低到高；沒 12 個月價的排後面（再以家庭價排序）。 */
export function nsoSortedRows(
  perUsd: Record<string, number> = NSO_FX_PER_USD
): NsoRow[] {
  const key = (r: NsoRow): number => {
    const y = r.prices.y12;
    if (y != null) return nsoTwd(y, r.currency, perUsd);
    const f = r.prices.fam12;
    if (f != null) return nsoTwd(f, r.currency, perUsd) + 100000;
    return Infinity;
  };
  return [...NSO_ROWS].sort((a, b) => key(a) - key(b));
}
