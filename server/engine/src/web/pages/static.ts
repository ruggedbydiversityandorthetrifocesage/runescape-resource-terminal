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
    <title>Disclaimer — Resource Terminal</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: Arial, Helvetica, sans-serif;
            background: #0a0a08;
            background-image: radial-gradient(ellipse at 20% 50%, #1a1200 0%, transparent 50%),
                              radial-gradient(ellipse at 80% 20%, #0e0c00 0%, transparent 50%);
            color: #c8c8b8;
            min-height: 100vh;
            padding: 32px 16px 60px;
            font-size: 14px;
            line-height: 1.7;
        }
        .page { max-width: 740px; margin: 0 auto; }
        .back { display: inline-block; color: #8ebc44; text-decoration: none; font-size: 12px; margin-bottom: 20px; letter-spacing: 1px; }
        .back:hover { text-decoration: underline; }
        .box {
            border: 1px solid #3a3000;
            background: linear-gradient(135deg, #0e0c04 0%, #141000 100%);
            padding: 28px 32px;
            margin-bottom: 16px;
        }
        h1 { color: #f0c030; font-size: 18px; font-weight: bold; margin-bottom: 6px; letter-spacing: 1px; }
        .tagline { color: #888; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 20px; border-bottom: 1px solid #2a2000; padding-bottom: 14px; }
        p { margin-bottom: 14px; color: #c8c8b8; }
        p:last-child { margin-bottom: 0; }
        .warn { color: #ff6b35; font-weight: bold; }
        .gold { color: #f0c030; }
        .green { color: #8ebc44; }
        .dim { color: #888; font-size: 12px; }
        h2 { color: #f0c030; font-size: 13px; font-weight: bold; margin-bottom: 10px; letter-spacing: 1px; }
        .faq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .faq-item { border: 1px solid #2a2000; background: #080600; padding: 16px 18px; }
        .faq-q { color: #f0c030; font-size: 12px; font-weight: bold; margin-bottom: 8px; }
        .faq-a { color: #c8c8b8; font-size: 13px; line-height: 1.6; }
        .faq-a em { color: #ff6b35; font-style: normal; font-weight: bold; }
        .summary { border: 1px solid #3a3000; background: #080600; padding: 20px 24px; text-align: center; }
        .summary p { color: #888; font-size: 13px; margin-bottom: 8px; }
        .summary .closer { color: #f0c030; font-size: 15px; font-weight: bold; margin-top: 14px; }
        @media (max-width: 600px) { .faq-grid { grid-template-columns: 1fr; } .box { padding: 20px 18px; } }
    </style>
</head>
<body>
<div class="page">
    <a class="back" href="/">&#x2190; BACK TO HOME</a>

    <div class="box">
        <h1>Non-Affiliation Disclaimer</h1>
        <div class="tagline">Resource Terminal &mdash; Bitcoin-Powered RuneScape</div>

        <p>This is a <span class="green">free, open-source, community-run project</span> built on love, nostalgia, and an unhealthy amount of research. We are preserving September 7th, 2004 &mdash; not for profit, but for posterity.</p>

        <p>Every line of code was written from scratch. Everything is transparent, open, and auditable by anyone. We have never been endorsed by, authorized by, or communicated with <strong>Jagex Ltd.</strong> in any capacity &mdash; nor do we need to be.</p>

        <p class="warn">You cannot play Old School RuneScape here. You cannot buy RuneScape gold here. You cannot access any official Jagex service here.</p>

        <p>What you <span class="gold">can</span> do is relive a moment in time that shaped a generation &mdash; and optionally earn a little Bitcoin doing it.</p>

        <p class="warn">As always: never reuse passwords across any online service. Ever.</p>
    </div>

    <div class="faq-grid" style="margin-bottom:16px">
        <div class="faq-item">
            <div class="faq-q">What version is this?</div>
            <div class="faq-a">September 7th, 2004. The day the wilderness was wild and the economy was real.</div>
        </div>
        <div class="faq-item">
            <div class="faq-q">How do I pay for membership?</div>
            <div class="faq-a"><em>You don&rsquo;t.</em> $0. Lifetime. Free forever.<br><br>The distinction between F2P and P2P content exists for historical accuracy only &mdash; not profit. We are archivists, not a subscription service.</div>
        </div>
        <div class="faq-item">
            <div class="faq-q">What is RST?</div>
            <div class="faq-a">RST is an experimental community token built on Bitcoin via OP_NET. It is not RuneScape gold. It is not affiliated with Jagex. It is <em>not an investment</em>. It is not a financial product.<br><br>You earn it by playing. You can hold it, trade it, or ignore it entirely &mdash; the game works exactly the same either way.<br><br><em>Do not buy RST expecting profit.</em> Play the game. That&rsquo;s the point.</div>
        </div>
        <div class="faq-item">
            <div class="faq-q">How can I help?</div>
            <div class="faq-a">Research. Develop. Report bugs. Run a validator node. Share your memories. Tell someone who played in 2004.<br><br>The best thing you can do is show up and play. The second best thing is bring a friend.</div>
        </div>
    </div>

    <div class="summary">
        <p>We didn&rsquo;t ask Jagex&rsquo;s permission to remember 2004.</p>
        <p>We didn&rsquo;t ask anyone&rsquo;s permission to build on Bitcoin.</p>
        <p>This is open source. This is community owned. This is free.</p>
        <div class="closer">Welcome back to Lumbridge. &#x1F5E1;&#xFE0F;</div>
    </div>
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
