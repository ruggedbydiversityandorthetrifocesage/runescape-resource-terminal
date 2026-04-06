/**
 * Bot Launcher (Node.js ESM) — opens headless Chromium sessions for all bots
 * Runs alongside dashboard.ts inside Docker.
 */

import puppeteer from 'puppeteer';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOTS_DIR = join(__dirname, 'bots');
const STAGGER_MS = 3000;

function parseEnv(path) {
    const out = {};
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

async function launchBot(dir, username, password, server) {
    const url = `https://${server}/bot?bot=${username}&password=${password}&fps=5`;
    console.log(`[Launcher] ${username}: connecting...`);

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    page.on('pageerror', err => console.error(`[Launcher] ${username} js error:`, err.message));
    page.on('crash', () => console.error(`[Launcher] ${username} CRASHED`));

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
    } catch (e) {
        console.error(`[Launcher] ${username}: nav error: ${e.message}`);
        return;
    }

    // Wait for in-game flag
    let attempts = 0;
    while (true) {
        const ingame = await page.evaluate(() => !!window.gameClient?.ingame).catch(() => false);
        if (ingame) break;
        await new Promise(r => setTimeout(r, 500));
        if (++attempts > 120) {
            console.error(`[Launcher] ${username}: login timed out`);
            return;
        }
    }

    console.log(`[Launcher] ${username}: ✅ in-game`);
}

for (const dir of botDirs) {
    const env = parseEnv(join(BOTS_DIR, dir, 'bot.env'));
    launchBot(dir, env.BOT_USERNAME ?? dir, env.PASSWORD ?? '', env.SERVER ?? 'runescaperesourceterminal.duckdns.org')
        .catch(e => console.error(`[Launcher] ${dir} failed: ${e.message}`));
    await new Promise(r => setTimeout(r, STAGGER_MS));
}

console.log('[Launcher] All bots launched — keeping sessions alive...');
await new Promise(() => {}); // keep alive forever
