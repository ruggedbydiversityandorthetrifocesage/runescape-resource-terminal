/**
 * Bot Launcher — opens headless Chromium sessions for all bots
 * Runs inside Docker alongside dashboard.ts
 * Each bot gets its own page, auto-logged in via URL params
 */

import puppeteer from 'puppeteer';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const BOTS_DIR = join(import.meta.dir, 'bots');
const STAGGER_MS = 3000; // delay between bot launches to avoid hammering server

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

const botDirs = readdirSync(BOTS_DIR).filter(
    d => d !== '_template' && existsSync(join(BOTS_DIR, d, 'bot.env'))
);

console.log(`[Launcher] Starting ${botDirs.length} headless bot sessions...`);

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser';

const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-extensions',
        '--mute-audio',
    ],
});

async function launchBot(name: string, username: string, password: string, server: string) {
    const url = `https://${server}/bot?bot=${username}&password=${password}&fps=5`;
    console.log(`[Launcher] ${name}: opening ${url}`);

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    page.on('pageerror', err => console.error(`[Launcher] ${name} page error:`, err.message));
    page.on('crash', () => console.error(`[Launcher] ${name} page CRASHED`));

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
    } catch (e: any) {
        console.error(`[Launcher] ${name}: navigation error: ${e.message}`);
        return;
    }

    // Wait for in-game
    let attempts = 0;
    while (true) {
        const ingame = await page.evaluate(() => !!(window as any).gameClient?.ingame).catch(() => false);
        if (ingame) break;
        await new Promise(r => setTimeout(r, 500));
        if (++attempts > 120) { // 60s timeout
            console.error(`[Launcher] ${name}: login timed out`);
            return;
        }
    }

    console.log(`[Launcher] ${name}: ✅ in-game`);
}

for (const dir of botDirs) {
    const env = parseEnv(join(BOTS_DIR, dir, 'bot.env'));
    const name = env.BOT_USERNAME ?? dir;
    const password = env.PASSWORD ?? '';
    const server = env.SERVER ?? 'runescaperesourceterminal.duckdns.org';

    launchBot(dir, name, password, server).catch(e =>
        console.error(`[Launcher] ${dir}: failed: ${e.message}`)
    );

    await new Promise(r => setTimeout(r, STAGGER_MS));
}

console.log('[Launcher] All bots launched — keeping sessions alive...');

// Keep process alive forever so browser sessions don't die
await new Promise(() => {});
