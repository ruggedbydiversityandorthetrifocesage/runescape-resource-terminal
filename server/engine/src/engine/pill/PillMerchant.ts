import ObjType from '#/cache/config/ObjType.js';
import { NetworkPlayer } from '#/engine/entity/NetworkPlayer.js';
import Npc from '#/engine/entity/Npc.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mintRST, isMintConfigured, fetchRSTBalance, queueAddRewards } from './RSTMinter.js';
import { stampBankLog } from './BankLogMinter.js';
import { getTutorialStep, setTutorialStep, TUTORIAL_TREE_X, TUTORIAL_TREE_Z } from './TutorialTracker.js';

// ============================================================
// RST — Runescape Resource Terminal
// OPNet OP20 token bridge
// Paste the deployed tb1p... contract address below:
// ============================================================
export const RST_CONTRACT = 'opt1sqzvnq5yetkcnwqzz02h23ch8294kgt0hxvvt9xyw'; // v9 live testnet
export const RST_GP_PER_TOKEN = 1000; // 1,000 GP = 1 RST
export const FIRST_CLAIM_GP_MIN = 1000;      // first ever claim: 1,000 GP minimum
export const SUBSEQUENT_CLAIM_GP_MIN = 10000; // all subsequent claims: 10,000 GP minimum

// Combat NPC kill GP rewards
// Cow NPC type IDs: 81=cow, 397=cow2, 955=cow3
export const COW_NPC_IDS = new Set([81, 397, 955]);

// Giants — type 91=mossgiant, type 94=giant (Hill Giant)
// Kill GP is direct (not through merchant, unaffected by Tier 2 price multiplier)
export const HILL_GIANT_NPC_IDS = new Set([94]);
export const MOSS_GIANT_NPC_IDS = new Set([91]);
export const HILL_GIANT_KILL_GP = 250;  // 0.25 RST
export const MOSS_GIANT_KILL_GP = 500;  // 0.5 RST

export function awardGiantKillGP(username: string, gp: number, type: 'hill' | 'moss'): void {
    const prev = pendingGP.get(username) ?? 0;
    pendingGP.set(username, prev + gp);
    const prevTotal = totalGPConverted.get(username) ?? 0;
    totalGPConverted.set(username, prevTotal + gp);
    recordActivity(username, gp);
    savePending();
    saveLeaderboard();
    console.log('[RST] ' + (type === 'moss' ? 'Moss' : 'Hill') + ' Giant kill: +' + gp + ' GP for ' + username);
}
export const COW_KILL_GP = 10;     // 10 GP per cow kill
export const CHICKEN_KILL_GP = 5;  // 5 GP per chicken kill (raw chicken selling price)

// ============================================================
// Dragon Slayer Milestone — community earn threshold
// When total GP converted across ALL players crosses this,
// Dragon Slayer quest unlocks and Tier 2 economy activates.
// ============================================================
export const DRAGON_SLAYER_THRESHOLD_GP = 10_000_000; // 10,000 RST worth of gameplay
export const TIER2_PRICE_MULTIPLIER = 0.1;            // Tier 2: resources worth 10% of Tier 1
const DRAGON_SLAYER_PATH = 'data/dragon-slayer-enabled.json';
let dragonSlayerEnabled = false;

(function loadDragonSlayerState() {
    try {
        if (fs.existsSync(DRAGON_SLAYER_PATH)) {
            const raw = JSON.parse(fs.readFileSync(DRAGON_SLAYER_PATH, 'utf8'));
            dragonSlayerEnabled = !!raw.enabled;
            if (dragonSlayerEnabled) console.log('[RST] 🐉 Dragon Slayer milestone already achieved — Tier 2 active');
        }
    } catch { /* ignore */ }
})();

export function isDragonSlayerEnabled(): boolean { return dragonSlayerEnabled; }

export function getTotalCommunityGP(): number {
    let total = 0;
    for (const gp of totalGPConverted.values()) total += gp;
    return total;
}

