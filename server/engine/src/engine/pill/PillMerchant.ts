import { NetworkPlayer } from '#/engine/entity/NetworkPlayer.js';
import Npc from '#/engine/entity/Npc.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mintRST, isMintConfigured } from './RSTMinter.js';
import { getTutorialStep, setTutorialStep, TUTORIAL_TREE_X, TUTORIAL_TREE_Z } from './TutorialTracker.js';

// ============================================================
// RST — Runescape Resource Terminal
// OPNet OP20 token bridge
// Paste the deployed tb1p... contract address below:
// ============================================================
export const RST_CONTRACT = 'opt1sqqsrj9ex92gwjwus3ufz60nclkdgzdtgnqkv9ya8';
export const RST_GP_PER_TOKEN = 10000; // 10,000 GP = 1 RST

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
export const pendingGP = new Map<string, number>();         // GP accumulated but not yet minted
export const totalGPConverted = new Map<string, number>();  // all-time leaderboard score

// SSE push: engine signals the browser tab when a mint is ready
export const sseClients = new Map<string, ReadableStreamDefaultController<Uint8Array>>();

const LEADERBOARD_PATH = 'data/rst-leaderboard.json';
const PENDING_PATH = 'data/rst-pending.json';
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

loadLeaderboard();

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
        const price = (RESOURCE_PRICES as any)[item.id];
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
        player.messageGame('10,000 GP = 1 RST  |  1,000 GP = 0.1 RST  |  100 GP = 0.01 RST');
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
    player.messageGame('Sold for ' + saleGP + ' GP! Total: ' + newPending + ' GP = ' + rstValue + ' RST');

    // Tutorial progression
    const tStep = getTutorialStep(player.username);
    if (tStep === 1) {
        // First sale — tutorial complete, clear hint
        setTutorialStep(player.username, 2);
        player.stopHint();
        player.messageGame('You sold your resources! Visit /play in your browser to mint your RST tokens!');
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

    if (false && isMintConfigured()) {
        // Server auto-mint disabled — protocol rejects constructed addresses for wallets
        // with prior OPNet history. Browser-side signing via OP_WALLET is the correct path.
        player.messageGame('Auto-minting ' + rstValue + ' RST to your wallet...');
        const gpSnapshot = newPending;
        const mldsaKey = mldsaRegistry.get(player.username);
        mintRST(player.username, wallet, gpSnapshot, mldsaKey).then(success => {
            if (success) {
                pendingGP.delete(player.username);
                savePending();
                // Push success SSE so /play tab shows banner
                const ctrl = sseClients.get(player.username);
                if (ctrl) {
                    try {
                        ctrl.enqueue(encoder.encode('data: ' + JSON.stringify({
                            type: 'minted',
                            rstAmount: gpSnapshot / RST_GP_PER_TOKEN,
                        }) + '\n\n'));
                    } catch { sseClients.delete(player.username); }
                }
            } else {
                // Mint failed — fall back to manual signing via SSE
                const ctrl = sseClients.get(player.username);
                if (ctrl) {
                    const rstWei = (BigInt(Math.floor(gpSnapshot)) * (10n ** 18n) / BigInt(RST_GP_PER_TOKEN)).toString();
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
