# Runescape Resource Terminal (RST) — Roadmap

## Live Now ✅
- Woodcutting (logs → GP → RST)
- Mining (ores → GP → RST)
- Cow kills → GP → RST
- RST token on OPNet Bitcoin L1 (OP20 via grantClaim/claim)
- Wallet-gated world boundaries
- Leaderboard + hiscores
- Tutorial system
- Difficulty index display

---

## Phase 2 — 10 RST Unlock (Priority)

**World Expansion:**
- Unlock: Falador, White Knights' Castle
- Unlock: Rimmington
- Unlock: Port Sarim
- Unlock: Duel Arena (east of Al Kharid)
- Unlock: Wilderness (north of Edgeville, levels 1–50+)
- Brimhaven/Karamja (requires boat mechanic — see below)

**New Resources:**
- Fishing: shrimp, tuna, lobster, shark
  - Shark = top-tier fishing resource (rare, high GP)
  - Fishing spots at: Barbarian Village (trout/salmon), Draynor (shrimp), Karamja (lobster/shark)
- Smelting: bronze bar, iron bar, steel bar, mithril bar, adamant bar, runite bar
  - Adamantite + runite = 5x rarer/higher GP than magic logs (current top)
  - Furnace locations: Lumbridge, Falador, Al Kharid

**Difficulty label:** EXTREMELY HARDCORE → **HARD MODE**

**Mechanic — Boat to Karamja:**
- Interact with port in Port Sarim → pay fee → teleport to Brimhaven
- Required to access Karamja fishing spots (lobster/shark)

---

## Phase 3 — 1,000 RST Unlock

**World Expansion:**
- Full map access (no boundary)
- All of Kandarin: Seers Village, Ardougne, Fishing Guild, Flax fields
- Morytania (east): Barrows, Canifis, Mort Myre
- Feldip Hills, Kharazi Jungle
- Tree Gnome Stronghold

**New Resources:**
- Magic trees (top woodcutting), flax fields, yew groves
- Fishing Guild (all fish types available at max efficiency)
- Full smelting/smithing expanded (up to rune)

**Difficulty label:** HARD MODE → **NORMAL**

---

## Merchant / GP Claim System (Future)

**Claim Thresholds (anti-spam, planned):**
- First ever claim: minimum 100 GP earned
- Subsequent claims: minimum 1,000 GP
- After 10,000 lifetime GP: minimum 10,000 GP per claim
- Prevents dust-level spam minting

**3-min cooldown (in progress):**
- Block selling if player has unclaimed RST (merchant rejects, shows reminder)

**RST Shop purchase fees → staking pool (planned):**
- When a player spends RST at the RST Broker shop, instead of burning the RST, route it to the sRST staking rewards pool via `addRewards()`
- Currently: RST is burned on purchase
- Goal: make shop activity directly benefit stakers (buy pressure + yield generation)
- Implementation: in `RSTShop.ts`, after deducting the RST cost, call `addRewards(amount)` on the staking contract instead of discarding

---

## Contract v2 / LP (Planned)

**Redeployment:**
- 1% transfer fee on RST
  - 50% burned (deflationary)
  - 50% to deployer treasury (funds server gas for grantClaim)
- Server wallet only exposes `grantClaim` — no other deployer functions at launch
- Claim process: ~2 blocks confirmation (same as MotoSwap pattern)
- This prevents spam minting — supply burns slowly, fairly

**LP Setup:**
- Create RST/BTC pool on MotoSwap NativeSwap
- Call `setLPPair(pairAddress)` post-deploy to activate 1% LP burn
- LP fees partially recycle to server treasury over time

---

## Bank Log NFT (Long-term Vision)

- Players who convert 1,000+ GP total receive a daily "Bank Log Voucher" NFT on OPNet
- NFT snapshot: current inventory/bank value in RST terms
- Acts as a staking signal — "how much is your RS bank worth?"
- Updates dynamically as player earns more
- Visual: pixel-art bank receipt, stamped with block height and GP converted

---

## Difficulty Index Summary

| RST Balance | World Access | Difficulty Label |
|---|---|---|
| 0–9 RST | Misthalin only | EXTREMELY HARDCORE |
| 10–999 RST | +Asgarnia, Wilderness | HARD MODE |
| 1,000+ RST | Full world | NORMAL |

---

## Runecrafting — The Meta Joke

> "All rune tokens were just imaginary metadata on Bitcoin Taproot.
> Ordinals were the real deal. RST is the actual on-chain rune."

In-game, players craft runes. In reality, RST is a real OP20 token on Bitcoin L1.
The skill mirrors the joke — every rune ever made on Bitcoin was pretend until now.

**Quest chain:**
1. Explore Lumbridge Castle → talk to Duke Horacio
2. Complete Rune Mysteries → unlocks Rune Essence mine + Duke's shop
3. Mine pure essence → craft runes at altars (Air, Fire, Water, Earth, Mind, Body...)
4. Sell runes to merchant for GP → convert to RST
5. Each rune type = different GP value (higher altar level = rarer rune = more GP)

**Duke Horacio's shop** (unlocked post-quest):
- Tiara blanks, talismans, rune pouches

**Economy fit:**
- Runecrafting = slow, high-skill, high-GP activity
- High-level runes (Nature, Law, Death) = top-tier GP earners
- Pairs with Phase 2 (Falador area altars)
- Phase 3 unlocks best altars (Nature = Karamja, Law = Entrana)

---

## GP Reward Tiers (Planned)

**Tier 1 — Raw gathering (base rate):**
- Woodcutting, Mining, Fishing

**Tier 2 — Processed goods (2-3x multiplier, requires multiple resources/steps):**
- Smelting: 3x (ore + coal → bar)
- Cooking/Cooked Goods: 3x (raw food + fire/range → cooked)
- Runecrafting: 2x (essence + altar run)

**V3 — Complex crafting (TBD, implement last):**
- Herblore, Crafting, Farming

---

## Satoshi the Banker (Planned)

- Add Banker NPC named "Satoshi" in Lumbridge spawn area
- Phase 1: standard bank functionality (open bank interface like any banker)
- Phase 2 (later): AI-powered — Satoshi can answer questions, give hints, interact with player
- "Your bank is on the blockchain. Satoshi holds the keys." vibe

---

## Near-Term Priority Order

1. ✅ Difficulty index UI (done)
2. ✅ World boundary gating by RST balance (done)
3. 🔲 New characters spawn with Iron Axe instead of Bronze Axe
4. 🔲 Auto-complete Rune Mysteries Quest for all players on login
4. 🔲 Confirm Phase 2 boundary coordinates match red-outline map
5. 🔲 Add fishing skill + resources (Phase 2 content)
6. 🔲 Add smelting/smithing skill + resources (Phase 2 content)
7. 🔲 Apply Tier 2 GP multipliers (smelting 3x, cooking 3x, runecrafting 2x)
8. 🔲 Block selling during 3-min cooldown (merchant rejects)
9. 🔲 Boat mechanic (Port Sarim → Karamja)
10. 🔲 GP claim thresholds (100 → 1,000 → 10,000)
11. 🔲 Contract v2 redeploy (1% fee, 50/50 burn/treasury)
12. 🔲 Bank Log NFT system
13. 🔲 Runecrafting skill (Rune Mysteries auto-completed → essence mine → altars → GP)
14. 🔲 Duke Horacio shop (post-quest unlock: tiaras, talismans, pouches)
15. 🔲 Wallet TX history panel (localStorage — stake, unstake, claim events)
16. 🔲 V3 crafting skills (Herblore, Crafting, Farming)
