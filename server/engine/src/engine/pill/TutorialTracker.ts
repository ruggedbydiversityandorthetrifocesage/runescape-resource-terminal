// ============================================================
// RST Tutorial Tracker
// Guides new players: trees → Lumbridge General Store → Satoshi Bank
//
// Steps:
//   0 = Brand new player      — hint arrow on trees
//   1 = Has logs/ores          — hint arrow on Lumbridge General Store
//   2 = First sale done        — hint arrow on Satoshi the Banker
//   3 = Visited bank           — tutorial complete, hint cleared
//
// Existing players (with save files) are never added to this
// map, so they receive no tutorial hint.
// ============================================================

export const tutorialStep = new Map<string, number>();

// Tick at which to re-send the "head east" reminder (clears after firing)
export const tutorialRemindTick = new Map<string, number>();

export function getTutorialStep(username: string): number {
    return tutorialStep.get(username) ?? -1; // -1 = existing player, skip tutorial
}

export function setTutorialStep(username: string, step: number): void {
    tutorialStep.set(username, step);
}

// Tree right next to Lumbridge General Store — chop here, sell right there
export const TUTORIAL_TREE_X = 3213;
export const TUTORIAL_TREE_Z = 3238;

// Lumbridge General Store (NPC 520/521)
export const TUTORIAL_STORE_X = 3213;
export const TUTORIAL_STORE_Z = 3246;

// Satoshi the Banker — Lumbridge Castle ground floor
export const TUTORIAL_BANK_X = 3207;
export const TUTORIAL_BANK_Z = 3220;

// Item IDs that count as "harvestable resources" (triggers step 0 → 1)
export const RESOURCE_ITEM_IDS = new Set([
    1511, // logs
    1521, // oak logs
    1519, // willow logs
    1515, // yew logs
    1513, // magic logs
    436,  // copper ore
    438,  // tin ore
    440,  // iron ore
    453,  // coal
    444,  // gold ore
    447,  // mithril ore
    449,  // adamantite ore
    451,  // runite ore
]);
