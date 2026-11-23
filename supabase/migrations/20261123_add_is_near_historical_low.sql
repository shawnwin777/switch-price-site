-- ============================================================================
-- games_with_price_stats 加 is_near_historical_low 與 near_low_ratio：
-- 每款遊戲「目前最低價是不是接近歷史低價」（比值 1 < 最低價／歷史低價
-- <= 1.1）。near_low_ratio 是比值本身（排序＋「比歷史低貴 X%」顯示用）。
-- 檔案：supabase/migrations/20261123_add_is_near_historical_low.sql
-- 用途：接近歷史低價頁（/near-low）——原本 lib/data.ts 的
--   fetchNearLowCandidates 把 games_with_price_stats 用 1000 列分頁
--   全掃 13 頁（12,102 列）在程式裡算比值，Vercel 60 秒上限內常跑
--   不完（2026-11-23 實測頁面 34.3 秒後回「資料準備中」），出錯的
--   結果還會被快取 1 小時。PostgREST 不能直接比較兩個欄位
--   （cheapest_twd／historical_low_twd 寫不進查詢），所以把比較結果
--   先算成 view 欄位，頁面用 .eq("is_near_historical_low", true) 做
--   DB 層單一查詢＋分頁（跟 /historical-low 的 is_at_historical_low
--   同一套做法，見 20261123_add_is_at_historical_low.sql）。
--   2026-11-23 實測：比值落在 (1, 1.1] 的具名遊戲約 3,456 款。
-- 套用方式：Supabase Dashboard → SQL Editor 貼上整個檔案執行；
--           可重複執行（DROP VIEW IF EXISTS + CREATE VIEW）。
-- 部署順序：程式碼可先部署——欄位還沒建時，/near-low 自動改走舊的
--   全掃描備援（慢、偶爾超時，但頁面不會壞掉）；套用此 migration 後
--   切回精確的單一查詢。歷史低價 = 0／NULL、或尚無價格的遊戲不列入。
-- 注意：不能用 CREATE OR REPLACE VIEW（見 20261118_add_release_date.sql
--   的 42P16 教訓），所以先 DROP 再 CREATE。檢視定義需與目前線上
--   的版本一致（g.*、cheapest_twd、max_discount_pct、has_sale、
--   min_sale_end、price_country_list、cheapest_country、
--   is_at_historical_low），只多加 is_near_historical_low 與
--   near_low_ratio。比值用 ::numeric 轉型，避免兩個整數相除被截斷。
-- ============================================================================

drop view if exists public.games_with_price_stats;

create view public.games_with_price_stats
with (security_invoker = true) as
select
  g.*,
  (select min(p.price_twd)
     from public.prices p
    where p.game_id = g.id) as cheapest_twd,
  (select max(p.discount_pct)
     from public.prices p
    where p.game_id = g.id) as max_discount_pct,
  exists (select 1
            from public.prices p
           where p.game_id = g.id
             and p.discount_pct > 0) as has_sale,
  (select min(p.sale_end)
     from public.prices p
    where p.game_id = g.id
      and p.discount_pct > 0
      and p.sale_end >= now()) as min_sale_end,
  (select coalesce(array_agg(distinct p.country), '{}'::text[])
     from public.prices p
    where p.game_id = g.id) as price_country_list,
  (select p.country
     from public.prices p
    where p.game_id = g.id
      and p.price_twd is not null
    order by p.price_twd asc, p.country asc
    limit 1) as cheapest_country,
  -- 目前最低價 = 歷史低價（比值正好 = 1）。任一邊 NULL 時為 false，
  -- 這樣 .eq("is_at_historical_low", true) 只會抓到真正符合的列。
  (case
     when g.historical_low_twd is not null
       and (select min(p.price_twd)
              from public.prices p
             where p.game_id = g.id) = g.historical_low_twd
     then true
     else false
   end) as is_at_historical_low,
  -- 目前最低價接近歷史低價：比值 1 < 最低價／歷史低價 <= 1.1。
  -- 歷史低價為 0／NULL、或尚無價格時為 false。
  (case
     when g.historical_low_twd is not null
       and g.historical_low_twd > 0
       and (select min(p.price_twd)
              from public.prices p
             where p.game_id = g.id) is not null
       and (select min(p.price_twd)
              from public.prices p
             where p.game_id = g.id) > g.historical_low_twd
       and (select min(p.price_twd)
              from public.prices p
             where p.game_id = g.id)::numeric <= g.historical_low_twd * 1.1
     then true
     else false
   end) as is_near_historical_low,
  -- 比值本身（最低價 ÷ 歷史低價）：排序與「比歷史低貴 X%」顯示用。
  -- 歷史低價為 0／NULL、或尚無價格時為 NULL。
  (case
     when g.historical_low_twd is not null
       and g.historical_low_twd > 0
       and (select min(p.price_twd)
              from public.prices p
             where p.game_id = g.id) is not null
     then (select min(p.price_twd)
             from public.prices p
            where p.game_id = g.id)::numeric / g.historical_low_twd
     else null
   end) as near_low_ratio
from public.games g;
