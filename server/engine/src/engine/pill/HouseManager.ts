import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { printInfo, printError } from '#/util/Logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '../../../data/houses.json');

// username → 1-based house index
interface HouseRegistry {
    [username: string]: number;
}

let registry: HouseRegistry = {};
let nextIndex = 1;

/**
 * Load house index assignments from disk.
 * Called once at server startup (before portal spawn).
 */
export function loadHouseRegistry(): void {
    if (fs.existsSync(DATA_PATH)) {
        try {
            const raw = fs.readFileSync(DATA_PATH, 'utf8');
            registry = JSON.parse(raw) as HouseRegistry;
            const indices = Object.values(registry);
            nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;
            printInfo(`[Housing] Loaded ${Object.keys(registry).length} house entries`);
        } catch (err) {
            printError('[Housing] Failed to load houses.json: ' + err);
            registry = {};
            nextIndex = 1;
        }
    } else {
        printInfo('[Housing] No houses.json found — starting fresh');
    }
}

/**
 * Get (or create) a 1-based house index for a player.
 * Allocations are immediately persisted to disk.
 */
export function getOrCreateHouseIndex(username: string): number {
    if (!registry[username]) {
        registry[username] = nextIndex++;
        saveHouseRegistry();
        printInfo(`[Housing] Allocated house index ${registry[username]} for "${username}"`);
    }
    return registry[username];
}

function saveHouseRegistry(): void {
    try {
        if (!fs.existsSync(path.dirname(DATA_PATH))) {
            fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
        }
        fs.writeFileSync(DATA_PATH, JSON.stringify(registry, null, 2));
    } catch (err) {
        printError('[Housing] Failed to save houses.json: ' + err);
    }
}

// Houses are arranged in a 2D grid: 6 columns eastward from x=4480,
// then new rows southward from z=12800. Regions 70-72 (X) × 200 (Z)
// have confirmed map data. 3 regions × 64 tiles = 192 tiles / 32 per house = 6 columns.
// Each row increments Z by 32, staying within z-region 200 (z=12800-12863).
const HOUSE_COLS = 6;
const HOUSE_BASE_X = 4480;  // region 70 × 64
const HOUSE_BASE_Z = 12800; // region 200 × 64

/**
 * Returns the world X coordinate for a given 1-based house index.
 */
export function houseBaseX(houseIndex: number): number {
    const col = (houseIndex - 1) % HOUSE_COLS;
    return HOUSE_BASE_X + col * 32;
}

/**
 * Returns the world Z coordinate for a given 1-based house index.
 */
export function houseBaseZ(houseIndex: number): number {
    const row = Math.floor((houseIndex - 1) / HOUSE_COLS);
    return HOUSE_BASE_Z + row * 32;
}

/**
 * Returns all currently-assigned house indices (for zone pre-allocation at startup).
 */
export function getAllHouseIndices(): number[] {
    return Object.values(registry);
}
export const HOUSE_PORTAL_X = 3220;
export const HOUSE_PORTAL_Z = 3215;
