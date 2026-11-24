import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getComments, overlayMyGameFlags } from "@/lib/data";
import { getCachedGamePublic } from "@/lib/cached-data";
import { fetchRelatedGames } from "@/lib/related-games";
import GameDetailClient from "@/components/GameDetailClient";

export const dynamic = "force-dynamic";

export default async function GameDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const db = createSupabaseServerClient();
  // auth 與快取遊戲沒有依賴關係，平行跑：未登入時 auth 很快回 null，
  // 登入時則省掉一次序列等待（Supabase 免費版單次往返約 0.3–0.4 秒）。
  const [{ data: { user } }, game0] = await Promise.all([
    db.auth.getUser(),
    getCachedGamePublic(params.slug),
  ]);
  const userId = user?.id ?? null;
  if (!game0) notFound();
  // 公開資料走快取；個人狀態（收藏／購買）即時補上。
  // overlay 與留言沒有依賴關係，平行跑；留言仍每次即時查（不進快取），
  // 發了留言要立刻看得到。相關內容同樣即時查（不進 getCachedGamePublic
  // 的 1 小時快取）：表不存在時回空分組、頁面不 500；shawn 跑完
  // migration＋回填後，相關內容立刻出現，不用等快取過期。
  const [[game], comments, related] = await Promise.all([
    userId
      ? overlayMyGameFlags(db, [game0], userId)
      : Promise.resolve([game0]),
    getComments(db, game0.id, userId),
    fetchRelatedGames(db, game0.id),
  ]);

  return (
    <GameDetailClient
      game={game}
      initialComments={comments}
      collectedByMe={game.collected_by_me}
      purchasedByMe={game.purchased_by_me}
      related={related}
    />
  );
}
