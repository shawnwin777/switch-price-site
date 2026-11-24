-- ============================================================================
-- 遊戲關聯表 game_relations（2026-11-24）
--   DLC／語言包／組合包 → 本體遊戲，以及同名雙版本主程式（Switch／Switch 2）
--   的配對。由 scripts/link-related-games.mjs 依標題規則運算後寫入。
--
-- 為什麼不用 games.parent_game_id 一欄（見 docs/link-related-games-20261124.md）：
--   - 一個 DLC／組合包可能對應多個本體（多遊戲組合包，如 P3P＋P4G 同捆包），
--     也可能對到同一個本體的多筆重複上架列（canonical slug＋tw- 列）；
--   - edition 是對稱關係（A 是 B 的另一代，B 也是 A 的另一代），一欄放不下；
--   - 關聯表可以帶 relation_type／method／confidence，UI 能分開顯示
--     「相關內容（DLC／語言包／升級通行證／組合包）」與「同名另一代主程式」，
--     規則改了只要重跑腳本，不用改 games 結構。
--
-- 方向約定（腳本寫入時遵守，查詢端照此查）：
--   - dlc／language_pack／upgrade_pass／bundle：
--       game_id = DLC／組合包那一列，related_game_id = 本體遊戲。
--       本體頁查「相關內容」：WHERE related_game_id = :game AND
--       relation_type IN ('dlc','language_pack','upgrade_pass','bundle')。
--       DLC 頁查「所屬本體」：WHERE game_id = :dlc。
--   - edition：雙向各寫一列（A→B 與 B→A，relation_type 都是 'edition'），
--       詳情頁只要查 WHERE game_id = :game AND relation_type = 'edition'。
--   - 多遊戲組合包：同一 game_id 對每個內含遊戲各寫一列 bundle
--    （method='multi' 可追溯）。
--
-- 欄位：
--   id               uuid 主鍵
--   game_id          uuid，FK games(id) ON DELETE CASCADE
--   related_game_id  uuid，FK games(id) ON DELETE CASCADE
--   relation_type    text：'dlc'／'language_pack'／'upgrade_pass'／'bundle'／'edition'
--   method           text：配對方法（exact／split／prefix-marker／…），供追溯
--   confidence       text：'high'／'medium'（見腳本說明）
--   source           text：寫入來源，預設 'link-related-games'
--                    （腳本 --prune 只清這個來源的列，不動手動補的列）
--   created_at／updated_at  timestamptz
-- 唯一鍵 (game_id, related_game_id, relation_type)：同一對關係只留一列，
-- 腳本重跑以 upsert 更新 method／confidence，不重複建檔。
--
-- RLS（風格同 game_region_ids）：
--   - 公開 SELECT：未登入訪客也要在詳情頁看到相關內容。
--   - 不開放一般使用者的任何寫入 policy：寫入只走 Service Role Key
--     （scripts/link-related-games.mjs），繞過 RLS。
--
-- 套用方式：Supabase Dashboard → SQL Editor，貼上整個檔案執行。
--   可重複執行：建表用 IF NOT EXISTS；index 用 IF NOT EXISTS；
--   policy 用 DROP IF EXISTS + CREATE 重建。
--   注意：跑之前腳本 --apply 會失敗（表不存在）；跑完才能寫入。
-- 執行後驗證：
--   1. SELECT count(*) FROM game_relations;（腳本跑完應約 3,300 列上下，
--      依當時庫內資料而定；見 data/game-relations-20261124.json 的 counts）
--   2. 巫師 3 驗證：SELECT * FROM game_relations WHERE
--      related_game_id IN (SELECT id FROM games WHERE slug IN
--      ('the-witcher-3-wild-hunt-complete-edition','the-witcher-3-wild-hunt-remastered'));
--      應看到兩列 edition 互指（complete-edition ↔ remastered）。
-- ============================================================================

create table if not exists public.game_relations (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  related_game_id uuid not null references public.games (id) on delete cascade,
  relation_type text not null check (relation_type in ('dlc', 'language_pack', 'upgrade_pass', 'bundle', 'edition')),
  method text,
  confidence text not null default 'medium' check (confidence in ('high', 'medium')),
  source text not null default 'link-related-games',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, related_game_id, relation_type)
);
create index if not exists game_relations_game_id_idx
  on public.game_relations (game_id);
create index if not exists game_relations_related_game_id_idx
  on public.game_relations (related_game_id);
create index if not exists game_relations_related_type_idx
  on public.game_relations (related_game_id, relation_type);

alter table public.game_relations enable row level security;

-- 公開可讀（與 games／prices／game_region_ids 相同）。
drop policy if exists "game_relations_select_public" on public.game_relations;
create policy "game_relations_select_public" on public.game_relations
  for select to anon, authenticated using (true);

-- 不開放一般使用者的任何寫入 policy（insert／update／delete 皆無）：
-- 寫入只走 Service Role Key（scripts/link-related-games.mjs）。
