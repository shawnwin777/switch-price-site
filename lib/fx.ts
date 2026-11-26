// ============================================================================
// USD→TWD 匯率（EA／Ubisoft／Fanatical 特價換算台幣用）。
// 來源跟 NSO 同一套：https://open.er-api.com/v6/latest/USD（見
// lib/cached-data.ts 的 getCachedNsoFx；er-api 每天 00:02 UTC 更新一次）。
// 抓不到（斷線、回應異常、缺 TWD）就退回 lib/nso-prices.ts 的靜態快照
// TWD 值（2026-11-23），價格照常換算。
// 注意：這裡不包 unstable_cache——呼叫端（/deals 整頁，deals-page-v18）
// 本身已是每小時快取，fetchDealsPage 每小時最多跑一次、匯率也只抓一次。
// ============================================================================

import { NSO_FX_PER_USD } from "./nso-prices";

const FX_URL = "https://open.er-api.com/v6/latest/USD";

/** 抓即時 USD→TWD 匯率；失敗回靜態快照（不拋錯，呼叫端不用處理）。 */
export async function fetchUsdToTwd(): Promise<number> {
  try {
    const res = await fetch(FX_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "shawn-game-studio-deals-fx/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${FX_URL}`);
    const data = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };
    const twd = data?.rates?.TWD;
    if (
      data.result !== "success" ||
      typeof twd !== "number" ||
      !Number.isFinite(twd) ||
      twd <= 0
    ) {
      throw new Error("er-api 回應異常（缺 TWD）");
    }
    return twd;
  } catch (e) {
    console.warn("[fx] USD→TWD 即時匯率抓取失敗，退回靜態快照：", e);
    return NSO_FX_PER_USD.TWD;
  }
}

/** 美元金額換算台幣（四捨五入到整數 NT$）。 */
export function usdToTwd(usd: number, rate: number): number {
  return Math.round(usd * rate);
}

/** 台幣金額格式化：NT$ 1,280。 */
export function formatTwd(amount: number): string {
  return `NT$ ${Math.round(amount).toLocaleString("zh-Hant-TW")}`;
}
