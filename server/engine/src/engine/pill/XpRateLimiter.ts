/**
 * XP Rate Limiter — Phase 2 server-side validation layer.
 *
 * Before calling grantClaim, the server verifies that the player actually
 * earned the XP consistent with the resources they're selling. This closes
 * a potential exploit where resources are injected without corresponding
 * game activity (e.g., engine bugs, console item spawning, future jailbreaks).
 *
 * Design:
 * - Per-sale: accumulate expected XP from each item sold
 * - At grantClaim: compare actual XP gain (since last snapshot) to expected
 * - Ratio below MIN_XP_RATIO → warning logged (warn-only in V2, not a hard block)
 * - After successful grant: snapshot current XP, clear pending expected
 *
 * Limits:
 * - In-memory only — snapshots reset on server restart (intentional; first
 *   session is ungated, only subsequent sales within a session are checked)
 * - Meat (combat drops) is excluded — combat XP tracking is separate
 */

// RSPS skill stat indices — player.stats[i] = XP × 10
const SKILL_WOODCUTTING = 8;
const SKILL_FISHING      = 10;
const SKILL_SMITHING     = 13;
const SKILL_MINING       = 14;

/** Expected XP earned per unit of each resource (actual XP, not ×10). */
const RESOURCE_XP: Record<number, { skillIdx: number; xp: number }> = {
    // ── Logs (woodcutting) ────────────────────────────────────────────────
    1511: { skillIdx: SKILL_WOODCUTTING, xp: 25 },     // logs
    1521: { skillIdx: SKILL_WOODCUTTING, xp: 37.5 },   // oak logs
    1519: { skillIdx: SKILL_WOODCUTTING, xp: 67.5 },   // willow logs
    1515: { skillIdx: SKILL_WOODCUTTING, xp: 175 },    // yew logs
    1513: { skillIdx: SKILL_WOODCUTTING, xp: 250 },    // magic logs

    // ── Ores (mining) ─────────────────────────────────────────────────────
    436:  { skillIdx: SKILL_MINING, xp: 17.5 },        // copper ore
    438:  { skillIdx: SKILL_MINING, xp: 17.5 },        // tin ore
    440:  { skillIdx: SKILL_MINING, xp: 35 },          // iron ore
    453:  { skillIdx: SKILL_MINING, xp: 50 },          // coal
    444:  { skillIdx: SKILL_MINING, xp: 65 },          // gold ore
    447:  { skillIdx: SKILL_MINING, xp: 80 },          // mithril ore
    449:  { skillIdx: SKILL_MINING, xp: 95 },          // adamantite ore
    451:  { skillIdx: SKILL_MINING, xp: 125 },         // runite ore

    // ── Fish (fishing) ───────────────────────────────────────────────────
    317:  { skillIdx: SKILL_FISHING, xp: 10 },         // raw shrimp
    321:  { skillIdx: SKILL_FISHING, xp: 40 },         // raw anchovies
    327:  { skillIdx: SKILL_FISHING, xp: 20 },         // raw sardine
    345:  { skillIdx: SKILL_FISHING, xp: 30 },         // raw herring
    335:  { skillIdx: SKILL_FISHING, xp: 50 },         // raw trout
    331:  { skillIdx: SKILL_FISHING, xp: 70 },         // raw salmon
    349:  { skillIdx: SKILL_FISHING, xp: 60 },         // raw pike
    359:  { skillIdx: SKILL_FISHING, xp: 80 },         // raw tuna
    377:  { skillIdx: SKILL_FISHING, xp: 90 },         // raw lobster
    371:  { skillIdx: SKILL_FISHING, xp: 100 },        // raw swordfish
    383:  { skillIdx: SKILL_FISHING, xp: 110 },        // raw shark

    // ── Bars (smithing/smelting at furnace) ───────────────────────────────
    2349: { skillIdx: SKILL_SMITHING, xp: 6.25 },      // bronze bar
    2351: { skillIdx: SKILL_SMITHING, xp: 12.5 },      // iron bar
    2353: { skillIdx: SKILL_SMITHING, xp: 17.5 },      // steel bar
    2355: { skillIdx: SKILL_SMITHING, xp: 13.75 },     // silver bar
    2357: { skillIdx: SKILL_SMITHING, xp: 22.5 },      // gold bar
    2359: { skillIdx: SKILL_SMITHING, xp: 30 },        // mithril bar
    2361: { skillIdx: SKILL_SMITHING, xp: 37.5 },      // adamantite bar
    2363: { skillIdx: SKILL_SMITHING, xp: 50 },        // runite bar
};

interface SkillXp { wc: number; mine: number; fish: number; smith: number }

