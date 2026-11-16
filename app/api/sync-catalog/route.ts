import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { runCatalogSync } from "@/lib/catalog-sync";

// 全自動目錄同步：GET /api/sync-catalog（Vercel Cron 用 GET）或 POST。
// 由 vercel.json 的 4 支 cron 每天打 4 次（UTC 18、19、21、22，
// 即台北 02、03、05、06），每次推進一個分頁窗口（見 lib/catalog-sync.ts
// 的 sync_state 游標）；4 支加起來約 1 天跑完一輪完整目錄
// （JP 約 300 頁是瓶頸，見 DATA_NOTES.md §12.4）。
// 新遊戲進目錄當天就有即時價（商店前端價＋價格 API），不用等價格輪轉。
//
// 驗證：與 /api/refresh 相同，必須帶 Authorization: Bearer $CRON_SECRET，
// 不符回 401；沒設定 CRON_SECRET 回 500。
//
// 流程（見 lib/catalog-sync.ts 與 DATA_NOTES.md §12）：
//   1. 抓各區官方清單（完整來源並行：JP 搜尋 API、NA Algolia、EU Solr、
//      AU Algolia、台港清單、韓國清單；單一來源失敗只記、不中斷）；
//   2. 分頁讀出現有 games＋game_region_ids，比對（分區 NSUID diff 為主力、
//      標題正規化唯一命中為輔；跨區編號碰撞列 needs_review）；
//   3. 冪等寫入：新遊戲 upsert（by slug）、title_id／封面只在為空時回填、
//      對照編號 upsert（by game_id,country）；重跑同一窗口 = 0 寫入；
//   4. 新遊戲即時查價：商店前端價（JP／NA，已驗證）先寫入，價格 API
//      查到同一國價時覆蓋（價格 API 為準）；EU Solr 參考價只做交叉驗證、
//      永不寫入（上限 100 款／次；完整 35 國價仍走 /api/refresh 輪轉）。
//
// 參數：
//   ?sources=jp-search,tw-list   只跑指定來源（預設全部 active 來源）
//   ?pages=20                    分頁來源每支本次最多抓幾頁（預設各來源 PAGE_CAP）
//   ?dry_run=1                   只比對、不寫庫（驗證與試算用）
//   ?skip_prices=1               不同步查新遊戲價格（只寫目錄）
//
// 限制：export const maxDuration = 60（Vercel Hobby 上限）。
// 平日預估 12–24 秒（見 SETUP.md §8.10 的預算表）；全程 50 秒軟預算，
// 超過就跳過價格階段（目錄已寫入，價格下次輪轉補）。
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function handleSyncCatalog(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "伺服器未設定 CRON_SECRET" },
      { status: 500 }
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  if (!token || !timingSafeCompare(token, cronSecret)) {
    return NextResponse.json({ ok: false, error: "未授權" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const sourcesParam = params.get("sources");
  const sources = sourcesParam
    ? sourcesParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  if (sources && sources.length === 0) {
    return NextResponse.json(
      { ok: false, error: "sources 參數沒有指定任何來源" },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  try {
    const pagesParam = params.get("pages");
    const pages = pagesParam ? Number(pagesParam) : undefined;
    if (pagesParam && (!Number.isInteger(pages) || (pages as number) < 1)) {
      return NextResponse.json(
        { ok: false, error: "pages 參數需為 ≥ 1 的整數（例如 ?pages=20）" },
        { status: 400 }
      );
    }
    const summary = await runCatalogSync(admin, {
      sources,
      pages,
      dryRun: params.get("dry_run") === "1",
      skipPrices: params.get("skip_prices") === "1",
    });
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `目錄同步失敗：${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleSyncCatalog(request);
}

export async function POST(request: NextRequest) {
  return handleSyncCatalog(request);
}
