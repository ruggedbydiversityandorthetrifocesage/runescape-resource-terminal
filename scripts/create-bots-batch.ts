#!/usr/bin/env bun
/**
 * Batch bot creator
 * Usage: bun scripts/create-bots-batch.ts <count> [prefix] [server]
 * Example: bun scripts/create-bots-batch.ts 100
 * Example: bun scripts/create-bots-batch.ts 100 bot runescaperesourceterminal.duckdns.org
 */

import { cp, readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const DEFAULT_SERVER = 'runescaperesourceterminal.duckdns.org';

function randomStr(len: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

async function replaceInFile(filePath: string, replacements: Record<string, string>) {
    let content = await readFile(filePath, 'utf-8');
    for (const [k, v] of Object.entries(replacements)) content = content.replaceAll(k, v);
    await writeFile(filePath, content);
}

async function createBot(username: string, server: string): Promise<boolean> {
    const templateDir = join(process.cwd(), 'bots', '_template');
    const botDir = join(process.cwd(), 'bots', username);

    if (existsSync(botDir)) return false; // already exists, skip

    await cp(templateDir, botDir, { recursive: true });

    const password = randomStr(12);
    const files = await readdir(botDir);
    for (const file of files) {
        await replaceInFile(join(botDir, file), {
            '{{USERNAME}}': username,
            '{{PASSWORD}}': password,
        });
    }

    // Set server in bot.env
    const envPath = join(botDir, 'bot.env');
    await replaceInFile(envPath, { 'rs-sdk-demo.fly.dev': server });

    return true;
}

async function main() {
    const count  = parseInt(process.argv[2] ?? '10');
    const prefix = process.argv[3] ?? 'bot';
    const server = process.argv[4] ?? DEFAULT_SERVER;

    if (isNaN(count) || count < 1) {
        console.error('Usage: bun scripts/create-bots-batch.ts <count> [prefix] [server]');
        process.exit(1);
    }

    console.log(`Creating ${count} bots (prefix: ${prefix}, server: ${server})...`);

    let created = 0;
    let skipped = 0;

    for (let i = 0; i < count; i++) {
        // Generate a unique name: prefix + zero-padded index (e.g. bot0001)
        const username = `${prefix}${String(i + 1).padStart(4, '0')}`;
        if (username.length > 12) {
            console.error(`Username "${username}" exceeds 12 chars — use a shorter prefix`);
            process.exit(1);
        }

        const ok = await createBot(username, server);
        if (ok) {
            created++;
            if (created % 50 === 0) console.log(`  ${created}/${count} created...`);
        } else {
            skipped++;
        }
    }

    console.log(`Done. Created: ${created}, Skipped (already exist): ${skipped}`);
    console.log(`\nRun dashboard:\n  bun dashboard.ts --all wc`);
    console.log(`Or Docker:\n  docker build -t rst-dashboard . && docker run -p 3001:3001 rst-dashboard`);
}

main().catch(console.error);