function checkDragonSlayerMilestone(): void {
    if (dragonSlayerEnabled) return;
    const total = getTotalCommunityGP();
    if (total >= DRAGON_SLAYER_THRESHOLD_GP) {
        dragonSlayerEnabled = true;
        try {
            fs.mkdirSync(path.dirname(DRAGON_SLAYER_PATH), { recursive: true });
            fs.writeFileSync(DRAGON_SLAYER_PATH, JSON.stringify({ enabled: true, achievedAt: Date.now(), totalGP: total }));
        } catch { /* ignore */ }
        console.log('[RST] 🐉 DRAGON SLAYER MILESTONE REACHED! ' + total + ' GP converted — Tier 2 economy active!');
        // Broadcast to all connected SSE clients
        const msg = JSON.stringify({ type: 'dragon_slayer_unlocked', totalGP: total });
        for (const [, ctrl] of sseClients) {
            try { ctrl.enqueue(encoder.encode('data: ' + msg + '\n\n')); } catch { /* ignore */ }
        }
    }
}

const RESOURCE_PRICES: Record<number, number> = {
    // Logs
    1511: 5,    // logs
    1521: 20,   // oak logs
    1519: 35,   // willow logs
    1515: 200,  // yew logs
    1513: 500,  // magic logs
    // Ores
    436: 10,    // copper ore
    438: 10,    // tin ore
    440: 30,    // iron ore
    453: 50,    // coal
    444: 100,   // gold ore
    447: 150,   // mithril ore
    449: 200,   // adamantite ore
    451: 400,   // runite ore
    // Meat — Tier 0 combat drops
    2132: 5,    // raw beef  (cow)
    2138: 5,    // raw chicken
    // Fish (raw) — Tier 1 gathering
    317: 5,     // raw shrimp
    321: 8,     // raw anchovies
    327: 8,     // raw sardine
    345: 12,    // raw herring
    335: 20,    // raw trout
    331: 30,    // raw salmon
    349: 15,    // raw pike
    359: 60,    // raw tuna
    377: 150,   // raw lobster
    371: 200,   // raw swordfish
    383: 500,   // raw shark
    // Smelted bars — Tier 2 (3x ore value)
    2349: 60,   // bronze bar  (copper 10 + tin 10 = 20 → x3)
    2351: 90,   // iron bar    (iron 30 → x3)
    2353: 100,  // steel bar   (iron + coal)
    2355: 150,  // silver bar
    2357: 300,  // gold bar    (gold 100 → x3)
    2359: 450,  // mithril bar (mithril 150 → x3)
    2361: 600,  // adamantite bar (adamantite 200 → x3)
    2363: 1200, // runite bar  (runite 400 → x3)
};

// All general store shopkeepers and assistants across every city:
// 520/521 Lumbridge, 522/523 Varrock, 524/525 Falador, 526/527 Draynor,
// 528/529 Edgeville, 530/531 Al Kharid, 532/533 Shilo Village, 534/535 (extra),
// 516 Shilo general store (special variant)
export const RST_MERCHANT_NPC_IDS = new Set([516, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535]);

export const walletRegistry = new Map<string, string>();
export const mldsaRegistry = new Map<string, string>();     // username -> raw MLDSA public key hex
export const pendingGP = new Map<string, number>();         // GP accumulated but not yet granted on-chain
export const grantedGP = new Map<string, number>();         // GP granted on-chain but not yet claimed by player
export const totalGPConverted = new Map<string, number>();  // all-time leaderboard score
export const stakedRegistry = new Map<string, number>();    // username → staked RST amount
export const earnedRewardsRegistry = new Map<string, number>(); // wallet → cumulative sRST rewards claimed (RST)
export const claimedRegistry = new Set<string>();               // usernames who have claimed RST at least once

// Rolling activity log for analytics (last 30 days of GP sale events)
interface ActivityEvent { username: string; gp: number; timestamp: number; }
export const activityLog: ActivityEvent[] = [];
const MAX_ACTIVITY_AGE = 30 * 24 * 60 * 60 * 1000;
const ACTIVITY_LOG_PATH = path.resolve('data/activity-log.json');

