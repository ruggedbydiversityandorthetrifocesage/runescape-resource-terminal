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
const RST_CONTRACT = 'opt1sqq0uxr9f5e9qdswpaptpvgc8qr9thv2a4gwaj6fl';
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

function sha256PureJSClaim(data){const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];const msg=data instanceof Uint8Array?data:new Uint8Array(data);const len=msg.length,bitLen=len*8;const padLen=len%64<56?56-(len%64):120-(len%64);const padded=new Uint8Array(len+padLen+8);padded.set(msg);padded[len]=0x80;const dv=new DataView(padded.buffer);dv.setUint32(padded.length-4,bitLen>>>0,false);dv.setUint32(padded.length-8,Math.floor(bitLen/0x100000000),false);const h=H.slice();const rotr=(x,n)=>(x>>>n)|(x<<(32-n));for(let i=0;i<padded.length;i+=64){const w=new Array(64);for(let j=0;j<16;j++)w[j]=dv.getUint32(i+j*4,false);for(let j=16;j<64;j++){const s0=rotr(w[j-15],7)^rotr(w[j-15],18)^(w[j-15]>>>3);const s1=rotr(w[j-2],17)^rotr(w[j-2],19)^(w[j-2]>>>10);w[j]=(w[j-16]+s0+w[j-7]+s1)>>>0;}let[a,b,c,d,e,f,g,hh]=h;for(let j=0;j<64;j++){const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);const ch=(e&f)^(~e&g);const t1=(hh+S1+ch+K[j]+w[j])>>>0;const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);const maj=(a&b)^(a&c)^(b&c);const t2=(S0+maj)>>>0;hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+hh)>>>0;}return h.map(v=>v.toString(16).padStart(8,'0')).join('');}
async function sha256HexClaim(data){const bytes=typeof data==='string'?hexToBytes(data):data;if(typeof crypto!=='undefined'&&crypto.subtle){const buf=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}return sha256PureJSClaim(bytes);}
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
        recipientHashClaim = await sha256HexClaim(keyHex);
      } catch(e) { console.warn('[RST] getMLDSAPublicKey failed on claim page:', e); }
    }
    if (!recipientHashClaim) { showStatus('Could not resolve recipient address. Make sure OP_WALLET is connected.', 'error'); return; }
    const amountWei = BigInt(gpAmount) * (10n ** 18n) / 1000n;
    const amtHex = amountWei.toString(16).padStart(64, '0');
    const calldata = hexToBytes('16b06937' + amtHex);
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
    const contractHexClaim = '0x8ea522eb4c95f38e9f4f9a9c4b6f4f1d9e4f7b8d2b10902dbd302779105afaf1';
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
    showStatus('SUCCESS! ' + (Number(amountWei) / 1e18).toFixed(6) + ' RST claimed!', 'success');
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
                    allowanceRST: allowanceGP / 1000,
                }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }

            // RST: Balance check
            if (url.pathname === '/rst/debug/tier') {
                const username = url.searchParams.get('username')?.toLowerCase() ?? '';
                const { rstBalanceCache, getPlayerRSTTier, mldsaRegistry } = await import('../engine/pill/PillMerchant.js');
                const bal = rstBalanceCache.get(username) ?? -1;
                const tier = getPlayerRSTTier(username);
                const hasMldsa = mldsaRegistry.has(username);
                return new Response(JSON.stringify({ username, cachedBalance: bal, tier, hasMldsa }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            if (url.pathname === '/rst/balance') {
                const username = url.searchParams.get('username')?.toLowerCase() ?? '';
                const { pendingGP, grantedGP, totalGPConverted, walletRegistry } = await import('../engine/pill/PillMerchant.js');
                const pending = pendingGP.get(username) ?? 0;
                const granted = grantedGP.get(username) ?? 0;
                const totalGP = totalGPConverted.get(username) ?? 0;
                const wallet = walletRegistry.get(username) ?? null;
                return new Response(JSON.stringify({ username, pending, granted, totalGP, rstPending: pending / 1000, rstGranted: granted / 1000, wallet }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            // RST: Server address — returns server's MLDSA hash for setMinter admin call
            if (url.pathname === '/rst/server-address' && req.method === 'GET') {
                const { getServerMldsaHash } = await import('../engine/pill/RSTMinter.js');
                const hash = getServerMldsaHash();
                return new Response(JSON.stringify({ mldsaHash: hash }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            // RST: Confirm claim — clear pending GP after successful mint
            if (url.pathname === '/rst/confirm-claim' && req.method === 'POST') {
                const body = await req.json() as any;
                const { username, wallet } = body;
                const { pendingGP, grantedGP, walletRegistry, saveWallets, saveGranted } = await import('../engine/pill/PillMerchant.js');
                // Only save the wallet address here. Pending GP is cleared server-side in
                // PillMerchant.ts only when grantClaim actually succeeds — never here.
                if (wallet) { walletRegistry.set(username?.toLowerCase(), wallet); saveWallets(); }
                // Clear grantedGP since player has successfully claimed their on-chain RST
                const gpGranted = grantedGP.get(username?.toLowerCase()) ?? 0;
                if (gpGranted > 0) { grantedGP.delete(username?.toLowerCase()); saveGranted(); }
                const gpPending = pendingGP.get(username?.toLowerCase()) ?? 0;
                console.log('[RST] confirm-claim: ' + username + ' wallet saved, granted GP cleared: ' + gpGranted + ', pending GP = ' + gpPending);
                return new Response(JSON.stringify({ success: true, gpCleared: gpGranted }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            // RST Shop: Confirm purchase — validate nonce, deduct RST, give item in-game
            if (url.pathname === '/shop/confirm-purchase' && req.method === 'POST') {
                try {
                    const body = await req.json() as any;
                    const { username, nonce } = body;
                    if (!username || !nonce) {
                        return new Response(JSON.stringify({ success: false, message: 'Missing username or nonce.' }), {
                            status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                        });
                    }
                    // Player must be online — item can only be delivered to a live session
                    const player = Array.from(World.players).find(p => p.username === username.toLowerCase());
                    if (!player) {
                        return new Response(JSON.stringify({ success: false, message: 'You must be logged in-game to receive your item. Log in first, then confirm here.' }), {
                            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                        });
                    }
                    const { confirmRSTShopPurchase } = await import('../engine/pill/RSTShop.js');
                    const result = confirmRSTShopPurchase(username.toLowerCase(), nonce, World.currentTick);
                    if (result.success && result.itemId != null) {
                        const InvTypeMod = (await import('#/cache/config/InvType.js')).default;
                        player.invAdd(InvTypeMod.INV, result.itemId, 1, false);
                        player.messageGame(result.message!);
                        console.log('[RST Shop] ' + username + ' received ' + result.itemName + ' for ' + result.itemId);
                    }
                    return new Response(JSON.stringify(result), {
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                    });
                } catch (e: any) {
                    return new Response(JSON.stringify({ success: false, message: e.message }), {
                        status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                    });
                }
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
/* How to play modal */
.htp-modal-bg { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 200; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 24px 12px; }
.htp-modal-bg.show { display: flex; }
.htp-box { background: #0a0a0a; border: 2px solid #f0c030; padding: 28px 32px; max-width: 560px; width: 100%; border-radius: 4px; position: relative; }
.htp-box h1 { color: #f0c030; font-size: 1em; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 4px; }
.htp-box .htp-sub { color: #555; font-size: 0.72em; margin-bottom: 20px; border-bottom: 1px solid #1e1600; padding-bottom: 12px; }
.htp-section { margin-bottom: 16px; }
.htp-section h3 { color: #f0c030; font-size: 0.72em; letter-spacing: 1px; margin-bottom: 6px; }
.htp-section p, .htp-section li { color: #c0a060; font-size: 0.75em; line-height: 1.7; }
.htp-section ul { padding-left: 14px; }
.htp-section .htp-addr { color: #44cc44; font-size: 0.68em; word-break: break-all; background: #0d1a0d; padding: 6px 8px; border-radius: 3px; display: block; margin-top: 4px; border: 1px solid #1a3a1a; }
.htp-section .htp-step { display: flex; gap: 10px; margin-bottom: 8px; }
.htp-section .htp-num { color: #f7931a; font-weight: bold; flex-shrink: 0; font-size: 0.75em; }
.htp-section .htp-desc { color: #c0a060; font-size: 0.75em; line-height: 1.6; }
.htp-rates { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 8px; }
.htp-rate { background: #111; border: 1px solid #2a2000; border-radius: 3px; padding: 8px; text-align: center; }
.htp-rate .r-gp { color: #888; font-size: 0.68em; }
.htp-rate .r-rst { color: #f0c030; font-size: 0.82em; font-weight: bold; }
.htp-close { position: absolute; top: 14px; right: 16px; background: none; border: 1px solid #2a2000; color: #555; padding: 4px 10px; font-family: monospace; font-size: 0.72em; cursor: pointer; border-radius: 3px; }
.htp-close:hover { color: #888; border-color: #555; }
.htp-btn { width: 100%; background: #1a1200; border: 1px solid #f0c030; color: #f0c030; padding: 7px; font-family: monospace; font-size: 0.72em; cursor: pointer; border-radius: 3px; margin-bottom: 6px; text-align: center; }
.htp-btn:hover { background: #2a2000; }
/* RST Shop purchase confirmation modal */
.shop-modal-box { border-color: #f7931a !important; }
.shop-modal-box h2 { color: #f7931a !important; }
.shop-item-name { font-size: 1.6em; color: #f0c030; margin: 10px 0 4px; font-weight: bold; }
.shop-cost-label { font-size: 0.75em; color: #888; margin-bottom: 18px; }
.shop-confirm-btn { background: #f7931a; color: #000; border: none; padding: 13px; font-family: monospace; font-size: 0.9em; font-weight: bold; cursor: pointer; border-radius: 4px; width: 100%; margin-bottom: 7px; }
.shop-confirm-btn:disabled { background: #2a1a00; color: #555; cursor: default; }
/* Admin panel — deployer-only, never rendered for other wallets */
.admin-section { border-color: #cc0000 !important; }
.admin-section h3 { color: #ff4444 !important; }
.admin-btn { width: 100%; background: #cc0000; color: #fff; border: none; padding: 7px; font-family: monospace; font-size: 0.75em; font-weight: bold; cursor: pointer; border-radius: 3px; margin-top: 8px; }
.admin-btn:hover { background: #aa0000; }
.admin-btn:disabled { background: #330000; color: #666; cursor: default; }
</style>
</head>
<body>
<header>
  <span class="logo">&#x26CF; RUNESCAPE RESOURCE TERMINAL</span>
  <div style="display:flex;align-items:center;gap:12px;">
    <button onclick="document.getElementById('htpModal').classList.add('show')" style="background:#1a1200;border:1px solid #f0c030;color:#f0c030;padding:5px 12px;font-family:monospace;font-size:0.72em;cursor:pointer;border-radius:3px;font-weight:bold;">&#x2753; HOW TO PLAY</button>
    <span id="walletStatus" class="wallet-status">No wallet connected — connect in the sidebar</span>
  </div>
</header>
<div class="main">
  <div class="game-wrap">
    <iframe id="gameFrame" src="/rs2.cgi" allow="fullscreen" title="Runescape Resource Terminal"></iframe>
  </div>
  <div class="sidebar">
    <!-- Wallet connect -->
    <div class="connect-area" id="connectSection">
      <h3 style="color:#f0c030;font-size:0.65em;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Connect Wallet</h3>
      <p style="font-size:0.72em;color:#888;line-height:1.5;margin-bottom:8px;">Enter your username here <strong style="color:#c0a060">first</strong>, then connect. After connecting, enter the same username in the game — your first password becomes permanent.</p>
      <input class="rs-input" id="usernameInput" placeholder="Enter username first">
      <button class="conn-btn" onclick="connectWallet()">&#x26BF; CONNECT OP_WALLET</button>
    </div>
    <!-- Stats (after connect) -->
    <div class="s-section" id="statsSection" style="display:none">
      <h3>Your Stats</h3>
      <div class="stat-row"><span>Username</span><span id="statUser">-</span></div>
      <div class="stat-row"><span>GP Converted</span><span id="statGP">0 GP</span></div>
      <div class="stat-row"><span>RST Pending</span><span id="statRST">0.0000 RST</span></div>
      <div class="stat-row"><span>RST Mempool</span><span id="statRSTMempool">0.0000 RST</span></div>
      <div class="stat-row"><span>RST Balance</span><span id="statRSTBal">-</span></div>
      <div class="stat-row"><span>tBTC Balance</span><span id="statBTC">-</span></div>
      <div class="stat-row" style="margin-top:6px;border-top:1px solid #2a2000;padding-top:6px">
        <span>Difficulty</span>
        <span id="statDifficulty" style="font-weight:bold;color:#ff4444">EXTREMELY HARDCORE</span>
      </div>
      <div id="statDifficultyHint" style="font-size:0.68em;color:#666;margin-bottom:4px;text-align:right">Earn 10 RST to reduce</div>
      <button class="claim-btn" id="claimBtn" onclick="openClaimModal()" disabled>CLAIM RST</button>
      <button class="claim-btn" style="background:#1a1a1a;color:#666;border:1px solid #333;margin-top:4px;" onclick="disconnectWallet()">Disconnect</button>
    </div>
    <!-- Leaderboard -->
    <div class="s-section">
      <h3>Most GP Converted</h3>
      <div id="leaderboard"><div style="color:#333;font-size:0.72em;text-align:center;padding:8px;">Loading...</div></div>
    </div>
    <!-- How to Play button -->
    <div style="padding: 10px 12px; border-bottom: 1px solid #1e1600;">
      <button class="htp-btn" onclick="document.getElementById('htpModal').classList.add('show')">&#x2753; HOW TO PLAY</button>
      <button class="htp-btn" onclick="document.getElementById('dsModal').classList.add('show')">&#x1F30D; DIFFICULTY SYSTEM</button>
    </div>
  </div>
</div>
<!-- How To Play Modal -->
<div class="htp-modal-bg" id="htpModal">
  <div class="htp-box">
    <button class="htp-close" onclick="document.getElementById('htpModal').classList.remove('show')">&#x2715; CLOSE</button>
    <h1>&#x26CF; RST &mdash; Runescape Resource Terminal</h1>
    <div class="htp-sub">How to Play</div>
    <div class="htp-section">
      <h3>BEFORE YOU START &mdash; Requirements</h3>
      <ul>
        <li>OP_WALLET browser extension installed</li>
        <li>Testnet BTC (tBTC) in your wallet &mdash; get it free at <strong style="color:#44cc44">faucet.opnet.org</strong></li>
      </ul>
    </div>
    <div class="htp-section">
      <h3>IMPORT THE RST TOKEN INTO OP_WALLET</h3>
      <p>Open OP_WALLET &rarr; Tokens &rarr; Import Token &rarr; paste this address:</p>
      <span class="htp-addr">0x8ea522eb4c95f38e9f4f9a9c4b6f4f1d9e4f7b8d2b10902dbd302779105afaf1</span>
    </div>
    <div class="htp-section">
      <h3>STEPS</h3>
      <div class="htp-step"><span class="htp-num">1.</span><span class="htp-desc"><strong style="color:#f0c030">Go to the game</strong> &mdash; You&apos;re already here!</span></div>
      <div class="htp-step"><span class="htp-num">2.</span><span class="htp-desc"><strong style="color:#f0c030">Enter a username &amp; connect</strong> &mdash; On the right sidebar, type your desired username into the box, then click CONNECT OP_WALLET. It will silently sync your wallet to that username &mdash; no popup needed.</span></div>
      <div class="htp-step"><span class="htp-num">3.</span><span class="htp-desc"><strong style="color:#f0c030">Create your in-game account</strong> &mdash; In the game client, enter that same username and choose a password. That password is permanent &mdash; it locks your account forever.</span></div>
      <div class="htp-step"><span class="htp-num" style="color:#888">&#x2139;</span><span class="htp-desc" style="color:#666">Forgot your password or username? You can always create a new account with the same wallet address.</span></div>
      <div class="htp-step"><span class="htp-num">4.</span><span class="htp-desc"><strong style="color:#f0c030">Chop some trees</strong> &mdash; Walk to the trees near spawn and click one. Chop until you have 2&ndash;3 logs.</span></div>
      <div class="htp-step"><span class="htp-num">5.</span><span class="htp-desc"><strong style="color:#f0c030">Sell at the General Store</strong> &mdash; Walk to the nearby General Store NPC and click them. Your logs convert to GP automatically.</span></div>
      <div class="htp-step"><span class="htp-num">6.</span><span class="htp-desc"><strong style="color:#f0c030">Sign &amp; Mint RST</strong> &mdash; A mint button appears in the sidebar. Click SIGN &amp; CLAIM WITH OP_WALLET, approve in OP_WALLET. RST lands in your wallet on Bitcoin L1.</span></div>
    </div>
    <div class="htp-section">
      <h3>CONVERSION RATES</h3>
      <div class="htp-rates">
        <div class="htp-rate"><div class="r-gp">100 GP</div><div class="r-rst">0.01 RST</div></div>
        <div class="htp-rate"><div class="r-gp">1,000 GP</div><div class="r-rst">0.1 RST</div></div>
        <div class="htp-rate"><div class="r-gp">10,000 GP</div><div class="r-rst">1 RST</div></div>
      </div>
    </div>
    <p style="color:#555;font-size:0.68em;margin-top:16px;text-align:center;">The more you play, the more you mint. Keep chopping. &#x1F333;&#x26CF;&#xFE0F;</p>
  </div>
</div>
<!-- Difficulty System Modal -->
<div class="htp-modal-bg" id="dsModal">
  <div class="htp-box">
    <button class="htp-close" onclick="document.getElementById('dsModal').classList.remove('show')">&#x2715; CLOSE</button>
    <h1>&#x1F30D; DIFFICULTY SYSTEM</h1>
    <div class="htp-sub">Unlock more of the world by earning RST</div>
    <div class="htp-section">
      <h3 style="color:#44cc44;">&#x1F7E2; PHASE 1 &mdash; KINGDOM OF MISTHALIN &mdash; 0 RST</h3>
      <p>Everyone starts here. No RST required.</p>
      <ul style="margin-top:6px;">
        <li>Lumbridge</li>
        <li>Draynor Village &amp; Draynor Manor</li>
        <li>Varrock &amp; Palace &amp; Lumber Yard</li>
        <li>Edgeville &amp; Cooks&apos; Guild</li>
        <li>Barbarian Village</li>
      </ul>
    </div>
    <div class="htp-section">
      <h3 style="color:#f7931a;">&#x1F7E0; PHASE 2 &mdash; KINGDOM OF ASGARNIA &mdash; 10 RST</h3>
      <p>Earn 10 RST to unlock the western kingdom.</p>
      <ul style="margin-top:6px;">
        <li>Everything in Phase 1</li>
        <li>Falador &amp; White Knights&apos; Castle</li>
        <li>Port Sarim &amp; Rimmington</li>
        <li>Taverly &amp; Burthorpe &amp; Hero&apos;s Guild</li>
        <li>Ice Mountain &amp; Dwarven Mine &amp; Monastery</li>
        <li>Goblin Village &amp; Black Knights&apos; Castle</li>
        <li>Wizards&apos; Tower &amp; Lumbridge Swamp</li>
        <li>Al Kharid &amp; Duel Arena &amp; Dig Site</li>
      </ul>
    </div>
    <div class="htp-section">
      <h3 style="color:#ff4444;">&#x1F534; PHASE 3 &mdash; FULL WORLD &mdash; 1,000 RST</h3>
      <p>The ultimate challenge. Unlock all of Gielinor.</p>
      <ul style="margin-top:6px;">
        <li>Everything in Phase 1 &amp; 2</li>
        <li>Kandarin (Seers&apos; Village, Catherby, Ardougne)</li>
        <li>Morytania (Canifis, Barrows)</li>
        <li>Karamja (Brimhaven, TzHaar)</li>
        <li>Desert &amp; Feldip Hills &amp; Tirannwn, and more</li>
      </ul>
    </div>
    <div class="htp-section" style="border-top:1px solid #2a2000;padding-top:14px;">
      <h3>HOW TO EARN RST</h3>
      <p>Chop logs &rarr; sell at General Store &rarr; GP converts to RST automatically. 1,000 GP = 1 RST.</p>
    </div>
    <p style="color:#555;font-size:0.68em;margin-top:16px;text-align:center;">The further you go, the harder it gets. Can you unlock the full world? &#x1F30D;</p>
  </div>
</div>
<!-- RST Shop Purchase Modal -->
<div class="modal-bg" id="shopModal">
  <div class="modal-box shop-modal-box">
    <h2>&#x1F6D2; RST SHOP PURCHASE</h2>
    <div class="shop-item-name" id="shopItemName">-</div>
    <div class="shop-cost-label" id="shopCostLabel">X RST will be burned from your balance</div>
    <button class="shop-confirm-btn" id="shopConfirmBtn" onclick="executeShopConfirm()">CONFIRM &amp; RECEIVE ITEM</button>
    <button class="dismiss-btn" onclick="dismissShopModal()">Cancel</button>
    <div id="shopModalStatus" class="modal-status"></div>
  </div>
</div>
<!-- Mint Modal -->
<div class="modal-bg" id="mintModal">
  <div class="modal-box">
    <h2 id="mintModalTitle">&#x26CF; RST CLAIM READY</h2>
    <div class="modal-amt"><span id="mintAmt">0</span><span class="modal-unit"> RST</span></div>
    <div class="modal-sub" id="mintSub">Sign to receive your tokens!</div>
    <button class="sign-btn" id="signBtn" onclick="executeMint()">SIGN &amp; CLAIM WITH OP_WALLET</button>
    <button class="dismiss-btn" onclick="dismissModal()">Dismiss</button>
    <div id="modalStatus" class="modal-status"></div>
    <div id="modalTimingNote" style="display:none;margin-top:10px;padding:8px;background:#0a1a0a;border:1px solid #1a4a1a;border-radius:4px;font-size:0.72em;color:#5a9a5a;line-height:1.5;">
      &#x231B; On-chain grants take <strong>1&ndash;3 min</strong> to confirm on testnet &mdash; this is normal. The Sign button unlocks automatically.
    </div>
  </div>
</div>
<script>
const RST_CONTRACT = 'opt1sqq0uxr9f5e9qdswpaptpvgc8qr9thv2a4gwaj6fl';
// RST v8 — hardcoded server MLDSA hash as minter in onDeployment
const RST_V2_CONTRACT = 'opt1sqq0uxr9f5e9qdswpaptpvgc8qr9thv2a4gwaj6fl';
const RST_V2_CONTRACT_HEX = '0x8ea522eb4c95f38e9f4f9a9c4b6f4f1d9e4f7b8d2b10902dbd302779105afaf1';
// Deployer MLDSA hash — SHA256 of OP_WALLET deployer MLDSA pubkey; used for admin visibility check
const DEPLOYER_ADDRESS = 'ad5bad18085ad4cf4f75b71d672bee0b19df826d622279b0020cc29120efce33';
// Motoswap NativeSwap pool contract that emitted LiquidityListed for the RST/BTC pair
const LP_PAIR_ADDRESS = '4397befe4e067390596b3c296e77fe86589487bf3bf3f0a9a93ce794e2d78fb5';
let wallet = null;
let username = null;
let mintData = null;
let es = null;
let mldsaHash = null; // 32-byte SHA256 of MLDSA pubkey — the real OPNet recipient address
let lastMintTime = 0;   // timestamp of last successful mint (cooldown tracking)
let walletRefreshInterval = null;
let shopPurchaseData = null;
// Mint state machine — module-level so DOM repaints can't corrupt it
let mintState = 'idle'; // 'idle' | 'in_progress' | 'ready_to_sign'

function sha256PureJS(data) {
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const msg=data instanceof Uint8Array?data:new Uint8Array(data);
  const len=msg.length,bitLen=len*8;
  const padLen=len%64<56?56-(len%64):120-(len%64);
  const padded=new Uint8Array(len+padLen+8);
  padded.set(msg);padded[len]=0x80;
  const dv=new DataView(padded.buffer);
  dv.setUint32(padded.length-4,bitLen>>>0,false);
  dv.setUint32(padded.length-8,Math.floor(bitLen/0x100000000),false);
  const h=H.slice();
  const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let i=0;i<padded.length;i+=64){
    const w=new Array(64);
    for(let j=0;j<16;j++)w[j]=dv.getUint32(i+j*4,false);
    for(let j=16;j<64;j++){const s0=rotr(w[j-15],7)^rotr(w[j-15],18)^(w[j-15]>>>3);const s1=rotr(w[j-2],17)^rotr(w[j-2],19)^(w[j-2]>>>10);w[j]=(w[j-16]+s0+w[j-7]+s1)>>>0;}
    let[a,b,c,d,e,f,g,hh]=h;
    for(let j=0;j<64;j++){const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);const ch=(e&f)^(~e&g);const t1=(hh+S1+ch+K[j]+w[j])>>>0;const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);const maj=(a&b)^(a&c)^(b&c);const t2=(S0+maj)>>>0;hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+hh)>>>0;
  }
  return h.map(v=>v.toString(16).padStart(8,'0')).join('');
}
async function sha256Hex(data) {
  // data = hex string or Uint8Array
  const bytes = typeof data === 'string' ? hexToBytes(data) : data;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  return sha256PureJS(bytes);
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
  checkAdminPanel();
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
      } else if (d.type === 'minting_started') {
        // grantClaim TX is now in flight — lock button immediately (before TX confirms)
        mintState = 'in_progress';
        mintData = d;
        const claimBtn = document.getElementById('claimBtn');
        if (claimBtn) { claimBtn.disabled = true; claimBtn.textContent = 'MINT IN PROGRESS...'; }
      } else if (d.type === 'mint_ready') {
        // grantClaim TX broadcast — show modal and start polling claimableOf.
        // If already confirmed (ready_to_sign), ignore stale SSE events — don't reset the modal.
        if (mintState === 'ready_to_sign') {
          // Already confirmed on-chain — just update amount if larger
          if (d.rstWei && mintData) {
            const newWei = BigInt(d.rstWei);
            const curWei = BigInt(mintData.rstWei || '0');
            if (newWei > curWei) { mintData.rstWei = d.rstWei; mintData.rstAmount = d.rstAmount; }
          }
        } else {
          mintData = d;
          showMintModal(d);
        }
      } else if (d.type === 'shop_purchase_ready') {
        // RST Shop: item selected in-game, confirm here to receive it
        shopPurchaseData = d;
        showShopModal(d);
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
    // RST Pending = server-side GP sold but not yet granted on-chain
    const serverPendingRst = (d.pending || 0) / 1000;
    // RST Mempool = grantClaim fired (in mempool or confirmed) but not yet claimed by player
    const serverGrantedRst = (d.granted || 0) / 1000;
    const claimable = await fetchClaimableOf();
    const claimableRst = Number(claimable) / 1e18;
    // Use on-chain confirmed value if larger, otherwise server-tracked (covers in-mempool case)
    const mempoolDisplay = claimableRst > serverGrantedRst ? claimableRst : serverGrantedRst;
    document.getElementById('statRST').textContent = serverPendingRst.toFixed(4) + ' RST';
    document.getElementById('statRSTMempool').textContent = mempoolDisplay.toFixed(4) + ' RST';
    // If claimableOf > 0, transition to ready_to_sign from idle OR in_progress (SSE reconnect recovery)
    if (claimable > 0n && (mintState === 'idle' || mintState === 'in_progress') && mintCooldownRemaining() === 0) {
      mintData = { rstWei: claimable.toString(), rstAmount: claimableRst, gpAmount: Math.round(claimableRst * 1000), wallet };
      mintState = 'ready_to_sign';
      const claimBtnR = document.getElementById('claimBtn');
      if (claimBtnR) { claimBtnR.disabled = false; claimBtnR.textContent = 'CLAIM RST'; }
    } else {
      const claimBtnR = document.getElementById('claimBtn');
      // Only enable if there's actually something pending or in mempool — never enable when nothing to claim
      if (claimBtnR && mintState === 'idle') {
        claimBtnR.disabled = (serverPendingRst <= 0 && mempoolDisplay <= 0);
        if (!claimBtnR.disabled) claimBtnR.textContent = 'CLAIM RST';
      }
    }
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
    const all = [...(result.confirmed || [])]; // confirmed only — pending UTXOs cause script mismatches
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
  // tBTC balance — only sum CONFIRMED UTXOs to avoid double-counting unconfirmed change outputs
  try {
    const btcResult = await opnetRpc('btc_getUTXOs', [wallet, true]);
    const confirmedUtxos = btcResult?.confirmed || [];
    const btcSats = confirmedUtxos.reduce((sum, u) => sum + BigInt(u.value || 0), 0n);
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
        const rstBal = Number(rstWei) / 1e18;
        document.getElementById('statRSTBal').textContent = rstBal.toFixed(4) + ' RST';
        updateDifficultyDisplay(rstBal);
      } else {
        document.getElementById('statRSTBal').textContent = '0.0000 RST';
        updateDifficultyDisplay(0);
      }
    }
  } catch(e) { console.error('[RST] btc_call error:', e); document.getElementById('statRSTBal').textContent = '?'; }
}

function updateDifficultyDisplay(rstBal) {
  const el = document.getElementById('statDifficulty');
  const hint = document.getElementById('statDifficultyHint');
  if (!el || !hint) return;
  if (rstBal >= 1000) {
    el.textContent = 'NORMAL';
    el.style.color = '#90ee90';
    hint.textContent = 'Full world unlocked';
  } else if (rstBal >= 10) {
    el.textContent = 'HARD MODE';
    el.style.color = '#ff8c00';
    hint.textContent = 'Earn 1,000 RST for full world';
  } else {
    el.textContent = 'EXTREMELY HARDCORE';
    el.style.color = '#ff4444';
    hint.textContent = 'Earn 10 RST to reduce difficulty';
  }
}

const MINT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
let claimPollInterval = null;

// Shared claimableOf helper — returns BigInt wei (0n if unavailable)
async function fetchClaimableOf() {
  if (!mldsaHash) return 0n;
  try {
    const calldata = '7511422a' + mldsaHash.padStart(64, '0');
    const result = await opnetRpc('btc_call', [RST_CONTRACT, calldata, null, null]);
    const raw = typeof result === 'string' ? result : (result?.result ?? result?.data ?? '');
    let hexStr = '';
    if (typeof raw === 'string' && raw.length > 0) {
      if (raw.startsWith('0x')) hexStr = raw.slice(2);
      else if (/^[0-9a-fA-F]+$/.test(raw)) hexStr = raw;
      else { try { const b = atob(raw); hexStr = Array.from(b).map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join(''); } catch {} }
    }
    if (hexStr.length >= 64) return BigInt('0x' + hexStr.slice(0, 64));
  } catch {}
  return 0n;
}

function mintCooldownRemaining() {
  if (!lastMintTime) return 0;
  return Math.max(0, MINT_COOLDOWN_MS - (Date.now() - lastMintTime));
}

function stopClaimPolling() {
  if (claimPollInterval) { clearInterval(claimPollInterval); claimPollInterval = null; }
  // Only reset button if fully idle (not in_progress or ready_to_sign)
  if (mintState === 'idle') {
    const claimBtn = document.getElementById('claimBtn');
    if (claimBtn) { claimBtn.disabled = false; claimBtn.textContent = 'CLAIM RST'; }
  }
}

async function pollClaimableUntilReady() {
  if (claimPollInterval) { clearInterval(claimPollInterval); claimPollInterval = null; }
  const addrHex = mldsaHash;
  if (!addrHex) return;
  // Transition to in_progress — lock button
  mintState = 'in_progress';
  const claimBtn = document.getElementById('claimBtn');
  if (claimBtn) { claimBtn.disabled = true; claimBtn.textContent = 'MINT IN PROGRESS...'; }
  const calldata = '7511422a' + addrHex.padStart(64, '0');
  console.log('[RST] polling claimableOf for', addrHex.slice(0,8), '...');
  claimPollInterval = setInterval(async () => {
    if (mintState !== 'in_progress') { clearInterval(claimPollInterval); claimPollInterval = null; return; }
    try {
      const result = await opnetRpc('btc_call', [RST_CONTRACT, calldata, null, null]);
      const raw = typeof result === 'string' ? result : (result?.result ?? result?.data ?? '');
      let hexStr = '';
      if (typeof raw === 'string' && raw.length > 0) {
        if (raw.startsWith('0x')) { hexStr = raw.slice(2); }
        else if (/^[0-9a-fA-F]+$/.test(raw)) { hexStr = raw; }
        else { try { const b = atob(raw); hexStr = Array.from(b).map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join(''); } catch {} }
      }
      console.log('[RST] claimableOf hex:', hexStr.slice(0,16) || '(empty)');
      if (hexStr.length >= 64) {
        const claimable = BigInt('0x' + hexStr.slice(0, 64));
        console.log('[RST] claimable:', claimable.toString());
        if (claimable > 0n) {
          clearInterval(claimPollInterval); claimPollInterval = null;
          const claimableRst = Number(claimable) / 1e18;
          // Sync mintData with authoritative on-chain amount
          if (mintData) { mintData.rstWei = claimable.toString(); mintData.rstAmount = claimableRst; }
          else { mintData = { rstWei: claimable.toString(), rstAmount: claimableRst, gpAmount: Math.round(claimableRst * 1000), wallet }; }
          // Transition to ready_to_sign FIRST (before any DOM updates that could throw)
          mintState = 'ready_to_sign';
          // Update button — CLAIM RST is clickable (grantClaim confirmed, ready for claim())
          if (claimBtn) { claimBtn.disabled = false; claimBtn.textContent = 'CLAIM RST'; }
          // Update modal title to reflect confirmed state
          const titleEl = document.getElementById('mintModalTitle');
          if (titleEl) titleEl.textContent = '\u26CF RST CLAIM READY';
          const timingNote = document.getElementById('modalTimingNote');
          if (timingNote) timingNote.style.display = 'none';
          // Update displays
          const rstMempoolEl = document.getElementById('statRSTMempool');
          if (rstMempoolEl) rstMempoolEl.textContent = claimableRst.toFixed(4) + ' RST';
          const amtEl = document.getElementById('mintAmt');
          if (amtEl) amtEl.textContent = claimableRst.toFixed(4);
          const subEl = document.getElementById('mintSub');
          if (subEl) subEl.textContent = 'Total claimable: ' + claimableRst.toFixed(4) + ' RST (' + Math.round(claimableRst * 1000).toLocaleString() + ' GP). Sign to claim!';
          // Unlock Sign button in modal
          const signBtn = document.getElementById('signBtn');
          if (signBtn) { signBtn.disabled = false; signBtn.textContent = 'SIGN & CLAIM WITH OP_WALLET'; }
          setModalStatus('Confirmed on-chain! Sign to receive your RST.', 'success');
          console.log('[RST] ✅ claimableOf confirmed — CLAIM RST enabled');
        }
      }
    } catch(e) { console.warn('[RST] claimableOf poll error:', e); }
  }, 10000);
}

function showMintModal(d) {
  document.getElementById('mintModalTitle').textContent = '\u23F3 GRANTING RST...';
  document.getElementById('mintAmt').textContent = (d.rstAmount || 0).toFixed(4);
  document.getElementById('mintSub').textContent = 'Sold resources for ' + (d.gpAmount || 0).toLocaleString() + ' GP. Confirming on-chain...';
  // Always start with Sign disabled — poll claimableOf until grantClaim is confirmed on-chain.
  // This prevents claim() racing grantClaim into the same block ("Insufficient claim allowance").
  document.getElementById('signBtn').disabled = true;
  document.getElementById('signBtn').textContent = 'WAITING FOR CONFIRMATION...';
  document.getElementById('modalTimingNote').style.display = 'block';
  setModalStatus('grantClaim is confirming on-chain (~1-2 min). Sign will unlock automatically.', 'info');
  document.getElementById('mintModal').classList.add('show');
  pollClaimableUntilReady();
}

async function openClaimModal() {
  if (!username || !wallet) { alert('Connect your wallet first.'); return; }
  // If grantClaim confirmed on-chain — reopen modal with Sign already ready
  if (mintState === 'ready_to_sign') {
    // Always fetch fresh claimableOf so display shows the real total (not stale mintData)
    const freshClaimable = await fetchClaimableOf();
    const displayAmt = freshClaimable > 0n ? Number(freshClaimable) / 1e18 : (mintData?.rstAmount || 0);
    const displayWei = freshClaimable > 0n ? freshClaimable.toString() : (mintData?.rstWei || '0');
    if (!mintData) mintData = { rstAmount: displayAmt, rstWei: displayWei, gpAmount: Math.round(displayAmt * 1000), wallet };
    else { mintData.rstAmount = displayAmt; mintData.rstWei = displayWei; }
    document.getElementById('mintModalTitle').textContent = '\u26CF RST CLAIM READY';
    document.getElementById('mintAmt').textContent = displayAmt.toFixed(4);
    document.getElementById('mintSub').textContent = 'Total claimable: ' + displayAmt.toFixed(4) + ' RST. Sign to receive!';
    document.getElementById('signBtn').disabled = false;
    document.getElementById('signBtn').textContent = 'SIGN & CLAIM WITH OP_WALLET';
    document.getElementById('modalTimingNote').style.display = 'none';
    setModalStatus('Confirmed on-chain! Sign to receive your RST.', 'success');
    document.getElementById('mintModal').classList.add('show');
    return;
  }
  // If mint TX is in flight — don't allow clicking through
  if (mintState === 'in_progress') {
    alert('Transaction in progress. Sign will unlock automatically when confirmed (~1 min).');
    return;
  }
  try {
    const r = await fetch('/rst/balance?username=' + encodeURIComponent(username));
    const d = await r.json();
    const gp = d.pending || 0;
    if (gp < 10) {
      // No server-side pending — check if there's already-granted RST on-chain waiting to be claimed
      const claimable = await fetchClaimableOf();
      if (claimable > 0n) {
        const claimableRst = Number(claimable) / 1e18;
        mintData = { rstWei: claimable.toString(), rstAmount: claimableRst, gpAmount: Math.round(claimableRst * 1000), wallet };
        mintState = 'ready_to_sign';
        document.getElementById('mintModalTitle').textContent = '\u26CF RST CLAIM READY';
        document.getElementById('mintAmt').textContent = claimableRst.toFixed(4);
        document.getElementById('mintSub').textContent = 'RST confirmed on-chain. Sign to receive!';
        document.getElementById('signBtn').disabled = false;
        document.getElementById('signBtn').textContent = 'SIGN & CLAIM WITH OP_WALLET';
        document.getElementById('modalTimingNote').style.display = 'none';
        setModalStatus('Confirmed on-chain! Sign to receive your RST.', 'success');
        document.getElementById('mintModal').classList.add('show');
        const claimBtn = document.getElementById('claimBtn');
        if (claimBtn) { claimBtn.disabled = false; claimBtn.textContent = 'CLAIM RST'; }
        return;
      }
      alert('No RST pending yet. Sell resources to the RST merchant first!');
      return;
    }
    mintData = { rstAmount: gp / 1000, gpAmount: gp, rstWei: (BigInt(gp) * (10n ** 18n) / 1000n).toString(), wallet };
    showMintModal(mintData);
  } catch(e) { alert('Error: ' + e.message); }
}

function dismissModal() {
  // If grantClaim is still in-flight, keep the poll running in the background
  // so it can unlock the button automatically when confirmed. Don't reset state.
  if (mintState === 'in_progress') {
    document.getElementById('mintModal').classList.remove('show');
    const claimBtn = document.getElementById('claimBtn');
    if (claimBtn) { claimBtn.disabled = true; claimBtn.textContent = 'MINT IN PROGRESS...'; }
    return;
  }
  if (claimPollInterval) { clearInterval(claimPollInterval); claimPollInterval = null; }
  const claimBtn = document.getElementById('claimBtn');
  if (mintState === 'idle') {
    if (claimBtn) { claimBtn.disabled = false; claimBtn.textContent = 'CLAIM RST'; }
  }
  // ready_to_sign: leave button as CLAIM RST (grantClaim confirmed, awaiting player claim)
  document.getElementById('mintModal').classList.remove('show');
}

function disconnectWallet() {
  if (es) { es.close(); es = null; }
  if (walletRefreshInterval) { clearInterval(walletRefreshInterval); walletRefreshInterval = null; }
  username = null; wallet = null; mintData = null; mldsaHash = null; mintState = 'idle';
  localStorage.removeItem('rst_username');
  document.getElementById('walletStatus').textContent = 'No wallet connected — connect in the sidebar';
  document.getElementById('walletStatus').className = 'wallet-status';
  document.getElementById('statsSection').style.display = 'none';
  document.getElementById('connectSection').style.display = 'block';
  document.getElementById('usernameInput').value = '';
  dismissModal();
  const adminEl = document.getElementById('adminSection');
  if (adminEl) adminEl.remove();
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
      document.getElementById('signBtn').textContent = 'SIGN & CLAIM WITH OP_WALLET';
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
    if (!recipientHash) { setModalStatus('Could not resolve recipient address. Reconnect wallet.', 'error'); document.getElementById('signBtn').disabled = false; document.getElementById('signBtn').textContent = 'SIGN & CLAIM WITH OP_WALLET'; return; }
    const rstWei = BigInt(d.rstWei || '0');
    const amtHex = rstWei.toString(16).padStart(64, '0');
    const calldata = hexToBytes('16b06937' + amtHex);
    console.log('[RST] calldata built, fetching UTXOs...');
    setModalStatus('Preparing transaction...', 'info');
    const utxos = await fetchUTXOs(wallet);
    console.log('[RST] UTXOs:', utxos.length);
    const network = { messagePrefix: '\\x18Bitcoin Signed Message:\\n', bech32: 'opt', bech32Opnet: 'opt', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
    // RST contract secret = tweakedPubkey from getPublicKeyInfo (32 bytes)
    // bech32mAddrToHex gives only 21 bytes (P2OP witness program) — use the resolved tweakedPubkey instead
    const contractHex = '0x8ea522eb4c95f38e9f4f9a9c4b6f4f1d9e4f7b8d2b10902dbd302779105afaf1';
    const params = { to: RST_CONTRACT, contract: contractHex, calldata, from: wallet, utxos, feeRate: 10, priorityFee: BigInt(0), gasSatFee: BigInt(20000), network, linkMLDSAPublicKeyToAddress: false, revealMLDSAPublicKey: false };
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
    if (claimPollInterval) { clearInterval(claimPollInterval); claimPollInterval = null; }
    mintState = 'idle';
    lastMintTime = Date.now();
    setModalStatus('SUCCESS! ' + (d.rstAmount || 0).toFixed(4) + ' RST claimed!', 'success');
    mintData = null;
    document.getElementById('signBtn').textContent = 'CLAIMED!';
    const claimBtnDone = document.getElementById('claimBtn');
    if (claimBtnDone) { claimBtnDone.textContent = 'CLAIM RST'; claimBtnDone.disabled = true; }
    setTimeout(() => { dismissModal(); refreshBalance(); refreshWalletBalances(); fetchLeaderboard(); }, 3000);
  } catch(e) {
    console.error('[RST] executeMint error:', e);
    setModalStatus('Failed: ' + (e.message || String(e)), 'error');
    document.getElementById('signBtn').disabled = false;
    document.getElementById('signBtn').textContent = 'SIGN & CLAIM WITH OP_WALLET';
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

function showShopModal(d) {
  document.getElementById('shopItemName').textContent = d.itemName;
  document.getElementById('shopCostLabel').textContent = d.rstCost + ' RST will be burned from your balance';
  document.getElementById('shopConfirmBtn').disabled = false;
  document.getElementById('shopConfirmBtn').textContent = 'CONFIRM \u0026 RECEIVE ITEM';
  document.getElementById('shopModalStatus').textContent = '';
  document.getElementById('shopModalStatus').className = 'modal-status';
  document.getElementById('shopModal').classList.add('show');
}

function dismissShopModal() {
  document.getElementById('shopModal').classList.remove('show');
  shopPurchaseData = null;
}

async function executeShopConfirm() {
  if (!shopPurchaseData || !username) return;
  const d = shopPurchaseData;
  document.getElementById('shopConfirmBtn').disabled = true;
  document.getElementById('shopConfirmBtn').textContent = 'CONFIRMING...';
  document.getElementById('shopModalStatus').textContent = 'Confirming purchase...';
  document.getElementById('shopModalStatus').className = 'modal-status info';
  try {
    const r = await fetch('/shop/confirm-purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, nonce: d.nonce })
    });
    const result = await r.json();
    if (result.success) {
      document.getElementById('shopModalStatus').textContent = 'SUCCESS! Check your in-game inventory!';
      document.getElementById('shopModalStatus').className = 'modal-status success';
      document.getElementById('shopConfirmBtn').textContent = 'ITEM DELIVERED!';
      shopPurchaseData = null;
      setTimeout(() => { dismissShopModal(); refreshBalance(); }, 3000);
    } else {
      document.getElementById('shopModalStatus').textContent = 'Failed: ' + result.message;
      document.getElementById('shopModalStatus').className = 'modal-status error';
      document.getElementById('shopConfirmBtn').disabled = false;
      document.getElementById('shopConfirmBtn').textContent = 'CONFIRM \u0026 RECEIVE ITEM';
    }
  } catch(e) {
    document.getElementById('shopModalStatus').textContent = 'Error: ' + e.message;
    document.getElementById('shopModalStatus').className = 'modal-status error';
    document.getElementById('shopConfirmBtn').disabled = false;
    document.getElementById('shopConfirmBtn').textContent = 'CONFIRM \u0026 RECEIVE ITEM';
  }
}

// ─── Admin Panel (deployer-only) ──────────────────────────────────────────────

function checkAdminPanel() {
  // Only inject if the connected wallet IS the deployer — no hidden elements for anyone else
  if (!mldsaHash || mldsaHash !== DEPLOYER_ADDRESS) return;
  if (document.getElementById('adminSection')) return;

  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const sec = document.createElement('div');
  sec.id = 'adminSection';
  sec.className = 's-section admin-section';
  sec.innerHTML =
    '<h3>RST Admin</h3>' +
    '<div class="stat-row"><span>v2 Contract</span><span style="color:#ff4444;font-size:0.65em;">DEPLOYER</span></div>' +
    '<button class="admin-btn" id="setMinterBtn" onclick="executeSetMinter()">SET MINTER</button>' +
    '<button class="admin-btn" id="setLPBtn" onclick="executeSetLPPair()" style="margin-top:6px;">SET LP PAIR</button>' +
    '<div id="adminStatus" class="modal-status" style="margin-top:8px;font-size:0.72em;min-height:16px;"></div>';

  // Insert before the first .s-section (leaderboard area) so it appears above links
  const firstSection = sidebar.querySelector('.s-section');
  if (firstSection) {
    sidebar.insertBefore(sec, firstSection);
  } else {
    sidebar.appendChild(sec);
  }
}

function setAdminStatus(msg, type) {
  const el = document.getElementById('adminStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'modal-status ' + type;
}

async function executeSetMinter() {
  if (!wallet) { setAdminStatus('No wallet connected.', 'error'); return; }

  const btn = document.getElementById('setMinterBtn');
  btn.disabled = true;
  btn.textContent = 'LOADING...';
  setAdminStatus('Fetching server minter address...', 'info');

  try {
    const res = await fetch('/rst/server-address');
    const { mldsaHash } = await res.json();
    if (!mldsaHash) { setAdminStatus('Server minter WIF not configured.', 'error'); btn.disabled = false; btn.textContent = 'SET MINTER'; return; }

    const web3 = window.opnet?.web3;
    if (!web3) { setAdminStatus('OP_WALLET not found.', 'error'); btn.disabled = false; btn.textContent = 'SET MINTER'; return; }

    // setMinter(address) calldata
    // selector = first 4 bytes of SHA256('setMinter(address)') = 5bf977e4
    // param    = 32-byte server MLDSA hash
    const calldata = hexToBytes('5bf977e4' + mldsaHash);

    btn.textContent = 'SIGNING...';
    setAdminStatus('Server: ' + mldsaHash.slice(0,16) + '...', 'info');

    const utxos = await fetchUTXOs(wallet);
    if (!utxos.length) {
      setAdminStatus('No UTXOs found. Fund your deployer wallet.', 'error');
      btn.disabled = false; btn.textContent = 'SET MINTER'; return;
    }

    const network = { messagePrefix: '\\x18Bitcoin Signed Message:\\n', bech32: 'opt', bech32Opnet: 'opt', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
    const params = { to: RST_V2_CONTRACT, contract: RST_V2_CONTRACT_HEX, calldata, from: wallet, utxos, feeRate: 10, priorityFee: BigInt(0), gasSatFee: BigInt(20000), network, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: false };

    setAdminStatus('Check OP_WALLET to sign...', 'info');
    if (typeof web3.signAndBroadcastInteraction === 'function') {
      await web3.signAndBroadcastInteraction(params);
    } else {
      const signed = await web3.signInteraction(params);
      if (signed.fundingTransaction) await broadcastOpnet(signed.fundingTransaction);
      await broadcastOpnet(signed.interactionTransaction);
    }

    setAdminStatus('Minter set! Server can now call grantClaim.', 'success');
    btn.textContent = 'SET MINTER';
  } catch (e) {
    setAdminStatus('Failed: ' + (e.message || String(e)), 'error');
    btn.disabled = false;
    btn.textContent = 'SET MINTER';
  }
}

async function executeSetLPPair() {
  if (!wallet) { setAdminStatus('No wallet connected.', 'error'); return; }

  const btn = document.getElementById('setLPBtn');
  btn.disabled = true;
  btn.textContent = 'SIGNING...';
  setAdminStatus('Building transaction...', 'info');

  try {
    const web3 = window.opnet?.web3;
    if (!web3) { setAdminStatus('OP_WALLET not found.', 'error'); btn.disabled = false; btn.textContent = 'SET LP PAIR'; return; }

    // setLPPair(address) calldata
    // selector = first 4 bytes of SHA256('setLPPair(address)') = 78e4405d
    // param    = 32-byte LP pair contract address (already 32 bytes, no padding needed)
    const calldata = hexToBytes('78e4405d' + LP_PAIR_ADDRESS);

    setAdminStatus('Fetching UTXOs...', 'info');
    const utxos = await fetchUTXOs(wallet);
    if (!utxos.length) {
      setAdminStatus('No UTXOs found. Fund your deployer wallet.', 'error');
      btn.disabled = false; btn.textContent = 'SET LP PAIR'; return;
    }

    const network = { messagePrefix: '\\x18Bitcoin Signed Message:\\n', bech32: 'opt', bech32Opnet: 'opt', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };

    const params = {
      to: RST_V2_CONTRACT,
      contract: RST_V2_CONTRACT_HEX,
      calldata,
      from: wallet,
      utxos,
      feeRate: 10,
      priorityFee: BigInt(0),
      gasSatFee: BigInt(20000),
      network,
      linkMLDSAPublicKeyToAddress: true,
      revealMLDSAPublicKey: false,
    };

    setAdminStatus('Check OP_WALLET to sign...', 'info');
    if (typeof web3.signAndBroadcastInteraction === 'function') {
      await web3.signAndBroadcastInteraction(params);
    } else {
      const signed = await web3.signInteraction(params);
      if (signed.fundingTransaction) await broadcastOpnet(signed.fundingTransaction);
      await broadcastOpnet(signed.interactionTransaction);
    }

    setAdminStatus('LP pair set! 1% burn mechanic is now active.', 'success');
    btn.textContent = 'SET LP PAIR';
  } catch (e) {
    setAdminStatus('Failed: ' + (e.message || String(e)), 'error');
    btn.disabled = false;
    btn.textContent = 'SET LP PAIR';
  }
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

            // RST Leaderboard — replaces the broken skill-based hiscores
            if (url.pathname === '/hiscores' || url.pathname === '/hiscores/') {
                const { totalGPConverted, RST_GP_PER_TOKEN } = await import('../engine/pill/PillMerchant.js');
                const entries = Array.from(totalGPConverted.entries())
                    .sort((a, b) => b[1] - a[1]);
                const rows = entries.map(([username, gp], i) => {
                    const rst = (gp / RST_GP_PER_TOKEN).toFixed(4);
                    const gpFmt = gp >= 1_000_000 ? (gp / 1_000_000).toFixed(2) + 'M' : gp >= 1_000 ? (gp / 1_000).toFixed(1) + 'K' : gp.toLocaleString();
                    const rankColor = i === 0 ? '#f0c030' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#888';
                    return `<tr>
                        <td style="padding:6px 10px;color:#444;font-size:0.85em;">#\${i + 1}</td>
                        <td style="padding:6px 10px;color:\${rankColor};">\${username}</td>
                        <td style="padding:6px 10px;color:#f0c030;text-align:right;">\${gpFmt} GP</td>
                        <td style="padding:6px 10px;color:#44cc44;text-align:right;">\${rst} RST</td>
                    </tr>`;
                }).join('');
                const noRows = entries.length === 0 ? '<tr><td colspan="4" style="padding:20px;text-align:center;color:#444;">No conversions yet — start playing!</td></tr>' : '';
                const rstHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>RST Leaderboard — Runescape Resource Terminal</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0e0e0e; color:#c0a060; font-family:'Courier New',monospace; min-height:100vh; }
header { background:#1a1200; border-bottom:2px solid #4a3800; padding:0 20px; height:44px; display:flex; align-items:center; justify-content:space-between; }
.logo { color:#f0c030; font-size:1em; font-weight:bold; letter-spacing:2px; }
.back { background:#1a1200; border:1px solid #f0c030; color:#f0c030; padding:5px 14px; font-family:monospace; font-size:0.72em; border-radius:3px; text-decoration:none; }
.back:hover { background:#2a2000; }
.wrap { max-width:700px; margin:30px auto; padding:0 16px; }
h1 { color:#f0c030; font-size:1em; letter-spacing:3px; text-transform:uppercase; margin-bottom:4px; }
.sub { color:#555; font-size:0.72em; margin-bottom:20px; border-bottom:1px solid #1e1600; padding-bottom:12px; }
table { width:100%; border-collapse:collapse; }
th { color:#888; font-size:0.68em; letter-spacing:1px; text-transform:uppercase; padding:6px 10px; border-bottom:2px solid #2a2000; text-align:left; }
th:last-child, th:nth-child(3) { text-align:right; }
tr:nth-child(even) { background:#0a0a0a; }
tr:hover { background:#111; }
</style>
</head>
<body>
<header>
  <span class="logo">&#x26CF; RST LEADERBOARD</span>
  <a href="/play" class="back">&#x2190; BACK TO GAME</a>
</header>
<div class="wrap">
  <h1>&#x1F3C6; GP Conversion Leaderboard</h1>
  <p class="sub">All-time GP converted to RST &mdash; updated live &mdash; \${entries.length} players</p>
  <table>
    <thead>
      <tr>
        <th>Rank</th>
        <th>Player</th>
        <th>GP Converted</th>
        <th>RST Earned</th>
      </tr>
    </thead>
    <tbody>
      \${rows}\${noRows}
    </tbody>
  </table>
</div>
</body>
</html>`;
                return new Response(rstHtml, { headers: { 'Content-Type': 'text/html' } });
            }

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
