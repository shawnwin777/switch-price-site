import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getComments, getGameBySlug } from "@/lib/data";
import GameDetailClient from "@/components/GameDetailClient";

export const dynamic = "force-dynamic";

export default async function GameDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const db = createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const game = await getGameBySlug(db, params.slug, user?.id ?? null);
  if (!game) notFound();

  const comments = await getComments(db, game.id, user?.id ?? null);

  return (
    <GameDetailClient
      game={game}
      initialComments={comments}
      collectedByMe={game.collected_by_me}
      purchasedByMe={game.purchased_by_me}
    />
  );
}
