import type { DealsCarouselItem } from "./deals-carousel";
import { fetchUsdToTwd, formatTwd, usdToTwd } from "./fx";

/** Fanatical 特價（/deals FANATICAL 分頁用），伺服器端抓取（不需金鑰）。
 *  來源：Fanatical 官方 MCP 伺服器 https://mcp.fanatical.com/mcp
 *  （Streamable HTTP，不需認證；Fanatical 是官方授權序號商，賣
 *  Steam／Epic／GOG 序號）。工具 search_products：region "US"
 *  （美元計價，跟 EA／Ubisoft 一致）、min_discount 1（只取特價中）、
 *  sort "discount"（折扣大→小）、limit 100（單次上限）。
 *  回傳：region／currency／results[]，每筆有 slug、name、type、
 *  image（1280x720 官方圖，cdn-ext.fanatical.com，可直接引用）、
 *  url（官方商品連結，含追蹤參數、照原樣用）、price、full_price、
 *  discount_percent、valid_until（Unix 秒，特價截止時間）。
 *  2026-11-26 實測：100 款、折扣 93–96%（黑五期間）。
 *  免費／特價分流（2026-11-26）：折扣 100% 或特價 $0 的品項是免費領取，
 *  不進 FANATICAL 特價分頁，改進免費遊戲區（badge「免費」、
 *  priceLine「免費（原價 $X.XX）」、freeKinds ["pc"]）；折扣 <100%
 *  才進 FANATICAL 特價分頁。免費品項另外用 min_discount 100 單獨抓一次
 *  再合併（免費品項折扣最高、理應排在主清單最前面，但獨立抓一次
 *  更保險，不怕主清單被 100 款特價塞滿）。分流在 fetchDealsPage 做
 *  （見 lib/deals-carousel.ts），這裡只負責把免費品項標成免費格式
 *  （freeKinds ["pc"]）。
 *  抓取失敗回空陣列（不讓整個 /deals 頁面壞掉）；呼叫端用
 *  lib/cached-data.ts 的 unstable_cache 包一層（1 小時自動更新，
 *  不用另外開 cron、不用手動同步、不用推 GitHub 更新資料）。 */

const MCP_URL = "https://mcp.fanatical.com/mcp";
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = "shawn-game-studio-deals-page/1.0";
/** 單次取的最大款數（search_products 上限 100）。 */
const LIMIT = 100;

interface McpJsonRpc {
  result?: unknown;
  error?: { message?: string };
}

interface FanaticalProduct {
  slug?: string;
  name?: string;
  type?: string;
  image?: string;
  url?: string;
  price?: number | null;
  full_price?: number | null;
  discount_percent?: number;
  valid_until?: number | null;
}

/** 解析 Streamable HTTP 回應：可能是 SSE（data: {...} 行）或純 JSON。 */
function parseMcpResponse(text: string): McpJsonRpc {
  const msgs: McpJsonRpc[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("data:")) {
      try {
        msgs.push(JSON.parse(t.slice(5).trim()) as McpJsonRpc);
      } catch {
        // 忽略心跳／空行。
      }
    }
  }
  if (msgs.length > 0) return msgs[msgs.length - 1];
  try {
    return JSON.parse(text) as McpJsonRpc;
  } catch {
    throw new Error("Fanatical MCP 回應無法解析");
  }
}

