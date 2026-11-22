/**
 * Pure Nintendo TW catalog validation and exact-NSUID backfill planner.
 * This module never fetches data, updates a database, or merges regional listings.
 */
export const NSUID_PATTERN = /^7\d{13}$/;
export const CATALOG_SOURCE = 'https://www.nintendo.com/tw/api/software?sftab=all';

export function officialImageUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.hostname !== 'images.ctfassets.net') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function parseTwOfficialItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nsuid = String(raw.nsuid ?? '');
  const title = String(raw.title ?? '').trim();
  if (!NSUID_PATTERN.test(nsuid) || !title || title.length > 500) return null;
  return {
    nsuid,
    title,
    publisher: typeof raw.publisher === 'string' ? raw.publisher.trim() : null,
    softCode: typeof raw.softCode === 'string' ? raw.softCode.trim() : null,
    hardwareCategory: typeof raw.hardwareCategory === 'string' ? raw.hardwareCategory.trim() : null,
    imageUrl: officialImageUrl(raw.imageHero?.url ?? raw.imageHeroOrg),
  };
}

export function catalogFromPages(pageData, fetchedAt = new Date().toISOString()) {
  if (!Array.isArray(pageData) || !pageData.length) throw new Error('No TW catalog pages');
  const total = pageData[0]?.total;
  if (!Number.isSafeInteger(total) || total < 1) throw new Error('Missing official catalog total');
  const requiredPages = Math.ceil(total / 24);
  if (pageData.length !== requiredPages)
    throw new Error('Incomplete TW catalog pages: ' + pageData.length + '/' + requiredPages);
  const records = {}, conflicts = {}, signatures = new Set();
  let rows = 0, acceptedRows = 0, images = 0;
  for (const [page, response] of pageData.entries()) {
    if (response?.total !== total) throw new Error('Catalog total changed on page ' + (page + 1));
    const items = response?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 24)
      throw new Error('Bad TW page ' + (page + 1));
    const signature = items.map(x => x?.nsuid).join(',');
    if (signatures.has(signature)) throw new Error('Repeated TW catalog page ' + (page + 1));
    signatures.add(signature);
    rows += items.length;
    for (const raw of items) {
      const item = parseTwOfficialItem(raw);
      if (!item) continue;
      acceptedRows++;
      if (item.imageUrl) images++;
      const previous = records[item.nsuid];
      if (!previous) {
        records[item.nsuid] = item;
        continue;
      }
      if (previous.title.normalize('NFKC').trim() !== item.title.normalize('NFKC').trim()
        || (previous.hardwareCategory && item.hardwareCategory && previous.hardwareCategory !== item.hardwareCategory)) {
        if (!conflicts[item.nsuid]) conflicts[item.nsuid] = [previous];
        conflicts[item.nsuid].push(item);
      } else if (!previous.imageUrl && item.imageUrl) {
        records[item.nsuid] = { ...previous, imageUrl: item.imageUrl };
      }
    }
  }
  if (rows !== total) throw new Error('Incomplete TW catalog items: ' + rows + '/' + total);
  if (acceptedRows < Math.floor(total * 0.85))
    throw new Error('Unexpectedly few valid TW entries: ' + acceptedRows + '/' + total);
  return {
    schemaVersion: 1, source: CATALOG_SOURCE, fetchedAt, complete: true,
    officialTotal: total, pages: pageData.length, rows, acceptedRows, imageRows: images,
    distinctNsuids: Object.keys(records).length, conflicts, records,
  };
}

export function planTwExactBackfill(snapshot, catalog) {
  if (!catalog?.complete || catalog.schemaVersion !== 1 || !catalog.records)
    throw new Error('A fully validated TW official catalog index is required');
  if (!snapshot?.games || typeof snapshot.games !== 'object')
    throw new Error('Missing historical scan games');
  const byId = new Map();
  for (const [key, game] of Object.entries(snapshot.games)) {
    const nsuid = String(game?.twTitleId ?? '');
    if (!NSUID_PATTERN.test(nsuid) || game?.twPrice?.sales_status !== 'onsale') continue;
    if (!byId.has(nsuid)) byId.set(nsuid, []);
    byId.get(nsuid).push({ key, game });
  }
  const candidates = [], conflicts = [], classifiedSeparately = [];
  let alreadyNamed = 0, absentFromOfficial = 0, withImage = 0;
  for (const [nsuid, matches] of byId) {
    if (!nsuid.startsWith('7001')) {
      classifiedSeparately.push({ nsuid, keys: matches.map(x => x.key), reason: 'non_base_prefix_review_required' });
      continue;
    }
    const record = catalog.records[nsuid];
    if (!record) { absentFromOfficial++; continue; }
    if (catalog.conflicts[nsuid]) {
      conflicts.push({
        nsuid, keys: matches.map(x => x.key),
        reason: 'official_title_or_platform_conflict', evidence: catalog.conflicts[nsuid],
      });
      continue;
    }
    // Never automatically overwrite existing game names.
    const named = matches.some(x => Boolean(x.game.titleZh || x.game.titleEn));
    if (named) { alreadyNamed++; continue; }
    candidates.push({
      nsuid, existingKeys: matches.map(x => x.key), proposedTitleZh: record.title,
      officialImageUrl: record.imageUrl, publisher: record.publisher,
      hardwareCategory: record.hardwareCategory,
      source: CATALOG_SOURCE, status: 'exact_nsuid_pending_review',
    });
    if (record.imageUrl) withImage++;
  }
  return {
    generatedAt: new Date().toISOString(),
    snapshotAt: snapshot.generated_at ?? null, officialFetchedAt: catalog.fetchedAt,
    officialSource: catalog.source, complete: true, mode: 'READ_ONLY_NO_SUPABASE',
    summary: {
      twPricedDistinctNsuids: byId.size,
      exactNsuidUnnamedNameCandidates: candidates.length,
      exactNsuidNameAndImageCandidates: withImage,
      alreadyNamed, absentFromOfficial, classifiedSeparately: classifiedSeparately.length,
      officialConflicts: conflicts.length,
    },
    note: 'Only TW onsale NSUID and same ID official metadata. Candidate is NOT yet an approved write or a confirmed cross-region product match. No DLC / upgrade classification from prefix alone.',
    candidates, conflicts, nonBasePrefixSamples: classifiedSeparately.slice(0, 25),
  };
}
