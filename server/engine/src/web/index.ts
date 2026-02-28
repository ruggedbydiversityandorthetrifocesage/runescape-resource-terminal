import { register } from 'prom-client';
import Environment from '#/util/Environment.js';
import World from '#/engine/World.js';
import { handleClientPage, handleCacheEndpoints } from './pages/client.js';
import { handleHiscoresPage, handleHiscoresPlayerPage, handleHiscoresOutfitPage } from './pages/hiscores.js';
import { handleViewerAssets } from './hiscoresServer.js';
import { handleScreenshotsListPage, handleScreenshotFilePage } from './pages/screenshots.js';
import { handleScreenshotUpload, handleExportCollisionApi } from './pages/api.js';
import { handleDisclaimerPage, handleMapviewPage, handlePublicFiles } from './pages/static.js';
import { WebSocketData, handleWebSocketUpgrade, handleGatewayEndpointGet, websocketHandlers } from './websocket.js';

export type { WebSocketData };

export type WebSocketRoutes = {
    '/': Response
};

export async function startWeb() {
    Bun.serve<WebSocketData, WebSocketRoutes>({
        port: Environment.WEB_PORT,
        idleTimeout: 0,
        async fetch(req, server) {
            const url = new URL(req.url ?? '', `http://${req.headers.get('host')}`);

            // Handle WebSocket upgrades first
            const wsResponse = handleWebSocketUpgrade(req, server, url);
            if (wsResponse !== undefined) {
                return wsResponse;
            }

            // Gateway endpoint GET request
            const gatewayResponse = handleGatewayEndpointGet(url);
            if (gatewayResponse) return gatewayResponse;


            // RST: Claim page
            if (url.pathname === '/rst/claim') {
                const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Claim $RST</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0a0a0a; color: #00ff41; font-family: monospace; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
.container { text-align: center; padding: 40px; max-width: 520px; width: 100%; }
h1 { font-size: 2em; margin-bottom: 8px; text-shadow: 0 0 20px #00ff41; }
.sub { color: #888; margin-bottom: 24px; font-size: 0.85em; }
input { background: #111; border: 1px solid #00ff41; color: #00ff41; padding: 12px 16px; width: 100%; margin-bottom: 12px; font-family: monospace; font-size: 0.9em; border-radius: 4px; }
button { background: #00ff41; color: #000; border: none; padding: 14px; font-family: monospace; font-size: 1em; font-weight: bold; cursor: pointer; border-radius: 4px; width: 100%; margin-bottom: 10px; }
button:hover { background: #00cc33; }
button:disabled { background: #333; color: #666; cursor: not-allowed; }
.btn-orange { background: #f7931a; color: #000; }
.btn-orange:hover { background: #e07800; }
.btn-blue { background: #4444ff; color: #fff; }
.rst-count { font-size: 4em; color: #00ff41; text-shadow: 0 0 30px #00ff41; margin: 16px 0 4px; }
.rst-label { color: #888; font-size: 0.8em; margin-bottom: 20px; }
.status { margin-top: 16px; padding: 12px; border-radius: 4px; font-size: 0.85em; display: none; word-break: break-all; }
.success { background: #001a00; border: 1px solid #00ff41; color: #00ff41; display: block; }
.error { background: #1a0000; border: 1px solid #ff4141; color: #ff4141; display: block; }
.info { background: #00001a; border: 1px solid #4444ff; color: #8888ff; display: block; }
.contract { font-size: 0.6em; color: #333; margin-top: 24px; word-break: break-all; }
</style>
</head>
<body>
<div class="container">
  <h1>&#x1F48A; CLAIM $RST</h1>
  <p class="sub">Earned by chopping logs in Runescape Resource Terminal</p>
  <input id="username" placeholder="Your RuneScape username" />
  <button onclick="checkBalance()">CHECK MY BALANCE</button>
  <div id="rstInfo" style="display:none">
    <div class="rst-count" id="rstAmount">0</div>
    <div class="rst-label">$RST READY TO CLAIM</div>
    <button class="btn-orange" onclick="connectAndClaim()">CONNECT OP_WALLET &amp; CLAIM</button>
  </div>
  <a href="/rst" style="display:block; margin-top:12px; color:#888; font-size:0.8em;">Back to wallet connect</a>
  <div id="status" class="status"></div>
  <div class="contract">RST: 0xb09fc29c112af8293539477e23d8df1d3126639642767d707277131352040cbb</div>
</div>
<script>
const RST_CONTRACT = 'opt1sqqsrj9ex92gwjwus3ufz60nclkdgzdtgnqkv9ya8';
let connectedWallet = null;

function bech32mAddrToHex(addr) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const lower = addr.toLowerCase();
  const sep = lower.lastIndexOf('1');
  if (sep < 1) return null;
  const values = [];
  for (const c of lower.slice(sep + 1)) {
    const v = CHARSET.indexOf(c);
    if (v === -1) return null;
    values.push(v);
  }
  const prog = values.slice(1, -6);
  let acc = 0, bits = 0;
  const bytes = [];
  for (const v of prog) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
  }
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) bytes[i/2] = parseInt(h.substr(i, 2), 16);
  return bytes;
}

async function checkBalance() {
  const username = document.getElementById('username').value.trim().toLowerCase();
  if (!username) { showStatus('Enter your username first', 'error'); return; }
  try {
    const res = await fetch('/rst/balance?username=' + encodeURIComponent(username));
    const data = await res.json();
    if (data.pending > 0) {
      document.getElementById('rstAmount').textContent = data.pending;
      document.getElementById('rstInfo').style.display = 'block';
      showStatus(data.pending + ' $RST pending for ' + username + '!', 'success');
    } else {
      document.getElementById('rstInfo').style.display = 'none';
      showStatus('No $RST pending for ' + username + '. Chop some logs first!', 'info');
    }
  } catch(e) { showStatus('Error: ' + e.message, 'error'); }
}

async function connectAndClaim() {
  const username = document.getElementById('username').value.trim().toLowerCase();
  const gpAmount = parseInt(document.getElementById('rstAmount').textContent);
  try {
    const provider = window.opnet || window.unisat;
    if (!provider) { showStatus('OP_WALLET not found. Install it first!', 'error'); return; }
    const accounts = await provider.requestAccounts();
    connectedWallet = accounts[0];
    showStatus('Wallet connected. Preparing tx...', 'info');
    const web3 = window.opnet?.web3;
    if (!web3) { showStatus('OP_WALLET web3 not found.', 'error'); return; }
    // Compute MLDSA hash for recipient — SHA256 of the full MLDSA pubkey is the real OPNet address
    let recipientHashClaim = null;
    const pClaim = window.opnet || window.unisat;
    if (pClaim && typeof pClaim.getMLDSAPublicKey === 'function') {
      try {
        const key = await pClaim.getMLDSAPublicKey();
        const keyHex = typeof key === 'string' ? key : Array.from(key).map(b => b.toString(16).padStart(2,'0')).join('');
        const hashBuf = await crypto.subtle.digest('SHA-256', hexToBytes(keyHex));
        recipientHashClaim = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
      } catch(e) { console.warn('[RST] getMLDSAPublicKey failed on claim page:', e); }
    }
    if (!recipientHashClaim) { showStatus('Could not resolve recipient address. Make sure OP_WALLET is connected.', 'error'); return; }
    const amountWei = BigInt(gpAmount) * (10n ** 18n) / 10000n;
    const addrPadded = recipientHashClaim.padStart(64, '0');
    const amtHex = amountWei.toString(16).padStart(64, '0');
    const calldata = hexToBytes('3950e061' + addrPadded + amtHex);
    showStatus('Fetching UTXOs...', 'info');
    const utxosRaw = await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_getUTXOs', params: [connectedWallet, true] }) });
    const utxosJson = await utxosRaw.json();
    const utxosResult = utxosJson.result || {};
    const rawTxsClaim = Array.isArray(utxosResult.raw) ? utxosResult.raw : [];
    const utxos = [...(utxosResult.confirmed || []), ...(utxosResult.pending || [])].map(u => {
      const rawTx = typeof u.raw === 'number' ? rawTxsClaim[u.raw] : (typeof u.raw === 'string' ? u.raw : undefined);
      const obj = { transactionId: u.transactionId, outputIndex: u.outputIndex, value: typeof u.value === 'bigint' ? u.value : BigInt(u.value || 0), scriptPubKey: u.scriptPubKey };
      if (rawTx) { obj.nonWitnessUtxoBase64 = rawTx; try { const bin = atob(rawTx); const b = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i); obj.nonWitnessUtxo = b; } catch {} }
      return obj;
    });
    const network = { messagePrefix: '\\x18Bitcoin Signed Message:\\n', bech32: 'opt', bech32Opnet: 'opt', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
    // RST contract secret = tweakedPubkey (32 bytes), not the P2OP witness program (21 bytes)
    const contractHexClaim = '0xfdcb53e48b0330e2714efa4c5de48f29893d89023ee661d94a15b2948138a77f';
    const params = { to: RST_CONTRACT, contract: contractHexClaim, calldata, from: connectedWallet, utxos, feeRate: 10, priorityFee: BigInt(0), gasSatFee: BigInt(20000), network, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: false };
    showStatus('Check OP_WALLET to sign...', 'info');
    if (typeof web3.signAndBroadcastInteraction === 'function') {
      await web3.signAndBroadcastInteraction(params);
    } else {
      const result = await web3.signInteraction(params);
      showStatus('Broadcasting...', 'info');
      if (result.fundingTransaction) await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [result.fundingTransaction, false] }) });
      await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [result.interactionTransaction, false] }) });
    }
    await fetch('/rst/confirm-claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, wallet: connectedWallet }) });
    document.getElementById('rstInfo').style.display = 'none';
    showStatus('SUCCESS! ' + (Number(amountWei) / 1e18).toFixed(6) + ' RST minted!', 'success');
  } catch(e) { showStatus('Failed: ' + (e.message || String(e)), 'error'); }
}

function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + type;
}
</script>
</body>
</html>`;
                return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
            }

            // RST: Live SSE stream — engine pushes mint signals to the browser tab
            if (url.pathname === '/rst/events') {
                const username = url.searchParams.get('username')?.toLowerCase() ?? '';
                if (!username) return new Response('Missing username', { status: 400 });
                const { sseClients } = await import('../engine/pill/PillMerchant.js');
                const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                        sseClients.set(username, controller);
                        controller.enqueue(new TextEncoder().encode(': connected\n\n'));
                        // Keepalive every 25s to prevent proxy timeouts
                        const ping = setInterval(() => {
                            try { controller.enqueue(new TextEncoder().encode(': ping\n\n')); }
                            catch { clearInterval(ping); sseClients.delete(username); }
                        }, 25000);
                    },
                    cancel() { sseClients.delete(username); }
                });
                return new Response(stream as any, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'Access-Control-Allow-Origin': '*',
                    }
                });
            }

            // RST: Leaderboard
            if (url.pathname === '/rst/leaderboard') {
                const { getLeaderboard } = await import('../engine/pill/PillMerchant.js');
                return new Response(JSON.stringify(getLeaderboard()), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            // RST: List online players (for wallet linking verification)
            if (url.pathname === '/rst/online-players') {
                const online = Array.from(World.players).map(p => p.username.toLowerCase());
                return new Response(JSON.stringify({ players: online }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            // RST: Verify a username is currently logged in
            if (url.pathname === '/rst/verify-player') {
                const username = url.searchParams.get('username')?.toLowerCase() ?? '';
                const isOnline = Array.from(World.players).some(p => p.username.toLowerCase() === username);
                return new Response(JSON.stringify({ online: isOnline, username }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            // RST: Allowance check — how much RST a player has earned and is allowed to mint
            if (url.pathname === '/rst/allowance') {
                const username = url.searchParams.get('username')?.toLowerCase() ?? '';
                const { pendingGP, walletRegistry } = await import('../engine/pill/PillMerchant.js');
                const allowanceGP = pendingGP.get(username) ?? 0;
                const wallet = walletRegistry.get(username) ?? null;
                return new Response(JSON.stringify({
                    username,
                    wallet,
                    allowanceGP,
                    allowanceRST: allowanceGP / 10000,
                }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }

            // RST: Balance check
            if (url.pathname === '/rst/balance') {
                const username = url.searchParams.get('username')?.toLowerCase() ?? '';
                const { pendingGP, totalGPConverted, walletRegistry } = await import('../engine/pill/PillMerchant.js');
                const pending = pendingGP.get(username) ?? 0;
                const totalGP = totalGPConverted.get(username) ?? 0;
                const wallet = walletRegistry.get(username) ?? null;
                return new Response(JSON.stringify({ username, pending, totalGP, rstPending: pending / 10000, wallet }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            // RST: Confirm claim — clear pending GP after successful mint
            if (url.pathname === '/rst/confirm-claim' && req.method === 'POST') {
                const body = await req.json() as any;
                const { username, wallet } = body;
                const { pendingGP, walletRegistry, savePending, saveWallets } = await import('../engine/pill/PillMerchant.js');
                const gpCleared = pendingGP.get(username?.toLowerCase()) ?? 0;
                pendingGP.delete(username?.toLowerCase());
                savePending();
                if (wallet) { walletRegistry.set(username?.toLowerCase(), wallet); saveWallets(); }
                console.log('[RST] Claimed: ' + username + ' cleared ' + gpCleared + ' GP');
                return new Response(JSON.stringify({ success: true, gpCleared }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            // RST: Register wallet address for a username
            if (url.pathname === '/rst/register-wallet') {
                if (req.method === 'OPTIONS') {
                    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
                }
                if (req.method === 'POST') {
                    try {
                        const body = await req.json() as any;
                        const { username, wallet, mldsaKey } = body;
                        if (!username || !wallet) {
                            return new Response(JSON.stringify({ error: 'Missing username or wallet' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                        }
                        const { walletRegistry, mldsaRegistry, pendingGP, saveWallets, saveMldsa } = await import('../engine/pill/PillMerchant.js');
                        walletRegistry.set(username.toLowerCase(), wallet);
                        saveWallets();
                        if (mldsaKey) {
                            mldsaRegistry.set(username.toLowerCase(), mldsaKey);
                            saveMldsa();
                            console.log('[RST] MLDSA key stored for ' + username + ': ' + String(mldsaKey).slice(0, 16) + '...');
                        }
                        const pending = pendingGP.get(username.toLowerCase()) ?? 0;
                        console.log('[RST] Wallet registered: ' + username + ' -> ' + wallet + (pending > 0 ? ' (' + pending + ' GP pending)' : ''));
                        return new Response(JSON.stringify({ success: true, username, wallet, pendingGP: pending, hasMldsa: !!mldsaKey }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                    } catch (e: any) {
                        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                    }
                }
            }

            // RST: Main game wrapper — game iframe + sidebar leaderboard + live mint prompt
            if (url.pathname === '/play' || url.pathname === '/play/') {
                const playHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Runescape Resource Terminal</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0e0e0e; font-family: 'Courier New', monospace; color: #c0a060; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
header { background: #1a1200; border-bottom: 2px solid #4a3800; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; height: 44px; }
.logo { color: #f0c030; font-size: 1em; font-weight: bold; letter-spacing: 2px; }
.wallet-status { font-size: 0.7em; color: #555; }
.wallet-status.connected { color: #44cc44; }
.main { display: flex; flex: 1; overflow: hidden; }
.game-wrap { flex: 1; display: flex; align-items: stretch; background: #000; overflow: hidden; }
iframe { border: none; width: 100%; height: 100%; }
.sidebar { width: 252px; flex-shrink: 0; background: #0e0e0e; border-left: 2px solid #2a2000; display: flex; flex-direction: column; overflow-y: auto; }
.s-section { padding: 10px 12px; border-bottom: 1px solid #1e1600; }
.s-section h3 { color: #f0c030; font-size: 0.65em; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
.stat-row { display: flex; justify-content: space-between; font-size: 0.75em; margin-bottom: 3px; color: #666; }
.stat-row span:last-child { color: #c0a060; }
.claim-btn { width: 100%; background: #f7931a; color: #000; border: none; padding: 7px; font-family: monospace; font-size: 0.75em; font-weight: bold; cursor: pointer; border-radius: 3px; margin-top: 8px; }
.claim-btn:disabled { background: #252000; color: #444; cursor: default; }
.claim-btn:not(:disabled):hover { background: #e07800; }
.lb-row { display: flex; align-items: center; font-size: 0.72em; padding: 3px 0; border-bottom: 1px solid #181200; }
.lb-row .rank { color: #444; width: 18px; flex-shrink: 0; font-size: 0.9em; }
.lb-row .lb-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #888; }
.lb-row .lb-gp { color: #f0c030; font-size: 0.9em; }
.lb-row:nth-child(1) .lb-name { color: #f0c030; }
.lb-row:nth-child(2) .lb-name { color: #c0c0c0; }
.lb-row:nth-child(3) .lb-name { color: #cd7f32; }
.connect-area { padding: 10px 12px; }
.connect-area p { font-size: 0.72em; color: #555; margin-bottom: 8px; line-height: 1.5; }
input.rs-input { background: #111; border: 1px solid #2a2000; color: #c0a060; padding: 6px 8px; width: 100%; font-family: monospace; font-size: 0.75em; border-radius: 3px; margin-bottom: 6px; }
button.conn-btn { width: 100%; background: #1a2200; border: 1px solid #44cc44; color: #44cc44; padding: 7px; font-family: monospace; font-size: 0.72em; cursor: pointer; border-radius: 3px; }
button.conn-btn:hover { background: #243300; }
.s-links { padding: 8px 12px; }
.s-links a { display: block; color: #444; font-size: 0.68em; padding: 2px 0; text-decoration: none; }
.s-links a:hover { color: #888; }
/* Mint modal */
.modal-bg { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.88); z-index: 100; align-items: center; justify-content: center; }
.modal-bg.show { display: flex; }
.modal-box { background: #0a1400; border: 2px solid #44cc44; padding: 28px; max-width: 380px; width: 90%; text-align: center; border-radius: 4px; }
.modal-box h2 { color: #44cc44; font-size: 1em; letter-spacing: 2px; margin-bottom: 4px; }
.modal-amt { font-size: 3.2em; color: #f0c030; margin: 12px 0 4px; }
.modal-unit { font-size: 0.35em; color: #888; }
.modal-sub { font-size: 0.72em; color: #666; margin-bottom: 18px; }
.sign-btn { background: #f7931a; color: #000; border: none; padding: 13px; font-family: monospace; font-size: 0.9em; font-weight: bold; cursor: pointer; border-radius: 4px; width: 100%; margin-bottom: 7px; }
.sign-btn:disabled { background: #2a2000; color: #555; }
.dismiss-btn { background: none; border: 1px solid #2a2000; color: #555; padding: 7px; font-family: monospace; font-size: 0.72em; cursor: pointer; border-radius: 3px; width: 100%; }
.modal-status { margin-top: 10px; font-size: 0.75em; min-height: 18px; }
.modal-status.success { color: #44cc44; }
.modal-status.error { color: #ff4444; }
.modal-status.info { color: #5555ff; }
</style>
</head>
<body>
<header>
  <span class="logo">&#x26CF; RUNESCAPE RESOURCE TERMINAL</span>
  <span id="walletStatus" class="wallet-status">No wallet connected — connect in the sidebar</span>
</header>
<div class="main">
  <div class="game-wrap">
    <iframe id="gameFrame" src="/rs2.cgi" allow="fullscreen" title="Runescape Resource Terminal"></iframe>
  </div>
  <div class="sidebar">
    <!-- Wallet connect -->
    <div class="connect-area" id="connectSection">
      <h3 style="color:#f0c030;font-size:0.65em;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Connect Wallet</h3>
      <p>Link your OP_WALLET to earn $RST tokens when you sell logs or ores to the General Store.</p>
      <input class="rs-input" id="usernameInput" placeholder="RS username">
      <button class="conn-btn" onclick="connectWallet()">&#x26BF; CONNECT OP_WALLET</button>
    </div>
    <!-- Stats (after connect) -->
    <div class="s-section" id="statsSection" style="display:none">
      <h3>Your Stats</h3>
      <div class="stat-row"><span>Username</span><span id="statUser">-</span></div>
      <div class="stat-row"><span>GP Converted</span><span id="statGP">0 GP</span></div>
      <div class="stat-row"><span>RST Pending</span><span id="statRST">0.0000</span></div>
      <div class="stat-row"><span>RST Balance</span><span id="statRSTBal">-</span></div>
      <div class="stat-row"><span>tBTC Balance</span><span id="statBTC">-</span></div>
      <button class="claim-btn" id="claimBtn" onclick="openClaimModal()" disabled>CLAIM RST</button>
      <button class="claim-btn" style="background:#1a1a1a;color:#666;border:1px solid #333;margin-top:4px;" onclick="disconnectWallet()">Disconnect</button>
    </div>
    <!-- Leaderboard -->
    <div class="s-section">
      <h3>Most GP Converted</h3>
      <div id="leaderboard"><div style="color:#333;font-size:0.72em;text-align:center;padding:8px;">Loading...</div></div>
    </div>
    <!-- Links -->
    <div class="s-links">
      <a href="/hiscores">&#x2197; Hiscores</a>
      <a href="/mapview">&#x2197; Map Viewer</a>
      <a href="/rst">&#x2197; Wallet Setup</a>
      <a href="/rst/claim">&#x2197; Claim RST</a>
    </div>
  </div>
</div>
<!-- Mint Modal -->
<div class="modal-bg" id="mintModal">
  <div class="modal-box">
    <h2>&#x26CF; RST MINT READY</h2>
    <div class="modal-amt"><span id="mintAmt">0</span><span class="modal-unit"> RST</span></div>
    <div class="modal-sub" id="mintSub">Sign to receive your tokens!</div>
    <button class="sign-btn" id="signBtn" onclick="executeMint()">SIGN &amp; MINT WITH OP_WALLET</button>
    <button class="dismiss-btn" onclick="dismissModal()">Claim later at /rst/claim</button>
    <div id="modalStatus" class="modal-status"></div>
  </div>
</div>
<script>
const RST_CONTRACT = 'opt1sqqsrj9ex92gwjwus3ufz60nclkdgzdtgnqkv9ya8';
let wallet = null;
let username = null;
let mintData = null;
let es = null;
let mldsaHash = null; // 32-byte SHA256 of MLDSA pubkey — the real OPNet recipient address
let lastMintTime = 0;   // timestamp of last successful mint (cooldown tracking)
let walletRefreshInterval = null;

async function sha256Hex(data) {
  // data = hex string or Uint8Array
  const bytes = typeof data === 'string' ? hexToBytes(data) : data;
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function bech32mAddrToHex(addr) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const lower = addr.toLowerCase();
  const sep = lower.lastIndexOf('1');
  if (sep < 1) return null;
  const values = [];
  for (const c of lower.slice(sep + 1)) {
    const v = CHARSET.indexOf(c);
    if (v === -1) return null;
    values.push(v);
  }
  const prog = values.slice(1, -6);
  let acc = 0, bits = 0;
  const bytes = [];
  for (const v of prog) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
  }
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) bytes[i/2] = parseInt(h.substr(i, 2), 16);
  return bytes;
}

window.addEventListener('load', () => {
  const saved = localStorage.getItem('rst_username');
  const savedHash = localStorage.getItem('rst_mldsa_hash');
  if (savedHash) mldsaHash = savedHash;
  if (saved) { document.getElementById('usernameInput').value = saved; tryReconnect(saved); }
  fetchLeaderboard();
  setInterval(fetchLeaderboard, 15000);
});

async function tryReconnect(u) {
  try {
    const p = window.opnet || window.unisat;
    if (!p) return;
    const accs = await p.getAccounts();
    if (accs && accs.length > 0) await setupSession(u, accs[0], false);
  } catch {}
}

async function connectWallet() {
  const u = document.getElementById('usernameInput').value.trim().toLowerCase();
  if (!u) { alert('Enter your RS username first.'); return; }
  try {
    const p = window.opnet || window.unisat;
    if (!p) { alert('OP_WALLET not found. Install it first.'); return; }
    const accs = await p.requestAccounts();
    let mldsaKey = null;
    if (typeof p.getMLDSAPublicKey === 'function') {
      try { mldsaKey = await p.getMLDSAPublicKey(); } catch(e) { console.warn('[RST] getMLDSAPublicKey failed:', e); }
    }
    const mldsaKeyHex = mldsaKey ? (typeof mldsaKey === 'string' ? mldsaKey : Array.from(mldsaKey).map(b => b.toString(16).padStart(2,'0')).join('')) : null;
    if (mldsaKeyHex) {
      mldsaHash = await sha256Hex(mldsaKeyHex);
      localStorage.setItem('rst_mldsa_hash', mldsaHash);
      console.log('[RST] MLDSA hash computed:', mldsaHash.slice(0,16) + '...');
    }
    await fetch('/rst/register-wallet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, wallet: accs[0], mldsaKey: mldsaKeyHex })
    });
    await setupSession(u, accs[0], true);
    localStorage.setItem('rst_username', u);
  } catch(e) { alert('Failed: ' + e.message); }
}

async function setupSession(u, w, showAlert) {
  username = u; wallet = w;
  document.getElementById('walletStatus').textContent = w.slice(0,12) + '...' + w.slice(-6);
  document.getElementById('walletStatus').className = 'wallet-status connected';
  document.getElementById('connectSection').style.display = 'none';
  document.getElementById('statsSection').style.display = 'block';
  document.getElementById('statUser').textContent = u;
  startSSE(u);
  refreshBalance();
  refreshWalletBalances();
  if (walletRefreshInterval) clearInterval(walletRefreshInterval);
  walletRefreshInterval = setInterval(() => { refreshBalance(); refreshWalletBalances(); }, 30000);
  if (showAlert) console.log('[RST] Session started for', u, w);
}

function startSSE(u) {
  if (es) es.close();
  es = new EventSource('/rst/events?username=' + encodeURIComponent(u));
  es.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'minted') {
        // Server auto-minted successfully — show success banner, no signing needed
        const rstDisplay = (d.rstAmount || 0).toFixed(4);
        showSuccessBanner('🎉 ' + rstDisplay + ' RST sent to your wallet! (~30s to confirm)');
        refreshBalance();
        setTimeout(() => refreshWalletBalances(), 35000);
      } else if (d.type === 'mint_ready') {
        // Fallback: no server key configured — show browser signing modal
        mintData = d;
        showMintModal(d);
      }
    } catch {}
  };
  es.onerror = () => setTimeout(() => startSSE(u), 5000);
}

async function refreshBalance() {
  if (!username) return;
  try {
    const r = await fetch('/rst/balance?username=' + encodeURIComponent(username));
    const d = await r.json();
    document.getElementById('statGP').textContent = (d.totalGP || 0).toLocaleString() + ' GP';
    document.getElementById('statRST').textContent = ((d.pending || 0) / 10000).toFixed(4) + ' RST';
    document.getElementById('claimBtn').disabled = false;
  } catch {}
}

async function opnetRpc(method, params) {
  const res = await fetch('https://testnet.opnet.org/api/v1/json-rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return (await res.json()).result;
}

async function fetchUTXOs(address) {
  try {
    const result = await opnetRpc('btc_getUTXOs', [address, true]);
    console.log('[RST] btc_getUTXOs raw result:', JSON.stringify(result));
    if (!result) { console.warn('[RST] btc_getUTXOs returned null/empty'); return []; }
    // btc_getUTXOs returns {confirmed: RawIUTXO[], pending: RawIUTXO[], raw: string[], spentTransactions: [...]}
    // Each RawIUTXO.raw is an index into result.raw[] which holds the base64-encoded tx hex
    const rawTxs = Array.isArray(result.raw) ? result.raw : [];
    const all = [...(result.confirmed || []), ...(result.pending || [])];
    console.log('[RST] UTXO count:', all.length, 'rawTxs count:', rawTxs.length);
    return all.map(u => {
      const rawTx = typeof u.raw === 'number' ? rawTxs[u.raw] : (typeof u.raw === 'string' ? u.raw : undefined);
      const sp = u.scriptPubKey;
      const scriptPubKey = typeof sp === 'string' ? { hex: sp, type: 'witness_v1_taproot' } : (sp || { hex: '', type: 'unknown' });
      const obj = {
        transactionId: u.transactionId,
        outputIndex: u.outputIndex,
        value: typeof u.value === 'bigint' ? u.value : BigInt(u.value || 0),
        scriptPubKey,
      };
      if (rawTx) {
        obj.nonWitnessUtxoBase64 = rawTx;
        try {
          const binary = atob(rawTx);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          obj.nonWitnessUtxo = bytes;
        } catch {}
      }
      return obj;
    });
  } catch(e) { console.error('[RST] fetchUTXOs error:', e); return []; }
}

async function refreshWalletBalances() {
  if (!wallet) return;
  // tBTC balance — sum UTXOs as fallback since btc_getBalance is unreliable on testnet
  try {
    const utxos = await fetchUTXOs(wallet);
    let btcSats = utxos.reduce((sum, u) => sum + u.value, 0n);
    document.getElementById('statBTC').textContent = (Number(btcSats) / 1e8).toFixed(6) + ' tBTC';
  } catch(e) { document.getElementById('statBTC').textContent = '?'; }
  // RST token balance via balanceOf(address) — must use MLDSA hash, not bech32m witness program
  try {
    let addrHex = mldsaHash;
    if (!addrHex) {
      // Hash not cached — fetch from wallet now and cache it
      const p = window.opnet || window.unisat;
      if (p && typeof p.getMLDSAPublicKey === 'function') {
        try {
          const key = await p.getMLDSAPublicKey();
          const keyHex = typeof key === 'string' ? key : Array.from(key).map(b => b.toString(16).padStart(2,'0')).join('');
          addrHex = await sha256Hex(keyHex);
          mldsaHash = addrHex;
          localStorage.setItem('rst_mldsa_hash', addrHex);
        } catch(e) { console.warn('[RST] Could not get MLDSA hash for balanceOf:', e); }
      }
    }
    if (addrHex) {
      const calldata = '5b46f8f6' + addrHex.padStart(64, '0');
      const result = await opnetRpc('btc_call', [RST_CONTRACT, calldata, null, null]);
      console.log('[RST] btc_call balanceOf:', JSON.stringify(result));
      let hexStr = '';
      const raw = typeof result === 'string' ? result : (result?.result ?? result?.data ?? result?.output ?? '');
      if (typeof raw === 'string' && raw.length > 0) {
        if (raw.startsWith('0x')) {
          hexStr = raw.slice(2);
        } else if (/^[0-9a-fA-F]+$/.test(raw)) {
          hexStr = raw; // already hex
        } else {
          // base64-encoded bytes (OPNet btc_call response format)
          try { const b = atob(raw); hexStr = Array.from(b).map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join(''); } catch {}
        }
      }
      if (hexStr.length >= 64) {
        const rstWei = BigInt('0x' + hexStr.slice(0, 64));
        document.getElementById('statRSTBal').textContent = (Number(rstWei) / 1e18).toFixed(4) + ' RST';
      } else {
        document.getElementById('statRSTBal').textContent = '0.0000 RST';
      }
    }
  } catch(e) { console.error('[RST] btc_call error:', e); document.getElementById('statRSTBal').textContent = '?'; }
}

const MINT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function mintCooldownRemaining() {
  if (!lastMintTime) return 0;
  return Math.max(0, MINT_COOLDOWN_MS - (Date.now() - lastMintTime));
}

function showMintModal(d) {
  document.getElementById('mintAmt').textContent = (d.rstAmount || 0).toFixed(4);
  document.getElementById('mintSub').textContent = 'Sold resources for ' + (d.gpAmount || 0).toLocaleString() + ' GP. Sign to mint!';
  const cooldown = mintCooldownRemaining();
  if (cooldown > 0) {
    const mins = Math.ceil(cooldown / 60000);
    document.getElementById('signBtn').disabled = true;
    document.getElementById('signBtn').textContent = 'WAIT ' + mins + 'm FOR PREVIOUS TX TO CONFIRM';
    setModalStatus('Previous mint is still confirming. Wait ~' + mins + ' more minute(s) before signing again to avoid UTXO conflicts.', 'info');
  } else {
    document.getElementById('signBtn').disabled = false;
    document.getElementById('signBtn').textContent = 'SIGN & MINT WITH OP_WALLET';
    document.getElementById('modalStatus').textContent = '';
    document.getElementById('modalStatus').className = 'modal-status';
  }
  document.getElementById('mintModal').classList.add('show');
}

async function openClaimModal() {
  if (!username || !wallet) { alert('Connect your wallet first.'); return; }
  try {
    const r = await fetch('/rst/balance?username=' + encodeURIComponent(username));
    const d = await r.json();
    const gp = d.pending || 0;
    if (gp < 10) { alert('No RST pending yet. Sell resources to the RST merchant first!'); return; }
    mintData = { rstAmount: gp / 10000, gpAmount: gp, rstWei: (BigInt(gp) * (10n ** 18n) / 10000n).toString(), wallet };
    showMintModal(mintData);
  } catch(e) { alert('Error: ' + e.message); }
}

function dismissModal() { document.getElementById('mintModal').classList.remove('show'); }

function disconnectWallet() {
  if (es) { es.close(); es = null; }
  if (walletRefreshInterval) { clearInterval(walletRefreshInterval); walletRefreshInterval = null; }
  username = null; wallet = null; mintData = null; mldsaHash = null;
  localStorage.removeItem('rst_username');
  document.getElementById('walletStatus').textContent = 'No wallet connected — connect in the sidebar';
  document.getElementById('walletStatus').className = 'wallet-status';
  document.getElementById('statsSection').style.display = 'none';
  document.getElementById('connectSection').style.display = 'block';
  document.getElementById('usernameInput').value = '';
  dismissModal();
}

async function broadcastOpnet(txHex) {
  const res = await fetch('https://testnet.opnet.org/api/v1/json-rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [txHex, false] })
  });
  return await res.json();
}

async function executeMint() {
  if (!mintData) return;
  const d = mintData;
  document.getElementById('signBtn').disabled = true;
  document.getElementById('signBtn').textContent = 'SIGNING...';
  setModalStatus('Check OP_WALLET to sign...', 'info');
  try {
    const web3 = window.opnet?.web3;
    if (!web3) {
      setModalStatus('OP_WALLET not found! Make sure the extension is installed.', 'error');
      document.getElementById('signBtn').disabled = false;
      document.getElementById('signBtn').textContent = 'SIGN & MINT WITH OP_WALLET';
      return;
    }
    // Use MLDSA hash as recipient — this is what OPNet uses as the actual address, not the bech32m witness program
    let recipientHash = mldsaHash;
    if (!recipientHash) {
      // Not cached — re-fetch from wallet
      const p = window.opnet || window.unisat;
      if (p && typeof p.getMLDSAPublicKey === 'function') {
        try {
          const key = await p.getMLDSAPublicKey();
          const keyHex = typeof key === 'string' ? key : Array.from(key).map(b => b.toString(16).padStart(2,'0')).join('');
          recipientHash = await sha256Hex(keyHex);
          mldsaHash = recipientHash;
          localStorage.setItem('rst_mldsa_hash', recipientHash);
        } catch(e) { console.warn('[RST] Could not get MLDSA key at mint time:', e); }
      }
    }
    if (!recipientHash) { setModalStatus('Could not resolve recipient address. Reconnect wallet.', 'error'); document.getElementById('signBtn').disabled = false; document.getElementById('signBtn').textContent = 'SIGN & MINT WITH OP_WALLET'; return; }
    const rstWei = BigInt(d.rstWei || '0');
    const addrPadded = recipientHash.padStart(64, '0');
    const amtHex = rstWei.toString(16).padStart(64, '0');
    const calldata = hexToBytes('3950e061' + addrPadded + amtHex);
    console.log('[RST] calldata built, fetching UTXOs...');
    setModalStatus('Preparing transaction...', 'info');
    const utxos = await fetchUTXOs(wallet);
    console.log('[RST] UTXOs:', utxos.length);
    const network = { messagePrefix: '\\x18Bitcoin Signed Message:\\n', bech32: 'opt', bech32Opnet: 'opt', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
    // RST contract secret = tweakedPubkey from getPublicKeyInfo (32 bytes)
    // bech32mAddrToHex gives only 21 bytes (P2OP witness program) — use the resolved tweakedPubkey instead
    const contractHex = '0xfdcb53e48b0330e2714efa4c5de48f29893d89023ee661d94a15b2948138a77f';
    const params = { to: RST_CONTRACT, contract: contractHex, calldata, from: wallet, utxos, feeRate: 10, priorityFee: BigInt(0), gasSatFee: BigInt(20000), network, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: false };
    setModalStatus('Waiting for OP_WALLET signature...', 'info');
    if (typeof web3.signAndBroadcastInteraction === 'function') {
      const res = await web3.signAndBroadcastInteraction(params);
      console.log('[RST] signAndBroadcastInteraction result:', res);
    } else {
      const signed = await web3.signInteraction(params);
      console.log('[RST] signInteraction result:', signed);
      if (signed.fundingTransaction) await broadcastOpnet(signed.fundingTransaction);
      await broadcastOpnet(signed.interactionTransaction);
    }
    await fetch('/rst/confirm-claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, wallet, gpAmount: d.gpAmount })
    });
    lastMintTime = Date.now();
    setModalStatus('SUCCESS! ' + (d.rstAmount || 0).toFixed(4) + ' RST minted!', 'success');
    mintData = null;
    document.getElementById('signBtn').textContent = 'MINTED!';
    setTimeout(() => { dismissModal(); refreshBalance(); refreshWalletBalances(); fetchLeaderboard(); }, 3000);
  } catch(e) {
    console.error('[RST] executeMint error:', e);
    setModalStatus('Failed: ' + (e.message || String(e)), 'error');
    document.getElementById('signBtn').disabled = false;
    document.getElementById('signBtn').textContent = 'SIGN & MINT WITH OP_WALLET';
  }
}

function setModalStatus(msg, type) {
  const el = document.getElementById('modalStatus');
  el.textContent = msg;
  el.className = 'modal-status ' + type;
}

function showSuccessBanner(msg) {
  // Re-use the modal as a success notification (auto-dismiss)
  document.getElementById('mintAmt').textContent = '';
  document.getElementById('mintSub').textContent = msg;
  document.getElementById('signBtn').style.display = 'none';
  document.getElementById('mintModal').classList.add('show');
  setModalStatus('', '');
  setTimeout(() => {
    dismissModal();
    document.getElementById('signBtn').style.display = '';
  }, 5000);
}

async function fetchLeaderboard() {
  try {
    const r = await fetch('/rst/leaderboard');
    const rows = await r.json();
    const lb = document.getElementById('leaderboard');
    if (!rows.length) { lb.innerHTML = '<div style="color:#333;font-size:0.72em;text-align:center;padding:8px;">No data yet</div>'; return; }
    lb.innerHTML = rows.map((r, i) =>
      '<div class="lb-row"><span class="rank">' + (i+1) + '.</span><span class="lb-name">' + r.username + '</span><span class="lb-gp">' + r.gp.toLocaleString() + '</span></div>'
    ).join('');
    if (username) {
      const me = rows.find(r => r.username === username);
      if (me) {
        document.getElementById('statGP').textContent = me.gp.toLocaleString() + ' GP';
      }
    }
  } catch {}
}
</script>
</body>
</html>`;
                return new Response(playHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            // RST: Wallet connect page — redirect to /play (which handles everything)
            if (url.pathname === '/rst' || url.pathname === '/rst/') {
                return new Response(null, { status: 302, headers: { 'Location': '/play' } });
            }

            // Engine status endpoint
            if (url.pathname === '/engine-status' || url.pathname === '/engine-status/') {
                return new Response(JSON.stringify({
                    status: 'running',
                    server: 'rs-agent-engine',
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    version: '1.0.0'
                }, null, 2), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }

            // Player count endpoint
            if (url.pathname === '/playercount' || url.pathname === '/playercount/') {
                return new Response(JSON.stringify({
                    count: World.getTotalPlayers()
                }), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }

            // Player positions endpoint
            if (url.pathname === '/playerpositions' || url.pathname === '/playerpositions/') {
                const players: {x: number, z: number, level: number, name: string}[] = [];
                for (const player of World.players) {
                    players.push({ x: player.x, z: player.z, level: player.level, name: player.displayName });
                }
                return new Response(JSON.stringify(players), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }

            // Gateway status endpoint (proxy all bot statuses)
            if (url.pathname === '/status' || url.pathname === '/status/') {
                try {
                    const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:7780';
                    const response = await fetch(`${gatewayUrl}/status`);
                    const data = await response.json();
                    return new Response(JSON.stringify(data, null, 2), {
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                } catch (error) {
                    return new Response(JSON.stringify({
                        error: 'Failed to fetch gateway status',
                        message: error instanceof Error ? error.message : 'Unknown error'
                    }, null, 2), {
                        status: 503,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                }
            }

            // Bot status endpoint (proxy to gateway)
            const botStatusMatch = url.pathname.match(/^\/status\/([^/]+)\/?$/);
            if (botStatusMatch) {
                const username = botStatusMatch[1];
                try {
                    const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:7780';
                    const response = await fetch(`${gatewayUrl}/status/${username}`);
                    const data = await response.json();
                    return new Response(JSON.stringify(data, null, 2), {
                        status: response.status,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                } catch (error) {
                    return new Response(JSON.stringify({
                        error: 'Failed to fetch bot status from gateway',
                        message: error instanceof Error ? error.message : 'Unknown error'
                    }, null, 2), {
                        status: 503,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                }
            }

            // Client pages (/, /bot, /rs2.cgi)
            const clientResponse = await handleClientPage(url);
            if (clientResponse) return clientResponse;

            // Cache endpoints
            const cacheResponse = handleCacheEndpoints(url);
            if (cacheResponse) return cacheResponse;

            // Disclaimer page
            const disclaimerResponse = handleDisclaimerPage(url);
            if (disclaimerResponse) return disclaimerResponse;

            // Map viewer page
            const mapviewResponse = handleMapviewPage(url);
            if (mapviewResponse) return mapviewResponse;

            // API endpoints
            const screenshotUploadResponse = await handleScreenshotUpload(req, url);
            if (screenshotUploadResponse) return screenshotUploadResponse;

            const exportCollisionResponse = handleExportCollisionApi(url);
            if (exportCollisionResponse) return exportCollisionResponse;

            // Hiscores
            const hiscoresResponse = await handleHiscoresPage(url);
            if (hiscoresResponse) return hiscoresResponse;

            const hiscoresPlayerResponse = await handleHiscoresPlayerPage(url);
            if (hiscoresPlayerResponse) return hiscoresPlayerResponse;

            const hiscoresOutfitResponse = await handleHiscoresOutfitPage(url);
            if (hiscoresOutfitResponse) return hiscoresOutfitResponse;

            // Viewer assets (cache data, JS, WASM for item icon rendering)
            const viewerResponse = handleViewerAssets(url);
            if (viewerResponse) return viewerResponse;

            // Screenshots
            const screenshotsListResponse = handleScreenshotsListPage(url);
            if (screenshotsListResponse) return screenshotsListResponse;

            const screenshotFileResponse = handleScreenshotFilePage(url);
            if (screenshotFileResponse) return screenshotFileResponse;

            // Public static files
            const publicFilesResponse = handlePublicFiles(url);
            if (publicFilesResponse) return publicFilesResponse;

            // 404
            return new Response(null, { status: 404 });
        },
        websocket: websocketHandlers
    });
}

export async function startManagementWeb() {
    Bun.serve({
        port: Environment.WEB_MANAGEMENT_PORT,
        routes: {
            '/prometheus': new Response(await register.metrics(), {
                headers: {
                    'Content-Type': register.contentType
                }
            })
        },
        fetch() {
            return new Response(null, { status: 404 });
        },
    });
}
