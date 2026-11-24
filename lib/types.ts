// 資料型別：欄位名稱與 Supabase 資料表合約一致（不要改名）。
// games / prices / fx_rates / collections / game_likes / comments / comment_likes / user_settings / user_purchases

export interface Game {
  id: string;
  slug: string;
  title_zh: string;
  title_en: string | null;
  genre: string | null;
  publisher: string | null;
  platform: string | null; // "Switch" | "Switch 2"
  product_type: string | null; // "game" | "dlc" | "bundle" ...
  has_demo: number | null; // 0 無試玩 / 1 免費 Demo / 2 免費試玩 / 3 NSO 限時試玩（見 FRONTEND_NOTES）
  cover_url: string | null;
  youtube_id: string | null;
  /** 詳情頁畫廊用截圖（IGDB t_screenshot_big，最多 6 張；NULL = 尚未回填
   *  或無截圖；見 migration 20261124_add_game_screenshots.sql）。 */
  screenshots?: string[] | null;
  title_id: string | null;
  historical_low_twd: number | null;
  /** 上市日期（date，如 2025-05-01；NULL = 尚未補到，見 migration 20261118_add_release_date.sql）。 */
  release_date?: string | null;
  /** 未具名商品（只有編號＋價格、尚未找到標題；true 時不出現在首頁遊戲牆／搜尋結果與接近歷史低價，見 migration 20261118_unnamed_games.sql）。 */
  is_unnamed?: boolean | null;
  is_manual: boolean | null;
  created_by: string | null;
  created_at: string | null;
}

export interface Price {
  id: string;
  game_id: string;
  country: string; // ISO 國家碼，如 JP / TW / US
  country_name: string | null;
  currency: string | null;
  regular_raw: number | null;
  effective_raw: number | null;
  discount_pct: number | null;
  discount_raw: number | null;
  sale_end: string | null; // ISO 時間
  price_twd: number | null;
  is_historical_low: boolean | null;
  /** 價格是否已確認：新匯入的外國價格在探針驗證通過前為 false；
   *  既有價格與官方來源一律 true（見 price-verified-migration-20261124.sql）。
   *  欄位未建（migration 未跑）時 select("*") 不會回傳它，undefined
   *  視為已確認，見 lib/data.ts isVerifiedPrice。 */
  verified?: boolean | null;
  updated_at: string | null;
}

export interface FxRate {
  id: string;
  date_key: string; // YYYY-MM-DD（台北日期）
  currency: string;
  rate: number;
  as_of: string | null; // ISO 時間，快照時間（當天 08:00 台北時間）
}

export interface CommentItem {
  id: string;
  game_id: string;
  user_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string | null;
  likes_count: number;
  liked_by_me: boolean;
  // 一層回覆：指向上層留言的 id；上層留言為 null。
  parent_comment_id: string | null;
}

export interface GameWithPrices extends Game {
  prices: Price[];
  likes_count: number;
  collections_count: number;
  liked_by_me: boolean;
  collected_by_me: boolean;
  purchased_by_me: boolean;
}

export interface RankingEntry {
  game: Game;
  collections_count: number;
  likes_count: number;
  cheapest: Price | null;
  on_sale: boolean;
  sale_end: string | null;
}

/** game_relations 關聯類型（見 migration 20261124_add_game_relations.sql）。
 *  方向約定：dlc／language_pack／upgrade_pass／bundle 皆為
 *  game_id＝子項（DLC／組合包）、related_game_id＝本體；
 *  edition 雙向各寫一列。 */
export type RelationType =
  | "dlc"
  | "language_pack"
  | "upgrade_pass"
  | "bundle"
  | "edition";

/** 詳情頁「相關內容」區的一張卡片：相關遊戲＋最低價（台幣）。
 *  cheapest_twd 為 null＝尚無價格；0＝免費（顯示 NT$ 0）。 */
export interface RelatedGameItem {
  id: string;
  slug: string;
  title_zh: string;
  title_en: string | null;
  cover_url: string | null;
  platform: string | null;
  product_type: string | null;
  relation_type: RelationType;
  cheapest_twd: number | null;
}

/** 詳情頁「相關內容」分組：parent＝當前遊戲所屬的本體
 *  （只在當前遊戲本身是 DLC／組合包時出現）；其餘四組是本體的
 *  子項；edition＝同名另一代主程式（雙向）。 */
export interface RelatedGameGroups {
  parent: RelatedGameItem[];
  dlc: RelatedGameItem[];
  language_pack: RelatedGameItem[];
  upgrade_pass: RelatedGameItem[];
  bundle: RelatedGameItem[];
  edition: RelatedGameItem[];
}

export interface CollectedOnSale {
  game: Game;
  cheapest_sale: Price | null;
}