async function mcpPost(
  body: Record<string, unknown>,
  sessionId?: string
): Promise<{ data: McpJsonRpc; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "User-Agent": USER_AGENT,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Fanatical MCP HTTP ${res.status}`);
  const session = res.headers.get("mcp-session-id") ?? sessionId;
  const text = await res.text();
  if (!text.trim()) return { data: {}, sessionId: session };
  return { data: parseMcpResponse(text), sessionId: session };
}

function formatTaipeiDateFromUnix(sec: number | null | undefined): string | null {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return null;
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).format(d);
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** 抓 Fanatical 特價（折扣大→小、前 100 款；失敗回空陣列）。
 *  免費品項（折扣 100%）另外單獨抓一次再合併，確保免費品項
 *  不會被主清單的 100 款特價擠掉。
 *  usdToTwdRate：USD→TWD 匯率（fetchDealsPage 傳入；沒傳就自己抓一次，
 *  見 lib/fx.ts）。priceLine 台幣在前、美元在括號內
 *  （特價：NT$ 320（$9.99，原價 NT$ 1,280／$39.99）；無原價：
 *  NT$ 320（$9.99）；免費：免費（原價 NT$ 1,280／$39.99））。 */
export async function fetchFanaticalDeals(
  usdToTwdRate?: number
): Promise<DealsCarouselItem[]> {
  const rate = usdToTwdRate ?? (await fetchUsdToTwd());
  try {
    // MCP 交握：initialize → notifications/initialized → tools/call。
    const init = await mcpPost({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "shawn-game-studio-deals-page", version: "1.0" },
      },
    });
    if (init.data.error) {
      throw new Error(`Fanatical MCP initialize 失敗：${init.data.error.message ?? ""}`);
    }
    const session = init.sessionId;
    await mcpPost({ jsonrpc: "2.0", method: "notifications/initialized" }, session).catch(
      () => undefined
    );
    // 特價主清單（折扣 ≥1%）＋免費清單（折扣 100%）並行抓，合併去重。
    const search = async (args: Record<string, unknown>) => {
      const call = await mcpPost(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "search_products", arguments: args },
        },
        session
      );
      if (call.data.error) {
        throw new Error(`Fanatical MCP search_products 失敗：${call.data.error.message ?? ""}`);
      }
      const content = (call.data.result as { content?: { text?: string }[] } | undefined)
        ?.content;
      const text = (content ?? []).map((c) => c.text ?? "").join("");
      if (!text) throw new Error("Fanatical MCP search_products 回應為空");
      const data = JSON.parse(text) as {
        currency?: string;
        results?: FanaticalProduct[];
      };
      return Array.isArray(data.results) ? data.results : [];
    };
    const [saleRes, freeRes] = await Promise.allSettled([
      search({ region: "US", limit: LIMIT, min_discount: 1, sort: "discount" }),
      search({ region: "US", limit: LIMIT, min_discount: 100, sort: "discount" }),
    ]);
    const seen = new Set<string>();
    const results: FanaticalProduct[] = [];
    for (const r of [saleRes, freeRes]) {
      if (r.status !== "fulfilled") {
        console.warn("[fanatical-deals] 一路 search_products 失敗：", r.reason);
        continue;
      }
      for (const p of r.value) {
        const slug = typeof p?.slug === "string" ? p.slug : "";
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        results.push(p);
      }
    }
    const items: DealsCarouselItem[] = [];
    for (const r of results) {
      const slug = typeof r?.slug === "string" ? r.slug : "";
      const name = typeof r?.name === "string" ? r.name : "";
      const discount =
        typeof r?.discount_percent === "number" ? r.discount_percent : 0;
      const price = typeof r?.price === "number" ? r.price : null;
      const full = typeof r?.full_price === "number" ? r.full_price : null;
      const image = typeof r?.image === "string" ? r.image : "";
      const url = typeof r?.url === "string" ? r.url : "";
      if (!slug || !name || price == null || !image || !url) continue;
      const end = formatTaipeiDateFromUnix(r?.valid_until);
      // 本體／DLC 分類（Fanatical MCP 官方 type 欄位，2026-11-26 實測值：
      // game／game-bundle＝本體、dlc＝DLC；其他值一律算本體）。
      const kind: "game" | "dlc" =
        r?.type === "dlc" ? "dlc" : "game";
      // 免費：折扣 100% 或特價 $0——標成免費格式（freeKinds ["pc"]），
      // fetchDealsPage 會把它合併進免費遊戲區，不放進 FANATICAL 特價分頁。
      if (discount >= 100 || price === 0) {
        items.push({
          source: "fanatical",
          key: `fanatical-${slug}`,
          title: name,
          image,
          // url 已含追蹤參數，照官方回傳原樣用。
          url,
          badge: "免費",
          priceLine:
            full != null && full > 0
              ? `免費（原價 ${formatTwd(usdToTwd(full, rate))}／${formatUsd(full)}）`
              : "免費領取",
          subLine: end ? `免費領取至 ${end}` : null,
          freeKinds: ["pc"],
          kind,
          // 免費區按截止日近→遠排；無截止日排最後。
          sortKey:
            typeof r?.valid_until === "number" && r.valid_until > 0
              ? r.valid_until * 1000
              : Number.MAX_SAFE_INTEGER,
        });
        continue;
      }
      if (discount <= 0) continue;
      items.push({
        source: "fanatical",
        key: `fanatical-${slug}`,
        title: name,
        image,
        // url 已含追蹤參數，照官方回傳原樣用。
        url,
        badge: `-${discount}%`,
        // Pick-and-mix 組合包的 full_price 是入門價、等於 price，
        // 此時只寫特價、不寫原價（見 /for-ai/tools 說明）。
        priceLine:
          full != null && full > price
            ? `${formatTwd(usdToTwd(price, rate))}（${formatUsd(price)}，原價 ${formatTwd(usdToTwd(full, rate))}／${formatUsd(full)}）`
            : `${formatTwd(usdToTwd(price, rate))}（${formatUsd(price)}）`,
        subLine: end ? `特價至 ${end}` : null,
        kind,
        sortKey: discount,
      });
    }
    items.sort((a, b) => b.sortKey - a.sortKey || a.key.localeCompare(b.key));
    if (items.length === 0) {
      console.warn("[fanatical-deals] MCP 回傳 0 款可用特價");
    }
    return items;
  } catch (e) {
    console.warn("[fanatical-deals] Fanatical 特價抓取失敗：", e);
    return [];
  }
}
