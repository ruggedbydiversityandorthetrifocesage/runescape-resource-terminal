import fs from 'fs';
import path from 'path';
import { MIME_TYPES } from '../utils.js';

export function handleDisclaimerPage(url: URL): Response | null {
    if (url.pathname !== '/disclaimer' && url.pathname !== '/disclaimer/') {
        return null;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Disclaimer</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a;
            color: #ccc;
            margin: 0;
            padding: 40px 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 700px;
            margin: 0 auto;
            background: rgba(255,255,255,0.03);
            padding: 40px;
            border-radius: 8px;
        }
        h1 {
            color: #5bf;
            margin-bottom: 24px;
        }
        p {
            margin-bottom: 16px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Disclaimer</h1>
        <p>This is a free, open-source, community-run project.</p>
        <p>The goal is strictly education and scientific research.</p>
        <p>LostCity Server was written from scratch after many hours of research and peer review. Everything you see is completely and transparently open source.</p>
        <p>We have not been endorsed by, authorized by, or officially communicated with Jagex Ltd. on our efforts here.</p>
        <p>You cannot play Old School RuneScape here, buy RuneScape gold, or access any of the official game's services!</p>
    </div>
</body>
</html>`;

    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

export function handleMapviewPage(url: URL): Response | null {
    if (url.pathname !== '/mapview' && url.pathname !== '/mapview/') {
        return null;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>World Map — Runescape Resource Terminal</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0e0e0e; color: #c0a060; font-family: 'Courier New', monospace; min-height: 100vh; display: flex; flex-direction: column; }
        header { background: #1a1200; border-bottom: 2px solid #4a3800; padding: 0 20px; height: 44px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
        .logo { color: #f0c030; font-size: 1em; font-weight: bold; letter-spacing: 2px; }
        .back-btn { background: #1a1200; border: 1px solid #f0c030; color: #f0c030; padding: 5px 14px; font-family: monospace; font-size: 0.72em; cursor: pointer; border-radius: 3px; text-decoration: none; }
        .back-btn:hover { background: #2a2000; }
        .tabs { display: flex; gap: 4px; padding: 14px 20px 0; border-bottom: 2px solid #2a2000; }
        .tab { background: #111; border: 1px solid #2a2000; border-bottom: none; color: #666; padding: 8px 18px; font-family: monospace; font-size: 0.75em; cursor: pointer; border-radius: 3px 3px 0 0; transition: all 0.15s; }
        .tab:hover { color: #c0a060; border-color: #4a3800; }
        .tab.active { background: #1a1200; border-color: #f0c030; color: #f0c030; }
        .map-view { flex: 1; padding: 20px; display: flex; flex-direction: column; align-items: center; }
        .phase-panel { display: none; width: 100%; max-width: 900px; }
        .phase-panel.active { display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .phase-label { font-size: 0.8em; letter-spacing: 2px; text-transform: uppercase; padding: 6px 18px; border-radius: 3px; font-weight: bold; }
        .phase-label.p1 { color: #44cc44; border: 1px solid #44cc44; background: #001a00; }
        .phase-label.p2 { color: #f7931a; border: 1px solid #f7931a; background: #1a0800; }
        .phase-label.p3 { color: #ff4444; border: 1px solid #ff4444; background: #1a0000; }
        .phase-req { font-size: 0.72em; color: #666; }
        .map-img { width: 100%; border: 2px solid #2a2000; border-radius: 4px; display: block; }
        .phase-desc { font-size: 0.75em; color: #888; text-align: center; line-height: 1.6; max-width: 700px; }
    </style>
</head>
<body>
<header>
    <span class="logo">&#x26CF; WORLD MAP</span>
    <a href="/play" class="back-btn">&#x2190; BACK TO GAME</a>
</header>
<div class="tabs">
    <button class="tab active" onclick="showPhase(1, this)">&#x1F7E2; PHASE 1</button>
    <button class="tab" onclick="showPhase(2, this)">&#x1F7E0; PHASE 2</button>
    <button class="tab" onclick="showPhase(3, this)">&#x1F534; PHASE 3 — FULL WORLD</button>
</div>
<div class="map-view">
    <div class="phase-panel active" id="phase1">
        <span class="phase-label p1">&#x1F7E2; PHASE 1 — MISTHALIN</span>
        <span class="phase-req">0 RST required — starting area</span>
        <img class="map-img" src="/maps/phase1_region_hq.jpg" alt="Phase 1 map — Misthalin region">
        <p class="phase-desc">Lumbridge &bull; Draynor Village &bull; Varrock &bull; Edgeville &bull; Barbarian Village &bull; Al Kharid &bull; Scorpion Crag &bull; Wilderness</p>
    </div>
    <div class="phase-panel" id="phase2">
        <span class="phase-label p2">&#x1F7E0; PHASE 2 — ASGARNIA</span>
        <span class="phase-req">10 RST required to unlock</span>
        <img class="map-img" src="/maps/phase2_region_hq.jpg" alt="Phase 2 map — Asgarnia region">
        <p class="phase-desc">Phase 1 + Falador &bull; Port Sarim &bull; Rimmington &bull; Entrana &bull; Taverley &bull; Burthorpe &bull; Duel Arena</p>
    </div>
    <div class="phase-panel" id="phase3">
        <span class="phase-label p3">&#x1F534; PHASE 3 — FULL WORLD</span>
        <span class="phase-req">1,000 RST required to unlock</span>
        <img class="map-img" src="/maps/gielinor_hq_web.jpg" alt="Phase 3 map — Full Gielinor">
        <p class="phase-desc">Full world access — all of Gielinor</p>
    </div>
</div>
<script>
function showPhase(n, el) {
    document.querySelectorAll('.phase-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('phase' + n).classList.add('active');
    el.classList.add('active');
}
</script>
</body>
</html>`;

    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// Map URL prefixes to webclient build output directories.
// The webclient builds into ../webclient/out/ relative to the engine CWD,
// so we serve those files directly instead of requiring a copy step.
const WEBCLIENT_OUT = path.resolve('../webclient/out');
const WEBCLIENT_ROUTES: Record<string, string> = {
    '/client/': path.join(WEBCLIENT_OUT, 'standard'),
    '/bot/': path.join(WEBCLIENT_OUT, 'bot'),
};

function resolveWebclientPath(pathname: string): string | null {
    for (const [prefix, dir] of Object.entries(WEBCLIENT_ROUTES)) {
        if (pathname.startsWith(prefix)) {
            const file = pathname.slice(prefix.length);
            const resolved = path.resolve(dir, file);
            // Prevent path traversal
            if (!resolved.startsWith(dir)) return null;
            return resolved;
        }
    }
    return null;
}

export function handlePublicFiles(url: URL): Response | null {
    // Check engine/public/ first (favicon, images, etc.)
    const publicPath = `public${url.pathname}`;
    if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
        return new Response(Bun.file(publicPath), {
            headers: {
                'Content-Type': MIME_TYPES.get(path.extname(url.pathname ?? '')) ?? 'text/plain'
            }
        });
    }

    // Fall back to webclient build output
    const webclientPath = resolveWebclientPath(url.pathname);
    if (webclientPath && fs.existsSync(webclientPath) && fs.statSync(webclientPath).isFile()) {
        return new Response(Bun.file(webclientPath), {
            headers: {
                'Content-Type': MIME_TYPES.get(path.extname(url.pathname ?? '')) ?? 'text/plain'
            }
        });
    }

    return null;
}
