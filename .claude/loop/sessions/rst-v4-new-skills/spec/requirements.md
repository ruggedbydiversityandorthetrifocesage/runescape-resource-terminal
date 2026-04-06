# Requirements: RST v4 New Skills (Slayer, Farming, Construction)

## Objective
Add Slayer (slot 18), Farming (slot 19), and Construction (slot 22) skill slots to the TypeScript Lost City RS2 server running on localhost:9999, with working XP tracking, level-up events, and RuneScript content — while keeping the OPWallet/RST blockchain integration fully intact.

## Acceptance
- Server starts on port 9999 without TypeScript errors
- PlayerStat enum has SLAYER=18, FARMING=19, HUNTER=21, CONSTRUCTION=22
- PlayerStatEnabled[18] and [19] are true
- skill_slayer/ directory exists with Turael NPC + task system RuneScript
- skill_farming/ directory exists with herb patch RuneScript
- skill_construction/ directory exists with placeholder construction.rs2
- levelup.dbrow has entries for slayer, farming, construction
- levelup.rs2 has [advancestat] triggers for all three
- Web UI SKILL_NAMES shows 'Slayer' and 'Farming' at positions 18/19
- PillMerchant/RSTMinter/BankLogMinter blockchain integration untouched
