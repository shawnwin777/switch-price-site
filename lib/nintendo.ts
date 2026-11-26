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

/** 價格 API 單一 chunk（≤50 個 ID）最多嘗試次數（1 次 + 2 次重試）。 */
const PRICE_FETCH_MAX_ATTEMPTS = 3;
/** 重試退避基底：500ms、1000ms（再加 ≤200ms 抖動）；429 的 Retry-After 優先但上限 5 秒。 */
const PRICE_RETRY_BASE_MS = 500;
const PRICE_RETRY_AFTER_CAP_MS = 5_000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number, res?: Response): number {
  const header = res?.headers.get("retry-after");
  if (header != null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, PRICE_RETRY_AFTER_CAP_MS);
    }
  }
  return PRICE_RETRY_BASE_MS * 2 ** attempt + Math.random() * 200;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 抓一國的價格。ids 一次最多 50 個（API 限制未公開，50 是實測安全的批量）。
 *  429 / 5xx / 網路逾時會按 chunk 重試（指數退避，最多 3 次嘗試）；
 *  全部失敗才拋錯，由呼叫方記進 errors、不中斷其他國家。 */
/** 並行抓價的併發數。任天堂價格 API 是 I/O 等待為主，但 5 並行會觸發
 *  任天堂的防刷機制（Vercel IP 回 403，HK／TW 兩組皆然）；2 並行＋批次間
 *  隔 200ms 較溫和。舊版循序等（1 並行）則 214 輪直接超過 Vercel 60 秒
 *  上限導致 FUNCTION_INVOCATION_TIMEOUT。2 並行需搭配較小的 pair budget
 *  （見 lib/refresh-slices.ts DEFAULT_PAIR_BUDGET）才塞得進 60 秒。 */
const PRICE_CHUNK_CONCURRENCY = 2;
/** 批次之間的間隔（毫秒），降低對任天堂 API 的請求速率，避免再被 403。 */
const PRICE_BATCH_DELAY_MS = 200;

/** 抓單一 chunk（≤50 個 ID）的價格，含重試（指數退避，最多 3 次嘗試）。 */
async function fetchPriceChunk(
  country: string,
  chunk: string[],
  lang: string
): Promise<NintendoPriceEntry[]> {
  const url = `${PRICE_API}?country=${country}&ids=${chunk.join(",")}&lang=${lang}`;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < PRICE_FETCH_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "shawn-game-studio/1.0 (daily refresh)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        if (isRetryableStatus(res.status) && attempt < PRICE_FETCH_MAX_ATTEMPTS - 1) {
          await sleep(retryDelayMs(attempt, res));
          continue;
        }
        throw new Error(`價格 API HTTP ${res.status}（country=${country}）`);
      }
      const data = await res.json();
      return (data?.prices ?? []) as NintendoPriceEntry[];
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // 可重試：逾時／中斷、429／5xx，以及 fetch 本身的網路錯誤
      // （TypeError 等，不含「價格 API HTTP …」開頭的非重試狀態碼錯誤）。
      const isHttpError = lastError.message.startsWith("價格 API HTTP");
      const retryable =
        lastError.name === "TimeoutError" ||
        lastError.name === "AbortError" ||
        /HTTP (429|5\d\d)/.test(lastError.message) ||
        !isHttpError;
      if (retryable && attempt < PRICE_FETCH_MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("價格 API 未知錯誤");
}

/** 抓一國的價格。ids 一次最多 50 個（API 限制未公開，50 是實測安全的批量）。
 *  429 / 5xx / 網路逾時會按 chunk 重試（指數退避，最多 3 次嘗試）；
 *  全部失敗才拋錯，由呼叫方記進 errors、不中斷其他國家。
 *  chunk 以 PRICE_CHUNK_CONCURRENCY 並行抓（舊版循序等會超過 60 秒上限）。 */
export async function fetchPricesForCountry(
  country: string,
  titleIds: string[]
): Promise<NintendoPriceEntry[]> {
  const lang = langForCountry(country);
  const chunks: string[][] = [];
  for (let i = 0; i < titleIds.length; i += 50) {
    chunks.push(titleIds.slice(i, i + 50));
  }
  const out: NintendoPriceEntry[] = [];
  for (let i = 0; i < chunks.length; i += PRICE_CHUNK_CONCURRENCY) {
    if (i > 0) await sleep(PRICE_BATCH_DELAY_MS);
    const batch = chunks.slice(i, i + PRICE_CHUNK_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((chunk) => fetchPriceChunk(country, chunk, lang))
    );
    for (const entries of batchResults) out.push(...entries);
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
        headers: { "User-Agent": "shawn-game-studio/1.0 (daily refresh)" },
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
