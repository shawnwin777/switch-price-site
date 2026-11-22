import "server-only";
import { unstable_cache } from "next/cache";

/**
 * Official Taiwan public catalog (fast, cached discovery layer).
 * This is independent from Supabase and does NOT infer DLC/region matches.
 * It must not be used as evidence that every listed item is currently on sale.
 */
export type TwPublicProduct = {
  nsuid: string;
  title: string;
  publisher: string | null;
  hardwareCategory: string | null;
  imageUrl: string | null;
  releaseDate: string | null;
};

export type TwPublicPrice = {
  salesStatus: string;
  regular: number | null;
  effective: number | null;
  currency: string | null;
  saleEnd: string | null;
};

const BASE = "https://www.nintendo.com/tw/api/software?sftab=all";
const PRICE_BASE = "https://api.ec.nintendo.com/v1/price";
const PAGES_LIMIT = 350;

function safeCover(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "images.ctfassets.net"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function amount(v: unknown): number | null {
  if (v == null) return null;
  const raw = typeof v === "object" && v !== null && "raw_value" in v
    ? (v as { raw_value: unknown }).raw_value : v;
  const num = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(num) && num >= 0 ? num : null;
}

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(16000),
      });
      if (!res.ok) throw new Error("Nintendo API HTTP " + res.status);
      return await res.json();
    } catch (e) {
      lastError = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

type CatalogPage = { total: number; items: Array<Record<string, unknown>> };
function isPage(x: unknown): x is CatalogPage {
  return !!x && typeof x === "object" &&
    Number.isSafeInteger((x as CatalogPage).total) &&
    Array.isArray((x as CatalogPage).items);
}

async function readFullCatalog(): Promise<TwPublicProduct[]> {
  const first = await fetchJson(BASE + "&spage=1");
  if (!isPage(first)) throw new Error("Nintendo Taiwan catalog response changed");
  const totalPages = Math.ceil(first.total / 24);
  if (totalPages < 1 || totalPages > PAGES_LIMIT)
    throw new Error("Unexpected Nintendo Taiwan catalog total");
  const pages: CatalogPage[] = new Array(totalPages);
  pages[0] = first;
  let cursor = 2;
  await Promise.all(Array.from({ length: Math.min(4, totalPages - 1) }, async () => {
    while (cursor <= totalPages) {
      const pageNo = cursor++;
      const data = await fetchJson(BASE + "&spage=" + pageNo);
      if (!isPage(data) || data.total !== first.total)
        throw new Error("Nintendo Taiwan catalog pagination changed");
      pages[pageNo - 1] = data;
    }
  }));
  const byNsuid = new Map<string, TwPublicProduct>();
  const seenPages = new Set<string>();
  let rows = 0;
  for (const page of pages) {
    if (!page || page.items.length === 0 || page.items.length > 24)
      throw new Error("Incomplete Nintendo Taiwan page");
    const sig = page.items.map((i) => String(i.nsuid ?? "")).join(",");
    if (seenPages.has(sig)) throw new Error("Repeated Nintendo Taiwan page");
    seenPages.add(sig);
    rows += page.items.length;
    for (const item of page.items) {
      const nsuid = String(item.nsuid ?? "");
      const title = asStr(item.title);
      if (!/^7\d{13}$/.test(nsuid) || !title) continue;
      const originalCover = item.imageHero && typeof item.imageHero === "object"
        ? (item.imageHero as { url?: unknown }).url : null;
      if (!byNsuid.has(nsuid)) {
        byNsuid.set(nsuid, {
          nsuid, title,
          publisher: asStr(item.publisher),
          hardwareCategory: asStr(item.hardwareCategory),
          imageUrl: safeCover(originalCover),
          releaseDate: asStr(item.releaseDateDownload) ?? asStr(item.releaseDate),
        });
      }
    }
  }
  if (rows !== first.total || byNsuid.size < first.total * .7)
    throw new Error("Incomplete Nintendo Taiwan official catalog");
  return [...byNsuid.values()].sort((a, b) =>
    (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.nsuid.localeCompare(b.nsuid));
}

export const getTwPublicCatalog = unstable_cache(
  readFullCatalog,
  ["tw-official-public-catalog-v1"],
  { revalidate: 60 * 60 * 6 }
);

async function fetchPublicPrices(ids: string[]): Promise<Record<string, TwPublicPrice>> {
  if (!ids.length) return {};
  if (ids.length > 50 || ids.some((id) => !/^7\d{13}$/.test(id)))
    throw new Error("Only up to 50 validated NSUIDs may be priced at once");
  const url = PRICE_BASE + "?country=TW&lang=zh&ids=" + ids.join(",");
  const data = await fetchJson(url);
  const rawPrices = (data as { prices?: unknown }).prices;
  if (!Array.isArray(rawPrices)) throw new Error("Unexpected Taiwan price result");
  const permitted = new Set(ids);
  const prices: Record<string, TwPublicPrice> = {};
  for (const item of rawPrices) {
    const id = String(item?.title_id ?? "");
    if (!permitted.has(id) || prices[id]) continue;
    const regular = amount(item.regular_price);
    const discount = amount(item.discount_price);
    prices[id] = {
      salesStatus: String(item.sales_status ?? "unknown"),
      regular, effective: discount ?? regular,
      currency: asStr(item.discount_price?.currency) ?? asStr(item.regular_price?.currency),
      saleEnd: asStr(item.discount_price?.end_datetime),
    };
  }
  return prices;
}

export const getTwPublicPrices = unstable_cache(
  fetchPublicPrices,
  ["tw-official-public-price-v1"],
  { revalidate: 60 * 10 }
);
