import { COUNTRIES } from "./countries";

// 任天堂官方價格 API 與匯率抓取（每日更新路由共用）。
// 價格 API：https://api.ec.nintendo.com/v1/price?country={country}&ids={titleIds}&lang={lang}
// 匯率 API：ExchangeRate-API 免 key 端點 https://open.er-api.com/v6/latest/USD
//   （備援 https://api.exchangerate-api.com/v4/latest/USD，同一家服務）。

export interface NintendoPriceEntry {
  title_id: number | string;
  sales_status: string;
  regular_price?: { amount: string; currency: string; raw_value: string };
  discount_price?: {
    amount: string;
    currency: string;
    raw_value: string;
    start_datetime?: string;
    end_datetime?: string;
  };
}

/** 價格 API 支援的國家：沿用前端 lib/countries.ts 的 35 國清單。 */
export const PRICE_COUNTRIES = COUNTRIES;

/** 價格 API 的 lang 參數：只對 JP 用 ja、TW/HK 用 zh，其餘用 en。
 *  lang 只影響回傳的顯示文字，不影響金額數字。 */
export function langForCountry(country: string): string {
  if (country === "JP") return "ja";
  if (country === "TW" || country === "HK") return "zh";
  return "en";
}

/** 台北日期（YYYY-MM-DD），以 Asia/Taipei 時區取當天日期。 */
export function taipeiDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 把價格 API 的 raw_value（可能含千分位逗號，如 "7,678"）轉成數字。 */
export function parseRawValue(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

const FETCH_TIMEOUT_MS = 20_000;
const PRICE_API = "https://api.ec.nintendo.com/v1/price";

/** 抓一國的價格。ids 一次最多 50 個（API 限制未公開，50 是實測安全的批量）。 */
export async function fetchPricesForCountry(
  country: string,
  titleIds: string[]
): Promise<NintendoPriceEntry[]> {
  const out: NintendoPriceEntry[] = [];
  const lang = langForCountry(country);
  for (let i = 0; i < titleIds.length; i += 50) {
    const chunk = titleIds.slice(i, i + 50);
    const url = `${PRICE_API}?country=${country}&ids=${chunk.join(",")}&lang=${lang}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "switch-price-site/1.0 (daily refresh)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`價格 API HTTP ${res.status}（country=${country}）`);
    }
    const data = await res.json();
    out.push(...((data?.prices ?? []) as NintendoPriceEntry[]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 匯率：以 USD 為基準抓一次，再換算成「1 單位外幣 = 多少台幣」。
//   twdPerUnit(JPY) = rates.TWD / rates.JPY
// 寫進 fx_rates 的 rate 就是這個數字；TWD 本身 rate = 1。
// ---------------------------------------------------------------------------
export interface FxSnapshot {
  /** currency → 1 單位該幣別等於多少台幣 */
  ratesTwd: Map<string, number>;
  /** 快照來源時間（API 回傳的 time_last_update_utc） */
  asOf: string;
  source: string;
}

const FX_ENDPOINTS = [
  "https://open.er-api.com/v6/latest/USD",
  "https://api.exchangerate-api.com/v4/latest/USD",
];

export async function fetchFxSnapshot(): Promise<FxSnapshot> {
  let lastError: Error | null = null;
  for (const endpoint of FX_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        headers: { "User-Agent": "switch-price-site/1.0 (daily refresh)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rates = data?.rates as Record<string, number> | undefined;
      if (!rates || typeof rates.TWD !== "number" || rates.TWD <= 0) {
        throw new Error("匯率回應缺少 TWD");
      }
      const ratesTwd = new Map<string, number>();
      ratesTwd.set("TWD", 1);
      for (const [currency, perUsd] of Object.entries(rates)) {
        if (typeof perUsd !== "number" || perUsd <= 0) continue;
        ratesTwd.set(currency, rates.TWD / perUsd);
      }
      return {
        ratesTwd,
        asOf:
          data?.time_last_update_utc ??
          data?.date ??
          new Date().toISOString(),
        source: endpoint,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(`匯率抓取失敗（兩個端點都失敗）：${lastError?.message ?? "未知錯誤"}`);
}