// Load persisted log on startup
(function loadActivityLog() {
    try {
        if (fs.existsSync(ACTIVITY_LOG_PATH)) {
            const raw = JSON.parse(fs.readFileSync(ACTIVITY_LOG_PATH, 'utf8'));
            const cutoff = Date.now() - MAX_ACTIVITY_AGE;
            for (const e of raw) {
                if (e.timestamp >= cutoff) activityLog.push(e);
            }
        }
    } catch { /* ignore corrupt file */ }
})();

// Flush to disk every 5 minutes
setInterval(() => {
    try { fs.writeFileSync(ACTIVITY_LOG_PATH, JSON.stringify(activityLog)); } catch { /* ignore */ }
}, 5 * 60 * 1000);

export function recordActivity(username: string, gp: number): void {
    const now = Date.now();
    activityLog.push({ username, gp, timestamp: now });
    const cutoff = now - MAX_ACTIVITY_AGE;
    while (activityLog.length > 0 && activityLog[0].timestamp < cutoff) activityLog.shift();
}

// SSE push: engine signals the browser tab when a mint is ready
export const sseClients = new Map<string, ReadableStreamDefaultController<Uint8Array>>();

// Per-player grantClaim cooldown — prevents UTXO chaining on rapid sales
// Only one grantClaim per player per 3 minutes; GP accumulates in between
const GRANT_COOLDOWN_MS = 3 * 60 * 1000;
const lastGrantTime = new Map<string, number>();

// 1% conversion fee — accumulates in pendingRewardGP, flushed on a fixed 30-min interval.
// queueAddRewards() routes through the shared wallet queue, so it never runs concurrently
// with grantClaim TXs (which would cause UTXO double-spend contention).
const REWARD_FEE_PCT = 0.01;
const REWARD_FLUSH_INTERVAL_MS = 10 * 60 * 1000; // flush every 10 min (1 BTC block — slowfi style)
const REWARD_FLUSH_MIN_RST = 0.01;               // don't flush dust (< 0.01 RST)
let pendingRewardGP = 0;

// Start the reward flush interval once on module load
setInterval(() => {
    if (pendingRewardGP <= 0) return;
    const flushRST = pendingRewardGP / RST_GP_PER_TOKEN;
    if (flushRST < REWARD_FLUSH_MIN_RST) return;
    pendingRewardGP = 0;
    // Route through walletQueue — waits behind any in-progress grantClaim TXs
    queueAddRewards(flushRST).then(ok => {
        if (ok) {
            console.log('[RST] ⏰ Reward flush: +' + flushRST.toFixed(4) + ' RST distributed to stakers');
        } else {
            pendingRewardGP += flushRST * RST_GP_PER_TOKEN; // return to buffer on failure
            console.log('[RST] ⏰ Reward flush failed — GP returned to buffer');
        }
    });
}, REWARD_FLUSH_INTERVAL_MS);

const LEADERBOARD_PATH = 'data/rst-leaderboard.json';
const PENDING_PATH = 'data/rst-pending.json';
const GRANTED_PATH = 'data/rst-granted.json';
const WALLETS_PATH = 'data/rst-wallets.json';
const MLDSA_PATH = 'data/rst-mldsa.json';
const STAKED_PATH = 'data/rst-staked.json';
const EARNED_REWARDS_PATH = 'data/rst-earned-rewards.json';
const CLAIMED_PATH = 'data/rst-claimed.json';
const encoder = new TextEncoder();

