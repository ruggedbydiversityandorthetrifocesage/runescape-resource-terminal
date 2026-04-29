# RST Bot Dashboard — Changelog

## 2026-04-29

### Added: Lumbridge Willow Woodcutter (`wc_lumbridge`)
- New job that chops the two willow trees east of the Lumbridge general store
- Banks at Satoshi's booths in the Lumbridge courtyard (~30 tiles away — very short loop)
- Available in the job dropdown on all bot panels

### Added: Falador walk button (🛡️)
- New cmd button on every bot panel — walks to Falador (coords 2964, 3378)

### Added: Satoshi Teleport button (⚡)
- Fires the Lumbridge Teleport spell (component 1167) — free & unlimited on this server
- Waits 4 ticks for teleport animation to complete

### Added: Auto-open bot tabs on dashboard startup
- All bot game client tabs open automatically in the background when the dashboard starts
- Dashboard itself opens in the browser after a 1s delay
- Tabs staggered 800ms apart to avoid server load spike

### Fixed: Essence miner portal exit loop
- Previously: after clicking the portal it waited a fixed 4s then looped — if the click didn't fire, it would spam-click the portal indefinitely
- Now: polls `isInEssenceMine()` every 300ms for up to 8s after the portal click, only retrying once the player has actually left
- If no portal is visible, walks toward the known portal area (2983, 4849) instead of waiting blindly

### Fixed: Essence miner bank open failure on restart
- Tightened walkTo tolerance to 2 tiles so the bot lands close enough for openBank() to reach
- Increased retries from 3 → 5; on 3rd failure walks even closer (tolerance 1) before retrying

## 2026-04-28

### Fixed: Mining script tick timing (mining-trainer/script.ts)
- All `setTimeout()` calls replaced with `sdk.waitForTicks()` so the script runs at server tick speed rather than wall-clock time
- Eliminates spam-clicking on rocks caused by the private server running faster than OSRS's 600ms tick
