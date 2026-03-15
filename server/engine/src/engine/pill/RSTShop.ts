// ============================================================
// RST Shop — Burn RST for rare in-game items
//
// NPC: RST Broker (type 741) spawned in front of Lumbridge Castle
// Flow:
//   1. Player clicks NPC → count dialog with catalog
//   2. Player picks number → pending purchase stored, SSE pushed to /play
//   3. Browser confirms at /play → /shop/confirm-purchase endpoint
//   4. Server deducts RST + gives item in-game
//
// Cooldown: 10 minutes between confirmed purchases
// Broadcast: every 50 ticks via npc.say() speech bubble (nearby players only)
// ============================================================

import { NetworkPlayer } from '#/engine/entity/NetworkPlayer.js';
import Npc from '#/engine/entity/Npc.js';
import Player from '#/engine/entity/Player.js';
import { pendingGP, RST_GP_PER_TOKEN, savePending, sseClients } from './PillMerchant.js';
import PCountDialog from '#/network/game/server/model/PCountDialog.js';

// NPC type IDs that trigger the RST Shop
export const RST_SHOP_NPC_IDS = new Set([741]);

// Reference to the spawned broker NPC (for broadcast say() bubbles)
let rstBrokerNpc: Npc | null = null;

export function setRSTBrokerNpc(npc: Npc): void {
    rstBrokerNpc = npc;
}

// Shop catalog — rst is the amount burned on purchase
const SHOP_ITEMS = [
    // Tools — skilling upgrades
    { id: 1357, name: 'Adamant axe',        rst: 25  },
    { id: 1271, name: 'Adamant pickaxe',    rst: 25  },
    { id: 1359, name: 'Rune axe',           rst: 50  },
    { id: 1275, name: 'Rune pickaxe',       rst: 50  },
    // Fishing supplies
    { id: 303,  name: 'Small net',          rst: 1   },
    { id: 309,  name: 'Fly fishing rod',    rst: 1   },
    { id: 314,  name: 'Feather (100x)',     rst: 2,  qty: 100 },
    { id: 311,  name: 'Harpoon',            rst: 3   },
    { id: 301,  name: 'Lobster pot',        rst: 3   },
    { id: 313,  name: 'Fishing bait (50x)', rst: 1,  qty: 50  },
    // Cosmetics
    { id: 1050, name: 'Santa hat',          rst: 500 },
];

const PARTY_HATS = [1038, 1040, 1042, 1044, 1046, 1048];

// Players currently in the count-dialog selection step
export const pendingShopDialog = new Map<string, boolean>();

// Pending purchases awaiting browser confirmation
type PendingPurchase = {
    itemId: number;
    itemName: string;
    itemQty: number;
    rstCost: number;
    gpCost: number;
    nonce: string;
    expiresAtTick: number;
};

export const pendingShopPurchase = new Map<string, PendingPurchase>();

// Cooldown: 10 minutes between confirmed purchases
const lastShopPurchase = new Map<string, number>();
const SHOP_COOLDOWN_TICKS = 1000; // ~10 min at 600ms/tick

const encoder = new TextEncoder();