function loadLeaderboard(): void {
    try {
        if (fs.existsSync(LEADERBOARD_PATH)) {
            const data = JSON.parse(fs.readFileSync(LEADERBOARD_PATH, 'utf-8'));
            for (const [k, v] of Object.entries(data)) totalGPConverted.set(k, v as number);
            console.log('[RST] Leaderboard loaded: ' + totalGPConverted.size + ' entries');
        }
        if (fs.existsSync(PENDING_PATH)) {
            const data = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf-8'));
            for (const [k, v] of Object.entries(data)) pendingGP.set(k, v as number);
            console.log('[RST] Pending GP loaded: ' + pendingGP.size + ' entries');
        }
        if (fs.existsSync(WALLETS_PATH)) {
            const data = JSON.parse(fs.readFileSync(WALLETS_PATH, 'utf-8'));
            for (const [k, v] of Object.entries(data)) walletRegistry.set(k, v as string);
            console.log('[RST] Wallets loaded: ' + walletRegistry.size + ' entries');
        }
        if (fs.existsSync(MLDSA_PATH)) {
            const data = JSON.parse(fs.readFileSync(MLDSA_PATH, 'utf-8'));
            for (const [k, v] of Object.entries(data)) mldsaRegistry.set(k, v as string);
            console.log('[RST] MLDSA keys loaded: ' + mldsaRegistry.size + ' entries');
        }
        if (fs.existsSync(GRANTED_PATH)) {
            const data = JSON.parse(fs.readFileSync(GRANTED_PATH, 'utf-8'));
            for (const [k, v] of Object.entries(data)) grantedGP.set(k, v as number);
            console.log('[RST] Granted GP loaded: ' + grantedGP.size + ' entries');
        }
        if (fs.existsSync(STAKED_PATH)) {
            const data = JSON.parse(fs.readFileSync(STAKED_PATH, 'utf-8'));
            for (const [k, v] of Object.entries(data)) stakedRegistry.set(k, v as number);
            console.log('[RST] Staked registry loaded: ' + stakedRegistry.size + ' entries');
        }
        if (fs.existsSync(EARNED_REWARDS_PATH)) {
            const data = JSON.parse(fs.readFileSync(EARNED_REWARDS_PATH, 'utf-8'));
            for (const [k, v] of Object.entries(data)) earnedRewardsRegistry.set(k, v as number);
            console.log('[RST] Earned rewards loaded: ' + earnedRewardsRegistry.size + ' entries');
        }
        if (fs.existsSync(CLAIMED_PATH)) {
            const data = JSON.parse(fs.readFileSync(CLAIMED_PATH, 'utf-8'));
            for (const k of Object.keys(data)) claimedRegistry.add(k);
            console.log('[RST] Claimed registry loaded: ' + claimedRegistry.size + ' entries');
        }
    } catch {}
}

export function saveStaked(): void {
    try {
        fs.mkdirSync(path.dirname(STAKED_PATH), { recursive: true });
        fs.writeFileSync(STAKED_PATH, JSON.stringify(Object.fromEntries(stakedRegistry)));
    } catch {}
}

export function saveEarnedRewards(): void {
    try {
        fs.mkdirSync(path.dirname(EARNED_REWARDS_PATH), { recursive: true });
        fs.writeFileSync(EARNED_REWARDS_PATH, JSON.stringify(Object.fromEntries(earnedRewardsRegistry)));
    } catch {}
}

export function saveClaimed(): void {
    try {
        fs.mkdirSync(path.dirname(CLAIMED_PATH), { recursive: true });
        fs.writeFileSync(CLAIMED_PATH, JSON.stringify(Object.fromEntries([...claimedRegistry].map(k => [k, true]))));
    } catch {}
}

export function stakePlayer(username: string, amount: number): void {
    const prev = stakedRegistry.get(username) ?? 0;
    stakedRegistry.set(username, prev + amount);
    saveStaked();
    console.log('[RST] Staked: ' + username + ' +' + amount + ' RST (total: ' + (prev + amount) + ')');
}

function saveLeaderboard(): void {
    try {
        fs.mkdirSync(path.dirname(LEADERBOARD_PATH), { recursive: true });
        fs.writeFileSync(LEADERBOARD_PATH, JSON.stringify(Object.fromEntries(totalGPConverted)));
    } catch {}
}

export function savePending(): void {
    try {
        fs.mkdirSync(path.dirname(PENDING_PATH), { recursive: true });
        fs.writeFileSync(PENDING_PATH, JSON.stringify(Object.fromEntries(pendingGP)));
    } catch {}
}

export function saveWallets(): void {
    try {
        fs.mkdirSync(path.dirname(WALLETS_PATH), { recursive: true });
        fs.writeFileSync(WALLETS_PATH, JSON.stringify(Object.fromEntries(walletRegistry)));
    } catch {}
}

