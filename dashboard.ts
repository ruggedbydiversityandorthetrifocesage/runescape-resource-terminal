/**
 * Bot Dashboard — Multi-bot controller
 * Usage: bun dashboard.ts <bot1> [bot2] ...  (job is chosen in the UI)
 * Example: bun dashboard.ts frmgporudie overit birdboy124
 * Opens a control panel at http://localhost:3001
 */

import { BotSDK, deriveGatewayUrl } from './sdk/index';
import { BotActions } from './sdk/actions';
import type { NearbyLoc } from './sdk/types';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────

// Woodcutting
const DRAYNOR_WILLOWS        = { x: 3087, z: 3235 };
const LUMBRIDGE_WILLOWS      = { x: 3226, z: 3241 }; // Two willows east of general store
const LUMBRIDGE_SATOSHI_BANK = { x: 3222, z: 3223 }; // Satoshi bank booths, Lumbridge courtyard
const DRAYNOR_BANK           = { x: 3092, z: 3243 };
const EDGEVILLE_YEWS         = { x: 3087, z: 3470 }; // WCPro2: primary yew tree
const EDGEVILLE_YEWS2        = { x: 3087, z: 3481 }; // WCPro2: secondary yew tree
const EDGEVILLE_BANK         = { x: 3095, z: 3492 }; // WCPro2: Edgeville bank tile
const VARROCK_CASTLE_YEWS    = { x: 3205, z: 3494 }; // Varrock Palace south — primary
const VARROCK_CASTLE_YEWS2   = { x: 3209, z: 3497 }; // Varrock Palace south — secondary

// Combat
const COW_FIELD        = { x: 3257, z: 3272 };
const COW_FIELD_GATE   = { x: 3253, z: 3270 };
const COW_FIELD_RADIUS = 25;
const LUMBRIDGE        = { x: 3222, z: 3218 }; // respawn point after death
const CHICKEN_FIELD    = { x: 3238, z: 3295 }; // XChickenSlaughter
const CHICKEN_RADIUS   = 15;

// Goblins — Lumbridge east (bridge area, easy respawn)
const GOBLIN_FIELD     = { x: 3247, z: 3233 }; // goblins north of Lumbridge
const GOBLIN_RADIUS    = 20;

// Al-Kharid Warriors — inside palace, bank directly west
const AL_KHARID_WARRIORS   = { x: 3293, z: 3164 }; // Al-Kharid palace interior
const AL_KHARID_WARRIORS2  = { x: 3299, z: 3164 }; // second spot inside palace
const AL_KHARID_BANK       = { x: 3269, z: 3167 }; // Al-Kharid bank (very close)
const AL_KHARID_FIGHT_RADIUS = 18;
const AL_KHARID_LUMBRIDGE_GATE = { x: 3269, z: 3229 }; // toll gate (south entrance)

// Varrock mines
const VARROCK_EAST_MINE    = { x: 3285, z: 3365 }; // SE Varrock mine (iron/copper/tin)
const VARROCK_WEST_MINE    = { x: 3176, z: 3368 }; // SW Varrock mine (copper/tin)
const VARROCK_WEST_BANK    = { x: 3185, z: 3436 }; // Varrock West bank
const AUBURY_POS           = { x: 3253, z: 3401 }; // Aubury (essence teleport)
const VARROCK_EAST_BANK    = { x: 3253, z: 3421 }; // Varrock East bank (north of Aubury)
// Waypoints: Varrock East mine → Varrock West bank (going west through town)
const VARROCK_EAST_BANK_WPS = [
    { x: 3270, z: 3380 },
    { x: 3250, z: 3395 },
    { x: 3230, z: 3410 },
    { x: 3210, z: 3425 },
] as const;
// Waypoints: Varrock West bank → Varrock East mine (return path)
const VARROCK_EAST_MINE_WPS = [
    { x: 3210, z: 3425 },
    { x: 3230, z: 3410 },
    { x: 3255, z: 3393 },
    { x: 3280, z: 3370 },
] as const;

// Fishing
const DRAYNOR_FISH_SPOT    = { x: 3086, z: 3228 }; // Draynor net/bait spot
const BARB_FISH_SPOT       = { x: 3105, z: 3434 }; // Barbarian Village fly-fish (trout/salmon)
const BARB_FISH_RADIUS     = 10;

// Moss Giants — Varrock Sewers
// Surface manhole tile; underground moss giants are ~z+6400
const SEWER_MANHOLE        = { x: 3237, z: 3457 }; // manhole south of Varrock
const SEWER_MOSS_GIANT     = { x: 3158, z: 9906 }; // underground fighting tile
const SEWER_LADDER_UP      = { x: 3237, z: 9858 }; // ladder back to surface (approx)
const SEWER_FIGHT_RADIUS   = 15;

// Runite Mining — Wilderness Lava Maze (~level 46 Wilderness)
const WILDY_RUNITE_1       = { x: 3054, z: 3887 }; // Lava Maze runite rock #1
const WILDY_RUNITE_2       = { x: 3056, z: 3889 }; // Lava Maze runite rock #2
const EDGEVILLE_WILDY_GATE = { x: 3131, z: 3523 }; // Edgeville Wilderness entrance
const WILDY_RUNITE_RADIUS  = 8;
const FLEE_PLAYER_RADIUS   = 15; // flee if other player within this many tiles

const MAX_DRIFT    = 20;
const DASHBOARD_PORT = 3001;

type Job =
    | 'wc'                  // Willow trees — Draynor
    | 'yews'                // Yew trees — Edgeville
    | 'yews_varrock'        // Yew trees — Varrock Castle
    | 'mining_all'          // Mining Guild — All ores (mithril > coal)
    | 'mining_coal'         // Mining Guild — Coal only
    | 'mining_mithril'      // Mining Guild — Mithril only
    | 'mining_varrock_east' // Mining — Varrock East mine (iron/copper/tin)
    | 'mining_varrock_west' // Mining — Varrock West mine (copper/tin)
    | 'mining_essence'      // Mining — Rune Essence via Aubury
    | 'combat_cows'         // Combat — Cows (Lumbridge)
    | 'combat_chickens'     // Combat — Chickens (Lumbridge)
    | 'combat_goblins'      // Combat — Goblins (Lumbridge, power fight)
    | 'combat_al_kharid'    // Combat — Al-Kharid Warriors (palace, banks coins)
    | 'fishing_draynor'     // Fishing — Draynor (shrimps/anchovies, net)
    | 'fishing_barb'        // Fishing — Barbarian Village (trout/salmon, fly)
    | 'combat_moss_giants'  // Combat — Moss Giants (Varrock Sewers, power fight)
    | 'mining_runite'       // Mining — Runite ore (Wilderness Lava Maze)
    | 'wc_lumbridge'        // Willow trees — Lumbridge (east of general store, banks at Satoshi)
    | 'thieving_lumbridge'  // Pickpocket men/women — Lumbridge castle, banks at Satoshi
    | 'free_will';          // AI decides — equip gear, fight, mine, woodcut, bank

// ─── Env loader ───────────────────────────────────────────────────────────────

function parseEnv(path: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
}

// ─── Bot state ────────────────────────────────────────────────────────────────

interface LogLine { time: string; msg: string }

interface XpSnap { ts: number; xp: number }

interface BotState {
    name: string;
    job: Job;
    sdk: BotSDK;
    bot: BotActions;
    running: boolean;
    status: string;
    logs: LogLine[];
    bankTrips: number;
    mineOrigin: { x: number; z: number } | null;
    xpHistory: Map<string, XpSnap[]>; // skill → timestamped XP readings
    lastProgress: number;  // timestamp of last meaningful action (for watchdog)
    restartCount: number;  // how many times the loop has auto-restarted
    pendingCmd: string | null; // one-shot manual command (e.g. 'bank', 'lumbridge', 'yews')
    clientUrl: string;    // pre-built /bot?bot=...&password=... URL for background launch
}

const bots = new Map<string, BotState>();

function addLog(b: BotState, msg: string) {
    const time = new Date().toTimeString().slice(0, 8);
    b.logs.push({ time, msg });
    if (b.logs.length > 150) b.logs.shift();
    console.log(`[${b.name}][${time}] ${msg}`);
}

function setStatus(b: BotState, s: string) {
    b.status = s;
    addLog(b, s);
}

// ─── Progress tracking + watchdog ─────────────────────────────────────────────

function updateProgress(b: BotState) {
    b.lastProgress = Date.now();
}

function getLoop(b: BotState) {
    if (b.job === 'mining_all' || b.job === 'mining_coal' || b.job === 'mining_mithril') return miningLoop;
    if (b.job === 'mining_varrock_east') return miningVarrockEastLoop;
    if (b.job === 'mining_varrock_west') return miningVarrockWestLoop;
    if (b.job === 'mining_essence')      return miningEssenceLoop;
    if (b.job === 'combat_cows')         return combatLoop;
    if (b.job === 'combat_chickens')     return chickenLoop;
    if (b.job === 'combat_goblins')      return goblinLoop;
    if (b.job === 'combat_al_kharid')    return alKharidLoop;
    if (b.job === 'yews')                return yewLoop;
    if (b.job === 'yews_varrock')        return yewVarrockLoop;
    if (b.job === 'fishing_draynor')     return fishingDraynorLoop;
    if (b.job === 'fishing_barb')        return fishingBarbLoop;
    if (b.job === 'combat_moss_giants')  return mosGiantLoop;
    if (b.job === 'mining_runite')       return runiteLoop;
    if (b.job === 'wc_lumbridge')        return willowLumbridgeLoop;
    if (b.job === 'thieving_lumbridge')  return thievingLumbridgeLoop;
    if (b.job === 'free_will')           return freeWillLoop;
    return willowLoop; // 'wc' default
}

function startBotLoop(b: BotState) {
    b.lastProgress = Date.now();
    const loop = getLoop(b);
    loop(b).catch(e => {
        addLog(b, `💥 Loop crashed: ${e.message}`);
        if (b.running) {
            b.restartCount++;
            const delay = Math.min(15_000 * b.restartCount, 60_000); // backoff up to 60s
            addLog(b, `🔄 Auto-restart in ${delay / 1000}s... (restart #${b.restartCount})`);
            setTimeout(() => { if (b.running) startBotLoop(b); }, delay);
        }
    });
}

// Watchdog: if a bot is "running" but hasn't made progress in 10 min, force-restart it
setInterval(async () => {
    for (const b of bots.values()) {
        if (!b.running) continue;
        const staleMs = Date.now() - b.lastProgress;
        if (staleMs > 10 * 60_000) {
            addLog(b, `⚠️ Watchdog: no progress for ${Math.round(staleMs / 60_000)}min — force-restarting loop`);
            b.running = false;
            await sleep(3000);
            b.running = true;
            startBotLoop(b);
        }
    }
}, 2 * 60_000);

// ─── SSE ──────────────────────────────────────────────────────────────────────

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();

function broadcast(data: unknown) {
    const msg = enc.encode(`data: ${JSON.stringify(data)}\n\n`);
    for (const ctrl of sseClients) {
        try { ctrl.enqueue(msg); } catch { sseClients.delete(ctrl); }
    }
}

// ─── XP tracking ──────────────────────────────────────────────────────────────

const WINDOWS = { '1h': 3_600_000, '6h': 21_600_000, '12h': 43_200_000, '24h': 86_400_000 };
const PRIMARY_SKILL: Record<Job, string> = {
    wc:                  'Woodcutting',
    yews:                'Woodcutting',
    yews_varrock:        'Woodcutting',
    mining_all:          'Mining',
    mining_coal:         'Mining',
    mining_mithril:      'Mining',
    mining_varrock_east: 'Mining',
    mining_varrock_west: 'Mining',
    mining_essence:      'Mining',
    combat_cows:         'Strength',
    combat_chickens:     'Strength',
    combat_goblins:      'Strength',
    combat_al_kharid:    'Strength',
    fishing_draynor:     'Fishing',
    fishing_barb:        'Fishing',
    combat_moss_giants:  'Strength',
    mining_runite:       'Mining',
    free_will:           'Strength',
};

function xpRate(history: XpSnap[], windowMs: number): number | null {
    const cutoff = Date.now() - windowMs;
    const oldest = history.find(h => h.ts >= cutoff);
    if (!oldest) return null;
    const newest = history[history.length - 1];
    const hrs = (newest.ts - oldest.ts) / 3_600_000;
    if (hrs < 0.02) return null; // need at least ~1 min of data
    return Math.round((newest.xp - oldest.xp) / hrs);
}

function recordXp(b: BotState) {
    const state = b.sdk.getState();
    if (!state) return;
    const cutoff = Date.now() - 25 * 3_600_000;
    for (const skill of state.skills) {
        if (!b.xpHistory.has(skill.name)) b.xpHistory.set(skill.name, []);
        const hist = b.xpHistory.get(skill.name)!;
        hist.push({ ts: Date.now(), xp: skill.experience });
        // Prune entries older than 25h
        while (hist.length > 0 && hist[0].ts < cutoff) hist.shift();
    }
}

function getRates(b: BotState) {
    const skill = PRIMARY_SKILL[b.job];
    const hist  = b.xpHistory.get(skill) ?? [];
    return {
        skill,
        '1h':  xpRate(hist, WINDOWS['1h']),
        '6h':  xpRate(hist, WINDOWS['6h']),
        '12h': xpRate(hist, WINDOWS['12h']),
        '24h': xpRate(hist, WINDOWS['24h']),
    };
}

// Record XP snapshot every 2 minutes
setInterval(() => {
    for (const b of bots.values()) recordXp(b);
}, 120_000);

function getSnap(b: BotState) {
    const state = b.sdk.getState();
    return {
        name:         b.name,
        job:          b.job,
        running:      b.running,
        status:       b.status,
        logs:         b.logs.slice(-40),
        rates:        getRates(b),
        bankTrips:    b.bankTrips,
        restartCount: b.restartCount,
        state: state ? {
            pos:       { x: state.player.worldX, z: state.player.worldZ },
            hp:        state.player.hp,
            maxHp:     state.player.maxHp,
            energy:    state.player.runEnergy,
            inventory: state.inventory.map(i => ({ slot: i.slot, name: i.name, count: i.count })),
            skills:    state.skills.map(s => ({ name: s.name, level: s.baseLevel, xp: s.experience })),
        } : null,
    };
}

setInterval(() => {
    broadcast({ type: 'tick', bots: [...bots.values()].map(getSnap) });
}, 2000);

// ─── Mining Guild loop ────────────────────────────────────────────────────────
// SexyGuildMiner-style: ladder nav, mithril > coal priority, contention detection

// 2004 cache rock IDs — prospect in-game to verify exact values
// These are guesses based on 2004-era IDs; bot falls back to any "mine" rock anyway
const MITHRIL_IDS = [2103, 2104];
const COAL_IDS    = [2096, 2097];
// Iscreams_GMiner exact bank path: waypoint (3030,3348) → BankTile (3016,3355)
const FALADOR_BANK_WAYPOINT = { x: 3030, z: 3348 };
const FALADOR_BANK          = { x: 3016, z: 3355 };
const FALADOR_BANK_GATE     = { x: 3018, z: 3352 }; // south gate tile
const GUILD_LADDER_FALLBACK = { x: 3030, z: 3344 }; // neartopladder (Iscreams_GMiner)
const GUILD_UNDERGROUND_LADDER = { x: 3032, z: 9739 }; // NearLadder (Iscreams_GMiner)

