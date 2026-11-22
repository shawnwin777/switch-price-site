/**
 * Conservative, pure live-database candidate validator.
 * Never modifies an existing named game, changes the URL slug, creates duplicates,
 * or infers DLC/bundle parent relationships.
 */
import { officialImageUrl, NSUID_PATTERN } from './tw-official-catalog.mjs';
export const PLACEHOLDER = '/covers/placeholder.svg';

export function buildTwBackfillChanges(plan, games, regionIds, maxWrites = 3000) {
  if (plan?.mode !== 'READ_ONLY_NO_SUPABASE' || !plan.complete || !Array.isArray(plan.candidates))
    throw new Error('Expected a complete, audited TW exact-NSUID plan');
  if (!Array.isArray(games) || !Array.isArray(regionIds)) throw new Error('Missing live database records');
  if (!Number.isSafeInteger(maxWrites) || maxWrites < 1 || maxWrites > 3000)
    throw new Error('Invalid maxWrites');
  const byGame = new Map(games.map(g => [g.id, g]));
  const byNsuid = new Map();
  for (const r of regionIds) {
    if (r.country !== 'TW') continue;
    const nsuid = String(r.title_id || '');
    if (!NSUID_PATTERN.test(nsuid)) continue;
    if (!byNsuid.has(nsuid)) byNsuid.set(nsuid, new Set());
    byNsuid.get(nsuid).add(String(r.game_id));
  }
  const changes = [], skipped = [], seen = new Set();
  for (const entry of [...plan.candidates].sort((a,b)=>a.nsuid.localeCompare(b.nsuid))) {
    const nsuid=String(entry.nsuid||'');
    let why=null;
    if (!NSUID_PATTERN.test(nsuid) || !nsuid.startsWith('7001') ||
        entry.status !== 'exact_nsuid_pending_review' ||
        typeof entry.proposedTitleZh !== 'string' || !entry.proposedTitleZh.trim()) why='invalid_evidence';
    else if (seen.has(nsuid)) why='duplicate_candidate';
    seen.add(nsuid);
    const refIds = byNsuid.get(nsuid);
    if (!why && (!refIds || refIds.size !== 1)) why='missing_or_ambiguous_tw_region_id';
    const game = !why ? byGame.get([...refIds][0]) : null;
    if (!why && !game) why='game_not_found';
    if (!why && (game.is_unnamed !== true || game.product_type !== 'game')) why='named_or_non_game';
    if (!why && !['tw-'+nsuid,'hk-'+nsuid].includes(game.slug)) why='unexpected_existing_slug';
    const url=officialImageUrl(entry.officialImageUrl);
    if (!why && entry.officialImageUrl && !url) why='untrusted_image_url';
    const existingCover=game?.cover_url;
    if (!why && existingCover && existingCover !== PLACEHOLDER &&
        typeof existingCover !== 'string') why='invalid_existing_cover';
    if (why) {skipped.push({nsuid,reason:why}); continue;}
    const patch={title_zh:entry.proposedTitleZh.trim(),is_unnamed:false};
    if ((!existingCover || existingCover===PLACEHOLDER) && url)patch.cover_url=url;
    changes.push({
      nsuid,gameId:game.id,slug:game.slug,source:entry.source,
      before:{title_zh:game.title_zh??null,is_unnamed:true,cover_url:existingCover??null},
      patch,
    });
  }
  if (changes.length>maxWrites)
    throw new Error('Write cap exceeded: '+changes.length+' > '+maxWrites);
  return {changes,skipped};
}