// XP × 10 snapshot at time of last committed grantClaim
const xpSnapshots = new Map<string, SkillXp>();

// Accumulated expected XP (actual XP, not ×10) since last committed snapshot
const pendingExpected = new Map<string, SkillXp>();

/**
 * Minimum ratio of (actual XP gained) / (expected XP from resources sold).
 * Set deliberately low (5%) to avoid false positives in edge cases:
 * - Player farmed resources across multiple server sessions
 * - Player mixed skills (woodcutting AND mining in same sale)
 * - XP from non-saleable activities (combat, firemaking, etc.)
 *
 * Raise this gradually in production as confidence increases.
 */
const MIN_XP_RATIO = 0.05;

/**
 * Minimum expected XP before the check is meaningful.
 * Below this threshold (e.g., selling 4 logs = 100 XP), skip the check.
 */
const MIN_EXPECTED_XP_TO_CHECK = 500;

/**
 * Track expected XP for a single item slot being sold at the merchant.
 * Call once per item during the sale loop, before calling mintRST.
 *
 * @param username - Player username (lowercase-normalised)
 * @param itemId   - The item's ID (may be noted)
 * @param count    - Stack size
 * @param certlink - Unnoted item ID (pass -1 if not a noted item)
 */
export function accumulateSaleXp(username: string, itemId: number, count: number, certlink: number): void {
    const entry = RESOURCE_XP[itemId] ?? (certlink >= 0 ? RESOURCE_XP[certlink] : undefined);
    if (!entry) return; // meat, unchecked items — skip

    const prev = pendingExpected.get(username) ?? { wc: 0, mine: 0, fish: 0, smith: 0 };
    const gain = entry.xp * count;

    switch (entry.skillIdx) {
        case SKILL_WOODCUTTING: prev.wc    += gain; break;
        case SKILL_MINING:      prev.mine  += gain; break;
        case SKILL_FISHING:     prev.fish  += gain; break;
        case SKILL_SMITHING:    prev.smith += gain; break;
    }
    pendingExpected.set(username, prev);
}

/**
 * Validate XP/resource ratio before grantClaim.
 * Returns { ok: boolean, reason?: string }.
 * ok=false = suspicious (caller logs, V2 does not hard-block).
 *
 * @param username - Player username
 * @param stats    - player.stats Int32Array (XP × 10 per skill slot)
 */
export function validateXpRatio(username: string, stats: Int32Array): { ok: boolean; reason?: string } {
    const expected = pendingExpected.get(username);
    if (!expected) return { ok: true };

    const snapshot = xpSnapshots.get(username);
    if (!snapshot) return { ok: true }; // no baseline — skip check this session

    // Actual XP gain since snapshot (divide by 10 to get real XP)
    const gainWc    = (stats[SKILL_WOODCUTTING] - snapshot.wc)    / 10;
    const gainMine  = (stats[SKILL_MINING]      - snapshot.mine)  / 10;
    const gainFish  = (stats[SKILL_FISHING]     - snapshot.fish)  / 10;
    const gainSmith = (stats[SKILL_SMITHING]    - snapshot.smith) / 10;

    const checks: Array<{ skill: string; gain: number; expected: number }> = [
        { skill: 'woodcutting', gain: gainWc,    expected: expected.wc },
        { skill: 'mining',      gain: gainMine,  expected: expected.mine },
        { skill: 'fishing',     gain: gainFish,  expected: expected.fish },
        { skill: 'smithing',    gain: gainSmith, expected: expected.smith },
    ];

    for (const c of checks) {
        if (c.expected < MIN_EXPECTED_XP_TO_CHECK) continue;
        if (c.gain < 0) {
            // XP decreased — server restart or stats rollback. Reset snapshot.
            return { ok: true };
        }
        const ratio = c.gain / c.expected;
        if (ratio < MIN_XP_RATIO) {
            return {
                ok: false,
                reason: `${c.skill}: gained ${c.gain.toFixed(0)} XP but sold resources worth ` +
                    `${c.expected.toFixed(0)} XP (ratio=${ratio.toFixed(3)}, min=${MIN_XP_RATIO})`,
            };
        }
    }

    return { ok: true };
}

/**
 * Commit XP snapshot after a successful grantClaim.
 * Must be called after grant to update the baseline and clear pending expected.
 *
 * @param username - Player username
 * @param stats    - player.stats Int32Array at the time of grant
 */
export function commitXpSnapshot(username: string, stats: Int32Array): void {
    xpSnapshots.set(username, {
        wc:    stats[SKILL_WOODCUTTING],
        mine:  stats[SKILL_MINING],
        fish:  stats[SKILL_FISHING],
        smith: stats[SKILL_SMITHING],
    });
    pendingExpected.delete(username);
}