export function saveMldsa(): void {
    try {
        fs.mkdirSync(path.dirname(MLDSA_PATH), { recursive: true });
        fs.writeFileSync(MLDSA_PATH, JSON.stringify(Object.fromEntries(mldsaRegistry)));
    } catch {}
}

export function saveGranted(): void {
    try {
        fs.mkdirSync(path.dirname(GRANTED_PATH), { recursive: true });
        fs.writeFileSync(GRANTED_PATH, JSON.stringify(Object.fromEntries(grantedGP)));
    } catch {}
}

export function awardCowKillGP(username: string): void {
    const prev = pendingGP.get(username) ?? 0;
    pendingGP.set(username, prev + COW_KILL_GP);
    const prevTotal = totalGPConverted.get(username) ?? 0;
    totalGPConverted.set(username, prevTotal + COW_KILL_GP);
    recordActivity(username, COW_KILL_GP);
    savePending();
    saveLeaderboard();
}

loadLeaderboard();

// ============================================================
// RST balance cache — used by BoundaryCheck for world gating
// Tier 0: 0 RST    → Misthalin only
// Tier 1: 1-9 RST  → +Wilderness, Asgarnia
// Tier 2: 10+ RST  → full world
// ============================================================
export const rstBalanceCache = new Map<string, number>(); // username → RST balance

export function getPlayerRSTTier(username: string): 0 | 1 | 2 {
    const staked = stakedRegistry.get(username) ?? 0;
    const bal = rstBalanceCache.get(username) ?? 0;
    if (staked >= 10 || bal >= 1000) return 2; // staked 10+ OR 1000+ RST → full world
    if (bal >= 10 || staked > 0) return 1;      // 10+ RST OR any sRST → hard mode
    return 0;
}

async function refreshRSTBalances(): Promise<void> {
    for (const [username, mldsaKey] of mldsaRegistry) {
        try {
            const bal = await fetchRSTBalance(mldsaKey);
            rstBalanceCache.set(username, bal);
        } catch {}
    }
}

// Initial fetch after a short delay, then every 60s
setTimeout(() => {
    void refreshRSTBalances();
    setInterval(() => { void refreshRSTBalances(); }, 60_000);
}, 5_000);


export function getLeaderboard(): Array<{ username: string; gp: number; rst: number }> {
    return Array.from(totalGPConverted.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([username, gp]) => ({ username, gp, rst: gp / RST_GP_PER_TOKEN }));
}

// Backward-compatible aliases so OpNpcHandler doesn't need to change
export const PILL_MERCHANT_NPC_IDS = RST_MERCHANT_NPC_IDS;
export const pendingPill = pendingGP;
export const pendingRST = pendingGP;
export function handlePillMerchant(player: NetworkPlayer, npc: Npc): boolean {
    return handleRSTMerchant(player, npc);
}

