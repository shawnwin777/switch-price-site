-- ============================================================================
-- 可見國家「特價優先」排序用 RPC：games_page_deals_order
-- 檔案：supabase/migrations/20261126_visible_sale_sort.sql
-- 用途：首頁預設排序「特價優先：即將結束」——PostgREST 無法對子表
--   （prices）的聚合排序，舊做法只能排 games_with_price_stats 檢視的
--   全域統計（has_sale、min_sale_end、cheapest_twd，全部 35 國），所以
--   篩到剩台港時，一款只在日本特價的遊戲會因日本的結束時間早而衝到
--   最前面。排序用的可見國家統計改由這個函式算。
--   規則（shawn 2026-11-26 決定）：時間先、價格後——先比特價結束時間
--   （最近的先），時間一樣再比最低價；可見國家 = 呼叫端傳入的國家清單，
--   全部 35 國都可見時（p_countries 為 NULL／空陣列）就是全部國家，
--   跟舊的全域排序一致。
--   可見國家統計（每款遊戲）：
--     vis_has_sale：存在可見國家價格：verified IS NOT FALSE、
--       discount_pct > 0、sale_end 為 NULL 或 >= now()（跟前端
--       isPriceOnSale 同一套定義；舊 view 的 has_sale 不看過期日，
--       只有過期特價的遊戲在新排序會被當成沒特價，比較符合卡片顯示）。
--     vis_min_sale_end：符合上述特價條件且 sale_end >= now() 的可見價格
--       中最小的 sale_end（NULL = 沒特價、或只有長期特價）。
--     vis_cheapest_twd：可見價格中最小的 price_twd（只算已確認價格，
--       跟前端 cheapestPrice 同一套定義）。
--   排序：vis_has_sale DESC、vis_min_sale_end ASC NULLS LAST、
--     vis_cheapest_twd ASC NULLS LAST、title_zh ASC、id ASC。
--   總數 total_count 是「不過濾已購買」的總數（跟既有邏輯一致：總數顯示
--   維持全站總數，排除只影響當頁名單）。
-- 套用方式：Supabase Dashboard → SQL Editor 貼上整個檔案執行；
--           可重複執行（CREATE OR REPLACE FUNCTION）。
-- 部署順序：程式碼可先部署——函式還沒建時，程式碼的 RPC 呼叫失敗會
--           自動退回既有的 view 全域排序，首頁不會壞掉；套用此 migration
--           後可見國家排序自動生效，不需重部署（牆快取 key 已換成 v8，
--           部署後第一次查詢就用新排序）。PostgREST 的函式清單有短暫
--           快取，剛套用完第一次呼叫可能回 404，fallback 會接手，等
--           快取更新後自動切過去。
-- 注意：函式需 GRANT EXECUTE 給 anon, authenticated，否則公開牆打不到。
-- ============================================================================

create or replace function public.games_page_deals_order(
  p_countries text[] default null,
  p_require_visible_price boolean default true,
  p_q text default null,
  p_platform text default null,
  p_product_type text default null,
  p_demo int default null,
  p_only_sale boolean default false,
  p_mine_ids uuid[] default null,
  p_exclude_ids uuid[] default null,
  p_page int default 1,
  p_page_size int default 18
)
returns table (ids jsonb, total_count bigint)
language sql
stable
security invoker
as $$
  with vis_prices as (
    -- 每款遊戲在「可見國家」的價格彙總（p_countries 為 NULL／空 = 全部國家）。
    select
      p.game_id,
      bool_or(
        p.verified is not false
        and p.discount_pct > 0
        and (p.sale_end is null or p.sale_end >= now())
      ) as vis_has_sale,
      min(p.sale_end) filter (
        where p.verified is not false
          and p.discount_pct > 0
          and p.sale_end >= now()
      ) as vis_min_sale_end,
      min(p.price_twd) filter (
        where p.verified is not false
      ) as vis_cheapest_twd
    from public.prices p
    where p_countries is null
       or cardinality(p_countries) = 0
       or p.country = any (p_countries)
    group by p.game_id
  ),
  candidates as (
    select
      g.id,
      g.title_zh,
      coalesce(vp.vis_has_sale, false) as vis_has_sale,
      vp.vis_min_sale_end,
      vp.vis_cheapest_twd
    from public.games g
    left join vis_prices vp on vp.game_id = g.id
    where g.is_unnamed = false
      -- 國家篩選：遊戲在可見國家有價（p_require_visible_price=false 時
      -- 不篩，例如只看我的收藏——那是使用者自己的清單）。
      and (
        not p_require_visible_price
        or p_countries is null
        or cardinality(p_countries) = 0
        or vp.game_id is not null
      )
      -- 搜尋：p_q 由呼叫端清理過（% _ \ 已跳脫），比照 PostgREST ilike。
      and (
        p_q is null or p_q = ''
        or g.title_zh ilike '%' || p_q || '%' escape '\'
        or g.title_en ilike '%' || p_q || '%' escape '\'
      )
      and (p_platform is null or g.platform = p_platform)
      -- 商品類型：'game' 含 product_type 為 NULL 的舊資料（與既有邏輯一致）。
      and (
        p_product_type is null or p_product_type = 'all'
        or (p_product_type = 'game' and (g.product_type = 'game' or g.product_type is null))
        or (p_product_type <> 'game' and p_product_type <> 'all' and g.product_type = p_product_type)
      )
      and (p_demo is null or g.has_demo = p_demo)
      and (p_mine_ids is null or g.id = any (p_mine_ids))
  ),
  ordered as (
    -- 排序：特價先、結束時間近→遠、最低價低→高、中文名、id。
    -- total_count 是不過濾已購買的總數；excluded 只影響當頁名單。
    select
      c.id,
      (p_exclude_ids is not null
        and cardinality(p_exclude_ids) > 0
        and c.id = any (p_exclude_ids)) as excluded,
      row_number() over (
        order by c.vis_has_sale desc,
                 c.vis_min_sale_end asc nulls last,
                 c.vis_cheapest_twd asc nulls last,
                 c.title_zh asc,
                 c.id asc
      ) as rn_all,
      count(*) over () as total_count
    from candidates c
    where (not p_only_sale or c.vis_has_sale)
  ),
  kept as (
    select id, row_number() over (order by rn_all) as rn
    from ordered
    where not excluded
  )
  select
    coalesce(
      (select jsonb_agg(id order by rn)
         from kept
        where rn > (greatest(p_page, 1) - 1) * greatest(p_page_size, 1)
          and rn <= greatest(p_page, 1) * greatest(p_page_size, 1)),
      '[]'::jsonb
    ) as ids,
    coalesce((select max(total_count) from ordered), 0) as total_count;
$$;

grant execute on function public.games_page_deals_order(
  text[], boolean, text, text, text, int, boolean, uuid[], uuid[], int, int
) to anon, authenticated;

-- 可見國家篩選加速：RPC 先按國家掃 prices 再按 game_id 彙總。
create index if not exists prices_country_game_id_idx
  on public.prices (country, game_id);
