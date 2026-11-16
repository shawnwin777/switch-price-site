import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getGamesWithPrices, getLatestFx, latestPriceUpdate } from "@/lib/data";
import { formatTaipei } from "@/lib/format";
import HomeClient from "@/components/HomeClient";

// 資料頁面用 force-dynamic：建置時不呼叫 Supabase，
// Supabase 專案不存在時也能 npm run build 通過。
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const db = createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const [games, fx] = await Promise.all([
    getGamesWithPrices(db, user?.id ?? null),
    getLatestFx(db),
  ]);
  const allPrices = games.flatMap((g) => g.prices);
  const lastUpdate = latestPriceUpdate(allPrices);

  return (
    <>
      <h1 className="page-title">
        <b>Switch</b> 遊戲<span>比價</span>
      </h1>
      <p className="muted">
        跨區比價 35 國 eShop，找出最便宜的買法。點封面進詳細頁看完整價格表與玩家留言。
      </p>
      <div className="status-bar">
        💱 匯率以 <b>當天 08:00 台北時間</b> 為準
        {fx.asOf ? (
          <>
            （本次快照：{formatTaipei(fx.asOf)}
            {fx.dateKey ? `，日期 ${fx.dateKey}` : ""}）
          </>
        ) : (
          "（尚無匯率資料）"
        )}
        {" ｜ "}💰 遊戲價格最後更新：
        <b>{lastUpdate ? formatTaipei(lastUpdate) : "尚無資料"}</b>
        {games.length === 0 && (
          <>
            {" ｜ "}
            目前尚無遊戲資料（Supabase 尚未匯入種子資料或專案未建立）。
          </>
        )}
      </div>
      <HomeClient games={games} loggedInUserId={user?.id ?? null} />
    </>
  );
}
