# Review: rst-v4-new-skills
Date: 2026-03-19
Status: PASS

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Server starts on port 9999 without TypeScript errors | PASS — "World ready" at 2:29:15, zero errors in log |
| PlayerStat enum has SLAYER=18, FARMING=19, HUNTER=21, CONSTRUCTION=22 | PASS — verified in PlayerStat.ts |
| PlayerStatEnabled[18] and [19] are true | PASS — all 23 slots true |
| skill_slayer/ directory with Turael NPC + task system | PASS — turael.npc, slayer_tasks.dbrow, slayer.rs2 compiled (entry 8371) |
| skill_farming/ directory with herb patch RuneScript | PASS — herb_patches.loc, farming.rs2 compiled (entries 8343-8345) |
| skill_construction/ directory with construction.rs2 | PASS — full POH system compiled (entries 8378-8431) |
| levelup.dbrow has entries for slayer, farming, construction | PASS — lines 270/281/292 |
| levelup.rs2 has [advancestat] triggers for all three | PASS — compiled as entries 8340/8341/8342 |
| Web UI SKILL_NAMES shows Slayer/Farming at positions 18/19 | PASS — both SKILL_NAMES arrays updated |
| PillMerchant/RSTMinter/BankLogMinter untouched | PASS — git diff shows 0 changes |

## Issues Encountered and Resolved
1. git stash reverted tracked files (PlayerStat.ts, Player.ts, index.ts, levelup files, drop table files) — reapplied manually
2. slayer_check_kill proc: `p_active_player` compiler error — fixed using p_finduid(uid)=true pattern (same as trail_easycluedrop)
3. stat.enum `Invalid value: construction` — root cause: ParamConfig.ts stats array hardcoded, missing construction/hunter — added both
4. stat.constant/stat.enum had hunter removed to fix gap, construction moved to val=22

## Compiled Script Pack Entries (key)
- 8340 [advancestat,slayer]
- 8341 [advancestat,farming]
- 8342 [advancestat,construction]
- 8371 [opnpc1,turael]
- 8378 [oploc1,home_portal]
- 8380 [oploc1,house_exit_portal]
- 8381-8385 [oploc1,buildspot_0..4]
- 8417 [proc,house_setup_locs]
- 8431 [proc,slayer_check_kill]
