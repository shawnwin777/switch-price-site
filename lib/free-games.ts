import fs from "fs";
import path from "path";

import type { DealsCarouselItem, DealsCarouselSource } from "./deals-carousel";
import { formatTaipeiDate } from "./format";

/** 免費 PC 遊戲清單（/deals 免費遊戲分頁用）。
 *  單一來源：data/free-games.json，由免費資源自動抓
 *  （artifact mian-fei-zi-yuan-zi-dong-zhua）的 getboard 輸出產生，
 *  每日由同步 cron 重新產生並推上線。不要手動編輯 JSON。
 *  來源：Epic 官方、GOG 官方、GamerPower 聚合（Steam、IndieGala、
 *  itch.io 等）。只留 PC 完整遊戲，DLC、手遊、主機、VR 已濾掉。
 *  讀不到／解析失敗時回空陣列（免費遊戲區顯示空狀態），不讓
 *  整個 /deals 頁面壞掉。 */

interface FreeGameRaw {
  id: number | string;
  title: string;
  imageUrl?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  claimUrl?: string | null;
  platforms?: string | null;
  worth?: string | null;
  endsAt?: string | null;
  startsAt?: string | null;
  kind?: string | null;
}

interface FreeGamesJson {
  fetchedAt?: string;
  games?: FreeGameRaw[];
  upcoming?: FreeGameRaw[];
}

function mapSource(raw: string | null | undefined): DealsCarouselSource {
  if (raw === "epic") return "epic";
  if (raw === "gog") return "gog";
  return "gamerpower";
}

function toItem(raw: FreeGameRaw, upcoming: boolean): DealsCarouselItem | null {
  if (typeof raw.title !== "string" || !raw.title) return null;
  const image =
    typeof raw.imageUrl === "string" && raw.imageUrl ? raw.imageUrl : "";
  if (!image) return null;
  const url =
    (typeof raw.claimUrl === "string" && raw.claimUrl) ||
    (typeof raw.sourceUrl === "string" && raw.sourceUrl) ||
    "";
  if (!url) return null;
  const source = mapSource(raw.source);
  const worth =
    typeof raw.worth === "string" && raw.worth ? raw.worth : null;
  if (!upcoming) {
    // 進行中：依截止日近→遠；無截止日（或截止日已過，GamerPower 的
    // endsAt 有時是舊值）不顯示截止日、排最後。
    const endMs =
      typeof raw.endsAt === "string" && raw.endsAt
        ? Date.parse(raw.endsAt)
        : NaN;
    const hasFutureEnd = Number.isFinite(endMs) && endMs > Date.now();
    const end = hasFutureEnd ? formatTaipeiDate(raw.endsAt) : null;
    return {
      badge: "免費",
      image,
      key: `free-${source}-${raw.id}`,
      priceLine: worth ?? "免費領取",
      sortKey: hasFutureEnd ? endMs : Number.MAX_SAFE_INTEGER,
      source,
      subLine: end && end !== "—" ? `免費領取至 ${end}` : null,
      title: raw.title,
      url,
    };
  }
  const startMs =
    typeof raw.startsAt === "string" && raw.startsAt
      ? Date.parse(raw.startsAt)
      : NaN;
  const start = Number.isFinite(startMs) ? formatTaipeiDate(raw.startsAt) : null;
  return {
    badge: "即將免費",
    image,
    key: `free-${source}-${raw.id}`,
    priceLine: worth ?? "即將免費",
    sortKey: Number.isFinite(startMs) ? startMs : 0,
    source,
    subLine: start && start !== "—" ? `${start} 起免費` : null,
    title: raw.title,
    url,
  };
}

export interface FreeGamesData {
  current: DealsCarouselItem[];
  upcoming: DealsCarouselItem[];
  fetchedAt: string;
}

export function getFreeGames(): FreeGamesData {
  const empty: FreeGamesData = { current: [], upcoming: [], fetchedAt: "" };
  try {
    const filePath = path.join(process.cwd(), "data", "free-games.json");
    const parsed = JSON.parse(
      fs.readFileSync(filePath, "utf-8")
    ) as FreeGamesJson;
    const current = (parsed.games ?? [])
      .map((g) => toItem(g, false))
      .filter((it): it is DealsCarouselItem => it !== null)
      .sort((a, b) => a.sortKey - b.sortKey);
    const upcoming = (parsed.upcoming ?? [])
      .map((g) => toItem(g, true))
      .filter((it): it is DealsCarouselItem => it !== null)
      .sort((a, b) => a.sortKey - b.sortKey);
    return {
      current,
      upcoming,
      fetchedAt:
        typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : "",
    };
  } catch (e) {
    console.warn("[free-games] 讀取 data/free-games.json 失敗：", e);
    return empty;
  }
}
