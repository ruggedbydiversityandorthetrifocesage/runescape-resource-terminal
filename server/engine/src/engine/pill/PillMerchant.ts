import ObjType from '#/cache/config/ObjType.js';
import { NetworkPlayer } from '#/engine/entity/NetworkPlayer.js';
import Npc from '#/engine/entity/Npc.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mintRST, isMintConfigured, fetchRSTBalance } from './RSTMinter.js';
import { getTutorialStep, setTutorialStep, TUTORIAL_TREE_X, TUTORIAL_TREE_Z } from './TutorialTracker.js';

// ============================================================
// RST — Runescape Resource Terminal
// OPNet OP20 token bridge
// Paste the deployed tb1p... contract address below:
// ============================================================
export const RST_CONTRACT = 'opt1sqq0uxr9f5e9qdswpaptpvgc8qr9thv2a4gwaj6fl';
export const RST_GP_PER_TOKEN = 1000; // 1,000 GP = 1 RST

// Cow NPC type IDs: 81=cow, 397=cow2, 955=cow3
export const COW_NPC_IDS = new Set([81, 397, 955]);
export const COW_KILL_GP = 100; // 0.1 RST per cow kill (at 1,000 GP/RST)

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

// SSE push: engine signals the browser tab when a mint is ready
export const sseClients = new Map<string, ReadableStreamDefaultController<Uint8Array>>();

// Per-player grantClaim cooldown — prevents UTXO chaining on rapid sales
// Only one grantClaim per player per 3 minutes; GP accumulates in between
const GRANT_COOLDOWN_MS = 3 * 60 * 1000;
const lastGrantTime = new Map<string, number>();

const LEADERBOARD_PATH = 'data/rst-leaderboard.json';
const PENDING_PATH = 'data/rst-pending.json';
const GRANTED_PATH = 'data/rst-granted.json';
const WALLETS_PATH = 'data/rst-wallets.json';
const MLDSA_PATH = 'data/rst-mldsa.json';
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
    } catch {}
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
    const bal = rstBalanceCache.get(username) ?? 0;
    if (bal >= 1000) return 2;
    if (bal >= 10) return 1;
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
        if (price) { saleGP += price * item.count; remove.push(slot); }
    }

    if (remove.length === 0) {
        // Tutorial: if new player has no sellable items, re-point them to the trees
        const tStepEmpty = getTutorialStep(player.username);
        if (tStepEmpty === 0 || tStepEmpty === 1) {
            player.hintTile(2, TUTORIAL_TREE_X, TUTORIAL_TREE_Z, 0);
            setTutorialStep(player.username, 0);
        }
        player.messageGame('Runescape Resource Terminal: Bring logs or ores to convert!');
        player.messageGame('1,000 GP = 1 RST  |  100 GP = 0.1 RST  |  10 GP = 0.01 RST');
        return true;
    }

    for (const slot of remove) inv.set(slot, null);

    // Update leaderboard (all-time, never decreases)
    const prevTotal = totalGPConverted.get(player.username) ?? 0;
    totalGPConverted.set(player.username, prevTotal + saleGP);
    saveLeaderboard();

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
        // First sale — tutorial complete, clear hint
        setTutorialStep(player.username, 2);
        player.stopHint();
        player.messageGame('You sold your resources! Visit /play in your browser to claim your RST tokens!');
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
        // Player then claims from browser via claim(amount).
        player.messageGame('Granting ' + rstValue + ' RST — sign at /play to claim!');
        const gpSnapshot = newPending;
        const mldsaKey = mldsaRegistry.get(player.username);
        const rstWei = (BigInt(Math.floor(gpSnapshot)) * (10n ** 18n) / BigInt(RST_GP_PER_TOKEN)).toString();
        // Push minting_started IMMEDIATELY so browser locks button before TX is in flight
        const ctrlEarly = sseClients.get(player.username);
        if (ctrlEarly) {
            try {
                ctrlEarly.enqueue(encoder.encode('data: ' + JSON.stringify({
                    type: 'minting_started',
                    username: player.username,
                    gpAmount: gpSnapshot,
                    rstAmount: gpSnapshot / RST_GP_PER_TOKEN,
                    rstWei,
                }) + '\n\n'));
            } catch { sseClients.delete(player.username); }
        }
        mintRST(player.username, wallet, gpSnapshot, mldsaKey).then(success => {
            const ctrl = sseClients.get(player.username);
            if (success) {
                const prevGranted = grantedGP.get(player.username) ?? 0;
                grantedGP.set(player.username, prevGranted + gpSnapshot);
                saveGranted();
                pendingGP.delete(player.username);
                savePending();
            }
            // Whether grant succeeded or failed, push mint_ready so the player can claim from browser
            if (ctrl) {
                try {
                    ctrl.enqueue(encoder.encode('data: ' + JSON.stringify({
                        type: 'mint_ready',
                        username: player.username,
                        wallet,
                        gpAmount: gpSnapshot,
                        rstAmount: gpSnapshot / RST_GP_PER_TOKEN,
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