async function miningLoop(b: BotState) {
    const modeLabel = b.job === 'mining_coal' ? 'coal only'
                    : b.job === 'mining_mithril' ? 'mithril only'
                    : 'all ores';
    setStatus(b, `Starting guild miner (${modeLabel})...`);

    // Track surface ladder exit position (set after first climb-up)
    let surfaceExitPos: { x: number; z: number } | null = null;

    // Rocks to skip temporarily (key = "x,z", value = expiry timestamp)
    const skipRocks = new Map<string, number>();

    // Capture underground starting position
    const startState = b.sdk.getState();
    if (startState && !b.mineOrigin) {
        b.mineOrigin = { x: startState.player.worldX, z: startState.player.worldZ };
        addLog(b, `Mine origin: (${b.mineOrigin.x}, ${b.mineOrigin.z})`);
    }

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }

        if (state.dialog?.isOpen) {
            await b.bot.dismissBlockingUI();
            continue;
        }

        const isOre = (name: string) => /(ore$|^coal$|^tin$|^copper$)/i.test(name);
        const oreCount  = state.inventory.filter(i => isOre(i.name)).length;
        const invFull   = state.inventory.length >= 28 && oreCount > 0; // only bank if we have ore
        const underground = state.player.worldZ > 6000;

        // ── BANKING ──────────────────────────────────────────────────────────
        if (invFull || oreCount >= 24) {
            setStatus(b, `Full (${oreCount} ore) — heading to bank...`);

            // 1. If still underground, climb the ladder up
            if (underground) {
                const ladderUp = state.nearbyLocs.find(
                    loc => loc.optionsWithIndex.some(o => /climb.?up/i.test(o.text))
                );
                if (ladderUp) {
                    addLog(b, 'Climbing up ladder...');
                    await b.bot.interactLoc(ladderUp, 'climb-up');
                    await sleep(2000);
                    let surfState = b.sdk.getState();
                    if (surfState && surfState.player.worldZ > 6000) {
                        addLog(b, `Climb failed — server-walking to ladder (${ladderUp.x},${ladderUp.z})...`);
                        await b.sdk.sendWalk(ladderUp.x, ladderUp.z, false);
                        await sleep(Math.max(3000, ladderUp.distance * 700));
                        const freshState = b.sdk.getState();
                        const nearLadder = freshState?.nearbyLocs.find(loc => loc.optionsWithIndex.some(o => /climb.?up/i.test(o.text)));
                        if (nearLadder) {
                            const climbOpt = nearLadder.optionsWithIndex.find(o => /climb.?up/i.test(o.text));
                            if (climbOpt) { await b.sdk.sendInteractLoc(nearLadder.x, nearLadder.z, nearLadder.id, climbOpt.opIndex); await sleep(3000); }
                        }
                        surfState = b.sdk.getState();
                    }
                    if (surfState && surfState.player.worldZ <= 6000) {
                        surfaceExitPos = { x: surfState.player.worldX, z: surfState.player.worldZ };
                        addLog(b, `Surface exit: (${surfaceExitPos.x}, ${surfaceExitPos.z})`);
                    }
                } else {
                    addLog(b, `Ladder out of range — walking to (${GUILD_UNDERGROUND_LADDER.x}, ${GUILD_UNDERGROUND_LADDER.z})`);
                    try { await b.bot.walkTo(GUILD_UNDERGROUND_LADDER.x, GUILD_UNDERGROUND_LADDER.z, 5); } catch { /* keep going */ }
                    await sleep(500);
                }
                continue;
            }

            // 2. Walk to bank — open south gate first, then enter
            try { await b.bot.walkTo(FALADOR_BANK_WAYPOINT.x, FALADOR_BANK_WAYPOINT.z); } catch { /* keep going */ }
            if (!b.running) break;
            try { await b.bot.walkTo(FALADOR_BANK_GATE.x, FALADOR_BANK_GATE.z, 3); } catch { /* keep going */ }
            const bankGate = b.sdk.getState()?.nearbyLocs.find(l => /gate/i.test(l.name));
            if (bankGate) { addLog(b, `Opening bank gate...`); await b.bot.openDoor(bankGate); await sleep(800); }
            try { await b.bot.walkTo(FALADOR_BANK.x, FALADOR_BANK.z); } catch { /* keep going */ }
            if (!b.running) break;

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 4 && b.running; attempt++) {
                await sleep(800);
                try {
                    opened = await b.bot.openBank();
                    if (opened.success) break;
                    addLog(b, `Bank attempt ${attempt}/4 failed: ${opened.message} — retrying...`);
                } catch (e: any) {
                    addLog(b, `Bank error attempt ${attempt}/4: ${e?.message ?? e}`);
                }
                // Walk closer to banker on each retry
                const nudge = [
                    { x: 3017, z: 3355 }, // banker tile
                    { x: 3016, z: 3355 }, // FALADOR_BANK
                    { x: 3018, z: 3354 }, // slightly offset
                    { x: 3013, z: 3356 }, // alternate
                ][attempt - 1] ?? FALADOR_BANK;
                try { await b.bot.walkTo(nudge.x, nudge.z, 1); } catch { /* keep going */ }
                await sleep(1200);
            }

            if (!opened.success) {
                addLog(b, `Bank failed after 4 attempts — heading back to mine`);
                await sleep(3000); // pause before heading back underground
            } else {
                try { await b.bot.depositItem(/coal/i, -1); } catch { /* keep going */ }
                try { await b.bot.depositItem(/ore/i, -1); } catch { /* keep going */ }
                try { await b.bot.closeBank(); } catch { /* keep going */ }
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked (trip #${b.bankTrips}) — returning to guild...`);
            }

            // 3. Walk back to ladder and climb down
            const ladderPos = surfaceExitPos ?? GUILD_LADDER_FALLBACK;
            try { await b.bot.walkTo(ladderPos.x, ladderPos.z); } catch { /* keep going */ }
            if (!b.running) break;

            const ladderDown = b.sdk.getState()?.nearbyLocs.find(
                loc => loc.optionsWithIndex.some(o => /climb.?down/i.test(o.text))
            );
            if (ladderDown) {
                addLog(b, 'Climbing down to guild...');
                await b.bot.interactLoc(ladderDown, 'climb-down');
                await sleep(2000);
            } else {
                // Walk to the known surface ladder position and try again
                const ladderPos2 = surfaceExitPos ?? GUILD_LADDER_FALLBACK;
                addLog(b, `Ladder not found — walking closer to (${ladderPos2.x}, ${ladderPos2.z})`);
                try { await b.bot.walkTo(ladderPos2.x, ladderPos2.z, 2); } catch { /* keep going */ }
            }

            // 4. Walk back to mine area
            const postClimb = b.sdk.getState();
            if (b.mineOrigin && postClimb && postClimb.player.worldZ > 6000) {
                setStatus(b, 'Walking to rocks...');
                try { await b.bot.walkTo(b.mineOrigin.x, b.mineOrigin.z); } catch { /* keep going */ }
            }
            continue;
        }

        // ── SURFACE WITH NO ORE — need to go underground ─────────────────────
        // If on surface with empty inventory, the banking section was skipped.
        // Climb down the ladder to get back to the mining guild.
        if (!underground && oreCount === 0) {
            setStatus(b, 'On surface — climbing down to guild...');
            const ladderPos = surfaceExitPos ?? GUILD_LADDER_FALLBACK;
            try { await b.bot.walkTo(ladderPos.x, ladderPos.z, 2); } catch { /* keep going */ }
            await sleep(300);
            const ladderDown = b.sdk.getState()?.nearbyLocs.find(
                loc => loc.optionsWithIndex.some(o => /climb.?down/i.test(o.text))
            );
            if (ladderDown) {
                addLog(b, 'Climbing down to guild...');
                await b.bot.interactLoc(ladderDown, 'climb-down');
                await sleep(2000);
            }
            continue;
        }

        // ── MINING ───────────────────────────────────────────────────────────
        const now = Date.now();
        // Clear stale skip entries (rocks refresh after ~30s)
        for (const [k, exp] of skipRocks) if (now > exp) skipRocks.delete(k);

        const mineable = state.nearbyLocs.filter(loc =>
            loc.optionsWithIndex.some(o => /^mine$/i.test(o.text)) &&
            !skipRocks.has(`${loc.x},${loc.z}`)
        );

        // Priority based on job type — name-based matching (server IDs vary)
        const sorted       = mineable.sort((a, c) => a.distance - c.distance);
        const mithrilRocks = sorted.filter(r => /mithril/i.test(r.name));
        const coalRocks    = sorted.filter(r => /^coal$/i.test(r.name));
        const anyRock      = sorted[0] as NearbyLoc | undefined;

        const target: NearbyLoc | undefined =
            b.job === 'mining_mithril' ? (mithrilRocks[0] ?? anyRock) :
            b.job === 'mining_coal'    ? (coalRocks[0]    ?? anyRock) :
            /* mining_all */             mithrilRocks[0] ?? coalRocks[0] ?? anyRock;

        if (!target) {
            const nextExpiry = [...skipRocks.entries()].sort((a, c) => a[1] - c[1])[0];
            const waitMs = nextExpiry ? Math.max(1000, nextExpiry[1] - Date.now()) : 5000;
            setStatus(b, `All rocks depleted — waiting ${Math.ceil(waitMs/1000)}s for respawn...`);
            await sleep(Math.min(waitMs, 5000));
            continue;
        }

        const oreLabel = /mithril/i.test(target.name) ? 'mithril'
                       : /^coal$/i.test(target.name)   ? 'coal'
                       : target.name;
        setStatus(b, `Mining ${oreLabel} (${oreCount} ore)...`);

        // Walk close enough first — use high-level walkTo so we wait for arrival
        if (target.distance > 3) {
            try { await b.bot.walkTo(target.x, target.z, 2); } catch { /* keep going */ }
        }

        const oresBefore = state.inventory.filter(i => isOre(i.name)).length;
        const result = await b.bot.interactLoc(target, 'mine');
        if (!result.success) {
            const isCantReach = /reach|stuck/i.test(result.message);
            const skipMs = isCantReach ? 12_000 : 20_000; // scaled for 400ms ticks
            addLog(b, `Skip rock (${target.x},${target.z}) ${skipMs/1000}s: ${result.message}`);
            skipRocks.set(`${target.x},${target.z}`, Date.now() + skipMs);
            await sleep(300);
            continue;
        }

        // Wait for swing to start before watching the rock
        await sleep(2000);

        // Stay on this rock until it depletes or inventory fills — don't re-click
        const MINE_TIMEOUT = 45_000;
        const mineStart = Date.now();
        let lastOreCount = b.sdk.getState()?.inventory.filter(i => isOre(i.name)).length ?? oresBefore;
        let idleTicksSinceOre = 0;

        while (Date.now() - mineStart < MINE_TIMEOUT && b.running) {
            await sleep(1200);
            const ns = b.sdk.getState();
            if (!ns) break;

            // Stop if inventory full
            if (ns.inventory.length >= 28) break;

            const currentOres = ns.inventory.filter(i => isOre(i.name)).length;
            if (currentOres > lastOreCount) {
                lastOreCount = currentOres;
                idleTicksSinceOre = 0;
                updateProgress(b);
                continue; // still mining — keep waiting
            }

            // If player animation stopped, rock is depleted — always skip it
            if (ns.player.animId === -1) {
                idleTicksSinceOre++;
                if (idleTicksSinceOre >= 2) {
                    addLog(b, `Rock at (${target.x},${target.z}) depleted — skipping 20s`);
                    skipRocks.set(`${target.x},${target.z}`, Date.now() + 20_000);
                    break;
                }
            } else {
                idleTicksSinceOre = 0; // still swinging
            }
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Combat — Cows ────────────────────────────────────────────────────────────

async function combatLoop(b: BotState) {
    setStatus(b, 'Starting cow fighter...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }

        if (state.dialog?.isOpen) {
            await b.bot.dismissBlockingUI();
            continue;
        }

        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const hp       = state.player.hp;
        const maxHp    = state.player.maxHp;
        const invFull  = state.inventory.length >= 28;
        const hides    = state.inventory.filter(i => i.name?.toLowerCase().includes('cowhide'));
        const inField  = Math.hypot(px - COW_FIELD.x, pz - COW_FIELD.z) <= COW_FIELD_RADIUS;

        // ── DEATH / RESPAWN DETECTION ─────────────────────────────────────────
        const atLumbridge = Math.hypot(px - LUMBRIDGE.x, pz - LUMBRIDGE.z) < 40;
        if (atLumbridge && !inField) {
            setStatus(b, `☠️ Respawned at Lumbridge — walking back to cows...`);
            // Walk out of Lumbridge castle
            try { await b.bot.walkTo(3230, 3228); } catch { /* keep going */ }
            try { await b.bot.walkTo(COW_FIELD_GATE.x, COW_FIELD_GATE.z); } catch { /* keep going */ }
            if (!b.running) break;
            const gate = b.sdk.getState()?.nearbyLocs.find(l => /gate/i.test(l.name));
            if (gate) await b.bot.openDoor(gate);
            try { await b.bot.walkTo(COW_FIELD.x, COW_FIELD.z); } catch { /* keep going */ }
            updateProgress(b);
            continue;
        }

        // ── LOW HP — flee to bank and wait to regen ───────────────────────────
        if (hp > 0 && hp <= 4 && maxHp > 0) {
            setStatus(b, `⚠️ Low HP (${hp}/${maxHp}) — fleeing to Draynor!`);
            try { await b.bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z); } catch { /* keep going */ }
            if (!b.running) break;
            // Wait for HP to regen (check every 10s for up to 3min)
            for (let i = 0; i < 18 && b.running; i++) {
                await sleep(10_000);
                const healed = b.sdk.getState();
                if (healed && healed.player.hp >= Math.min(10, maxHp)) break;
            }
            updateProgress(b);
            continue;
        }

        // ── BANKING ──────────────────────────────────────────────────────────
        if (invFull || hides.length >= 20) {
            setStatus(b, `Full (${hides.length} hides) — banking at Draynor...`);
            try { await b.bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z); } catch { /* keep going */ }
            if (!b.running) break;

            const opened = await b.bot.openBank();
            if (!opened.success) {
                addLog(b, `Bank failed: ${opened.message} — dropping extras`);
                const beef = b.sdk.getState()?.inventory.filter(i => i.name?.toLowerCase().includes('raw beef')) ?? [];
                for (const item of beef) { await b.sdk.sendDropItem(item.slot); await sleep(100); }
            } else {
                await b.bot.depositItem(/cowhide/i, -1);
                await b.bot.depositItem(/raw beef/i, -1);
                await b.bot.closeBank();
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked (trip #${b.bankTrips}) — returning to cows...`);
            }

            // Return to cow field — open gate if needed
            try { await b.bot.walkTo(COW_FIELD_GATE.x, COW_FIELD_GATE.z); } catch { /* keep going */ }
            if (!b.running) break;
            const gate = b.sdk.getState()?.nearbyLocs.find(l => /gate/i.test(l.name));
            if (gate) await b.bot.openDoor(gate);
            try { await b.bot.walkTo(COW_FIELD.x, COW_FIELD.z); } catch { /* keep going */ }
            continue;
        }

        // ── ALREADY IN COMBAT — wait it out ──────────────────────────────────
        const inCombat = state.player.animId !== -1 && state.player.animId !== 0;
        if (inCombat) {
            setStatus(b, `In combat... (${hides.length} hides, HP: ${hp}/${maxHp})`);
            await sleep(800);
            continue;
        }

        // ── PICK UP GROUND ITEMS ──────────────────────────────────────────────
        const groundHide = b.sdk.findGroundItem(/cowhide/i);
        if (groundHide && inField) {
            setStatus(b, 'Picking up cowhide...');
            await b.bot.pickupItem(groundHide);
            updateProgress(b);
            continue;
        }

        // ── BURY BONES ───────────────────────────────────────────────────────
        const bones = state.inventory.find(i => i.name?.toLowerCase() === 'bones');
        if (bones) {
            setStatus(b, 'Burying bones...');
            await b.sdk.sendUseItem(bones.slot);
            await sleep(800);
            updateProgress(b);
            continue;
        }

        // ── WALK TO COW FIELD ────────────────────────────────────────────────
        if (!inField) {
            setStatus(b, 'Walking to cow field...');
            try { await b.bot.walkTo(COW_FIELD_GATE.x, COW_FIELD_GATE.z); } catch { /* keep going */ }
            if (!b.running) break;
            const gate = b.sdk.getState()?.nearbyLocs.find(l => /gate/i.test(l.name));
            if (gate) await b.bot.openDoor(gate);
            try { await b.bot.walkTo(COW_FIELD.x, COW_FIELD.z); } catch { /* keep going */ }
            continue;
        }

        // ── ATTACK COW ───────────────────────────────────────────────────────
        const cow = b.sdk.findNearbyNpc(/cow/i);
        if (!cow) {
            setStatus(b, 'No cows nearby — waiting...');
            await sleep(1200);
            continue;
        }

        setStatus(b, `Attacking cow... (${hides.length} hides, HP: ${hp}/${maxHp})`);
        const result = await b.bot.attackNpc(cow);
        if (!result.success) {
            addLog(b, `Attack failed: ${result.message}`);
            await sleep(800);
        } else {
            updateProgress(b);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Combat — Chickens ────────────────────────────────────────────────────────
// XChickenSlaughter-style: Lumbridge chicken farm, bury bones, drop feathers (power fight)

async function chickenLoop(b: BotState) {
    setStatus(b, 'Starting chicken fighter...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }

        if (state.dialog?.isOpen) {
            await b.bot.dismissBlockingUI();
            continue;
        }

        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const hp     = state.player.hp;
        const maxHp  = state.player.maxHp;
        const inField = Math.hypot(px - CHICKEN_FIELD.x, pz - CHICKEN_FIELD.z) <= CHICKEN_RADIUS;

        // ── DEATH / RESPAWN DETECTION ─────────────────────────────────────────
        const atLumbridge = Math.hypot(px - LUMBRIDGE.x, pz - LUMBRIDGE.z) < 40;
        if (atLumbridge && !inField) {
            setStatus(b, '☠️ Respawned at Lumbridge — walking to chicken field...');
            try { await b.bot.walkTo(CHICKEN_FIELD.x, CHICKEN_FIELD.z); } catch { /* keep going */ }
            updateProgress(b);
            continue;
        }

        // ── LOW HP ───────────────────────────────────────────────────────────
        if (hp > 0 && hp <= 3 && maxHp > 0) {
            setStatus(b, `⚠️ Low HP (${hp}/${maxHp}) — waiting to regen...`);
            await sleep(10_000);
            updateProgress(b);
            continue;
        }

        // ── DROP FEATHERS (keep inventory clear) ─────────────────────────────
        const feathers = state.inventory.filter(i => /feather/i.test(i.name));
        if (feathers.length >= 10) {
            for (const f of feathers) { await b.sdk.sendDropItem(f.slot); await sleep(100); }
            continue;
        }

        // ── IN COMBAT — wait ─────────────────────────────────────────────────
        const inCombat = state.player.animId !== -1 && state.player.animId !== 0;
        if (inCombat) {
            setStatus(b, `In combat... (HP: ${hp}/${maxHp})`);
            await sleep(800);
            continue;
        }

        // ── BURY BONES ───────────────────────────────────────────────────────
        const bones = state.inventory.find(i => /^bones$/i.test(i.name));
        if (bones) {
            setStatus(b, 'Burying bones...');
            await b.sdk.sendUseItem(bones.slot);
            await sleep(800);
            updateProgress(b);
            continue;
        }

        // ── WALK TO FIELD ────────────────────────────────────────────────────
        if (!inField) {
            setStatus(b, 'Walking to chicken field...');
            try { await b.bot.walkTo(CHICKEN_FIELD.x, CHICKEN_FIELD.z); } catch { /* keep going */ }
            continue;
        }

        // ── ATTACK CHICKEN ───────────────────────────────────────────────────
        const chicken = b.sdk.findNearbyNpc(/^chicken$/i);
        if (!chicken) {
            setStatus(b, 'No chickens nearby — waiting...');
            await sleep(1200);
            continue;
        }

        setStatus(b, `Attacking chicken... (HP: ${hp}/${maxHp})`);
        const result = await b.bot.attackNpc(chicken);
        if (!result.success) {
            addLog(b, `Attack failed: ${result.message}`);
            await sleep(800);
        } else {
            updateProgress(b);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Combat — Goblins (Lumbridge) ────────────────────────────────────────────
// Power fight: bury bones, drop everything else. Easy respawn at Lumbridge.

async function goblinLoop(b: BotState) {
    setStatus(b, 'Starting goblin fighter...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }

        if (state.dialog?.isOpen) {
            await b.bot.dismissBlockingUI();
            continue;
        }

        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const hp     = state.player.hp;
        const maxHp  = state.player.maxHp;
        const inField = Math.hypot(px - GOBLIN_FIELD.x, pz - GOBLIN_FIELD.z) <= GOBLIN_RADIUS;

        // ── DEATH / RESPAWN DETECTION ─────────────────────────────────────────
        const atLumbridge = Math.hypot(px - LUMBRIDGE.x, pz - LUMBRIDGE.z) < 40;
        if (atLumbridge && !inField) {
            setStatus(b, '☠️ Respawned at Lumbridge — walking to goblins...');
            try { await b.bot.walkTo(GOBLIN_FIELD.x, GOBLIN_FIELD.z); } catch { /* keep going */ }
            updateProgress(b);
            continue;
        }

        // ── LOW HP — regen in place ───────────────────────────────────────────
        if (hp > 0 && hp <= 3 && maxHp > 0) {
            setStatus(b, `⚠️ Low HP (${hp}/${maxHp}) — waiting to regen...`);
            await sleep(10_000);
            updateProgress(b);
            continue;
        }

        // ── DROP JUNK (keep inv clear for power fighting) ─────────────────────
        const junk = state.inventory.filter(i => !/^bones$/i.test(i.name) && !/coins/i.test(i.name));
        if (junk.length >= 10) {
            for (const item of junk) { await b.sdk.sendDropItem(item.slot); await sleep(80); }
            continue;
        }

        // ── IN COMBAT — wait it out ───────────────────────────────────────────
        const inCombat = state.player.animId !== -1 && state.player.animId !== 0;
        if (inCombat) {
            setStatus(b, `In combat... (HP: ${hp}/${maxHp})`);
            await sleep(800);
            continue;
        }

        // ── BURY BONES ───────────────────────────────────────────────────────
        const bones = state.inventory.find(i => /^bones$/i.test(i.name));
        if (bones) {
            setStatus(b, 'Burying bones...');
            await b.sdk.sendUseItem(bones.slot);
            await sleep(800);
            updateProgress(b);
            continue;
        }

        // ── WALK TO GOBLIN FIELD ─────────────────────────────────────────────
        if (!inField) {
            setStatus(b, 'Walking to goblin field...');
            try { await b.bot.walkTo(GOBLIN_FIELD.x, GOBLIN_FIELD.z); } catch { /* keep going */ }
            continue;
        }

        // ── ATTACK GOBLIN ─────────────────────────────────────────────────────
        const goblin = b.sdk.findNearbyNpc(/^goblin$/i);
        if (!goblin) {
            setStatus(b, 'No goblins nearby — waiting...');
            await sleep(1200);
            continue;
        }

        setStatus(b, `Attacking goblin... (HP: ${hp}/${maxHp})`);
        const result = await b.bot.attackNpc(goblin);
        if (!result.success) {
            addLog(b, `Attack failed: ${result.message}`);
            await sleep(800);
        } else {
            updateProgress(b);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Combat — Al-Kharid Warriors ─────────────────────────────────────────────
// Palace interior. Banks coins at Al-Kharid bank (very close). Buries bones.

async function alKharidLoop(b: BotState) {
    setStatus(b, 'Starting Al-Kharid Warrior fighter...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }

        if (state.dialog?.isOpen) {
            await b.bot.dismissBlockingUI();
            continue;
        }

        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const hp      = state.player.hp;
        const maxHp   = state.player.maxHp;
        const coins   = state.inventory.filter(i => /^coins?$/i.test(i.name)).reduce((s, i) => s + (i.count ?? 1), 0);
        const invFull = state.inventory.length >= 26;
        const inPalace = Math.hypot(px - AL_KHARID_WARRIORS.x, pz - AL_KHARID_WARRIORS.z) <= AL_KHARID_FIGHT_RADIUS;

        // ── DEATH / RESPAWN ────────────────────────────────────────────────────
        const atLumbridge = Math.hypot(px - LUMBRIDGE.x, pz - LUMBRIDGE.z) < 40;
        if (atLumbridge && !inPalace) {
            setStatus(b, '☠️ Respawned at Lumbridge — returning to Al-Kharid...');
            // Go via the longer southern path to avoid toll gate
            try { await b.bot.walkTo(3271, 3228); } catch { /* keep going */ } // just past gate area
            try { await b.bot.walkTo(AL_KHARID_WARRIORS.x, AL_KHARID_WARRIORS.z); } catch { /* keep going */ }
            updateProgress(b);
            continue;
        }

        // ── LOW HP — flee to bank and regen ──────────────────────────────────
        if (hp > 0 && hp <= 5 && maxHp > 0) {
            setStatus(b, `⚠️ Low HP (${hp}/${maxHp}) — fleeing to Al-Kharid bank!`);
            try { await b.bot.walkTo(AL_KHARID_BANK.x, AL_KHARID_BANK.z); } catch { /* keep going */ }
            for (let i = 0; i < 18 && b.running; i++) {
                await sleep(10_000);
                const healed = b.sdk.getState();
                if (healed && healed.player.hp >= Math.min(8, maxHp)) break;
            }
            updateProgress(b);
            continue;
        }

        // ── BANK COINS when inv full or carrying a lot ─────────────────────────
        if (invFull || coins >= 500) {
            setStatus(b, `Banking (${coins} coins, inv ${state.inventory.length}/28)...`);
            try { await b.bot.walkTo(AL_KHARID_BANK.x, AL_KHARID_BANK.z); } catch { /* keep going */ }
            if (!b.running) break;
            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 3 && b.running; attempt++) {
                await sleep(700);
                opened = await b.bot.openBank();
                if (opened.success) break;
                addLog(b, `Bank attempt ${attempt}/3: ${opened.message}`);
                await sleep(1000);
            }
            if (opened.success) {
                // Deposit everything except coins (keep coins to pass gate if needed)
                const inv = b.sdk.getState()?.inventory ?? [];
                for (const item of inv) {
                    if (!/^coins?$/i.test(item.name)) {
                        await b.bot.depositItem(new RegExp(item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), -1);
                    }
                }
                await b.bot.depositItem(/^coins?$/i, -1); // bank coins too
                await b.bot.closeBank();
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked (trip #${b.bankTrips}) — back to palace...`);
            }
            try { await b.bot.walkTo(AL_KHARID_WARRIORS.x, AL_KHARID_WARRIORS.z); } catch { /* keep going */ }
            continue;
        }

        // ── IN COMBAT — wait ─────────────────────────────────────────────────
        const inCombat = state.player.animId !== -1 && state.player.animId !== 0;
        if (inCombat) {
            setStatus(b, `Fighting Al-Kharid warrior... (HP: ${hp}/${maxHp})`);
            await sleep(800);
            continue;
        }

        // ── BURY BONES ───────────────────────────────────────────────────────
        const bones = state.inventory.find(i => /^bones$/i.test(i.name));
        if (bones) {
            setStatus(b, 'Burying bones...');
            await b.sdk.sendUseItem(bones.slot);
            await sleep(800);
            updateProgress(b);
            continue;
        }

        // ── WALK TO PALACE ────────────────────────────────────────────────────
        if (!inPalace) {
            setStatus(b, 'Walking to Al-Kharid palace...');
            try { await b.bot.walkTo(AL_KHARID_WARRIORS.x, AL_KHARID_WARRIORS.z); } catch { /* keep going */ }
            continue;
        }

        // ── ATTACK AL-KHARID WARRIOR ──────────────────────────────────────────
        const warrior = b.sdk.findNearbyNpc(/al.?kharid warrior|warrior/i);
        if (!warrior) {
            // Try secondary position in palace
            setStatus(b, 'No warrior nearby — checking other side of palace...');
            const dist2 = Math.hypot(px - AL_KHARID_WARRIORS2.x, pz - AL_KHARID_WARRIORS2.z);
            if (dist2 > 5) {
                try { await b.bot.walkTo(AL_KHARID_WARRIORS2.x, AL_KHARID_WARRIORS2.z); } catch { /* keep going */ }
            }
            await sleep(1500);
            continue;
        }

        setStatus(b, `Attacking Al-Kharid warrior... (HP: ${hp}/${maxHp}, ${coins} coins)`);
        const result = await b.bot.attackNpc(warrior);
        if (!result.success) {
            addLog(b, `Attack failed: ${result.message}`);
            await sleep(800);
        } else {
            updateProgress(b);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Woodcutting — Willows ────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// ─── Manual command handler ────────────────────────────────────────────────────
// Called at the top of every loop iteration. Returns true if a command ran.
async function checkAndRunCmd(b: BotState): Promise<boolean> {
    const cmd = b.pendingCmd;
    if (!cmd) return false;
    b.pendingCmd = null;
    addLog(b, `⚡ CMD: ${cmd}`);
    try {
        if (cmd === 'bank') {
            // Walk to nearest bank based on rough position
            const state = b.sdk.getState();
            const x = state?.player.worldX ?? 0;
            const z = state?.player.worldZ ?? 0;
            // Pick nearest known bank
            const banks = [
                { name: 'Lumbridge',   x: 3208, z: 3220 },
                { name: 'Draynor',     x: 3092, z: 3243 },
                { name: 'Varrock W',   x: 3185, z: 3436 },
                { name: 'Varrock E',   x: 3253, z: 3421 },
                { name: 'Falador',     x: 3016, z: 3355 },
                { name: 'Edgeville',   x: 3095, z: 3492 },
                { name: 'Al Kharid',   x: 3269, z: 3167 },
            ];
            const nearest = banks.sort((a, bk) => Math.hypot(a.x - x, a.z - z) - Math.hypot(bk.x - x, bk.z - z))[0];
            setStatus(b, `CMD: walking to ${nearest.name} bank...`);
            await b.bot.walkTo(nearest.x, nearest.z, 5);
            await b.bot.openBank();
        } else if (cmd === 'bank_deposit_all') {
            setStatus(b, 'CMD: depositing all...');
            await b.bot.openBank();
            const state = b.sdk.getState();
            if (state) for (const item of state.inventory) await b.bot.depositItem(new RegExp(item.name, 'i'), -1);
            await b.bot.closeBank?.();
        } else if (cmd === 'lumbridge') {
            setStatus(b, 'CMD: walking to Lumbridge...');
            await b.bot.walkTo(3222, 3218, 5);
        } else if (cmd === 'falador') {
            setStatus(b, 'CMD: walking to Falador...');
            await b.bot.walkTo(2964, 3378, 5);
        } else if (cmd === 'satoshi_teleport') {
            setStatus(b, 'CMD: Satoshi teleport → Lumbridge...');
            // Lumbridge Teleport spell (component 1167) — free & unlimited on this server
            await b.sdk.sendClickComponent(1167);
            await b.sdk.waitForTicks(4); // teleport animation
        } else if (cmd === 'yews') {
            setStatus(b, 'CMD: walking to Edgeville yews...');
            await b.bot.walkTo(3087, 3470, 5);
        } else if (cmd === 'willows') {
            setStatus(b, 'CMD: walking to Draynor willows...');
            await b.bot.walkTo(3087, 3235, 5);
        } else if (cmd === 'cows') {
            setStatus(b, 'CMD: walking to cow field...');
            await b.bot.walkTo(3257, 3272, 10);
        } else if (cmd === 'varrock_mine') {
            setStatus(b, 'CMD: walking to Varrock East mine...');
            await b.bot.walkTo(3285, 3365, 8);
        } else if (cmd === 'draynor') {
            setStatus(b, 'CMD: walking to Draynor...');
            await b.bot.walkTo(3092, 3243, 5);
        } else if (cmd.startsWith('goto:')) {
            const [, coords] = cmd.split(':');
            const [gx, gz] = coords.split(',').map(Number);
            if (!isNaN(gx) && !isNaN(gz)) {
                setStatus(b, `CMD: walking to (${gx}, ${gz})...`);
                await b.bot.walkTo(gx, gz, 3);
            }
        } else if (cmd === 'buy_pickaxe') {
            // Sell junk at Draynor general store → buy bronze pickaxe from Bob's Axes Lumbridge
            setStatus(b, 'CMD: selling ore at Draynor general store...');
            await walkToLong(b, 3092, 3245);
            await b.bot.walkTo(3092, 3245, 5);
            try {
                await b.bot.openShop();
                const invBefore = b.sdk.getState()?.inventory ?? [];
                const toSell = invBefore.filter(i => /ore|log|hide/i.test(i.name));
                for (const item of toSell) {
                    await b.bot.sellToShop(new RegExp('^' + item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), item.count);
                }
            } catch (e2: any) {
                addLog(b, `CMD buy_pickaxe: sell step failed (${e2.message})`);
            }
            const coinsNow = b.sdk.getState()?.inventory?.find(i => /^coins?$/i.test(i.name));
            if (!coinsNow || coinsNow.count < 1) {
                addLog(b, 'CMD buy_pickaxe: no coins after selling — aborting pickaxe buy');
            } else {
                setStatus(b, `CMD: have ${coinsNow.count} gp — buying pickaxe at Bob's Axes...`);
                await walkToLong(b, 3230, 3203);
                await b.bot.walkTo(3230, 3203, 3);
                await b.bot.openShop();
                await b.bot.buyFromShop(/bronze pickaxe/i, 1);
                addLog(b, 'CMD buy_pickaxe: done — pickaxe acquired!');
            }
        }
    } catch (e: any) {
        addLog(b, `CMD error: ${e.message}`);
    }
    updateProgress(b);
    return true;
}

async function willowLoop(b: BotState) {
    setStatus(b, 'Starting willow woodcutter...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }

        if (state.dialog?.isOpen) {
            await b.bot.dismissBlockingUI();
            continue;
        }

        // Escape essence mine if somehow trapped there
        if (isInEssenceMine(state.player.worldZ)) {
            setStatus(b, 'Stuck in essence mine — exiting via portal...');
            const portal = state.nearbyLocs.find(l => /portal|mine exit/i.test(l.name));
            if (portal) {
                const opt = portal.optionsWithIndex[0];
                if (opt) await b.sdk.sendInteractLoc(portal.x, portal.z, portal.id, opt.opIndex);
            }
            await sleep(5000);
            continue;
        }

        const invFull = state.inventory.length >= 27; // bank with 1 slot spare — avoids wasted chop when nearly full

        if (invFull) {
            const logCount = state.inventory.filter(i => /willow/i.test(i.name)).length;
            setStatus(b, `Inventory full (${logCount} willow logs) — banking...`);

            await walkToLong(b, DRAYNOR_BANK.x, DRAYNOR_BANK.z);
            try { await b.bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 3); } catch { /* keep going */ }
            if (!b.running) break;

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 3 && b.running; attempt++) {
                try {
                    opened = await b.bot.openBank();
                    if (opened.success) break;
                    addLog(b, `Bank attempt ${attempt}/3: ${opened.message}`);
                } catch (e: any) {
                    addLog(b, `Bank error attempt ${attempt}/3: ${e?.message ?? e}`);
                }
                await sleep(1000);
            }
            if (!opened.success) {
                addLog(b, `Failed to open bank — retrying next cycle`);
                await sleep(1000);
                continue;
            }

            try { await b.bot.depositItem(/willow logs/i, -1); } catch { /* keep going */ }
            try { await b.bot.closeBank(); } catch { /* keep going */ }
            b.bankTrips++;
            updateProgress(b);
            setStatus(b, `Banked (trip #${b.bankTrips}) — returning to willows...`);
            try { await b.bot.walkTo(DRAYNOR_WILLOWS.x, DRAYNOR_WILLOWS.z); } catch { /* keep going */ }
            continue;
        }

        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const dist = Math.hypot(px - DRAYNOR_WILLOWS.x, pz - DRAYNOR_WILLOWS.z);
        if (dist > MAX_DRIFT) {
            setStatus(b, 'Walking to willow trees...');
            await walkToLong(b, DRAYNOR_WILLOWS.x, DRAYNOR_WILLOWS.z);
            try { await b.bot.walkTo(DRAYNOR_WILLOWS.x, DRAYNOR_WILLOWS.z, 3); } catch { /* keep going */ }
            await sleep(1000);
            continue;
        }

        const willow = b.sdk.findNearbyLoc(/^willow$/i) as NearbyLoc | undefined;
        if (!willow) {
            setStatus(b, 'No willow nearby — waiting...');
            await sleep(1200);
            continue;
        }

        const logCount = state.inventory.filter(i => /willow/i.test(i.name)).length;
        setStatus(b, `Chopping willow — ${logCount}/28 logs`);

        const result = await b.bot.chopTree(willow);
        if (!result.success) {
            addLog(b, `Chop failed: ${result.message}`);
            await sleep(600);
        } else {
            updateProgress(b);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Lumbridge Willow Woodcutter ───────────────────────────────────────────
// Two willows east of the general store. Banks at Satoshi's booths (30 tiles away).
async function willowLumbridgeLoop(b: BotState) {
    setStatus(b, 'Starting Lumbridge willow woodcutter...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }

        if (state.dialog?.isOpen) {
            await b.bot.dismissBlockingUI();
            continue;
        }

        const invFull = state.inventory.length >= 27;

        if (invFull) {
            const logCount = state.inventory.filter(i => /willow/i.test(i.name)).length;
            setStatus(b, `Inventory full (${logCount} logs) — banking at Satoshi...`);

            try { await b.bot.walkTo(LUMBRIDGE_SATOSHI_BANK.x, LUMBRIDGE_SATOSHI_BANK.z, 2); } catch { /* keep going */ }
            if (!b.running) break;

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 5 && b.running; attempt++) {
                await sleep(500);
                try {
                    opened = await b.bot.openBank();
                    if (opened.success) break;
                    addLog(b, `Bank attempt ${attempt}/5: ${opened.message}`);
                } catch (e: any) {
                    addLog(b, `Bank error attempt ${attempt}/5: ${e?.message ?? e}`);
                }
                if (attempt === 3) {
                    try { await b.bot.walkTo(LUMBRIDGE_SATOSHI_BANK.x, LUMBRIDGE_SATOSHI_BANK.z, 1); } catch { /* keep going */ }
                }
                await sleep(800);
            }

            if (!opened.success) {
                addLog(b, 'Failed to open bank — retrying next cycle');
                await sleep(1000);
                continue;
            }

            try { await b.bot.depositItem(/willow logs/i, -1); } catch { /* keep going */ }
            try { await b.bot.closeBank(); } catch { /* keep going */ }
            b.bankTrips++;
            updateProgress(b);
            setStatus(b, `Banked (trip #${b.bankTrips}) — returning to willows...`);
            try { await b.bot.walkTo(LUMBRIDGE_WILLOWS.x, LUMBRIDGE_WILLOWS.z, 5); } catch { /* keep going */ }
            continue;
        }

        // Return to tree area if drifted
        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const dist = Math.hypot(px - LUMBRIDGE_WILLOWS.x, pz - LUMBRIDGE_WILLOWS.z);
        if (dist > MAX_DRIFT) {
            setStatus(b, 'Walking to Lumbridge willows...');
            try { await b.bot.walkTo(LUMBRIDGE_WILLOWS.x, LUMBRIDGE_WILLOWS.z, 5); } catch { /* keep going */ }
            await sleep(800);
            continue;
        }

        const willow = b.sdk.findNearbyLoc(/^willow$/i) as NearbyLoc | undefined;
        if (!willow) {
            setStatus(b, 'No willow nearby — waiting for respawn...');
            await sleep(1500);
            continue;
        }

        const logCount = state.inventory.filter(i => /willow/i.test(i.name)).length;
        setStatus(b, `Chopping willow — ${logCount}/28 logs`);

        const result = await b.bot.chopTree(willow);
        if (!result.success) {
            addLog(b, `Chop failed: ${result.message}`);
            await sleep(600);
        } else {
            updateProgress(b);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Lumbridge Pickpocket (Men/Women) ──────────────────────────────────────
// Pickpockets men and women inside Lumbridge castle. Banks GP at Satoshi nearby.
const LUMBRIDGE_CASTLE     = { x: 3222, z: 3218 };
const GP_BANK_THRESHOLD    = 500; // bank when carrying this much GP
const STUN_WAIT_TICKS      = 8;   // ~5s stun recovery

async function thievingLumbridgeLoop(b: BotState) {
    setStatus(b, 'Starting Lumbridge pickpocket...');
    let successCount = 0;
    let stunCount    = 0;

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }

        if (state.dialog?.isOpen) {
            await b.bot.dismissBlockingUI();
            continue;
        }

        // HP safety — if low, eat anything edible in inventory
        if (state.player.hp > 0 && state.player.hp <= 4) {
            const food = state.inventory.find(i => i.optionsWithIndex?.some((o: any) => /eat/i.test(o.text)));
            if (food) {
                addLog(b, `Low HP (${state.player.hp}) — eating ${food.name}`);
                await b.sdk.sendUseItem(food.slot);
                await sleep(600);
                continue;
            }
        }

        // Bank GP if over threshold
        const coins = state.inventory.find(i => /^coins?$/i.test(i.name));
        const gp = coins?.count ?? 0;
        const invFull = state.inventory.length >= 27;
        if (gp >= GP_BANK_THRESHOLD || invFull) {
            setStatus(b, `Banking ${gp} GP (trip #${b.bankTrips + 1})...`);
            try { await b.bot.walkTo(LUMBRIDGE_SATOSHI_BANK.x, LUMBRIDGE_SATOSHI_BANK.z, 2); } catch { /* keep going */ }
            if (!b.running) break;

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 5 && b.running; attempt++) {
                await sleep(500);
                try { opened = await b.bot.openBank(); if (opened.success) break; } catch { /* keep going */ }
                if (attempt === 3) try { await b.bot.walkTo(LUMBRIDGE_SATOSHI_BANK.x, LUMBRIDGE_SATOSHI_BANK.z, 1); } catch { /* keep going */ }
                await sleep(800);
            }
            if (opened.success) {
                try { await b.bot.depositItem(/^coins?$/i, -1); } catch { /* keep going */ }
                try { await b.bot.closeBank(); } catch { /* keep going */ }
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked ${gp} GP (trip #${b.bankTrips}) — back to pickpocketing...`);
            } else {
                addLog(b, 'Bank failed — continuing');
            }
            try { await b.bot.walkTo(LUMBRIDGE_CASTLE.x, LUMBRIDGE_CASTLE.z, 5); } catch { /* keep going */ }
            continue;
        }

        // Walk to castle if drifted
        const px = state.player.worldX;
        const pz = state.player.worldZ;
        if (Math.hypot(px - LUMBRIDGE_CASTLE.x, pz - LUMBRIDGE_CASTLE.z) > MAX_DRIFT) {
            setStatus(b, 'Walking to Lumbridge castle...');
            try { await b.bot.walkTo(LUMBRIDGE_CASTLE.x, LUMBRIDGE_CASTLE.z, 5); } catch { /* keep going */ }
            continue;
        }

        // Find man or woman to pickpocket
        const target = b.sdk.findNearbyNpc(/^(man|woman)$/i);
        if (!target) {
            setStatus(b, 'No target nearby — searching...');
            await sleep(800);
            continue;
        }

        setStatus(b, `Pickpocketing ${target.name} — ${successCount} success / ${stunCount} stuns`);
        const result = await b.bot.pickpocketNpc(target);

        if (result.success) {
            successCount++;
            updateProgress(b);
        } else {
            stunCount++;
            // Stun: wait for recovery before retrying
            addLog(b, `Stunned! Waiting recovery... (stun #${stunCount})`);
            await b.sdk.waitForTicks(STUN_WAIT_TICKS);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Long-distance walk helper ─────────────────────────────────────────────
// Uses 50-tile hops with b.running checks between each — Stop takes effect fast.
async function walkToLong(b: BotState, destX: number, destZ: number): Promise<void> {
    const HOP = 50;
    for (let guard = 0; guard < 60 && b.running; guard++) {
        const s = b.sdk.getState();
        if (!s) return;
        const dx = destX - s.player.worldX;
        const dz = destZ - s.player.worldZ;
        const dist = Math.hypot(dx, dz);
        if (dist <= 5) return;

        let hopX: number, hopZ: number;
        if (dist <= HOP) {
            hopX = destX; hopZ = destZ;
        } else {
            const scale = HOP / dist;
            hopX = Math.round(s.player.worldX + dx * scale);
            hopZ = Math.round(s.player.worldZ + dz * scale);
        }

        const before = { x: s.player.worldX, z: s.player.worldZ };
        try { await b.bot.walkTo(hopX, hopZ, 3); } catch (e) {}
        if (!b.running) return;

        const after = b.sdk.getState();
        if (!after) return;
        const moved = Math.hypot(after.player.worldX - before.x, after.player.worldZ - before.z);
        if (moved < 3) await new Promise(r => setTimeout(r, 1000));
    }
}

function findChoppableYew(b: BotState): NearbyLoc | undefined {
    const state = b.sdk.getState();
    if (!state) return undefined;
    return state.nearbyLocs.find(loc =>
        /^yew/i.test(loc.name) &&
        !/stump/i.test(loc.name) &&
        loc.optionsWithIndex.some(o => /^chop/i.test(o.text))
    ) as NearbyLoc | undefined;
}

async function waitForChop(b: BotState, logsBefore: number, timeoutMs = 90_000): Promise<void> {
    const start = Date.now();
    let lastLogs = logsBefore;
    let idleTicks = 0;
    while (Date.now() - start < timeoutMs && b.running) {
        await sleep(1200);
        const ns = b.sdk.getState();
        if (!ns) break;
        if (ns.inventory.length >= 28) break; // full — bank time
        const curLogs = ns.inventory.filter(i => /yew/i.test(i.name)).length;
        if (curLogs > lastLogs) { lastLogs = curLogs; idleTicks = 0; updateProgress(b); continue; }
        if (ns.player.animId === -1) {
            idleTicks++;
            if (idleTicks >= 3) break; // tree depleted or chop stopped
        } else {
            idleTicks = 0;
        }
    }
}

async function yewLoop(b: BotState) {
    setStatus(b, 'Starting yew woodcutter — Edgeville...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }

        if (state.dialog?.isOpen) {
            await b.bot.dismissBlockingUI();
            continue;
        }

        const logCount = state.inventory.filter(i => /yew/i.test(i.name)).length;
        const invFull  = state.inventory.length >= 27;
        const shouldBank = invFull || logCount >= 20;

        if (shouldBank) {
            setStatus(b, `Banking (${logCount} yew logs, ${state.inventory.length}/28 slots) — Edgeville...`);
            await walkToLong(b, EDGEVILLE_BANK.x, EDGEVILLE_BANK.z);
            if (!b.running) break;

            const bankNudges = [
                { x: 3095, z: 3492 }, // primary
                { x: 3094, z: 3491 }, // nudge 1
                { x: 3096, z: 3492 }, // nudge 2
                { x: 3095, z: 3493 }, // nudge 3
            ];
            let opened = { success: false, message: '' };
            for (let attempt = 0; attempt < bankNudges.length && b.running; attempt++) {
                await sleep(700);
                opened = await b.bot.openBank();
                if (opened.success) break;
                addLog(b, `Bank attempt ${attempt + 1}/${bankNudges.length} failed: ${opened.message} — nudging...`);
                try { await b.bot.walkTo(bankNudges[attempt].x, bankNudges[attempt].z, 1); } catch { /* keep going */ }
                await sleep(1000);
            }
            if (!opened.success) {
                addLog(b, 'Bank failed — dropping junk to free space');
                // Drop non-essential items so we can at least start chopping
                const junk = b.sdk.getState()?.inventory.filter(i => !/yew/i.test(i.name)) ?? [];
                for (const item of junk.slice(0, 10)) { await b.sdk.sendDropItem(item.slot); await sleep(80); }
            } else {
                // Deposit yew logs + any junk clogging the inventory
                await b.bot.depositItem(/yew logs/i, -1);
                if (logCount === 0) {
                    // Inventory was full of junk — deposit everything to reset
                    const inv = b.sdk.getState()?.inventory ?? [];
                    for (const item of inv) {
                        await b.bot.depositItem(new RegExp(item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), -1);
                    }
                }
                await b.bot.closeBank();
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked (trip #${b.bankTrips}) — returning to yews...`);
            }
            await walkToLong(b, EDGEVILLE_YEWS.x, EDGEVILLE_YEWS.z);
            continue;
        }

        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const distPrimary   = Math.hypot(px - EDGEVILLE_YEWS.x,  pz - EDGEVILLE_YEWS.z);
        const distSecondary = Math.hypot(px - EDGEVILLE_YEWS2.x, pz - EDGEVILLE_YEWS2.z);
        const nearYews = Math.min(distPrimary, distSecondary) <= MAX_DRIFT;
        if (!nearYews) {
            setStatus(b, 'Walking to Edgeville yew trees...');
            await walkToLong(b, EDGEVILLE_YEWS.x, EDGEVILLE_YEWS.z);
            continue;
        }

        const yew = findChoppableYew(b);
        if (!yew) {
            setStatus(b, 'No choppable yew nearby — waiting for respawn...');
            await sleep(5000);
            continue;
        }

        setStatus(b, `Chopping yew — ${logCount}/27 logs`);
        let result = { success: false, message: '' };
        try { result = await b.bot.chopTree(yew); } catch (e: any) { result = { success: false, message: e?.message ?? String(e) }; }
        if (!result.success) {
            addLog(b, `Chop failed: ${result.message}`);
            await sleep(5000 + Math.random() * 5000);
        } else {
            updateProgress(b);
            // Stay on the tree — yews take many ticks per log
            await waitForChop(b, logCount);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Woodcutting — Yews (Varrock Castle) ─────────────────────────────────────
// South side of Varrock Palace; bank at Varrock West (short walk south)

async function yewVarrockLoop(b: BotState) {
    setStatus(b, 'Starting yew woodcutter — Varrock Castle...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }

        if (state.dialog?.isOpen) {
            await b.bot.dismissBlockingUI();
            continue;
        }

        const logCount = state.inventory.filter(i => /yew/i.test(i.name)).length;
        const invFull  = state.inventory.length >= 28;
        const shouldBank = invFull || logCount >= 20;

        if (shouldBank) {
            setStatus(b, `Banking (${logCount} yew logs, ${state.inventory.length}/28 slots) — Varrock West...`);
            try { await b.bot.walkTo(VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z); } catch { /* keep going */ }
            if (!b.running) break;

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 4 && b.running; attempt++) {
                await sleep(700);
                opened = await b.bot.openBank();
                if (opened.success) break;
                addLog(b, `Bank attempt ${attempt}/4 failed: ${opened.message} — nudging...`);
                const nudge = [
                    { x: 3185, z: 3436 },
                    { x: 3184, z: 3435 },
                    { x: 3186, z: 3436 },
                    { x: 3185, z: 3437 },
                ][attempt - 1] ?? VARROCK_WEST_BANK;
                try { await b.bot.walkTo(nudge.x, nudge.z, 1); } catch { /* keep going */ }
                await sleep(1000);
            }
            if (!opened.success) {
                addLog(b, 'Bank failed — dropping junk to free space');
                const junk = b.sdk.getState()?.inventory.filter(i => !/yew/i.test(i.name)) ?? [];
                for (const item of junk.slice(0, 10)) { await b.sdk.sendDropItem(item.slot); await sleep(80); }
            } else {
                // Deposit yew logs first, then deposit any remaining non-gear junk
                await b.bot.depositItem(/yew logs/i, -1);
                const keepGearYew = /axe|helm|shield|sword|armor|armour|gloves|boots|legs|body|cape|amulet|ring/i;
                const invAfter = b.sdk.getState()?.inventory ?? [];
                for (const item of invAfter) {
                    if (!keepGearYew.test(item.name)) {
                        await b.bot.depositItem(new RegExp('^' + item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), -1);
                    }
                }
                await b.bot.closeBank();
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked (trip #${b.bankTrips}) — returning to Varrock yews...`);
            }
            try { await b.bot.walkTo(VARROCK_CASTLE_YEWS.x, VARROCK_CASTLE_YEWS.z); } catch { /* keep going */ }
            continue;
        }

        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const dist1 = Math.hypot(px - VARROCK_CASTLE_YEWS.x,  pz - VARROCK_CASTLE_YEWS.z);
        const dist2 = Math.hypot(px - VARROCK_CASTLE_YEWS2.x, pz - VARROCK_CASTLE_YEWS2.z);
        const nearYews = Math.min(dist1, dist2) <= MAX_DRIFT;
        if (!nearYews) {
            setStatus(b, 'Walking to Varrock Castle yew trees...');
            try { await b.bot.walkTo(VARROCK_CASTLE_YEWS.x, VARROCK_CASTLE_YEWS.z); } catch { /* keep going */ }
            continue;
        }

        // Look for choppable yew (has Chop option, not a stump)
        const yew = state.nearbyLocs.find(loc =>
            /^yew/i.test(loc.name) &&
            !/stump/i.test(loc.name) &&
            loc.optionsWithIndex.some(o => /^chop/i.test(o.text))
        ) as NearbyLoc | undefined;

        if (!yew) {
            // Both trees down — wait for respawn (~100s), poll every 10s to avoid walk spam
            setStatus(b, 'No choppable yew nearby — waiting for respawn...');
            const altPos = Math.hypot(px - VARROCK_CASTLE_YEWS2.x, pz - VARROCK_CASTLE_YEWS2.z) > 5
                ? VARROCK_CASTLE_YEWS2 : VARROCK_CASTLE_YEWS;
            try { await b.bot.walkTo(altPos.x, altPos.z); } catch { /* keep going */ }
            await sleep(10_000);
            continue;
        }

        setStatus(b, `Chopping Varrock yew — ${logCount}/28 logs`);
        let result = { success: false, message: '' };
        try { result = await b.bot.chopTree(yew); } catch (e: any) { result = { success: false, message: e?.message ?? String(e) }; }
        if (!result.success) {
            addLog(b, `Chop failed: ${result.message}`);
            // Back off and move to alternate tree so competing bots desync
            const ns = b.sdk.getState();
            const npx = ns?.player.worldX ?? px;
            const npz = ns?.player.worldZ ?? pz;
            const altPos = Math.hypot(npx - VARROCK_CASTLE_YEWS2.x, npz - VARROCK_CASTLE_YEWS2.z) > 3
                ? VARROCK_CASTLE_YEWS2 : VARROCK_CASTLE_YEWS;
            try { await b.bot.walkTo(altPos.x, altPos.z); } catch { /* keep going */ }
            await sleep(5000 + Math.random() * 5000);
        } else {
            updateProgress(b);
            await waitForChop(b, logCount);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Mining — Varrock East ────────────────────────────────────────────────────
// SE Varrock mine (iron/copper/tin) → Varrock West bank

async function miningVarrockEastLoop(b: BotState) {
    setStatus(b, 'Starting Varrock East miner...');
    const skipRocks = new Map<string, number>();

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }
        if (state.dialog?.isOpen) { await b.bot.dismissBlockingUI(); continue; }

        const isOre = (name: string) => /(ore$|^coal$|^tin$|^copper$)/i.test(name);
        const oreCount = state.inventory.filter(i => isOre(i.name)).length;
        const invFull  = state.inventory.length >= 28;

        // ── BANK ─────────────────────────────────────────────────────────────
        if (invFull || oreCount >= 24) {
            setStatus(b, `Full (${oreCount} ore) — banking at Varrock West...`);

            // Exit any building the bot wandered into while mining (e.g. fancy dress shop).
            // Rocks near z~3390+ are inside/adjacent to buildings — open the door and get out.
            const buildDoor = b.sdk.getState()?.nearbyLocs.find(
                l => /^door$/i.test(l.name) && l.distance <= 6
            );
            if (buildDoor) {
                addLog(b, `Exiting building via door at (${buildDoor.x},${buildDoor.z})...`);
                try { await b.bot.openDoor(buildDoor); await sleep(600); } catch { /* keep going */ }
                // Walk south away from building to open ground
                try { await b.sdk.sendWalk(buildDoor.x + 2, buildDoor.z - 4, true); await sleep(1200); } catch { /* keep going */ }
            }

            // Normalize to a safe start position south of all buildings before bank route
            try { await b.bot.walkTo(3290, 3370, 5); } catch { /* keep going */ }
            await sleep(300);

            // Pre-step: approach the SE Varrock gate and open it before waypoint walking.
            // The gate at ~(3273,3380) is ~19 tiles from the mine start, too far for the
            // per-waypoint distance-4 check. Walk to just south of it first, then open it.
            try { await b.bot.walkTo(3280, 3374, 5); } catch { /* keep going */ }
            await sleep(300);
            const seGate = b.sdk.getState()?.nearbyLocs.find(l => /^(door|gate)$/i.test(l.name) && l.distance <= 10);
            if (seGate) {
                try { await b.bot.openDoor(seGate); await sleep(700); } catch { /* keep going */ }
            }

            for (const wp of VARROCK_EAST_BANK_WPS) {
                if (!b.running) break;
                // Open any door/gate blocking the path before each waypoint step (wider scan)
                const nearDoor = b.sdk.getState()?.nearbyLocs.find(l => /^(door|gate)$/i.test(l.name) && l.distance <= 8);
                if (nearDoor) { try { await b.bot.openDoor(nearDoor); await sleep(500); } catch { /* keep going */ } }
                try { await b.bot.walkTo(wp.x, wp.z, 5); } catch { /* keep going */ }
                await sleep(400);
                // Check door AFTER walking (bot may have stopped in front of a closed gate)
                const afterDoor = b.sdk.getState()?.nearbyLocs.find(l => /^(door|gate)$/i.test(l.name) && l.distance <= 5);
                if (afterDoor) { try { await b.bot.openDoor(afterDoor); await sleep(600); } catch { /* keep going */ } }
            }
            if (!b.running) break;
            try { await b.bot.walkTo(VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z); } catch { /* keep going */ }

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 3 && b.running; attempt++) {
                await sleep(800);
                try {
                    opened = await b.bot.openBank();
                    if (opened.success) break;
                    addLog(b, `Bank attempt ${attempt}/3 failed: ${opened.message} — retrying...`);
                } catch (e: any) {
                    addLog(b, `Bank error attempt ${attempt}/3: ${e?.message ?? e}`);
                }
                await sleep(1200);
            }

            if (!opened.success) {
                addLog(b, `Bank failed — heading back to mine`);
                await sleep(2000);
            } else {
                // Deposit all ore/resources — exact name match per slot so nothing is left behind
                const keepGear = /pickaxe|axe|helm|shield|sword|armor|armour|gloves|boots|legs|body|cape|amulet|ring/i;
                const mineInv1 = b.sdk.getState()?.inventory ?? [];
                for (const name of [...new Set(mineInv1.filter(i => !keepGear.test(i.name)).map(i => i.name))]) {
                    try { await b.bot.depositItem(new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), -1); } catch { /* keep going */ }
                }
                try { await b.bot.closeBank(); } catch { /* keep going */ }
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked (trip #${b.bankTrips}) — returning to mine...`);
            }

            // Return via waypoints — open gate when heading back out of Varrock too
            for (const wp of VARROCK_EAST_MINE_WPS) {
                if (!b.running) break;
                const nearDoor2 = b.sdk.getState()?.nearbyLocs.find(l => /^(door|gate)$/i.test(l.name) && l.distance <= 8);
                if (nearDoor2) { try { await b.bot.openDoor(nearDoor2); await sleep(500); } catch { /* keep going */ } }
                try { await b.bot.walkTo(wp.x, wp.z, 5); } catch { /* keep going */ }
                await sleep(400);
                const afterDoor2 = b.sdk.getState()?.nearbyLocs.find(l => /^(door|gate)$/i.test(l.name) && l.distance <= 5);
                if (afterDoor2) { try { await b.bot.openDoor(afterDoor2); await sleep(600); } catch { /* keep going */ } }
            }
            try { await b.bot.walkTo(VARROCK_EAST_MINE.x, VARROCK_EAST_MINE.z, 8); } catch { /* keep going */ }
            continue;
        }

        // ── POSITION CHECK ───────────────────────────────────────────────────
        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const dist = Math.hypot(px - VARROCK_EAST_MINE.x, pz - VARROCK_EAST_MINE.z);
        if (dist > MAX_DRIFT) {
            setStatus(b, 'Walking to Varrock East mine...');
            // Use waypoints to avoid blocked doors through Varrock centre
            // Re-read position after each walkTo so skip logic uses current position
            for (const wp of VARROCK_EAST_MINE_WPS) {
                if (!b.running) break;
                const cur = b.sdk.getState()?.player;
                const curDist = cur ? Math.hypot(cur.worldX - wp.x, cur.worldZ - wp.z) : 999;
                if (curDist < 15) continue; // already past this waypoint
                const nearDoor3 = b.sdk.getState()?.nearbyLocs.find(l => /^(door|gate)$/i.test(l.name) && l.distance <= 8);
                if (nearDoor3) { try { await b.bot.openDoor(nearDoor3); await sleep(500); } catch { /* keep going */ } }
                try { await b.bot.walkTo(wp.x, wp.z, 5); } catch { /* keep going */ }
                await sleep(500);
                const afterDoor3 = b.sdk.getState()?.nearbyLocs.find(l => /^(door|gate)$/i.test(l.name) && l.distance <= 5);
                if (afterDoor3) { try { await b.bot.openDoor(afterDoor3); await sleep(600); } catch { /* keep going */ } }
            }
            try { await b.bot.walkTo(VARROCK_EAST_MINE.x, VARROCK_EAST_MINE.z, 8); } catch { /* keep going */ }
            await sleep(1000);
            continue;
        }

        // ── MINE ─────────────────────────────────────────────────────────────
        const now = Date.now();
        for (const [k, exp] of skipRocks) if (now > exp) skipRocks.delete(k);

        const IRON_IDS = new Set([2092, 2095]);
        const mineable = state.nearbyLocs.filter(loc =>
            loc.optionsWithIndex.some(o => /^mine$/i.test(o.text)) &&
            !skipRocks.has(`${loc.x},${loc.z}`)
        ).sort((a, c) => {
            // Iron rocks first, then by distance
            const aIron = IRON_IDS.has(a.id) ? 0 : 1;
            const cIron = IRON_IDS.has(c.id) ? 0 : 1;
            if (aIron !== cIron) return aIron - cIron;
            return a.distance - c.distance;
        });

        const target = mineable[0] as NearbyLoc | undefined;
        if (!target) {
            const nextExpiry = [...skipRocks.entries()].sort((a, c) => a[1] - c[1])[0];
            const waitMs = nextExpiry ? Math.max(1000, nextExpiry[1] - Date.now()) : 5000;
            setStatus(b, `No rocks — waiting ${Math.ceil(waitMs / 1000)}s...`);
            await sleep(Math.min(waitMs, 5000));
            continue;
        }

        const oreLabel = IRON_IDS.has(target.id) ? 'iron' : target.name;
        setStatus(b, `Mining ${oreLabel} (${oreCount} ore)...`);
        if (target.distance > 3) {
            try { await b.bot.walkTo(target.x, target.z, 2); } catch { /* keep going */ }
        }

        const result = await b.bot.interactLoc(target, 'mine');
        if (!result.success) {
            const isCantReach = /reach|stuck/i.test(result.message);
            skipRocks.set(`${target.x},${target.z}`, Date.now() + (isCantReach ? 12_000 : 20_000));
            addLog(b, `Skip rock (${target.x},${target.z}): ${result.message}`);
            await sleep(300);
            continue;
        }

        await sleep(2000);
        const mineStart = Date.now();
        let lastOreCount = b.sdk.getState()?.inventory.filter(i => isOre(i.name)).length ?? oreCount;
        let idleTicks = 0;
        while (Date.now() - mineStart < 45_000 && b.running) {
            await sleep(1200);
            const ns = b.sdk.getState();
            if (!ns || ns.inventory.length >= 28) break;
            const cur = ns.inventory.filter(i => isOre(i.name)).length;
            if (cur > lastOreCount) { lastOreCount = cur; idleTicks = 0; updateProgress(b); continue; }
            // animId 625 = mining, -1 = idle; only count idle ticks when not actively mining
            const anim = ns.player.animId;
            if (anim === 625) { idleTicks = 0; continue; }
            if (anim === -1) {
                idleTicks++;
                if (idleTicks >= 2) {
                    if (cur === oreCount) skipRocks.set(`${target.x},${target.z}`, Date.now() + 20_000);
                    break;
                }
            } else { idleTicks = 0; }
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Mining — Varrock West ────────────────────────────────────────────────────
// SW Varrock mine (copper/tin) — very short walk to Varrock West bank

async function miningVarrockWestLoop(b: BotState) {
    setStatus(b, 'Starting Varrock West miner...');
    const skipRocks = new Map<string, number>();

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }
        if (state.dialog?.isOpen) { await b.bot.dismissBlockingUI(); continue; }

        const isOre = (name: string) => /(ore$|^coal$|^tin$|^copper$)/i.test(name);
        const oreCount = state.inventory.filter(i => isOre(i.name)).length;
        const invFull  = state.inventory.length >= 28;

        // ── BANK ─────────────────────────────────────────────────────────────
        if (invFull || oreCount >= 24) {
            setStatus(b, `Full (${oreCount} ore) — banking at Varrock West...`);
            try { await b.bot.walkTo(VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z); } catch { /* keep going */ }
            if (!b.running) break;

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 3 && b.running; attempt++) {
                await sleep(800);
                opened = await b.bot.openBank();
                if (opened.success) break;
                addLog(b, `Bank attempt ${attempt}/3 failed: ${opened.message} — retrying...`);
                await sleep(1200);
            }

            if (!opened.success) {
                addLog(b, `Bank failed — heading back to mine`);
                await sleep(2000);
            } else {
                // Deposit all ore/resources — exact name match per slot so nothing is left behind
                const keepGear2 = /pickaxe|axe|helm|shield|sword|armor|armour|gloves|boots|legs|body|cape|amulet|ring/i;
                const mineInv2 = b.sdk.getState()?.inventory ?? [];
                for (const name of [...new Set(mineInv2.filter(i => !keepGear2.test(i.name)).map(i => i.name))]) {
                    await b.bot.depositItem(new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), -1);
                }
                await b.bot.closeBank();
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked (trip #${b.bankTrips}) — returning to mine...`);
            }

            try { await b.bot.walkTo(VARROCK_WEST_MINE.x, VARROCK_WEST_MINE.z); } catch { /* keep going */ }
            continue;
        }

        // ── POSITION CHECK ───────────────────────────────────────────────────
        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const dist = Math.hypot(px - VARROCK_WEST_MINE.x, pz - VARROCK_WEST_MINE.z);
        if (dist > MAX_DRIFT) {
            setStatus(b, 'Walking to Varrock West mine...');
            // Open any gate blocking the path before walking
            const gate = b.sdk.getState()?.nearbyLocs.find(l => /gate/i.test(l.name) && l.distance <= 3);
            if (gate) { try { await b.bot.openDoor(gate); } catch { /* keep going */ } }
            try { await b.bot.walkTo(VARROCK_WEST_MINE.x, VARROCK_WEST_MINE.z); } catch { /* keep going */ }
            // Verify arrival — if still far away, try opening gate and walking again
            const after = b.sdk.getState()?.player;
            if (after && Math.hypot(after.worldX - VARROCK_WEST_MINE.x, after.worldZ - VARROCK_WEST_MINE.z) > MAX_DRIFT) {
                addLog(b, 'Walk to west mine failed — trying to open gate and retry');
                const blockedGate = b.sdk.getState()?.nearbyLocs.find(l => /gate/i.test(l.name) && l.distance <= 5);
                if (blockedGate) { try { await b.bot.openDoor(blockedGate); } catch { /* keep going */ } }
                try { await b.bot.walkTo(VARROCK_WEST_MINE.x, VARROCK_WEST_MINE.z); } catch { /* keep going */ }
            }
            continue;
        }

        // ── MINE ─────────────────────────────────────────────────────────────
        const now = Date.now();
        for (const [k, exp] of skipRocks) if (now > exp) skipRocks.delete(k);

        const mineable = state.nearbyLocs.filter(loc =>
            loc.optionsWithIndex.some(o => /^mine$/i.test(o.text)) &&
            !skipRocks.has(`${loc.x},${loc.z}`)
        ).sort((a, c) => a.distance - c.distance);

        const target = mineable[0] as NearbyLoc | undefined;
        if (!target) {
            const nextExpiry = [...skipRocks.entries()].sort((a, c) => a[1] - c[1])[0];
            const waitMs = nextExpiry ? Math.max(1000, nextExpiry[1] - Date.now()) : 5000;
            setStatus(b, `No rocks — waiting ${Math.ceil(waitMs / 1000)}s...`);
            await sleep(Math.min(waitMs, 5000));
            continue;
        }

        setStatus(b, `Mining ${target.name} (${oreCount} ore)...`);
        if (target.distance > 3) {
            try { await b.bot.walkTo(target.x, target.z, 2); } catch { /* keep going */ }
        }

        const result = await b.bot.interactLoc(target, 'mine');
        if (!result.success) {
            const isCantReach = /reach|stuck/i.test(result.message);
            skipRocks.set(`${target.x},${target.z}`, Date.now() + (isCantReach ? 12_000 : 20_000));
            addLog(b, `Skip rock (${target.x},${target.z}): ${result.message}`);
            await sleep(300);
            continue;
        }

        await sleep(2000);
        const mineStart = Date.now();
        let lastOreCount = b.sdk.getState()?.inventory.filter(i => isOre(i.name)).length ?? oreCount;
        let idleTicks = 0;
        while (Date.now() - mineStart < 45_000 && b.running) {
            await sleep(1200);
            const ns = b.sdk.getState();
            if (!ns || ns.inventory.length >= 28) break;
            const cur = ns.inventory.filter(i => isOre(i.name)).length;
            if (cur > lastOreCount) { lastOreCount = cur; idleTicks = 0; updateProgress(b); continue; }
            // animId 625 = mining, -1 = idle; only count idle ticks when not actively mining
            const anim = ns.player.animId;
            if (anim === 625) { idleTicks = 0; continue; }
            if (anim === -1) {
                idleTicks++;
                if (idleTicks >= 2) {
                    if (cur === oreCount) skipRocks.set(`${target.x},${target.z}`, Date.now() + 20_000);
                    break;
                }
            } else { idleTicks = 0; }
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Mining — Rune Essence ────────────────────────────────────────────────────
// Aubury teleport → essence mine → portal exit → Varrock East bank

const isInEssenceMine = (z: number) => z >= 4800 && z <= 4870;

async function miningEssenceLoop(b: BotState) {
    setStatus(b, 'Starting rune essence miner...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }
        if (state.dialog?.isOpen) { await b.bot.dismissBlockingUI(); continue; }

        const isEss   = (name: string) => /rune essence/i.test(name);
        const essCount = state.inventory.filter(i => isEss(i.name)).length;
        const invFull  = state.inventory.length >= 28 && essCount > 0;
        const inMine   = isInEssenceMine(state.player.worldZ);

        // ── BANK ─────────────────────────────────────────────────────────────
        if (invFull || essCount >= 26) {
            setStatus(b, `Full (${essCount} essence) — exiting mine...`);

            // Exit via portal if still inside essence mine
            if (inMine) {
                const portal = state.nearbyLocs.find(l => /portal|mine exit/i.test(l.name));
                if (portal) {
                    addLog(b, 'Exiting essence mine via portal...');
                    const firstOpt = portal.optionsWithIndex[0];
                    if (firstOpt) {
                        await b.sdk.sendInteractLoc(portal.x, portal.z, portal.id, firstOpt.opIndex);
                        // Wait until we actually leave the mine (up to 8s), not just a fixed sleep
                        const exitStart = Date.now();
                        while (Date.now() - exitStart < 8000 && b.running) {
                            await sleep(300);
                            const ns = b.sdk.getState();
                            if (!ns || !isInEssenceMine(ns.player.worldZ)) break;
                        }
                    }
                } else {
                    // No portal visible — walk toward known portal area then retry
                    addLog(b, 'No portal visible — walking to portal area...');
                    try { await b.bot.walkTo(2983, 4849, 5); } catch { /* keep going */ }
                    await sleep(1000);
                }
                continue;
            }

            // Navigate to Varrock East bank — go east past wall then north (wall blocks direct north at z~3407)
            setStatus(b, 'Walking to Varrock East bank...');
            const bankNavSteps: Array<[number, number]> = [[3259, 3408], [3259, 3421], [VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z]];
            let navFailed = false;
            for (const [wx, wz] of bankNavSteps) {
                if (!b.running) break;
                try { await b.sdk.sendWalk(wx, wz, true); } catch { navFailed = true; break; }
                // Wait for arrival (position-based, up to 6s) instead of fixed sleep
                const navStart = Date.now();
                while (Date.now() - navStart < 6000 && b.running) {
                    await sleep(300);
                    const ns = b.sdk.getState();
                    if (!ns) continue;
                    if (Math.hypot(ns.player.worldX - wx, ns.player.worldZ - wz) <= 4) break;
                }
            }
            if (navFailed || !b.running) { await sleep(1000); continue; }

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 3 && b.running; attempt++) {
                try {
                    opened = await b.bot.openBank();
                    if (opened.success) break;
                    addLog(b, `Bank attempt ${attempt}/3: ${opened.message}`);
                    await sleep(1000);
                } catch (e: any) {
                    addLog(b, `Bank error attempt ${attempt}/3: ${e?.message ?? e}`);
                    await sleep(1500);
                }
            }
            if (!opened.success) {
                addLog(b, `Bank failed after 3 attempts — retrying next cycle`);
                await sleep(2000);
                continue;
            }
            try {
                await b.bot.depositItem(/rune essence/i, -1);
                await b.bot.closeBank();
            } catch (e: any) {
                addLog(b, `Deposit/close error: ${e?.message ?? e}`);
                try { await b.bot.closeBank(); } catch { /* ignore */ }
            }
            b.bankTrips++;
            updateProgress(b);
            setStatus(b, `Banked (trip #${b.bankTrips}) — heading to Aubury...`);
            continue;
        }

        // ── IN ESSENCE MINE — mine rocks ─────────────────────────────────────
        if (inMine) {
            const mineableRocks = state.nearbyLocs.filter(loc =>
                loc.optionsWithIndex.some(o => /^mine$/i.test(o.text))
            ).sort((a, c) => a.distance - c.distance);

            if (mineableRocks.length === 0) {
                setStatus(b, `Mining rune essence (${essCount}/28)...`);
                await sleep(1000);
                continue;
            }

            const target = mineableRocks[0] as NearbyLoc;
            setStatus(b, `Mining rune essence (${essCount}/28)...`);

            // Send mine interaction directly (skip pathfinding walkTo for short distances)
            const mineOpt = target.optionsWithIndex.find(o => /^mine$/i.test(o.text));
            if (mineOpt) {
                await b.sdk.sendInteractLoc(target.x, target.z, target.id, mineOpt.opIndex);
            } else {
                let result = { success: false, message: '' };
                try { result = await b.bot.interactLoc(target, 'mine'); } catch (e: any) { result = { success: false, message: e?.message ?? String(e) }; }
                if (!result.success) {
                    addLog(b, `Mine failed: ${result.message}`);
                    await sleep(1000);
                    continue;
                }
            }

            await sleep(2000);
            const mineStart = Date.now();
            let lastEss = b.sdk.getState()?.inventory.filter(i => isEss(i.name)).length ?? essCount;
            while (Date.now() - mineStart < 60_000 && b.running) {
                await sleep(1200);
                const ns = b.sdk.getState();
                if (!ns || !isInEssenceMine(ns.player.worldZ)) break;
                if (ns.inventory.length >= 28) break;
                const cur = ns.inventory.filter(i => isEss(i.name)).length;
                if (cur > lastEss) { lastEss = cur; updateProgress(b); continue; }
                if (ns.player.animId === -1) break;
            }
            continue;
        }

        // ── TELEPORT TO MINE VIA AUBURY ───────────────────────────────────────
        setStatus(b, 'Walking to Aubury...');
        const px = state.player.worldX;
        const pz = state.player.worldZ;
        if (Math.hypot(px - AUBURY_POS.x, pz - AUBURY_POS.z) > 8) {
            try { await b.bot.walkTo(AUBURY_POS.x, AUBURY_POS.z, 3); } catch { /* keep going */ }
        }

        const aubury = b.sdk.findNearbyNpc(/^aubury$/i) ?? b.sdk.findNearbyNpc(/aubury/i);
        if (!aubury) {
            addLog(b, 'Aubury not found — walking closer...');
            try { await b.bot.walkTo(AUBURY_POS.x, AUBURY_POS.z); } catch { /* keep going */ }
            await sleep(2000);
            continue;
        }

        addLog(b, 'Asking Aubury to teleport to essence mine...');
        // Right-click Teleport (op4=Teleport in NPC config).
        // interactNpc may return "Nothing happened" because the teleport is
        // async — the packet IS sent correctly, just wait for the zone change.
        await b.bot.interactNpc(aubury, 'Teleport');
        // Wait for teleport animation (4 ticks ~2.4s) + zone change + buffer
        await sleep(6000);
        // Verify we actually landed in the mine; if not, loop will retry
        const afterTele = b.sdk.getState();
        if (!afterTele || !isInEssenceMine(afterTele.player.worldZ)) {
            addLog(b, 'Teleport did not land in mine — retrying...');
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Fishing — Draynor ────────────────────────────────────────────────────────
// Net fishing for shrimps/anchovies — bank is 15 tiles away

async function fishingDraynorLoop(b: BotState) {
    setStatus(b, 'Starting Draynor fisher...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }
        if (state.dialog?.isOpen) { await b.bot.dismissBlockingUI(); continue; }

        const isFish = (name: string) => /shrimp|anchov|herring|sardine/i.test(name);
        const fishCount = state.inventory.filter(i => isFish(i.name)).length;
        const invFull   = state.inventory.length >= 27;

        // ── BANK ─────────────────────────────────────────────────────────────
        if (invFull) {
            setStatus(b, `Full (${fishCount} fish) — banking at Draynor...`);
            try { await b.bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z); } catch { /* keep going */ }
            if (!b.running) break;

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 3 && b.running; attempt++) {
                await sleep(600);
                opened = await b.bot.openBank();
                if (opened.success) break;
                addLog(b, `Bank attempt ${attempt}/3: ${opened.message}`);
                await sleep(1000);
            }

            if (!opened.success) {
                addLog(b, 'Bank failed — heading back to fishing spot');
            } else {
                await b.bot.depositItem(/shrimp|anchov|herring|sardine/i, -1);
                await b.bot.closeBank();
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked (trip #${b.bankTrips}) — back to fishing...`);
            }

            try { await b.bot.walkTo(DRAYNOR_FISH_SPOT.x, DRAYNOR_FISH_SPOT.z); } catch { /* keep going */ }
            continue;
        }

        // ── POSITION CHECK ───────────────────────────────────────────────────
        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const dist = Math.hypot(px - DRAYNOR_FISH_SPOT.x, pz - DRAYNOR_FISH_SPOT.z);
        if (dist > MAX_DRIFT) {
            setStatus(b, 'Walking to Draynor fishing spot...');
            try { await b.bot.walkTo(DRAYNOR_FISH_SPOT.x, DRAYNOR_FISH_SPOT.z); } catch { /* keep going */ }
            continue;
        }

        // ── FISH ─────────────────────────────────────────────────────────────
        // Fishing spots are locs with Net/Bait/Lure options
        const spot = b.sdk.findNearbyLoc(/net|bait|fish/i) as NearbyLoc | undefined;
        if (!spot) {
            setStatus(b, 'No fishing spot nearby — waiting...');
            await sleep(2000);
            continue;
        }

        setStatus(b, `Fishing (${fishCount}/27 fish)...`);
        const result = await b.bot.interactLoc(spot, 'net');
        if (!result.success) {
            // Try 'bait' if net fails
            const r2 = await b.bot.interactLoc(spot, 'bait');
            if (!r2.success) {
                addLog(b, `Fish failed: ${result.message}`);
                await sleep(1000);
                continue;
            }
        }
        updateProgress(b);

        // Wait while fishing (watch for inventory change)
        const fishStart = Date.now();
        let lastFish = fishCount;
        while (Date.now() - fishStart < 30_000 && b.running) {
            await sleep(1200);
            const ns = b.sdk.getState();
            if (!ns || ns.inventory.length >= 27) break;
            const cur = ns.inventory.filter(i => isFish(i.name)).length;
            if (cur > lastFish) { lastFish = cur; updateProgress(b); }
            if (ns.player.animId === -1 && cur === lastFish) break; // stopped fishing
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Fishing — Barbarian Village ──────────────────────────────────────────────
// Fly fishing for trout/salmon — bank at Edgeville

async function fishingBarbLoop(b: BotState) {
    setStatus(b, 'Starting Barbarian Village fisher...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }
        if (state.dialog?.isOpen) { await b.bot.dismissBlockingUI(); continue; }

        const isFish = (name: string) => /trout|salmon|pike/i.test(name);
        const fishCount = state.inventory.filter(i => isFish(i.name)).length;
        const invFull   = state.inventory.length >= 27;

        // ── BANK ─────────────────────────────────────────────────────────────
        if (invFull) {
            setStatus(b, `Full (${fishCount} fish) — banking at Edgeville...`);
            try { await b.bot.walkTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z); } catch { /* keep going */ }
            if (!b.running) break;

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 3 && b.running; attempt++) {
                await sleep(600);
                opened = await b.bot.openBank();
                if (opened.success) break;
                addLog(b, `Bank attempt ${attempt}/3: ${opened.message}`);
                await sleep(1000);
            }

            if (!opened.success) {
                addLog(b, 'Bank failed — heading back to fishing spot');
            } else {
                await b.bot.depositItem(/trout|salmon|pike/i, -1);
                await b.bot.closeBank();
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked (trip #${b.bankTrips}) — back to fishing...`);
            }

            try { await b.bot.walkTo(BARB_FISH_SPOT.x, BARB_FISH_SPOT.z); } catch { /* keep going */ }
            continue;
        }

        // ── POSITION CHECK ───────────────────────────────────────────────────
        const px = state.player.worldX;
        const pz = state.player.worldZ;
        const dist = Math.hypot(px - BARB_FISH_SPOT.x, pz - BARB_FISH_SPOT.z);
        if (dist > BARB_FISH_RADIUS + 5) {
            setStatus(b, 'Walking to Barbarian Village...');
            try { await b.bot.walkTo(BARB_FISH_SPOT.x, BARB_FISH_SPOT.z); } catch { /* keep going */ }
            continue;
        }

        // ── FISH ─────────────────────────────────────────────────────────────
        const spot = b.sdk.findNearbyLoc(/lure|bait|fish/i) as NearbyLoc | undefined;
        if (!spot) {
            setStatus(b, 'No fishing spot nearby — waiting...');
            await sleep(2000);
            continue;
        }

        setStatus(b, `Fly fishing (${fishCount}/27 fish)...`);
        const result = await b.bot.interactLoc(spot, 'lure');
        if (!result.success) {
            const r2 = await b.bot.interactLoc(spot, 'bait');
            if (!r2.success) {
                addLog(b, `Fish failed: ${result.message}`);
                await sleep(1000);
                continue;
            }
        }
        updateProgress(b);

        // Wait while fishing
        const fishStart = Date.now();
        let lastFish = fishCount;
        while (Date.now() - fishStart < 30_000 && b.running) {
            await sleep(1200);
            const ns = b.sdk.getState();
            if (!ns || ns.inventory.length >= 27) break;
            const cur = ns.inventory.filter(i => isFish(i.name)).length;
            if (cur > lastFish) { lastFish = cur; updateProgress(b); }
            if (ns.player.animId === -1 && cur === lastFish) break;
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Combat — Moss Giants (Varrock Sewers) ────────────────────────────────────
// Power fight: kill giants, bury big bones, drop everything else. Surface on low HP.

async function mosGiantLoop(b: BotState) {
    setStatus(b, 'Starting Moss Giant fighter — Varrock Sewers...');

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }
        if (state.dialog?.isOpen) { await b.bot.dismissBlockingUI(); continue; }

        const px       = state.player.worldX;
        const pz       = state.player.worldZ;
        const hp       = state.player.hp;
        const maxHp    = state.player.maxHp;
        const underground = pz > 6000;

        // ── DEATH / RESPAWN ───────────────────────────────────────────────────
        const atLumbridge = Math.hypot(px - LUMBRIDGE.x, pz - LUMBRIDGE.z) < 40;
        if (atLumbridge) {
            setStatus(b, '☠️ Respawned — walking to Varrock sewers...');
            try { await b.bot.walkTo(SEWER_MANHOLE.x, SEWER_MANHOLE.z); } catch { /* keep going */ }
            updateProgress(b);
            continue;
        }

        // ── LOW HP — surface and regen ────────────────────────────────────────
        if (hp > 0 && hp <= 5 && maxHp > 0) {
            setStatus(b, `⚠️ Low HP (${hp}/${maxHp}) — surfacing to regen...`);
            if (underground) {
                // Find ladder up
                const ladder = state.nearbyLocs.find(l => l.optionsWithIndex.some(o => /climb.?up|ladder/i.test(o.text)));
                if (ladder) {
                    await b.bot.interactLoc(ladder, 'climb-up');
                    await sleep(3000);
                } else {
                    try { await b.bot.walkTo(SEWER_LADDER_UP.x, SEWER_LADDER_UP.z); } catch { /* keep going */ }
                }
            }
            // Wait to regen (up to 3 min)
            for (let i = 0; i < 18 && b.running; i++) {
                await sleep(10_000);
                const healed = b.sdk.getState();
                if (healed && healed.player.hp >= Math.min(10, maxHp)) break;
            }
            updateProgress(b);
            continue;
        }

        // ── SURFACE — enter sewers ────────────────────────────────────────────
        if (!underground) {
            const distManhole = Math.hypot(px - SEWER_MANHOLE.x, pz - SEWER_MANHOLE.z);
            if (distManhole > 5) {
                setStatus(b, 'Walking to sewer manhole...');
                try { await b.bot.walkTo(SEWER_MANHOLE.x, SEWER_MANHOLE.z); } catch { /* keep going */ }
                continue;
            }
            // Interact with manhole
            const manhole = state.nearbyLocs.find(l => /manhole|sewer|opening/i.test(l.name));
            if (manhole) {
                addLog(b, 'Entering Varrock Sewers...');
                const opt = manhole.optionsWithIndex[0];
                if (opt) { await b.sdk.sendInteractLoc(manhole.x, manhole.z, manhole.id, opt.opIndex); await sleep(3000); }
            } else {
                addLog(b, 'Manhole not found — waiting...');
                await sleep(2000);
            }
            continue;
        }

        // ── UNDERGROUND — drop junk if inventory nearly full ──────────────────
        if (state.inventory.length >= 26) {
            const junk = state.inventory.filter(i => !/big bones|bones|coins/i.test(i.name));
            for (const item of junk) { await b.sdk.sendDropItem(item.slot); await sleep(80); }
        }

        // ── BURY BIG BONES ───────────────────────────────────────────────────
        const bigBones = state.inventory.find(i => /big bones/i.test(i.name));
        if (bigBones) {
            setStatus(b, 'Burying big bones...');
            await b.sdk.sendUseItem(bigBones.slot);
            await sleep(800);
            updateProgress(b);
            continue;
        }

        // ── IN COMBAT — wait ─────────────────────────────────────────────────
        const inCombat = state.player.animId !== -1 && state.player.animId !== 0;
        if (inCombat) {
            setStatus(b, `Fighting moss giant... (HP: ${hp}/${maxHp})`);
            await sleep(800);
            continue;
        }

        // ── NAVIGATE TO FIGHT AREA ───────────────────────────────────────────
        const distFight = Math.hypot(px - SEWER_MOSS_GIANT.x, pz - SEWER_MOSS_GIANT.z);
        if (distFight > SEWER_FIGHT_RADIUS) {
            setStatus(b, 'Walking to moss giant area...');
            try { await b.bot.walkTo(SEWER_MOSS_GIANT.x, SEWER_MOSS_GIANT.z); } catch { /* keep going */ }
            continue;
        }

        // ── ATTACK MOSS GIANT ────────────────────────────────────────────────
        const giant = b.sdk.findNearbyNpc(/moss giant/i);
        if (!giant) {
            setStatus(b, 'No moss giant nearby — waiting for respawn...');
            await sleep(2000);
            continue;
        }

        setStatus(b, `Attacking moss giant... (HP: ${hp}/${maxHp})`);
        const result = await b.bot.attackNpc(giant);
        if (!result.success) {
            addLog(b, `Attack failed: ${result.message}`);
            await sleep(800);
        } else {
            updateProgress(b);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Mining — Runite (Wilderness Lava Maze) ───────────────────────────────────
// ~Level 46 Wilderness. Flees if another player is detected nearby.
// Route: Edgeville → north through Wilderness → Lava Maze → bank at Edgeville

async function runiteLoop(b: BotState) {
    setStatus(b, 'Starting Runite miner — Wilderness Lava Maze...');
    const skipRocks = new Map<string, number>();

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        const state = b.sdk.getState();
        if (!state) { await sleep(1000); continue; }
        if (state.dialog?.isOpen) { await b.bot.dismissBlockingUI(); continue; }

        const px  = state.player.worldX;
        const pz  = state.player.worldZ;
        const isOre  = (name: string) => /runite/i.test(name);
        const oreCount = state.inventory.filter(i => isOre(i.name)).length;
        const invFull  = state.inventory.length >= 28 && oreCount > 0;

        // ── FLEE — other player nearby in wilderness ──────────────────────────
        // nearbyPlayers from state (if available); conservative: check any player entities
        const nearbyPlayers: any[] = (state as any).nearbyPlayers ?? [];
        const otherPlayer = nearbyPlayers.find((p: any) => p.name && p.name !== b.name);
        if (otherPlayer && pz > 3520) {
            addLog(b, `⚠️ Player "${otherPlayer.name}" spotted — FLEEING to Edgeville!`);
            setStatus(b, '⚠️ FLEE — player spotted!');
            try { await b.bot.walkTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z); } catch { /* keep going */ }
            updateProgress(b);
            continue;
        }

        // ── BANK ─────────────────────────────────────────────────────────────
        if (invFull || oreCount >= 1) {
            // Bank after each ore — runite is valuable, don't risk losing it
            setStatus(b, `Banking ${oreCount} runite ore — heading to Edgeville...`);
            try { await b.bot.walkTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z); } catch { /* keep going */ }
            if (!b.running) break;

            let opened = { success: false, message: '' };
            for (let attempt = 1; attempt <= 3 && b.running; attempt++) {
                await sleep(700);
                opened = await b.bot.openBank();
                if (opened.success) break;
                addLog(b, `Bank attempt ${attempt}/3: ${opened.message}`);
                await sleep(1000);
            }

            if (!opened.success) {
                addLog(b, 'Bank failed — will retry');
                await sleep(2000);
            } else {
                await b.bot.depositItem(/runite/i, -1);
                await b.bot.closeBank();
                b.bankTrips++;
                updateProgress(b);
                setStatus(b, `Banked (trip #${b.bankTrips}) — heading back to Wilderness...`);
            }
            continue;
        }

        // ── NAVIGATE TO RUNITE ROCKS ──────────────────────────────────────────
        const distRock1 = Math.hypot(px - WILDY_RUNITE_1.x, pz - WILDY_RUNITE_1.z);
        const distRock2 = Math.hypot(px - WILDY_RUNITE_2.x, pz - WILDY_RUNITE_2.z);
        const nearRocks = Math.min(distRock1, distRock2) <= WILDY_RUNITE_RADIUS + 5;

        if (!nearRocks) {
            setStatus(b, 'Walking to Lava Maze runite rocks...');
            // Route north through Wilderness from Edgeville
            if (Math.hypot(px - EDGEVILLE_WILDY_GATE.x, pz - EDGEVILLE_WILDY_GATE.z) > 10 && pz < 3520) {
                try { await b.bot.walkTo(EDGEVILLE_WILDY_GATE.x, EDGEVILLE_WILDY_GATE.z); } catch { /* keep going */ }
            }
            // Walk directly to rock area (pathfinder handles it once in wilderness)
            try { await b.bot.walkTo(WILDY_RUNITE_1.x, WILDY_RUNITE_1.z); } catch { /* keep going */ }
            continue;
        }

        // ── MINE ─────────────────────────────────────────────────────────────
        const now = Date.now();
        for (const [k, exp] of skipRocks) if (now > exp) skipRocks.delete(k);

        const mineable = state.nearbyLocs.filter(loc =>
            loc.optionsWithIndex.some(o => /^mine$/i.test(o.text)) &&
            !skipRocks.has(`${loc.x},${loc.z}`)
        ).sort((a, c) => a.distance - c.distance);

        const target = mineable[0] as NearbyLoc | undefined;
        if (!target) {
            const nextExpiry = [...skipRocks.entries()].sort((a, c) => a[1] - c[1])[0];
            const waitMs = nextExpiry ? Math.max(1000, nextExpiry[1] - Date.now()) : 8000;
            setStatus(b, `Runite depleted — waiting ${Math.ceil(waitMs / 1000)}s for respawn...`);
            await sleep(Math.min(waitMs, 8000));
            continue;
        }

        setStatus(b, `Mining runite ore (${oreCount} in inv)...`);
        if (target.distance > 3) {
            try { await b.bot.walkTo(target.x, target.z, 2); } catch { /* keep going */ }
        }

        const result = await b.bot.interactLoc(target, 'mine');
        if (!result.success) {
            skipRocks.set(`${target.x},${target.z}`, Date.now() + 15_000);
            addLog(b, `Skip rock: ${result.message}`);
            await sleep(300);
            continue;
        }

        await sleep(2000);
        const mineStart = Date.now();
        let lastOreCount = oreCount;
        let idleTicks = 0;

        while (Date.now() - mineStart < 60_000 && b.running) {
            await sleep(1200);
            const ns = b.sdk.getState();
            if (!ns || ns.inventory.length >= 28) break;

            // Flee check inside mining loop
            const nbPlayers: any[] = (ns as any).nearbyPlayers ?? [];
            if (nbPlayers.find((p: any) => p.name && p.name !== b.name)) {
                addLog(b, '⚠️ Player spotted while mining — aborting rock!');
                break;
            }

            const cur = ns.inventory.filter(i => isOre(i.name)).length;
            if (cur > lastOreCount) { lastOreCount = cur; idleTicks = 0; updateProgress(b); continue; }
            if (ns.player.animId === -1) {
                idleTicks++;
                if (idleTicks >= 2) {
                    if (cur === oreCount) skipRocks.set(`${target.x},${target.z}`, Date.now() + 30_000);
                    break;
                }
            } else { idleTicks = 0; }
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Free Will loop ───────────────────────────────────────────────────────────
// AI decides what to do: equip gear, eat food, bank, fight/mine/woodcut

async function freeWillLoop(b: BotState) {
    setStatus(b, 'Free Will — sizing up the situation...');

    const LUMBRIDGE_RESPAWN = { x: 3222, z: 3218 };
    const FOOD_NAMES        = /shrimp|sardine|herring|trout|salmon|chicken|beef|bread|cake|pie|lobster|swordfish/i;
    const GEAR_NAMES        = /sword|scimitar|mace|dagger|spear|staff|bow|helmet|platebody|platelegs|chainbody|shield|coif|leather|chestplate/i;
    const LOOT_NAMES        = /bones|big bones|feather|cowhide|hide|logs|ore|coal|gold/i;

    // Alternate activity bias so bot doesn't always do the same thing
    let activityBias: 'combat' | 'woodcut' | 'mine' = 'combat';
    let biasCycle = 0;

    while (b.running) {
        if (await checkAndRunCmd(b)) continue;
        await sleep(600);
        const state = b.sdk.getState();
        if (!state) { await sleep(2000); continue; }

        const inv    = state.inventory;
        const hp     = state.player.hp;
        const maxHp  = state.player.maxHp ?? 10;

        // 1. Equip any weapon or armour sitting in inventory
        for (const item of inv) {
            if (GEAR_NAMES.test(item.name)) {
                const r = await b.bot.equipItem(item);
                if (r.success) addLog(b, `⚔️ Equipped ${item.name}`);
            }
        }

        // 2. Eat food if below 50% HP
        if (hp < maxHp * 0.5) {
            const food = b.sdk.findInventoryItem(FOOD_NAMES);
            if (food) {
                const r = await b.bot.eatFood(food);
                if (r.success) addLog(b, `🍖 Ate ${food.name}`);
            } else if (hp < maxHp * 0.25) {
                // No food and critically low — run to Lumbridge
                setStatus(b, '💀 Critically low HP — retreating!');
                await b.bot.walkTo(LUMBRIDGE_RESPAWN.x, LUMBRIDGE_RESPAWN.z, 8);
                await sleep(3000);
                continue;
            }
        }

        // 3. Bank when inventory is getting full (>= 24 items)
        if (inv.length >= 24) {
            setStatus(b, '🏦 Free will: banking up...');
            const res = await b.bot.openBank();
            if (res.success) {
                for (const item of (b.sdk.getState()?.inventory ?? [])) {
                    if (LOOT_NAMES.test(item.name)) {
                        await b.bot.depositItem(item);
                    }
                }
                b.bankTrips++;
                updateProgress(b);
                addLog(b, `💰 Banked loot (trip #${b.bankTrips})`);
            } else {
                // Can't open bank — walk toward Draynor
                await b.bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 5);
            }
            continue;
        }

        // 4. Rotate activity bias every ~10 cycles so bot mixes up skills
        biasCycle++;
        if (biasCycle % 10 === 0) {
            const options: ('combat' | 'woodcut' | 'mine')[] = ['combat', 'woodcut', 'mine'];
            activityBias = options[Math.floor(Math.random() * options.length)];
            addLog(b, `🎲 Switching focus: ${activityBias}`);
        }

        // 5. Scan for nearby resources
        const tree = b.sdk.findNearbyLoc(/^(tree|oak|willow)$/i) as NearbyLoc | undefined;
        const rock = b.sdk.findNearbyLoc(/^rocks$/i) as NearbyLoc | undefined;
        const npc  = b.sdk.findNearbyNpc(/^(chicken|cow|goblin|guard|man|woman)$/i);

        // Skill levels
        const skills = state.skills;
        const wcLvl     = skills.find(s => s.name === 'Woodcutting')?.baseLevel ?? 1;
        const mineLvl   = skills.find(s => s.name === 'Mining')?.baseLevel ?? 1;
        const combatLvl = (skills.find(s => s.name === 'Attack')?.baseLevel ?? 1)
                        + (skills.find(s => s.name === 'Strength')?.baseLevel ?? 1);

        // 6. Act based on bias + what's available
        const safeHp = hp > maxHp * 0.5;
        let acted = false;

        if (activityBias === 'combat' && npc && safeHp && combatLvl >= 4) {
            setStatus(b, `⚔️ Free will: attacking ${npc.name}...`);
            const r = await b.bot.attackNpc(npc);
            if (r.success) {
                updateProgress(b);
                // Bury any regular bones we picked up
                const bones = b.sdk.findInventoryItem(/^bones$/i);
                if (bones) await b.sdk.sendUseItem(bones.slot);
                acted = true;
            }
        }

        if (!acted && activityBias === 'mine' && rock && mineLvl >= 1) {
            setStatus(b, `⛏️ Free will: mining ${rock.name}...`);
            const r = await b.bot.interactLoc(rock, 'mine');
            if (r.success) { updateProgress(b); acted = true; }
        }

        if (!acted && tree && wcLvl >= 1) {
            setStatus(b, `🪓 Free will: chopping ${tree.name}...`);
            const r = await b.bot.chopTree(tree);
            if (r.success) { updateProgress(b); acted = true; }
        }

        // Fallback: nothing nearby — wander toward a random activity spot
        if (!acted) {
            const spots = [
                COW_FIELD,
                CHICKEN_FIELD,
                DRAYNOR_WILLOWS,
                VARROCK_WEST_MINE,
            ];
            const dest = spots[Math.floor(Math.random() * spots.length)];
            setStatus(b, `🚶 Free will: wandering to next spot...`);
            await b.bot.walkTo(dest.x, dest.z, 8);
            await sleep(2000);
        }
    }

    setStatus(b, 'idle');
    addLog(b, 'Bot stopped.');
}

// ─── Connect all bots ─────────────────────────────────────────────────────────

const botArgs = process.argv.slice(2);
if (botArgs.length === 0) {
    console.error('Usage: bun dashboard.ts <bot1:job> [bot2:job] ...');
    console.error('Jobs: wc (willow woodcutting), mining');
    process.exit(1);
}

for (const arg of botArgs) {
    const [name, jobRaw = 'wc'] = arg.split(':');
    const validJobs: Job[] = ['wc', 'wc_lumbridge', 'thieving_lumbridge', 'yews', 'yews_varrock', 'mining_all', 'mining_coal', 'mining_mithril', 'mining_varrock_east', 'mining_varrock_west', 'mining_essence', 'combat_cows', 'combat_chickens', 'combat_goblins', 'combat_al_kharid', 'fishing_draynor', 'fishing_barb', 'combat_moss_giants', 'mining_runite', 'free_will'];
    // Legacy aliases
    const jobAliases: Record<string, Job> = { mining: 'mining_all', combat: 'combat_cows' };
    const job = (validJobs.includes(jobRaw as Job) ? jobRaw : jobAliases[jobRaw] ?? 'wc') as Job;


    const envPath = join(import.meta.dir, 'bots', name, 'bot.env');
    if (!existsSync(envPath)) {
        console.error(`Bot "${name}" not found at ${envPath}`);
        process.exit(1);
    }
    const env = parseEnv(envPath);

    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME,
        password: env.PASSWORD,
        gatewayUrl: deriveGatewayUrl(env.SERVER),
        connectionMode: 'control',
        autoReconnect: true,
        autoLaunchBrowser: false,
        showChat: env.SHOW_CHAT?.toLowerCase() === 'true',
    });
    const bot = new BotActions(sdk);

    // Build the /bot client URL once so the /start handler can open it in the background
    const serverHost = env.SERVER || 'rs-sdk-demo.fly.dev';
    const isLocal = serverHost === 'localhost' || serverHost.startsWith('localhost:');
    const clientBase = isLocal
        ? `http://${serverHost}/bot`
        : `https://${serverHost}/bot`;
    const clientUrl = `${clientBase}?bot=${encodeURIComponent(env.BOT_USERNAME)}&password=${encodeURIComponent(env.PASSWORD)}`;

    const b: BotState = { name, job, sdk, bot, running: false, status: 'connecting...', logs: [], bankTrips: 0, mineOrigin: null, xpHistory: new Map(), lastProgress: Date.now(), restartCount: 0, pendingCmd: null, clientUrl };
    bots.set(name, b);

    sdk.connect().then(() => {
        setStatus(b, 'idle');
        console.log(`[${name}] Connected`);
    }).catch(e => {
        setStatus(b, `Connection failed: ${e.message}`);
        console.error(`[${name}] Connection error:`, e.message);
    });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

Bun.serve({
    port: DASHBOARD_PORT,

    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/') {
            return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (url.pathname === '/stream') {
            let ctrl: ReadableStreamDefaultController<Uint8Array>;
            const stream = new ReadableStream<Uint8Array>({
                start(c) {
                    ctrl = c;
                    sseClients.add(ctrl);
                    const snap = enc.encode(`data: ${JSON.stringify({
                        type: 'tick',
                        bots: [...bots.values()].map(getSnap),
                    })}\n\n`);
                    ctrl.enqueue(snap);
                },
                cancel() { sseClients.delete(ctrl); },
            });
            return new Response(stream, {
                headers: {
                    'Content-Type':  'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection':    'keep-alive',
                },
            });
        }

        if (req.method === 'POST' && url.pathname === '/start') {
            const { name } = await req.json() as { name: string };
            const b = bots.get(name);
            if (b && !b.running) {
                b.running = true;
                b.restartCount = 0;
                b.mineOrigin = null; // reset origin so it re-detects position
                // Open the bot's game tab in Chrome
                const { exec } = await import('child_process');
                if (process.platform === 'win32') {
                    exec(`start chrome "${b.clientUrl}"`, (err) => {
                        if (err) exec(`start "" "${b.clientUrl}"`, () => {});
                    });
                } else {
                    exec(`open -g "${b.clientUrl}"`, () => {});
                }
                console.log(`[${name}] Opened game tab`);
                startBotLoop(b);
            }
            return Response.json({ ok: true });
        }

        if (req.method === 'POST' && url.pathname === '/stop') {
            const { name } = await req.json() as { name: string };
            const b = bots.get(name);
            if (b) { b.running = false; addLog(b, 'Stop requested...'); }
            return Response.json({ ok: true });
        }

        if (req.method === 'POST' && url.pathname === '/stopall') {
            for (const b of bots.values()) {
                b.running = false;
                addLog(b, '🚨 EMERGENCY STOP');
            }
            return Response.json({ ok: true });
        }

        if (req.method === 'POST' && url.pathname === '/setjob') {
            const { name, job } = await req.json() as { name: string; job: Job };
            const b = bots.get(name);
            const validJobs: Job[] = ['wc', 'wc_lumbridge', 'thieving_lumbridge', 'yews', 'yews_varrock', 'mining_all', 'mining_coal', 'mining_mithril', 'mining_varrock_east', 'mining_varrock_west', 'mining_essence', 'combat_cows', 'combat_chickens', 'combat_goblins', 'combat_al_kharid', 'fishing_draynor', 'fishing_barb', 'combat_moss_giants', 'mining_runite', 'free_will'];
            if (b && validJobs.includes(job)) {
                const wasRunning = b.running;
                b.job = job;
                b.mineOrigin = null;
                addLog(b, `Job set to: ${job}`);
                if (wasRunning) {
                    // Interrupt current loop and restart with new job
                    b.running = false;
                    setTimeout(() => { b.running = true; b.restartCount = 0; startBotLoop(b); }, 800);
                }
            }
            return Response.json({ ok: true });
        }

        if (req.method === 'POST' && url.pathname === '/cmd') {
            const { name, cmd } = await req.json() as { name: string; cmd: string };
            const b = bots.get(name);
            if (b) {
                addLog(b, `⚡ Queued cmd: ${cmd}`);
                if (b.running) {
                    // Interrupt loop: stop it, set cmd, restart — forces exit from any inner loop
                    b.running = false;
                    b.pendingCmd = cmd;
                    setTimeout(() => { b.running = true; b.restartCount = 0; startBotLoop(b); }, 500);
                } else {
                    // Not running: execute command as one-shot directly
                    b.pendingCmd = cmd;
                    (async () => { await checkAndRunCmd(b); })();
                }
            }
            return Response.json({ ok: true });
        }

        return new Response('Not found', { status: 404 });
    },
});

console.log(`[Dashboard] Running at http://localhost:${DASHBOARD_PORT}`);
console.log(`[Dashboard] Bots: ${botArgs.join(', ')}`);

// Auto-open all bot game tabs on startup (staggered so the server isn't slammed)
(async () => {
    const { exec } = await import('child_process');
    // Brief delay so the HTTP server is ready first
    await new Promise(r => setTimeout(r, 1000));
    // Open dashboard itself
    const openUrl = (url: string) => {
        if (process.platform === 'win32') exec(`start chrome "${url}"`, (err) => {
            if (err) exec(`start "" "${url}"`, () => {});
        });
        else exec(`open "${url}"`, () => {});
    };
    openUrl(`http://localhost:${DASHBOARD_PORT}`);
    // Open each bot's game tab, staggered 800ms apart
    let i = 0;
    for (const b of bots.values()) {
        await new Promise(r => setTimeout(r, 800 * i));
        openUrl(b.clientUrl);
        const err_check = () => console.log(`[${b.name}] Auto-opened game tab`);
        err_check();
        i++;
    }
})();

// ─── HTML ─────────────────────────────────────────────────────────────────────

const HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>RST Bot Dashboard</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #111; --bg2: #1a1a1a; --bg3: #222; --border: #2a2a2a;
  --gold: #d4af37; --green: #4caf50; --red: #f44336; --blue: #4a9af4;
  --text: #ccc; --muted: #666; --font: 'Courier New', monospace;
}
body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

header { background: #0d0d0d; border-bottom: 2px solid var(--gold); padding: 6px 12px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
header h1 { color: var(--gold); font-size: 0.9em; letter-spacing: 1px; white-space: nowrap; }
#btnStopAll { background: #6b0000; color: #ff4444; border: 2px solid #ff2222; padding: 5px 14px; font-family: inherit; font-size: 0.85em; font-weight: bold; letter-spacing: 1px; cursor: pointer; border-radius: 3px; white-space: nowrap; }
#btnStopAll:hover { background: #ff2222; color: #000; }
#btnStopAll:active { transform: scale(0.96); }
#connBadge { font-size: 0.7em; margin-left: auto; white-space: nowrap; }
.page-controls { display: flex; align-items: center; gap: 6px; }
.page-btn { background: var(--bg3); color: var(--gold); border: 1px solid #444; border-radius: 3px; font-family: var(--font); font-size: 0.7em; padding: 2px 8px; cursor: pointer; }
.page-btn:hover { border-color: var(--gold); }
.page-btn:disabled { opacity: 0.3; cursor: default; }
#pageInfo { color: var(--muted); font-size: 0.7em; }

.bots-grid { display: flex; flex: 1; overflow: hidden; }

/* Each bot panel */
.bot-panel { flex: 1; display: flex; flex-direction: column; border-right: 1px solid var(--border); overflow: hidden; min-width: 0; }
.bot-panel:last-child { border-right: none; }

.bot-header { background: #0d0d0d; border-bottom: 1px solid var(--border); padding: 5px 8px; display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
.bot-header-row1 { display: flex; align-items: center; gap: 6px; }
.bot-header-row2 { display: flex; align-items: center; gap: 4px; }
.bot-name { color: var(--gold); font-weight: bold; font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.pill { padding: 1px 6px; border-radius: 6px; font-size: 0.65em; font-weight: bold; letter-spacing: 0.5px; flex-shrink: 0; white-space: nowrap; }
.pill.running { background: #1a3a1a; color: var(--green); border: 1px solid var(--green); }
.pill.stopped { background: #3a1a1a; color: var(--red);   border: 1px solid var(--red); }
.pill.connecting { background: #1a1a3a; color: var(--blue); border: 1px solid var(--blue); }
.bot-action-text { color: var(--muted); font-size: 0.7em; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn { padding: 3px 10px; border: none; border-radius: 3px; cursor: pointer; font-family: var(--font); font-size: 0.7em; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; white-space: nowrap; }
.btn:hover { filter: brightness(1.2); }
.btn-start { background: #1a4a1a; color: var(--green); border: 1px solid var(--green); }
.btn-stop  { background: #4a1a1a; color: var(--red);   border: 1px solid var(--red); }
.job-select { background: var(--bg3); color: var(--gold); border: 1px solid #444; border-radius: 3px; font-family: var(--font); font-size: 0.7em; padding: 2px 4px; cursor: pointer; flex: 1; min-width: 0; overflow: hidden; }
.job-select:disabled { opacity: 0.4; cursor: default; }
.job-select:focus { outline: none; border-color: var(--gold); }

.bot-body { display: flex; flex: 1; overflow: hidden; }

/* Stats column */
.stats-col { width: 155px; flex-shrink: 0; border-right: 1px solid var(--border); padding: 8px; overflow-y: auto; }
.sec-title { font-size: 0.65em; color: var(--muted); text-transform: uppercase; letter-spacing: 2px; padding-bottom: 4px; border-bottom: 1px solid var(--border); margin-bottom: 6px; }
.stat-row { display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px solid #1a1a1a; font-size: 0.85em; }
.stat-row .k { color: var(--muted); }
.stat-row .v { color: var(--gold); }
.bar-bg { background: var(--bg3); border-radius: 2px; height: 5px; overflow: hidden; margin: 4px 0; }
.bar-fill { height: 100%; border-radius: 2px; transition: width 0.6s; }
.bar-hp  { background: var(--green); }
.bar-run { background: #f4c742; }

.inv-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; margin-top: 6px; }
.slot { background: var(--bg3); border: 1px solid var(--border); border-radius: 2px; min-height: 34px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2px; text-align: center; }
.slot.filled { border-color: #3a5a3a; background: #151f15; }
.slot.willow { border-color: var(--green); background: #0f2010; }
.slot-name  { font-size: 0.6em; color: var(--text); line-height: 1.2; word-break: break-word; }
.slot-count { font-size: 0.65em; color: var(--gold); font-weight: bold; }

/* Log column */
.log-col { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.log-lines { flex: 1; overflow-y: auto; padding: 6px 8px; }
.log-line { display: flex; gap: 6px; padding: 2px 0; border-bottom: 1px solid #181818; }
.log-t { color: var(--muted); min-width: 55px; font-size: 0.75em; }
.log-m { color: var(--text); font-size: 0.78em; word-break: break-word; }

.session-box { padding: 6px 8px; border-top: 1px solid var(--border); font-size: 0.75em; color: var(--muted); flex-shrink: 0; }
.session-box span { color: var(--gold); }
.cmd-row { display: flex; align-items: center; gap: 3px; padding: 3px 6px; border-top: 1px solid var(--border); flex-wrap: wrap; }
.cmd-btn { background: var(--bg3); border: 1px solid #333; border-radius: 3px; cursor: pointer; font-size: 0.85em; padding: 1px 4px; color: var(--text); transition: border-color 0.1s; }
.cmd-btn:hover { border-color: var(--gold); background: #2a2000; }
.cmd-btn:active { transform: scale(0.92); }
.cmd-input { background: var(--bg3); border: 1px solid #333; border-radius: 3px; color: var(--gold); font-family: var(--font); font-size: 0.7em; padding: 2px 4px; }

/* Leaderboard */
#leaderboard { flex-shrink: 0; border-top: 2px solid var(--gold); background: #0d0d0d; padding: 6px 16px; overflow-x: auto; }
#leaderboard h2 { color: var(--gold); font-size: 0.7em; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
.lb-table { width: 100%; border-collapse: collapse; font-size: 0.78em; }
.lb-table th { color: var(--muted); text-align: left; padding: 2px 12px 4px 0; font-size: 0.7em; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid var(--border); white-space: nowrap; }
.lb-table td { padding: 3px 12px 3px 0; border-bottom: 1px solid #181818; white-space: nowrap; }
.lb-bot  { color: var(--gold); font-weight: bold; }
.lb-skill{ color: var(--muted); font-size: 0.9em; }
.lb-rate { color: var(--green); }
.lb-rate.dim { color: #444; }
.lb-best { color: #f4c742; font-weight: bold; }
.lb-rank { color: var(--muted); width: 20px; }
/* Prices panel */
#prices { flex-shrink: 0; border-top: 1px solid var(--border); background: #0d0d0d; overflow: hidden; transition: max-height 0.3s; }
#prices.collapsed { max-height: 24px; }
#prices.expanded  { max-height: 300px; overflow-y: auto; }
#prices-header { padding: 4px 16px; cursor: pointer; display: flex; align-items: center; gap: 8px; user-select: none; }
#prices-header span { color: var(--gold); font-size: 0.65em; letter-spacing: 2px; text-transform: uppercase; }
#prices-toggle { color: var(--muted); font-size: 0.7em; margin-left: auto; }
.prices-grid { display: flex; gap: 0; padding: 0 16px 8px; flex-wrap: nowrap; overflow-x: auto; }
.prices-section { flex-shrink: 0; margin-right: 24px; }
.prices-section h3 { color: var(--muted); font-size: 0.6em; letter-spacing: 1px; text-transform: uppercase; padding: 4px 0 3px; border-bottom: 1px solid var(--border); margin-bottom: 3px; white-space: nowrap; }
.prices-table { border-collapse: collapse; font-size: 0.72em; }
.prices-table td { padding: 1px 12px 1px 0; color: var(--text); white-space: nowrap; }
.prices-table td:last-child { color: var(--gold); text-align: right; padding-right: 0; }
</style>
</head>
<body>

<header>
  <h1>🪓 RST Bot Dashboard</h1>
  <div class="page-controls">
    <button class="page-btn" id="btnPrev" onclick="changePage(-1)" disabled>◀</button>
    <span id="pageInfo">Page 1</span>
    <button class="page-btn" id="btnNext" onclick="changePage(1)" disabled>▶</button>
  </div>
  <button id="btnStopAll" onclick="emergencyStop()">⛔ STOP ALL</button>
  <span id="connBadge" style="color:var(--muted)">connecting...</span>
</header>

<div class="bots-grid" id="botsGrid"></div>
<div id="leaderboard">
  <h2>📈 Who's on the Rise</h2>
  <table class="lb-table">
    <thead><tr>
      <th>#</th><th>Bot</th><th>Skill</th>
      <th>1 hr</th><th>6 hr</th><th>12 hr</th><th>24 hr</th>
    </tr></thead>
    <tbody id="lbBody"></tbody>
  </table>
</div>
<div id="prices" class="collapsed">
  <div id="prices-header" onclick="togglePrices()">
    <span>💰 General Store Prices</span>
    <span id="prices-toggle">▼ show</span>
  </div>
  <div class="prices-grid">
    <div class="prices-section">
      <h3>🪓 Woodcutting</h3>
      <table class="prices-table">
        <tr><td>Logs</td><td>4 gp</td></tr>
        <tr><td>Oak logs</td><td>20 gp</td></tr>
        <tr><td>Willow logs</td><td>40 gp</td></tr>
        <tr><td>Maple logs</td><td>80 gp</td></tr>
        <tr><td>Yew logs</td><td>160 gp</td></tr>
        <tr><td>Magic logs</td><td>320 gp</td></tr>
      </table>
    </div>
    <div class="prices-section">
      <h3>⛏ Mining — Ores</h3>
      <table class="prices-table">
        <tr><td>Copper ore</td><td>3 gp</td></tr>
        <tr><td>Tin ore</td><td>3 gp</td></tr>
        <tr><td>Iron ore</td><td>17 gp</td></tr>
        <tr><td>Coal</td><td>45 gp</td></tr>
        <tr><td>Silver ore</td><td>75 gp</td></tr>
        <tr><td>Gold ore</td><td>150 gp</td></tr>
        <tr><td>Mithril ore</td><td>162 gp</td></tr>
        <tr><td>Adamantite ore</td><td>400 gp</td></tr>
        <tr><td>Runite ore</td><td>3,200 gp</td></tr>
        <tr><td>Rune essence</td><td>4 gp</td></tr>
      </table>
    </div>
    <div class="prices-section">
      <h3>🔥 Smelting — Bars</h3>
      <table class="prices-table">
        <tr><td>Bronze bar</td><td>8 gp</td></tr>
        <tr><td>Iron bar</td><td>28 gp</td></tr>
        <tr><td>Steel bar</td><td>100 gp</td></tr>
        <tr><td>Silver bar</td><td>150 gp</td></tr>
        <tr><td>Gold bar</td><td>300 gp</td></tr>
        <tr><td>Mithril bar</td><td>300 gp</td></tr>
        <tr><td>Adamantite bar</td><td>640 gp</td></tr>
        <tr><td>Runite bar</td><td>5,000 gp</td></tr>
      </table>
    </div>
    <div class="prices-section">
      <h3>🎣 Fishing — Raw</h3>
      <table class="prices-table">
        <tr><td>Raw shrimps</td><td>5 gp</td></tr>
        <tr><td>Raw sardine</td><td>10 gp</td></tr>
        <tr><td>Raw herring</td><td>15 gp</td></tr>
        <tr><td>Raw anchovies</td><td>15 gp</td></tr>
        <tr><td>Raw trout</td><td>20 gp</td></tr>
        <tr><td>Raw cod</td><td>25 gp</td></tr>
        <tr><td>Raw pike</td><td>30 gp</td></tr>
        <tr><td>Raw salmon</td><td>50 gp</td></tr>
        <tr><td>Raw tuna</td><td>100 gp</td></tr>
        <tr><td>Raw lobster</td><td>150 gp</td></tr>
        <tr><td>Raw swordfish</td><td>200 gp</td></tr>
        <tr><td>Raw shark</td><td>300 gp</td></tr>
      </table>
    </div>
    <div class="prices-section">
      <h3>🍖 Cooking — Cooked</h3>
      <table class="prices-table">
        <tr><td>Shrimps</td><td>5 gp</td></tr>
        <tr><td>Sardine</td><td>10 gp</td></tr>
        <tr><td>Herring</td><td>15 gp</td></tr>
        <tr><td>Anchovies</td><td>15 gp</td></tr>
        <tr><td>Trout</td><td>20 gp</td></tr>
        <tr><td>Cod</td><td>25 gp</td></tr>
        <tr><td>Salmon</td><td>50 gp</td></tr>
        <tr><td>Tuna</td><td>100 gp</td></tr>
        <tr><td>Lobster</td><td>150 gp</td></tr>
        <tr><td>Swordfish</td><td>200 gp</td></tr>
        <tr><td>Shark</td><td>300 gp</td></tr>
        <tr><td>Cooked chicken</td><td>4 gp</td></tr>
        <tr><td>Cooked meat</td><td>4 gp</td></tr>
      </table>
    </div>
  </div>
</div>

<script>
const JOBS = [
  { value: 'wc',                  label: '🪓 Willows (Draynor)' },
  { value: 'wc_lumbridge',        label: '🪓 Willows (Lumbridge)' },
  { value: 'thieving_lumbridge',  label: '🎭 Pickpocket – Men/Women (Lumbridge)' },
  { value: 'yews',                label: '🌲 Yews (Edgeville)' },
  { value: 'yews_varrock',        label: '🌲 Yews (Varrock Castle)' },
  { value: 'mining_all',          label: '⛏ Mining – Guild (All)' },
  { value: 'mining_coal',         label: '⛏ Mining – Guild (Coal)' },
  { value: 'mining_mithril',      label: '⛏ Mining – Guild (Mithril)' },
  { value: 'mining_varrock_east', label: '⛏ Mining – Varrock East' },
  { value: 'mining_varrock_west', label: '⛏ Mining – Varrock West' },
  { value: 'mining_essence',      label: '⛏ Mining – Rune Essence' },
  { value: 'combat_cows',         label: '⚔️ Combat – Cows' },
  { value: 'combat_chickens',     label: '⚔️ Combat – Chickens' },
  { value: 'combat_goblins',      label: '⚔️ Combat – Goblins (Lumbridge)' },
  { value: 'combat_al_kharid',    label: '⚔️ Combat – Al-Kharid Warriors' },
  { value: 'fishing_draynor',     label: '🎣 Fishing – Draynor (net)' },
  { value: 'fishing_barb',        label: '🎣 Fishing – Barb Village (fly)' },
  { value: 'combat_moss_giants',  label: '💀 Combat – Moss Giants (Sewers)' },
  { value: 'mining_runite',       label: '💎 Mining – Runite (Wilderness)' },
  { value: 'free_will',           label: '🧠 Free Will – AI decides' },
];
const JOB_OPTIONS_HTML = JOBS.map(j =>
  \`<option value="\${j.value}">\${j.label}</option>\`
).join('');

const botState = {};   // name -> { running, sessionStart, bankTrips }

function initBot(name) {
  if (!botState[name]) botState[name] = { running: false, sessionStart: null, bankTrips: 0 };
}

function elapsed(start) {
  if (!start) return '—';
  const s = Math.floor((Date.now() - start) / 1000);
  return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0');
}

function toggle(name) {
  const b = botState[name];
  const ep = b.running ? '/stop' : '/start';
  fetch(ep, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name}) })
    .then(r => r.json()).then(() => {});
}

function emergencyStop() {
  fetch('/stopall', { method:'POST' }).then(r => r.json()).then(() => {
    document.getElementById('btnStopAll').textContent = '✅ ALL STOPPED';
    setTimeout(() => { document.getElementById('btnStopAll').textContent = '⛔ STOP ALL'; }, 3000);
  });
}

function setJob(name, job) {
  fetch('/setjob', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name, job}) })
    .then(r => r.json()).then(() => {});
}

function sendCmd(name, cmd) {
  fetch('/cmd', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name, cmd}) })
    .then(r => r.json()).then(() => {});
}

function sendGoto(name) {
  const input = document.getElementById('goto-' + name);
  const val = input ? input.value.trim() : '';
  if (!val) return;
  sendCmd(name, 'goto:' + val);
  if (input) input.value = '';
}

function renderBot(data) {
  initBot(data.name);
  const b = botState[data.name];

  // Track session start
  if (data.running && !b.running) b.sessionStart = Date.now();
  if (!data.running) b.sessionStart = null;
  b.running = data.running;

  let panel = document.getElementById('panel-' + data.name);
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'bot-panel';
    panel.id = 'panel-' + data.name;
    panel.innerHTML = \`
      <div class="bot-header">
        <div class="bot-header-row1">
          <span class="bot-name">\${data.name}</span>
          <div id="pill-\${data.name}" class="pill connecting">CONN</div>
        </div>
        <div class="bot-header-row2">
          <select id="job-\${data.name}" class="job-select" onchange="setJob('\${data.name}', this.value)">\${JOB_OPTIONS_HTML}</select>
          <button id="btn-\${data.name}" class="btn btn-start" onclick="toggle('\${data.name}')">▶</button>
        </div>
        <span id="act-\${data.name}" class="bot-action-text">—</span>
        <div class="cmd-row" id="cmds-\${data.name}">
          <button class="cmd-btn" onclick="sendCmd('\${data.name}','bank')" title="Walk to nearest bank">🏦</button>
          <button class="cmd-btn" onclick="sendCmd('\${data.name}','lumbridge')" title="Walk to Lumbridge">🏰</button>
          <button class="cmd-btn" onclick="sendCmd('\${data.name}','falador')" title="Walk to Falador">🛡️</button>
          <button class="cmd-btn" onclick="sendCmd('\${data.name}','satoshi_teleport')" title="Satoshi Teleport → Lumbridge (free)">⚡</button>
          <button class="cmd-btn" onclick="sendCmd('\${data.name}','yews')" title="Walk to Edgeville yews">🌲</button>
          <button class="cmd-btn" onclick="sendCmd('\${data.name}','willows')" title="Walk to Draynor willows">🪵</button>
          <button class="cmd-btn" onclick="sendCmd('\${data.name}','cows')" title="Walk to cow field">🐄</button>
          <button class="cmd-btn" onclick="sendCmd('\${data.name}','varrock_mine')" title="Walk to Varrock East mine">⛏️</button>
          <input class="cmd-input" id="goto-\${data.name}" type="text" placeholder="x,z" style="width:52px" />
          <button class="cmd-btn" onclick="sendGoto('\${data.name}')" title="Walk to coords">📍</button>
        </div>
      </div>
      <div class="bot-body">
        <div class="stats-col" id="stats-\${data.name}"></div>
        <div class="log-col">
          <div class="log-lines" id="log-\${data.name}"></div>
          <div class="session-box" id="sess-\${data.name}">Waiting...</div>
        </div>
      </div>\`;
    document.getElementById('botsGrid').appendChild(panel);
  }

  // Pill + button + job selector
  const pill    = document.getElementById('pill-' + data.name);
  const btn     = document.getElementById('btn-'  + data.name);
  const jobSel  = document.getElementById('job-'  + data.name);
  const hasState = !!data.state;

  // Sync dropdown to server job, lock while running
  if (jobSel && jobSel.value !== data.job) jobSel.value = data.job;
  if (jobSel) jobSel.disabled = false; // job switching always allowed — restarts loop live

  if (data.running) {
    pill.className = 'pill running'; pill.textContent = 'RUN';
    btn.className  = 'btn btn-stop'; btn.textContent  = '⏹';
  } else if (hasState) {
    pill.className = 'pill stopped'; pill.textContent = 'STOP';
    btn.className  = 'btn btn-start'; btn.textContent = '▶';
  } else {
    pill.className = 'pill connecting'; pill.textContent = 'CONN';
    btn.className  = 'btn btn-start'; btn.textContent = '▶';
  }

  document.getElementById('act-' + data.name).textContent = data.status || 'idle';

  // Stats
  const s = data.state;
  const statsEl = document.getElementById('stats-' + data.name);
  if (s) {
    const isMining  = data.job && data.job.startsWith('mining');
    const isCombat  = data.job && data.job.startsWith('combat');
    const isFishing = data.job && data.job.startsWith('fishing');
    const isYews    = data.job === 'yews' || data.job === 'yews_varrock';
    const wc       = s.skills.find(sk => sk.name === 'Woodcutting');
    const mining   = s.skills.find(sk => sk.name === 'Mining');
    const fishing  = s.skills.find(sk => sk.name === 'Fishing');
    const attack   = s.skills.find(sk => sk.name === 'Attack');
    const strength = s.skills.find(sk => sk.name === 'Strength');
    const hp       = s.skills.find(sk => sk.name === 'Hitpoints');
    const skill    = isMining ? mining : isCombat ? strength : isFishing ? fishing : wc;
    const skill2   = isCombat ? attack : null;
    const skillKey = isMining ? 'Mine' : isCombat ? 'Str' : isFishing ? 'Fish' : 'WC';
    const itemCount = isMining
      ? s.inventory.filter(i => /(ore$|coal)/i.test(i.name)).reduce((a,i) => a+i.count, 0)
      : data.job === 'combat_cows'
      ? s.inventory.filter(i => /cowhide/i.test(i.name)).reduce((a,i) => a+i.count, 0)
      : data.job === 'combat_chickens' || data.job === 'combat_goblins'
      ? s.inventory.filter(i => /bones/i.test(i.name)).reduce((a,i) => a+i.count, 0)
      : data.job === 'combat_al_kharid'
      ? s.inventory.filter(i => /^coins?$/i.test(i.name)).reduce((a,i) => a+(i.count??1), 0)
      : isYews
      ? s.inventory.filter(i => /yew/i.test(i.name)).reduce((a,i) => a+i.count, 0)
      : isFishing
      ? s.inventory.filter(i => /shrimp|anchov|trout|salmon|herring|sardine|pike/i.test(i.name)).reduce((a,i) => a+i.count, 0)
      : data.job === 'combat_moss_giants'
      ? s.inventory.filter(i => /big bones/i.test(i.name)).reduce((a,i) => a+i.count, 0)
      : s.inventory.filter(i => /willow/i.test(i.name)).reduce((a,i) => a+i.count, 0);
    const itemLabel = isMining ? 'Ore' : data.job === 'combat_cows' ? 'Hides' : data.job === 'combat_chickens' || data.job === 'combat_goblins' ? 'Bones' : data.job === 'combat_al_kharid' ? 'Coins' : isFishing ? 'Fish' : data.job === 'combat_moss_giants' ? 'BigBones' : 'Logs';

    // Inventory grid (28 slots)
    const slots = Array(28).fill(null);
    for (const item of s.inventory) if (item.slot < 28) slots[item.slot] = item;
    const invHtml = slots.map(item => {
      if (!item) return '<div class="slot"></div>';
      const highlight = isMining ? /(ore$|coal)/i.test(item.name) : isYews ? /yew/i.test(item.name) : isFishing ? /shrimp|anchov|trout|salmon|herring|sardine|pike/i.test(item.name) : /willow/i.test(item.name);
      return \`<div class="slot \${highlight ? 'willow' : 'filled'}">
        <div class="slot-name">\${item.name.replace(/ logs$/i,'').replace(/ ore$/i,' ore').slice(0,7)}</div>
        \${item.count > 1 ? \`<div class="slot-count">\${item.count}</div>\` : ''}
      </div>\`;
    }).join('');

    statsEl.innerHTML = \`
      <div class="sec-title">Player</div>
      <div class="stat-row"><span class="k">Pos</span><span class="v">(\${s.pos.x},\${s.pos.z})</span></div>
      <div class="stat-row"><span class="k">HP</span><span class="v">\${s.hp}/\${s.maxHp}</span></div>
      <div class="stat-row"><span class="k">Run</span><span class="v">\${s.energy}%</span></div>
      <div class="bar-bg"><div class="bar-fill bar-hp"  style="width:\${Math.round(s.hp/s.maxHp*100)}%"></div></div>
      <div class="bar-bg"><div class="bar-fill bar-run" style="width:\${s.energy}%"></div></div>
      <div class="sec-title" style="margin-top:8px">Skills</div>
      \${skill ? \`<div class="stat-row"><span class="k">\${skillKey}</span><span class="v">\${skill.level} (\${skill.xp.toLocaleString()} xp)</span></div>\` : ''}
      \${skill2 ? \`<div class="stat-row"><span class="k">Att</span><span class="v">\${skill2.level} (\${skill2.xp.toLocaleString()} xp)</span></div>\` : ''}
      \${hp ? \`<div class="stat-row"><span class="k">HP</span><span class="v">\${hp.level}</span></div>\` : ''}
      <div class="sec-title" style="margin-top:8px">Inv (<span>\${s.inventory.length}</span>/28)</div>
      <div class="inv-grid">\${invHtml}</div>\`;

    // Session box
    const restartColor = data.restartCount > 0 ? 'var(--red)' : 'var(--muted)';
    document.getElementById('sess-' + data.name).innerHTML =
      \`Runtime: <span>\${elapsed(b.sessionStart)}</span> &nbsp; \${itemLabel}: <span>\${itemCount}</span> &nbsp; Banks: <span>\${data.bankTrips ?? b.bankTrips}</span> &nbsp; Restarts: <span style="color:\${restartColor}">\${data.restartCount ?? 0}</span>\`;
  }

  // Logs
  if (data.logs?.length) {
    const logEl = document.getElementById('log-' + data.name);
    logEl.innerHTML = data.logs.map(l =>
      \`<div class="log-line"><span class="log-t">\${l.time}</span><span class="log-m">\${l.msg}</span></div>\`
    ).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function fmt(n) {
  if (n === null || n === undefined) return '<span class="lb-rate dim">—</span>';
  return \`<span class="lb-rate">\${n.toLocaleString()} xp/hr</span>\`;
}

function renderLeaderboard(bots) {
  // Sort by 1hr rate desc, fall back to 6hr, then name
  const sorted = [...bots].sort((a, b) => {
    const ar = a.rates?.['1h'] ?? a.rates?.['6h'] ?? -1;
    const br = b.rates?.['1h'] ?? b.rates?.['6h'] ?? -1;
    return br - ar;
  });

  const rows = sorted.map((bot, i) => {
    const r = bot.rates ?? {};
    const best = Math.max(r['1h'] ?? 0, r['6h'] ?? 0, r['12h'] ?? 0, r['24h'] ?? 0);
    const icon = bot.job === 'mining_runite' ? '💎' : bot.job === 'combat_moss_giants' ? '💀' : bot.job === 'combat_al_kharid' ? '🏺' : bot.job?.startsWith('mining') ? '⛏' : bot.job?.startsWith('combat') ? '⚔️' : bot.job?.startsWith('fishing') ? '🎣' : (bot.job === 'yews' || bot.job === 'yews_varrock') ? '🌲' : '🪓';
    return \`<tr>
      <td class="lb-rank">\${i + 1}</td>
      <td class="lb-bot">\${icon} \${bot.name}\${bot.running ? ' <span style="color:#4caf50;font-size:0.7em">●</span>' : ''}</td>
      <td class="lb-skill">\${r.skill ?? '—'}</td>
      <td>\${fmt(r['1h'])}</td>
      <td>\${fmt(r['6h'])}</td>
      <td>\${fmt(r['12h'])}</td>
      <td>\${fmt(r['24h'])}</td>
    </tr>\`;
  }).join('');

  document.getElementById('lbBody').innerHTML = rows;
}

// ─── Prices toggle ───────────────────────────────────────────────────────────
function togglePrices() {
  const el = document.getElementById('prices');
  const tog = document.getElementById('prices-toggle');
  const expanded = el.classList.toggle('expanded');
  el.classList.toggle('collapsed', !expanded);
  tog.textContent = expanded ? '▲ hide' : '▼ show';
}

// ─── Pagination ──────────────────────────────────────────────────────────────
const BOTS_PER_PAGE = 5;
let currentPage = 0;
let allBotNames = [];

function updatePagination() {
  const totalPages = Math.max(1, Math.ceil(allBotNames.length / BOTS_PER_PAGE));
  document.getElementById('pageInfo').textContent = \`Page \${currentPage + 1} / \${totalPages}\`;
  document.getElementById('btnPrev').disabled = currentPage === 0;
  document.getElementById('btnNext').disabled = currentPage >= totalPages - 1;

  const visibleNames = new Set(allBotNames.slice(currentPage * BOTS_PER_PAGE, (currentPage + 1) * BOTS_PER_PAGE));
  document.querySelectorAll('.bot-panel').forEach(p => {
    const name = p.id.replace('panel-', '');
    p.style.display = visibleNames.has(name) ? 'flex' : 'none';
  });
}

function changePage(dir) {
  const totalPages = Math.max(1, Math.ceil(allBotNames.length / BOTS_PER_PAGE));
  currentPage = Math.max(0, Math.min(currentPage + dir, totalPages - 1));
  updatePagination();
}

const badge = document.getElementById('connBadge');
const es = new EventSource('/stream');
es.onopen  = () => { badge.textContent = '● connected'; badge.style.color = '#4caf50'; };
es.onerror = () => { badge.textContent = '● disconnected'; badge.style.color = '#f44336'; };
es.onmessage = e => {
  const d = JSON.parse(e.data);
  if (d.type === 'tick') {
    // Track bot names for pagination
    const prevCount = allBotNames.length;
    d.bots.forEach(b => { if (!allBotNames.includes(b.name)) allBotNames.push(b.name); });
    d.bots.forEach(renderBot);
    if (allBotNames.length !== prevCount) updatePagination();
    renderLeaderboard(d.bots);
  }
};
</script>
</body>
</html>`;