export function handleRSTMerchant(player: NetworkPlayer, npc: Npc): boolean {
    const inv = player.getInventory(93);
    if (!inv) { player.messageGame('Could not access inventory.'); return true; }

    // Tier 2: all resource prices drop 90% once Dragon Slayer milestone is hit
    const priceMultiplier = dragonSlayerEnabled ? TIER2_PRICE_MULTIPLIER : 1.0;

    let saleGP = 0;
    const remove: number[] = [];
    for (let slot = 0; slot < inv.capacity; slot++) {
        const item = inv.get(slot);
        if (!item) continue;
        // Check unnoted price first, then fall back to noted (certlink = unnoted item id)
        let price = (RESOURCE_PRICES as any)[item.id];
        if (!price) {
            const objType = ObjType.get(item.id);
            if (objType && objType.certtemplate !== -1 && objType.certlink !== -1) {
                price = (RESOURCE_PRICES as any)[objType.certlink];
            }
        }
        if (price) { saleGP += Math.max(1, Math.floor(price * priceMultiplier)) * item.count; remove.push(slot); }
    }

    if (remove.length === 0) {
        // Tutorial: if new player has no sellable items, re-point them to the trees
        const tStepEmpty = getTutorialStep(player.username);
        if (tStepEmpty === 0 || tStepEmpty === 1) {
            player.hintTile(2, TUTORIAL_TREE_X, TUTORIAL_TREE_Z, 0);
            setTutorialStep(player.username, 0);
        }
        player.messageGame('Runescape Resource Terminal: Bring logs, ores, fish, or bars to convert!');
        player.messageGame('1,000 GP = 1 RST  |  100 GP = 0.1 RST  |  10 GP = 0.01 RST');
        return true;
    }

    for (const slot of remove) inv.set(slot, null);

    // Update leaderboard (all-time, never decreases)
    const prevTotal = totalGPConverted.get(player.username) ?? 0;
    totalGPConverted.set(player.username, prevTotal + saleGP);
    saveLeaderboard();
    recordActivity(player.username, saleGP);

    // Accumulate pending GP
    const prevPending = pendingGP.get(player.username) ?? 0;
    const newPending = prevPending + saleGP;
    pendingGP.set(player.username, newPending);
    savePending();

    const rstValue = (newPending / RST_GP_PER_TOKEN).toFixed(4);
    const totalGrantedAtSale = grantedGP.get(player.username) ?? 0;
    if (totalGrantedAtSale > 0) {
        const combinedRST = ((newPending + totalGrantedAtSale) / RST_GP_PER_TOKEN).toFixed(4);
        player.messageGame('Sold for ' + saleGP + ' GP! Pending: ' + rstValue + ' RST + On-chain: ' + (totalGrantedAtSale / RST_GP_PER_TOKEN).toFixed(4) + ' RST = ' + combinedRST + ' RST total');
    } else {
        player.messageGame('Sold for ' + saleGP + ' GP! Total: ' + newPending + ' GP = ' + rstValue + ' RST');
    }

    // Tutorial progression
    const tStep = getTutorialStep(player.username);
    if (tStep === 1) {
        // First sale — advance to bank step, point to Satoshi
        setTutorialStep(player.username, 2);
        player.hintTile(2, 3207, 3220, 0);
        player.messageGame('Nice work! Now visit Satoshi the Banker to store your items safely.');
    }

    if (newPending < 10) {
        player.messageGame('Keep going! Need 10 GP minimum to mint RST.');
        return true;
    }

    const wallet = walletRegistry.get(player.username);
    if (!wallet) {
        player.messageGame('Connect your OP_WALLET at /play to earn $RST!');
        return true;
    }

    if (isMintConfigured()) {
        // GP threshold check — first claim: 1,000 GP min; subsequent: 10,000 GP min
        const hasClaimedBefore = claimedRegistry.has(player.username);
        const gpThreshold = hasClaimedBefore ? SUBSEQUENT_CLAIM_GP_MIN : FIRST_CLAIM_GP_MIN;
        if (newPending < gpThreshold) {
            const needed = gpThreshold - newPending;
            player.messageGame(`Keep earning! Need ${needed} more GP to claim RST (${newPending}/${gpThreshold} GP).`);
            return true;
        }
        // Cooldown check — don't fire grantClaim again if one is still likely unconfirmed
        const now = Date.now();
        const lastGrant = lastGrantTime.get(player.username) ?? 0;
        if (now - lastGrant < GRANT_COOLDOWN_MS) {
            const secsLeft = Math.ceil((GRANT_COOLDOWN_MS - (now - lastGrant)) / 1000);
            const totalGrantedCooldown = grantedGP.get(player.username) ?? 0;
            const totalRSTCooldown = ((newPending + totalGrantedCooldown) / RST_GP_PER_TOKEN).toFixed(4);
            player.messageGame('GP banked! ' + totalRSTCooldown + ' RST total. Next grant in ~' + secsLeft + 's.');
            return true;
        }
        lastGrantTime.set(player.username, now);
        // Server calls grantClaim(playerMldsaHash, rstWei) on the v2 contract.
        // Player receives 99% of earned RST; 1% fee accumulates in pendingRewardGP.
        // When pendingRewardGP >= 1 RST, server flushes it to the sRST staking reward pool.
        const gpSnapshot = newPending;
        const feeGP = Math.floor(gpSnapshot * REWARD_FEE_PCT);
        const playerGP = gpSnapshot - feeGP;
        const playerRSTDisplay = (playerGP / RST_GP_PER_TOKEN).toFixed(4);
        player.messageGame('Granting ' + playerRSTDisplay + ' RST — sign at /play to claim!');
        const mldsaKey = mldsaRegistry.get(player.username);
        const rstWei = (BigInt(Math.floor(playerGP)) * (10n ** 18n) / BigInt(RST_GP_PER_TOKEN)).toString();
        // Push minting_started IMMEDIATELY so browser locks button before TX is in flight
        const ctrlEarly = sseClients.get(player.username);
        if (ctrlEarly) {
            try {
                ctrlEarly.enqueue(encoder.encode('data: ' + JSON.stringify({
                    type: 'minting_started',
                    username: player.username,
                    gpAmount: playerGP,
                    rstAmount: playerGP / RST_GP_PER_TOKEN,
                    rstWei,
                }) + '\n\n'));
            } catch { sseClients.delete(player.username); }
        }
        mintRST(player.username, wallet, playerGP, mldsaKey).then(success => {
            const ctrl = sseClients.get(player.username);
            if (success) {
                const prevGranted = grantedGP.get(player.username) ?? 0;
                grantedGP.set(player.username, prevGranted + playerGP);
                saveGranted();
                pendingGP.delete(player.username);
                savePending();
                // Mark as claimed — subsequent claims require 10,000 GP minimum
                claimedRegistry.add(player.username);
                saveClaimed();
                // Accumulate 1% fee — flushed by 30-min interval, not here
                pendingRewardGP += feeGP;
                // Check Dragon Slayer community milestone
                checkDragonSlayerMilestone();
                // Stamp on-chain Bank Log score at each conversion (event-driven, active players only).
                // Passes per-skill XP for on-chain audit trail: wcXp/25 ≈ logs, mineXp/17.5 ≈ ores.
                // player.stats[i] stores XP × 10 internally — divide by 10 for real XP.
                const totalLevel = player.baseLevels.reduce((sum: number, lv: number) => sum + lv, 0);
                const wcXp       = Math.floor((player.stats[8]  ?? 0) / 10); // WOODCUTTING
                const fishXp     = Math.floor((player.stats[10] ?? 0) / 10); // FISHING
                const mineXp     = Math.floor((player.stats[14] ?? 0) / 10); // MINING
                const totalGrantedGP = grantedGP.get(player.username) ?? 0;
                const rstEarned  = totalGrantedGP / RST_GP_PER_TOKEN;
                // resourcesSold approximated from total GP converted ÷ avg resource value (100 GP)
                const resourcesSold = Math.floor(totalGrantedGP / 100);
                stampBankLog(player.username, totalLevel, wcXp, mineXp, fishXp, rstEarned, resourcesSold);
            }
            // Whether grant succeeded or failed, push mint_ready so the player can claim from browser
            if (ctrl) {
                try {
                    ctrl.enqueue(encoder.encode('data: ' + JSON.stringify({
                        type: 'mint_ready',
                        username: player.username,
                        wallet,
                        gpAmount: playerGP,
                        rstAmount: playerGP / RST_GP_PER_TOKEN,
                        rstWei,
                    }) + '\n\n'));
                } catch { sseClients.delete(player.username); }
            }
        });
    } else {
        // No server key — push mint_ready for manual browser signing
        const controller = sseClients.get(player.username);
        if (controller) {
            const rstWei = (BigInt(Math.floor(newPending)) * (10n ** 18n) / BigInt(RST_GP_PER_TOKEN)).toString();
            try {
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({
                    type: 'mint_ready',
                    username: player.username,
                    wallet,
                    gpAmount: newPending,
                    rstAmount: newPending / RST_GP_PER_TOKEN,
                    rstWei,
                }) + '\n\n'));
                player.messageGame('Sign in OP_WALLET at /play to claim ' + rstValue + ' RST!');
            } catch {
                sseClients.delete(player.username);
                player.messageGame('Visit /play to claim ' + rstValue + ' RST!');
            }
        } else {
            player.messageGame('Open /play in your browser to claim ' + rstValue + ' RST!');
        }
    }

    return true;
}