function genNonce(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Step 1 — player clicks NPC: show catalog via count dialog
export function handleRSTShop(player: NetworkPlayer, _npc: Npc): boolean {
    const balance = pendingGP.get(player.username) ?? 0;
    const rst = (balance / RST_GP_PER_TOKEN).toFixed(4);

    player.messageGame('=== RST BROKER — Trade RST for rare items ===');
    player.messageGame('Your balance: ' + rst + ' RST');
    for (let i = 0; i < SHOP_ITEMS.length; i++) {
        player.messageGame((i + 1) + '. ' + SHOP_ITEMS[i].name + ' — ' + SHOP_ITEMS[i].rst + ' RST');
    }
    player.messageGame((SHOP_ITEMS.length + 1) + '. Party hat (random colour) — 500 RST');
    player.messageGame('Enter a number to select:');

    pendingShopDialog.set(player.username, true);
    player.write(new PCountDialog());
    return true;
}

// Step 2 — player submits number: validate + push SSE for browser to confirm
export function processRSTShopPurchase(player: Player, choice: number, currentTick: number): void {
    const lastPurchase = lastShopPurchase.get(player.username) ?? 0;
    if (currentTick - lastPurchase < SHOP_COOLDOWN_TICKS) {
        const remainingMins = Math.ceil((SHOP_COOLDOWN_TICKS - (currentTick - lastPurchase)) * 0.6 / 60);
        player.messageGame('Please wait ' + remainingMins + ' more minute(s) before purchasing again.');
        return;
    }

    const isPartyHat = choice === SHOP_ITEMS.length + 1;
    const item = isPartyHat
        ? { id: PARTY_HATS[Math.floor(Math.random() * PARTY_HATS.length)], name: 'Party hat', rst: 500 }
        : SHOP_ITEMS[choice - 1];

    if (!item) {
        player.messageGame('Invalid selection. Enter 1–' + (SHOP_ITEMS.length + 1) + '.');
        return;
    }

    const balance = pendingGP.get(player.username) ?? 0;
    const gpCost = item.rst * RST_GP_PER_TOKEN;
    if (balance < gpCost) {
        player.messageGame('Not enough RST! Need ' + item.rst + ', you have ' + (balance / RST_GP_PER_TOKEN).toFixed(4) + ' RST.');
        return;
    }

    // Store pending purchase — item not given until browser confirms
    const nonce = genNonce();
    pendingShopPurchase.set(player.username, {
        itemId: item.id,
        itemName: item.name,
        itemQty: (item as any).qty ?? 1,
        rstCost: item.rst,
        gpCost,
        nonce,
        expiresAtTick: currentTick + 500, // 5 min expiry
    });

    // Push SSE event to browser
    const controller = sseClients.get(player.username);
    if (controller) {
        try {
            controller.enqueue(encoder.encode('data: ' + JSON.stringify({
                type: 'shop_purchase_ready',
                itemName: item.name,
                rstCost: item.rst,
                nonce,
            }) + '\n\n'));
            player.messageGame('Go to /play to confirm and receive your ' + item.name + '!');
        } catch {
            sseClients.delete(player.username);
            pendingShopPurchase.delete(player.username);
            player.messageGame('Open /play in your browser first, then revisit the shop.');
        }
    } else {
        pendingShopPurchase.delete(player.username);
        player.messageGame('Open /play in your browser first, then revisit the shop!');
    }
}

// Step 3 — called by /shop/confirm-purchase web endpoint after browser confirms
export function confirmRSTShopPurchase(
    username: string,
    nonce: string,
    currentTick: number
): { success: boolean; itemId?: number; itemName?: string; message: string } {
    const pending = pendingShopPurchase.get(username);
    if (!pending) return { success: false, message: 'No pending purchase found.' };
    if (pending.nonce !== nonce) return { success: false, message: 'Invalid purchase token.' };
    if (currentTick > pending.expiresAtTick) {
        pendingShopPurchase.delete(username);
        return { success: false, message: 'Purchase expired — please visit the shop again.' };
    }

    const balance = pendingGP.get(username) ?? 0;
    if (balance < pending.gpCost) {
        pendingShopPurchase.delete(username);
        return { success: false, message: 'Insufficient RST balance.' };
    }

    pendingGP.set(username, balance - pending.gpCost);
    savePending();
    lastShopPurchase.set(username, currentTick);
    pendingShopPurchase.delete(username);

    return {
        success: true,
        itemId: pending.itemId,
        itemQty: pending.itemQty,
        itemName: pending.itemName,
        message: 'You received ' + pending.itemName + ' for ' + pending.rstCost + ' RST!',
    };
}

// ============================================================
// Bob's Brilliant Axes — GP-based shop (tools + fishing supplies)
// Intercepts NPC 519 (Bob) so we can add fishing gear alongside axes
// ============================================================

export const BOB_SHOP_NPC_IDS = new Set([519]);

// ============================================================
// Fishing Supplies NPC — spawned inside Bob's shop in World.ts
// Sells fishing gear for GP. Tracked by NID, not type, so any
// NPC type can be reused without affecting other world NPCs.
// ============================================================

export let fishingSuppliesNid = -1;

export function setFishingSuppliesNid(nid: number): void {
    fishingSuppliesNid = nid;
}

const FISHING_GP_ITEMS = [
    { id: 303, name: 'Small net',        gp: 5             },
    { id: 309, name: 'Fly fishing rod',  gp: 5             },
    { id: 307, name: 'Fishing rod',      gp: 5             },
    { id: 314, name: 'Feather',          gp: 2,  qty: 100  },
    { id: 313, name: 'Fishing bait',     gp: 3,  qty: 50   },
    { id: 311, name: 'Harpoon',          gp: 45            },
    { id: 301, name: 'Lobster pot',      gp: 20            },
];

const fishingShopDialog = new Map<string, boolean>();

export function handleFishingShop(player: NetworkPlayer, _npc: Npc): boolean {
    player.messageGame('=== Fishing Supplies — Buy gear for GP ===');
    for (let i = 0; i < FISHING_GP_ITEMS.length; i++) {
        const item = FISHING_GP_ITEMS[i];
        const label = (item as any).qty ? item.name + ' x' + (item as any).qty : item.name;
        player.messageGame((i + 1) + '. ' + label + ' — ' + item.gp + ' GP');
    }
    player.messageGame('Enter a number to buy:');
    fishingShopDialog.set(player.username, true);
    player.write(new PCountDialog());
    return true;
}

export function processFishingShopPurchase(player: NetworkPlayer, choice: number): void {
    fishingShopDialog.delete(player.username);
    const item = FISHING_GP_ITEMS[choice - 1];
    if (!item) {
        player.messageGame('Invalid selection. Enter 1–' + FISHING_GP_ITEMS.length + '.');
        return;
    }
    const qty = (item as any).qty ?? 1;
    const cost = item.gp;
    const inv = player.getInventory(93);
    if (!inv) return;
    let gpSlot = -1;
    let gpCount = 0;
    for (let slot = 0; slot < inv.capacity; slot++) {
        const obj = inv.get(slot);
        if (obj && obj.id === 995) { gpSlot = slot; gpCount = obj.count; break; }
    }
    if (gpCount < cost) {
        player.messageGame('Not enough GP! Need ' + cost + ' GP, you have ' + gpCount + ' GP.');
        return;
    }
    if (gpCount - cost === 0) {
        inv.set(gpSlot, null);
    } else {
        inv.set(gpSlot, { id: 995, count: gpCount - cost });
    }
    player.invAdd(93, item.id, qty, false);
    player.messageGame('Purchased ' + (qty > 1 ? qty + 'x ' : '') + item.name + ' for ' + cost + ' GP.');
}

export function hasFishingShopDialog(username: string): boolean {
    return fishingShopDialog.get(username) === true;
}

const BOB_GP_ITEMS = [
    // Axes
    { id: 1351, name: 'Bronze axe',      gp: 16   },
    { id: 1349, name: 'Iron axe',        gp: 56   },
    { id: 1353, name: 'Steel axe',       gp: 200  },
    { id: 1355, name: 'Mithril axe',     gp: 520  },
    { id: 1357, name: 'Adamant axe',     gp: 1280 },
    { id: 1359, name: 'Rune axe',        gp: 3200 },
    // Pickaxes
    { id: 1265, name: 'Bronze pickaxe',  gp: 1    },
    { id: 1267, name: 'Iron pickaxe',    gp: 140  },
    { id: 1269, name: 'Steel pickaxe',   gp: 500  },
    { id: 1273, name: 'Mithril pickaxe', gp: 1300 },
    // Tools
    { id: 946,  name: 'Knife',           gp: 6    },
    { id: 1755, name: 'Chisel',          gp: 13   },
    { id: 1733, name: 'Needle',          gp: 1    },
    { id: 590,  name: 'Tinderbox',       gp: 1    },
    // Fishing supplies
    { id: 303,  name: 'Small net',       gp: 5    },
    { id: 309,  name: 'Fly fishing rod', gp: 5    },
    { id: 307,  name: 'Fishing rod',     gp: 5    },
    { id: 314,  name: 'Feather',         gp: 2,   qty: 100 },
    { id: 313,  name: 'Fishing bait',    gp: 3,   qty: 50  },
    { id: 311,  name: 'Harpoon',         gp: 45   },
    { id: 301,  name: 'Lobster pot',     gp: 20   },
];

const bobShopDialog = new Map<string, boolean>();

export function handleBobShop(player: NetworkPlayer, _npc: Npc): boolean {
    player.messageGame('=== Bob\'s Shop — Buy tools & fishing supplies ===');
    for (let i = 0; i < BOB_GP_ITEMS.length; i++) {
        const item = BOB_GP_ITEMS[i];
        const label = (item as any).qty ? item.name + ' x' + (item as any).qty : item.name;
        player.messageGame((i + 1) + '. ' + label + ' — ' + item.gp + ' GP');
    }
    player.messageGame('Enter a number to buy:');
    bobShopDialog.set(player.username, true);
    player.write(new PCountDialog());
    return true;
}

export function processBobShopPurchase(player: NetworkPlayer, choice: number): void {
    bobShopDialog.delete(player.username);
    const item = BOB_GP_ITEMS[choice - 1];
    if (!item) {
        player.messageGame('Invalid selection.');
        return;
    }
    const qty = (item as any).qty ?? 1;
    const cost = item.gp * (qty > 1 ? 1 : 1); // total cost is always item.gp
    const inv = player.getInventory(93); // main inventory
    if (!inv) return;
    // Count GP in inventory
    let gpSlot = -1;
    let gpCount = 0;
    for (let slot = 0; slot < inv.capacity; slot++) {
        const obj = inv.get(slot);
        if (obj && obj.id === 995) { gpSlot = slot; gpCount = obj.count; break; }
    }
    if (gpCount < cost) {
        player.messageGame('Not enough GP! Need ' + cost + ' GP, you have ' + gpCount + ' GP.');
        return;
    }
    // Deduct GP and give item
    if (gpCount - cost === 0) {
        inv.set(gpSlot, null);
    } else {
        inv.set(gpSlot, { id: 995, count: gpCount - cost });
    }
    player.invAdd(93, item.id, qty, false);
    player.messageGame('Purchased ' + (qty > 1 ? qty + 'x ' : '') + item.name + ' for ' + cost + ' GP.');
}

export function hasBobShopDialog(username: string): boolean {
    return bobShopDialog.get(username) === true;
}

// Broadcast — NPC speech bubble visible to nearby players (much less spammy than game chat)
export function broadcastRSTShop(): void {
    if (rstBrokerNpc) {
        rstBrokerNpc.say('TRADE your $RST for RARE ITEMS! Click me to browse!');
    }
}
