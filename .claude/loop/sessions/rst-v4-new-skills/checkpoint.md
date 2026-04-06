# Checkpoint: rst-v4-new-skills
Updated: 2026-03-19

## Position
- Phase: complete
- Step: 8 of 8 (all done)

## Completed Steps ✅
- [x] Step 1 — ENGINE: PlayerStat.ts (SLAYER=18, FARMING=19, RUNECRAFT=20, HUNTER=21, CONSTRUCTION=22, all enabled). Player.ts all stat arrays resized 21→23.
- [x] Step 2 — SLAYER: skill_slayer/ created. slayer_tasks.dbtable/dbrow (8 tasks), slayer.varp, turael.npc, slayer.rs2 (Turael dialog + task assignment + slayer_check_kill proc using p_finduid(uid) pattern). Death hooks appended to: cow.rs2, chicken.rs2, goblin.rs2, man.rs2, zombie.rs2, skeleton.rs2.
- [x] Step 3 — FARMING: skill_farming/ created. farming_patches.dbtable/dbrow (3 patches), farming_patches.varp, herb_patches.loc, farming_seeds.obj, farming.rs2 (rake/inspect/harvest/plant + growth timer).
- [x] Step 4 — CONSTRUCTION: skill_construction/ created. construction.rs2 (full POH system: home portal, exit portal, 5 buildspots, furniture interactions, 3 farm patches). buildspot.loc, home_portal.loc, house_furniture.loc, house.varp.
- [x] Step 5 — LEVELUP DB: levelup.dbrow appended with [levelup_slayer], [levelup_farming], [levelup_construction]. levelup.rs2 got [advancestat] triggers for all three.
- [x] Step 6 — WEB UI: Both SKILL_NAMES arrays in index.ts updated with 23-entry version including Slayer/Farming/Hunter/Construction.
- [x] Step 7 — STAT SYSTEM: stat.constant, stat.enum, and ParamConfig.ts updated to register slayer/farming/construction as valid stat types for enum lookups.
- [x] Step 8 — Server starts clean on :9999. Full repack compiles without errors. All 23 stat slots registered. advancestat triggers for slayer/farming/construction in compiled script pack entries 8340-8342.

## Key Files Changed
server/engine/src/engine/entity/PlayerStat.ts — SLAYER=18, FARMING=19, HUNTER=21, CONSTRUCTION=22
server/engine/src/engine/entity/Player.ts — arrays 21→23
server/engine/src/web/index.ts — SKILL_NAMES 23 entries
server/engine/tools/pack/config/ParamConfig.ts — stats array extended with hunter, construction
server/content/scripts/player/configs/stat.constant — ^slayer=20, ^farming=21, ^construction=22
server/content/scripts/player/configs/stat.enum — [stats]/[stat_names]/[stat_members] extended
server/content/scripts/levelup/configs/levelup.dbrow — levelup_slayer/farming/construction rows
server/content/scripts/levelup/scripts/levelup.rs2 — advancestat,slayer/farming/construction triggers
server/content/scripts/drop tables/scripts/cow.rs2 — slayer_check_kill(1,15)
server/content/scripts/drop tables/scripts/chicken.rs2 — slayer_check_kill(2,5)
server/content/scripts/drop tables/scripts/goblin.rs2 — slayer_check_kill(3,5) ×2 handlers
server/content/scripts/drop tables/scripts/man.rs2 — slayer_check_kill(4,5)
server/content/scripts/drop tables/scripts/zombie.rs2 — slayer_check_kill(7,15) ×3 handlers
server/content/scripts/drop tables/scripts/skeleton.rs2 — slayer_check_kill(8,15) ×2 handlers
server/content/scripts/skill_slayer/ — all new files
server/content/scripts/skill_farming/ — all new files
server/content/scripts/skill_construction/ — all new files

## Compilation Notes
- tsc --noEmit reports one pre-existing error (TS1487 octal escape at index.ts:1229 — was in git HEAD before this session, unrelated to our changes)
- Bun runtime ignores this and server runs clean
- RuneScript pack compiles fully clean (no errors, only expected missing-model warnings)

## Known Caveats
- Turael NPC: needs to be placed on the map in Burthorpe — currently not spawned (no HouseManager-style spawn for NPCs in skill directories)
- Herb patch locs: need placing via map editor at Falador/Catherby/Ardougne coords
- Herb seeds (ranarr_seed etc) are new objects — need to be added to shops/drops separately
- Construction POH: poh_access gating uses %poh_access varp set by HouseManager.ts at login
- Home portal spawned by HouseManager at (3220, 3215) — visible in server log
- slayer_check_kill uses p_finduid(uid) = true pattern (required by compiler for p_active_player)
