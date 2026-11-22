/**
 * Conservative, pure live-database candidate validator.
 * Never modifies an existing named game, changes the URL slug, creates duplicates,
 * or infers DLC/bundle parent relationships.
 */
import { officialImageUrl, NSUID_PATTERN, CATALOG_SOURCE } from './tw-official-catalog.mjs';
export const PLACEHOLDER = '/covers/placeholder.svg';

export function buildTwBackfillChanges(plan, games, regionIds, maxWrites = 3000, currentPrices = null) {
  if (plan?.mode !== 'READ_ONLY_NO_SUPABASE' || !plan.complete || !Array.isArray(plan.candidates))
    throw new Error('Expected a complete, audited TW exact-NSUID plan');
  if (!Array.isArray(games) || !Array.isArray(regionIds)) throw new Error('Missing live database records');
  if (!Number.isSafeInteger(maxWrites) || maxWrites < 1 || maxWrites > 3000)
    throw new Error('Invalid maxWrites');
  if (currentPrices !== null) {
    const age = Date.now() - Date.parse(currentPrices.generatedAt);
    if (!currentPrices.complete || currentPrices.scope !== 'full_official_catalog' ||
        !Number.isFinite(age) || age < 0 || age > 36 * 3600_000)
      throw new Error('Fresh complete official TW price report is required');
  }
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
    if (!why && currentPrices !== null &&
        currentPrices.prices?.[nsuid]?.sales_status !== 'onsale') why='not_currently_onsale';
    const refIds = byNsuid.get(nsuid);
    if (!why && (!refIds || refIds.size !== 1)) why='missing_or_ambiguous_tw_region_id';
    const game = !why ? byGame.get([...refIds][0]) : null;
    if (!why && !game) why='game_not_found';
    if (!why && (game.is_unnamed !== true || game.product_type !== 'game')) why='named_or_non_game';
    // Even a mistaken is_unnamed flag must not cause a human-entered title to be replaced.
    const currentZh=String(game?.title_zh??'').trim();
    if (!why && currentZh && ![
      '未命名商品 '+nsuid, '未命名遊戲 '+nsuid,
      '未知商品 '+nsuid, '未命名商品', '未知商品',
    ].includes(currentZh)) why='existing_nonplaceholder_title';
    if (!why && entry.source !== CATALOG_SOURCE) why='non_official_evidence';
    if (!why && !['tw-'+nsuid,'hk-'+nsuid].includes(game.slug)) why='unexpected_existing_slug';
    const url=officialImageUrl(entry.officialImageUrl);
    if (!why && entry.officialImageUrl && !url) why='untrusted_image_url';
    const existingCover=game?.cover_url;
    if (!why && existingCover && existingCover !== PLACEHOLDER &&
        typeof existingCover !== 'string') why='invalid_existing_cover';
    if (why) {skipped.push({nsuid,reason:why}); continue;}
    const patch={title_zh:entry.proposedTitleZh.trim(),is_unnamed:false};
    // Existing unnamed games have non-null placeholder English titles. Do not display
    // "Unknown game" as English after the official TW name is installed.
    const english=String(game.title_en??'').trim();
    if (english === nsuid || !english || /^(?:未命名|未知商品|unknown|unnamed|untitled)/i.test(english))
      patch.title_en=null;
    if ((!existingCover || existingCover===PLACEHOLDER) && url)patch.cover_url=url;
    changes.push({
      nsuid,gameId:game.id,slug:game.slug,source:entry.source,
      before:{title_zh:game.title_zh??null,title_en:game.title_en??null,is_unnamed:true,cover_url:existingCover??null},
      patch,
    });
  }
  if (changes.length>maxWrites)
    throw new Error('Write cap exceeded: '+changes.length+' > '+maxWrites);
  return {changes,skipped};
}


/**
 * Rebuild a proposal from the ACTUAL live Supabase TW region IDs.
 * The committed 2026-11-16 historical price snapshot is NOT used: new placeholders
 * become eligible as the original weekly scanner discovers them.
 */
export function planLiveTwBackfill(index, currentPrices, games, regionIds) {
  if (!index?.complete || index.schemaVersion!==1 || index.source!==CATALOG_SOURCE || !index.records)
    throw new Error('A complete and validated official TW index is required');
  const indexAge=Date.now()-Date.parse(index.fetchedAt);
  const pricesAge=Date.now()-Date.parse(currentPrices?.generatedAt);
  if (!Number.isFinite(indexAge) || indexAge<0 || indexAge>48*3600_000 ||
      !currentPrices?.complete || currentPrices.scope!=='full_official_catalog' ||
      !Number.isFinite(pricesAge) || pricesAge<0 || pricesAge>36*3600_000)
    throw new Error('Fresh complete catalog and price reports are required');
  if(!Array.isArray(games)||!Array.isArray(regionIds))throw new Error('Live DB snapshots required');
  const ids=new Map();
  for(const r of regionIds){
    if(r.country!=='TW')continue;
    const nsuid=String(r.title_id??'');
    if(!NSUID_PATTERN.test(nsuid)||!nsuid.startsWith('7001'))continue;
    if(!ids.has(nsuid))ids.set(nsuid,new Set());
    ids.get(nsuid).add(String(r.game_id));
  }
  const byGame=new Map(games.map(g=>[String(g.id),g]));
  const candidates=[];
  let ambiguous=0,notOnSale=0,alreadyNamed=0,notOfficial=0;
  for(const [nsuid,refIds] of ids){
    if(refIds.size!==1){ambiguous++;continue;}
    const game=byGame.get([...refIds][0]);
    if(!game)continue;
    if(game.is_unnamed!==true){alreadyNamed++;continue;}
    const item=index.records[nsuid];
    if(!item || index.conflicts?.[nsuid]){notOfficial++;continue;}
    if(currentPrices.prices?.[nsuid]?.sales_status!=='onsale'){notOnSale++;continue;}
    candidates.push({
      nsuid,existingKeys:[game.slug],proposedTitleZh:item.title,
      officialImageUrl:item.imageUrl,publisher:item.publisher,
      hardwareCategory:item.hardwareCategory,source:CATALOG_SOURCE,
      status:'exact_nsuid_pending_review',
    });
  }
  return {
    generatedAt:new Date().toISOString(),mode:'READ_ONLY_NO_SUPABASE',complete:true,
    source:'live_tw_region_ids',officialFetchedAt:index.fetchedAt,
    summary:{eligibleFromLiveCandidates:candidates.length,ambiguous,notOnSale,alreadyNamed,notOfficial},
    candidates,
  };
}
