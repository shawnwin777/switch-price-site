// 資料型別：欄位名稱與 Supabase 資料表合約一致（不要改名）。
// games / prices / fx_rates / collections / game_likes / comments / comment_likes / user_settings

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
  title_id: string | null;
  historical_low_twd: number | null;
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
}

export interface GameWithPrices extends Game {
  prices: Price[];
  likes_count: number;
  collections_count: number;
  liked_by_me: boolean;
  collected_by_me: boolean;
}

export interface RankingEntry {
  game: Game;
  collections_count: number;
  likes_count: number;
  cheapest: Price | null;
  on_sale: boolean;
  sale_end: string | null;
}

export interface CollectedOnSale {
  game: Game;
  cheapest_sale: Price | null;
}
