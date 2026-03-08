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
const RST_CONTRACT_PUBKEY = '0x8ea522eb4c95f38e9f4f9a9c4b6f4f1d9e4f7b8d2b10902dbd302779105afaf1';
// RSTStaking V2 MasterChef — deployed 2026-03-07
const STAKING_CONTRACT = 'opt1sqpnwrzsteu0q9nllckgj0kwdw33xhlj7lvf3eyq4';
const STAKING_CONTRACT_PUBKEY = '0x870445dc98bb046bb6dd1f6984174b5b2bac9c70a1259ce3f4801a992bf4fa1c';
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


            // RST: Stake status
            if (url.pathname === '/rst/stake-status') {
                const username = url.searchParams.get('username')?.toLowerCase().trim() ?? '';
                const { stakedRegistry } = await import('../engine/pill/PillMerchant.js');
                const staked = stakedRegistry.get(username) ?? 0;
                return new Response(JSON.stringify({ staked }), {
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
            // RST: Stake — player must be currently logged in to stake
            if (url.pathname === '/rst/stake' && req.method === 'POST') {
                try {
                    const body = await req.json() as any;
                    const username = (body.username || '').toLowerCase().trim();
                    const amount = parseFloat(body.amount) || 0;
                    if (!username || amount < 10) {
                        return new Response(JSON.stringify({ error: 'Minimum stake is 10 RST' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
                    }
                    // Security: require player to be logged in — prevents anyone from staking arbitrary usernames
                    const player = Array.from(World.players).find((p: any) => p.username === username);
                    if (!player) {
                        return new Response(JSON.stringify({ error: 'You must be logged in-game to stake. Log in first, then stake here.' }), {
                            status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                        });
                    }
                    const { stakePlayer } = await import('../engine/pill/PillMerchant.js');
                    stakePlayer(username, amount);
                    return new Response(JSON.stringify({ success: true, staked: amount }), {
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                    });
                } catch (e: any) {
                    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
                }
            }

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
                        // Security: require player to be logged in — prevents wallet hijacking for offline users
                        const playerOnline = Array.from(World.players).some((p: any) => p.username === username.toLowerCase());
                        if (!playerOnline) {
                            return new Response(JSON.stringify({ error: 'You must be logged in-game to register your wallet.' }), {
                                status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                            });
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
.stake-btn { width: 100%; background: #0a2a0a; border: 1px solid #44cc44; color: #44cc44; padding: 7px; font-family: monospace; font-size: 0.72em; font-weight: bold; cursor: pointer; border-radius: 3px; margin-top: 6px; }
.stake-btn:hover { background: #143a14; }
.staked-badge { width: 100%; background: #001a00; border: 1px solid #44cc44; color: #44cc44; padding: 6px; font-family: monospace; font-size: 0.68em; text-align: center; border-radius: 3px; margin-top: 6px; }
.online-row { display: flex; align-items: center; gap: 6px; font-size: 0.72em; padding: 2px 0; color: #888; border-bottom: 1px solid #181200; }
.online-dot { width: 6px; height: 6px; border-radius: 50%; background: #44cc44; flex-shrink: 0; box-shadow: 0 0 4px #44cc44; }
</style>
</head>
<body>
<header>
  <span class="logo">&#x26CF; RUNESCAPE RESOURCE TERMINAL</span>
  <div style="display:flex;align-items:center;gap:12px;">
    <button onclick="document.getElementById('htpModal').classList.add('show')" style="background:#1a1200;border:1px solid #f0c030;color:#f0c030;padding:5px 12px;font-family:monospace;font-size:0.72em;cursor:pointer;border-radius:3px;font-weight:bold;">&#x2753; HOW TO PLAY</button>
    <button onclick="document.getElementById('dsModal').classList.add('show')" style="background:#1a1200;border:1px solid #f0c030;color:#f0c030;padding:5px 12px;font-family:monospace;font-size:0.72em;cursor:pointer;border-radius:3px;font-weight:bold;">&#x1F30D; DIFFICULTY</button>
    <button onclick="document.getElementById('tokenomicsModal').classList.add('show')" style="background:#1a1200;border:1px solid #f0c030;color:#f0c030;padding:5px 12px;font-family:monospace;font-size:0.72em;cursor:pointer;border-radius:3px;font-weight:bold;">&#x20BF; TOKENOMICS</button>
    <button onclick="document.getElementById('roadmapModal').classList.add('show')" style="background:#1a1200;border:1px solid #f0c030;color:#f0c030;padding:5px 12px;font-family:monospace;font-size:0.72em;cursor:pointer;border-radius:3px;font-weight:bold;">&#x1F5FA; ROADMAP</button>
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
      <div class="stat-row"><span>sRST Staked</span><span id="statSRSTBal" style="color:#88ff88">-</span></div>
      <div class="stat-row"><span>Rewards</span><span id="statPendingRewards" style="color:#f7931a">-</span></div>
      <div class="stat-row"><span>tBTC Balance</span><span id="statBTC">-</span></div>
      <div style="margin-top:6px;border-top:1px solid #2a2000;padding-top:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
          <span id="diffLabel" style="font-size:0.75em;color:#666;">Difficulty</span>
          <select id="sidebarLangSelect" onchange="setHTPLang(this.value)" title="Language" style="background:#0e0e0e;border:1px solid #2a2000;color:#888;font-family:monospace;font-size:0.62em;padding:2px 5px;border-radius:3px;cursor:pointer;">
            <option value="en">&#x1F310; EN</option>
            <option value="es">ES</option>
            <option value="fr">FR</option>
            <option value="zh">&#x4E2D;</option>
            <option value="de">DE</option>
            <option value="fa">&#x641;&#x627;</option>
            <option value="pt">PT</option>
            <option value="ja">&#x65E5;</option>
          </select>
        </div>
        <div style="text-align:center;"><span id="statDifficulty" style="font-weight:bold;color:#ff4444;font-size:0.75em;display:inline-block;">EXTREMELY HARDCORE</span></div>
      </div>
      <div id="statDifficultyHint" style="font-size:0.68em;color:#666;margin-bottom:4px;text-align:center;">Earn 10 RST to reduce</div>
      <button class="stake-btn" id="stakeBtn" onclick="openStakeModal()" style="display:none">&#x26A1; STAKE RST &mdash; UNLOCK FULL WORLD</button>
      <div class="staked-badge" id="stakedBadge" style="display:none">&#x2705; STAKED &mdash; FULL WORLD UNLOCKED</div>
      <button class="claim-btn" id="unstakeBtn" onclick="openUnstakeModal()" style="display:none;background:#1a2a1a;border:1px solid #44cc44;color:#44cc44;margin-top:4px;">&#x21A9; UNSTAKE sRST</button>
      <button class="claim-btn" id="withdrawBtn" onclick="executeWithdraw()" style="display:none;background:#1a2a1a;border:1px solid #88ff88;color:#88ff88;margin-top:4px;">&#x2B07; WITHDRAW RST</button>
      <button class="claim-btn" id="claimRewardsBtn" onclick="executeClaimRewards()" style="display:none;background:#1a1a00;border:1px solid #f7931a;color:#f7931a;margin-top:4px;">&#x1F4B0; CLAIM REWARDS</button>
      <button class="claim-btn" id="claimBtn" onclick="openClaimModal()" disabled>CLAIM RST</button>
      <button class="claim-btn" style="background:#1a1a1a;color:#666;border:1px solid #333;margin-top:4px;" onclick="disconnectWallet()">Disconnect</button>
    </div>
    <!-- Leaderboard -->
    <div class="s-section">
      <h3>Most GP Converted</h3>
      <div id="leaderboard"><div style="color:#333;font-size:0.72em;text-align:center;padding:8px;">Loading...</div></div>
    </div>
    <!-- Online Players -->
    <div class="s-section">
      <h3>Online Now <span id="onlineCount" style="color:#44cc44;font-weight:normal;font-size:0.9em;"></span></h3>
      <div id="onlineList"><div style="color:#333;font-size:0.72em;text-align:center;padding:4px;">-</div></div>
    </div>
    <!-- How to Play button -->
    <div style="padding: 10px 12px; border-bottom: 1px solid #1e1600;">
      <button class="htp-btn" onclick="document.getElementById('htpModal').classList.add('show')">&#x2753; HOW TO PLAY</button>
      <button class="htp-btn" onclick="document.getElementById('dsModal').classList.add('show')">&#x1F30D; DIFFICULTY SYSTEM</button>
      <button class="htp-btn" onclick="document.getElementById('tokenomicsModal').classList.add('show')">&#x20BF; TOKENOMICS</button>
      <button class="htp-btn" onclick="document.getElementById('roadmapModal').classList.add('show')">&#x1F5FA; ROADMAP</button>
    </div>
  </div>
</div>
<!-- How To Play Modal -->
<div class="htp-modal-bg" id="htpModal">
  <div class="htp-box">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <button class="htp-close" style="position:static;" onclick="document.getElementById('htpModal').classList.remove('show')">&#x2715; CLOSE</button>
      <select id="htpLangSelect" onchange="setHTPLang(this.value)" title="Language / Idioma / Langue / Sprache" style="background:#0e0e0e;border:1px solid #4a3800;color:#c0a060;font-family:monospace;font-size:0.72em;padding:4px 8px;border-radius:3px;cursor:pointer;">
        <option value="en">&#x1F310; English</option>
        <option value="es">Espa&#xF1;ol</option>
        <option value="fr">Fran&#xE7;ais</option>
        <option value="zh">&#x4E2D;&#x6587;</option>
        <option value="de">Deutsch</option>
        <option value="fa">&#x641;&#x627;&#x631;&#x633;&#x6CC;</option>
        <option value="pt">Portugu&#xEA;s</option>
        <option value="ja">&#x65E5;&#x672C;&#x8A9E;</option>
      </select>
    </div>
    <div id="htpContent"></div>
  </div>
</div>
<!-- Difficulty System Modal -->
<div class="htp-modal-bg" id="dsModal">
  <div class="htp-box">
    <button class="htp-close" onclick="document.getElementById('dsModal').classList.remove('show')">&#x2715; CLOSE</button>
    <h1>&#x1F30D; DIFFICULTY SYSTEM</h1>
    <div class="htp-sub">Unlock more of the world by earning RST</div>
    <div class="htp-section">
      <h3 style="color:#ff4444;">&#x1F534; PHASE 1 &mdash; KINGDOM OF MISTHALIN &mdash; 0 RST</h3>
      <p>Everyone starts here. No RST required. <strong style="color:#ff4444">EXTREME HARDCORE IRONMAN</strong> &mdash; no player trading.</p>
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
      <p>Earn 10 RST to unlock the western kingdom. <strong style="color:#f7931a">HARD MODE</strong> &mdash; 10,000 GP trade cap.</p>
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
      <h3 style="color:#44cc44;">&#x1F7E2; PHASE 3 &mdash; FULL WORLD &mdash; 1,000 RST or Stake</h3>
      <p><strong style="color:#44cc44">EASY MODE</strong> &mdash; unlimited trading, full Gielinor. Two paths to unlock:</p>
      <ul style="margin-top:6px;">
        <li><strong style="color:#44cc44">Earn 1,000 RST</strong> &mdash; own it in your wallet, no staking required</li>
        <li><strong style="color:#44cc44">Stake any RST</strong> &mdash; stake 10+ RST to instantly unlock full world access</li>
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
    <p style="color:#555;font-size:0.68em;margin-top:16px;text-align:center;">The harder you grind, the more you unlock. Can you reach the full world? &#x1F30D;</p>
  </div>
</div>
<!-- Tokenomics Modal -->
<div class="htp-modal-bg" id="tokenomicsModal">
  <div class="htp-box">
    <button class="htp-close" onclick="document.getElementById('tokenomicsModal').classList.remove('show')">&#x2715; CLOSE</button>
    <h1>&#x20BF; TOKENOMICS</h1>
    <div class="htp-sub">RST &mdash; Runescape Resource Terminal Token &mdash; BTC L1 OP20</div>

    <div class="htp-section">
      <h3 style="color:#f7931a;">&#x1F7E0; V1 CONTRACT &mdash; LIVE NOW (Testnet)</h3>
      <p><strong style="color:#f0c030;">Total Supply:</strong> 1,000,000 RST</p>
      <ul style="margin-top:6px;">
        <li><strong>500,000 RST</strong> &mdash; Deployer reserve (LP seeding)</li>
        <li><strong>500,000 RST</strong> &mdash; Player claim pool (earn in-game &rarr; claim on-chain)</li>
        <li>Basic earn &amp; claim system active &mdash; chop logs, sell to merchant, claim RST to your wallet</li>
        <li>LP pool live on MotoSwap NativeSwap &mdash; RST tradeable now</li>
        <li><strong>1% swap fee</strong> on every trade goes to the LP</li>
      </ul>
    </div>

    <div class="htp-section">
      <h3 style="color:#44cc44;">&#x1F451; OG RANK &mdash; V1 Traders</h3>
      <p>Wallets that trade RST on the V1 LP will be <strong style="color:#44cc44;">airdropped / whitelisted for Mainnet</strong> with <strong style="color:#44cc44;">OG Rank</strong> status. First movers get recognised.</p>
    </div>

    <div class="htp-section">
      <h3 style="color:#888;">&#x1F4CA; FUTURE VERSIONS</h3>
      <ul style="margin-top:6px;">
        <li><strong style="color:#44cc44;">V2 &mdash; Veteran Rank</strong> &mdash; Staking rewards launch, sRST conversion pool</li>
        <li><strong style="color:#f7931a;">V3 &mdash; Officer Rank</strong> &mdash; Expanded content, deeper DeFi integration</li>
        <li><strong style="color:#f0c030;">V4 &mdash; Master Rank</strong> &mdash; TBD based on roadmap progress</li>
      </ul>
      <p style="margin-top:8px;color:#888;font-size:0.88em;">Early players earn ranks. Ranks carry to Mainnet.</p>
    </div>

    <div class="htp-section" style="border-top:1px solid #2a2000;padding-top:14px;">
      <h3>HOW TO EARN RST</h3>
      <p>This is a <strong style="color:#f0c030;">BTC L1 Free-to-Play, Play-to-Earn</strong> game. No purchase required.</p>
      <ol style="margin-top:6px;">
        <li>Download <strong style="color:#f0c030;">OP_WALLET</strong></li>
        <li>Load Bitcoin (testnet BTC for now &mdash; Mainnet at launch)</li>
        <li>Connect wallet &rarr; enter username &rarr; play</li>
        <li>Mine ores, chop trees, sell resources &rarr; GP converts to RST</li>
        <li>Claim RST directly to your Bitcoin wallet on-chain</li>
      </ol>
    </div>

    <p style="color:#555;font-size:0.68em;margin-top:16px;text-align:center;">V1 Contract: <span style="color:#888;">opt1sqq0uxr9f5e9qdswpaptpvgc8qr9thv2a4gwaj6fl</span></p>
    <div style="text-align:center;margin-top:12px;">
      <a href="https://motoswap.org" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:8px 18px;background:#f7931a;color:#000;font-weight:bold;font-size:0.85em;border-radius:4px;text-decoration:none;letter-spacing:0.05em;">&#x26A1; BUY RST ON MOTOSWAP</a>
    </div>
  </div>
</div>
<!-- Roadmap Modal -->
<div class="htp-modal-bg" id="roadmapModal">
  <div class="htp-box">
    <button class="htp-close" onclick="document.getElementById('roadmapModal').classList.remove('show')">&#x2715; CLOSE</button>
    <h1>&#x1F5FA; ROADMAP</h1>
    <div class="htp-sub">From Testnet to Mainnet &mdash; the path ahead</div>

    <div class="htp-section">
      <h3 style="color:#44cc44;">&#x2705; V1 &mdash; FOUNDATION (Live)</h3>
      <ul style="margin-top:6px;">
        <li>&#x2705; V1 OP20 Contract deployed on BTC L1 (Testnet)</li>
        <li>&#x2705; Basic earn &amp; claim system (chop trees &rarr; sell &rarr; claim RST)</li>
        <li>&#x2705; LP pool available on MotoSwap &mdash; RST tradeable</li>
        <li>&#x2705; 1% swap fee on every trade</li>
        <li>&#x2705; Difficulty system &mdash; unlock world by earning RST</li>
        <li>&#x2705; OG Rank airdrop tracking for V1 LP traders</li>
      </ul>
    </div>

    <div class="htp-section">
      <h3 style="color:#f7931a;">&#x1F504; V2 &mdash; STAKING &amp; REWARDS (Upcoming)</h3>
      <ul style="margin-top:6px;">
        <li>sRST staking contract &mdash; stake RST, receive sRST</li>
        <li>1% swap fee now split 3 ways: LP providers, Deployer, sRST stakers</li>
        <li>sRST burn/convert mechanism &mdash; grow the staking reward pool</li>
        <li>Stake 10+ RST &rarr; instantly unlock Hard Mode (skip the grind)</li>
        <li>Fishing &amp; Cooking now unlocked! Catch raw fish and sell them to the general store (or cook them for double the price &mdash; careful, don&apos;t burn ALL your food ;)</li>
        <li>Veteran Rank awarded to V2 participants</li>
      </ul>
    </div>

    <div class="htp-section">
      <h3 style="color:#f0c030;">&#x1F6A7; V3 &mdash; EXPANDED ECONOMY (Planned)</h3>
      <ul style="margin-top:6px;">
        <li>Smelting bars, Creating Runes (Runecrafting) and making potions &mdash; all tradeable for RST</li>
        <li>Farming &amp; Player Housing unlock / Beta Unlock</li>
        <li>Officer Rank milestone</li>
        <li>Deeper crafting &rarr; on-chain item economy</li>
      </ul>
    </div>

    <div class="htp-section">
      <h3 style="color:#888;">&#x1F4BC; V4 &mdash; TBD (Master Rank)</h3>
      <p style="color:#888;">Scope depends on community growth and roadmap progress. Master Rank holders shape the direction.</p>
    </div>

    <div class="htp-section" style="border-top:1px solid #2a2000;padding-top:14px;">
      <h3 style="color:#f0c030;">&#x1F3C6; MAINNET LAUNCH &mdash; THE FINAL MILESTONE</h3>
      <p>Real Bitcoin. Real RST. All ranks carried over. OG / Veteran / Officer / Master wallets recognised at launch.</p>
      <p style="margin-top:6px;color:#888;font-size:0.88em;">The grind you do on Testnet <em>counts</em>. Your wallet history is your reputation.</p>
    </div>

    <p style="color:#555;font-size:0.68em;margin-top:16px;text-align:center;">Runescape Resource Terminal &mdash; BTC L1 F2P P2E &#x26CF;</p>
  </div>
</div>
<!-- Stake Modal -->
<div class="modal-bg" id="stakeModal">
  <div class="modal-box" style="border-color:#44cc44">
    <h2 style="color:#44cc44">&#x26A1; STAKE RST</h2>
    <div style="font-size:0.78em;color:#888;margin:10px 0 6px">Lock RST to earn staking rewards &amp; unlock world access</div>
    <!-- Tier Selector -->
    <div style="margin-bottom:10px;">
      <div style="font-size:0.68em;color:#888;margin-bottom:4px">Lock Tier</div>
      <select id="stakeTierSelect" style="background:#0a1a0a;border:1px solid #44cc44;color:#44cc44;padding:6px;width:100%;font-family:monospace;font-size:0.78em;border-radius:3px;" onchange="updateStakeTierInfo()">
        <option value="0">&#x1F513; Flexible (1&#xD7; sRST, 20% exit fee)</option>
        <option value="1">&#x1F512; 30-day lock (5&#xD7; sRST, 10% exit fee)</option>
        <option value="2">&#x1F512; 90-day lock (4&#xD7; sRST, 1% exit fee)</option>
        <option value="3">&#x1F512; 180-day lock (2.5&#xD7; sRST, no exit fee)</option>
      </select>
      <div id="stakeTierHint" style="font-size:0.65em;color:#f7931a;margin-top:3px;text-align:center;">1&#xD7; multiplier &mdash; no lock &mdash; 20% early exit fee</div>
    </div>
    <div style="font-size:2.8em;color:#44cc44;margin:8px 0 2px" id="stakeDisplayAmt">10</div>
    <div style="font-size:0.68em;color:#666;margin-bottom:4px">RST to stake (min 10)</div>
    <div style="font-size:0.68em;color:#88ff88;margin-bottom:10px">&#x21D2; <span id="stakeSRSTPreview">10</span> sRST minted</div>
    <input type="number" id="stakeInput" min="10" step="1" value="10" style="background:#0a1a0a;border:1px solid #44cc44;color:#44cc44;padding:8px;width:100%;font-family:monospace;font-size:0.85em;border-radius:3px;margin-bottom:12px;text-align:center;" oninput="onStakeAmountChange()">
    <button class="sign-btn" style="background:#44cc44;color:#000" id="stakeConfirmBtn" onclick="executeStake()">&#x26A1; STAKE &amp; UNLOCK FULL WORLD</button>
    <button class="dismiss-btn" style="margin-top:6px" onclick="document.getElementById('stakeModal').classList.remove('show')">Cancel</button>
    <div id="stakeModalStatus" class="modal-status"></div>
  </div>
</div>
<!-- Unstake Modal -->
<div class="modal-bg" id="unstakeModal">
  <div class="modal-box" style="border-color:#44cc44">
    <h2 style="color:#44cc44">&#x21A9; UNSTAKE sRST</h2>
    <div style="font-size:0.78em;color:#888;margin:10px 0 6px">Burn sRST to receive RST back. World tier drops immediately.</div>
    <div style="font-size:0.72em;color:#666;margin-bottom:6px">Your sRST: <span id="unstakeSRSTBal" style="color:#88ff88">0</span></div>
    <div style="font-size:2.2em;color:#44cc44;margin:4px 0 2px" id="unstakeDisplayAmt">10</div>
    <div style="font-size:0.68em;color:#888;margin-bottom:4px">sRST to unstake</div>
    <div style="font-size:0.72em;color:#666;margin-bottom:10px">&#x2248; <span id="unstakePreviewRST">-</span> RST to receive</div>
    <input type="number" id="unstakeInput" min="0.0001" step="0.0001" value="10" style="background:#0a1a0a;border:1px solid #44cc44;color:#44cc44;padding:8px;width:100%;font-family:monospace;font-size:0.85em;border-radius:3px;margin-bottom:12px;text-align:center;" oninput="updateUnstakePreview()">
    <button class="sign-btn" style="background:#44cc44;color:#000" id="unstakeConfirmBtn" onclick="executeUnstake()">&#x21A9; UNSTAKE</button>
    <button class="dismiss-btn" style="margin-top:6px" onclick="document.getElementById('unstakeModal').classList.remove('show')">Cancel</button>
    <div id="unstakeModalStatus" class="modal-status"></div>
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
    <div id="claimTxLink" style="display:none;margin-top:8px;font-size:0.78em;color:#888;text-align:center;word-break:break-all;"></div>
    <div id="modalTimingNote" style="display:none;margin-top:10px;padding:8px;background:#0a1a0a;border:1px solid #1a4a1a;border-radius:4px;font-size:0.72em;color:#5a9a5a;line-height:1.5;">
      &#x231B; On-chain grants take <strong>1&ndash;3 min</strong> to confirm on testnet &mdash; this is normal. The Sign button unlocks automatically.
    </div>
  </div>
</div>
<script>
const RST_CONTRACT = 'opt1sqq0uxr9f5e9qdswpaptpvgc8qr9thv2a4gwaj6fl';
const RST_CONTRACT_PUBKEY = '0x8ea522eb4c95f38e9f4f9a9c4b6f4f1d9e4f7b8d2b10902dbd302779105afaf1';
// RSTStaking V2 MasterChef — deployed 2026-03-07
const STAKING_CONTRACT = 'opt1sqpnwrzsteu0q9nllckgj0kwdw33xhlj7lvf3eyq4';
const STAKING_CONTRACT_PUBKEY = '0x870445dc98bb046bb6dd1f6984174b5b2bac9c70a1259ce3f4801a992bf4fa1c';
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
let sRSTBalance = 0;       // sRST balance
let vaultRatio = 1.0;      // legacy — kept for unstake preview fallback
let pendingWithdrawalRST = 0;  // legacy — kept for old staking contract compatibility
let pendingRewardsRST = 0; // RST rewards claimable from MasterChef staking

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
  refreshOnlinePlayers();
  setInterval(refreshOnlinePlayers, 20000);
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
  // If a different wallet connects, stale approval state from the previous session is invalid
  const prevWallet = localStorage.getItem('rst_stake_wallet');
  if (prevWallet && prevWallet !== w) {
    stakePhase = 'idle';
    localStorage.removeItem('rst_stake_phase');
    localStorage.removeItem('rst_stake_wallet');
    localStorage.removeItem('rst_stake_amount');
    localStorage.removeItem('rst_stake_tier');
  }
  document.getElementById('walletStatus').textContent = w.slice(0,12) + '...' + w.slice(-6);
  document.getElementById('walletStatus').className = 'wallet-status connected';
  document.getElementById('connectSection').style.display = 'none';
  document.getElementById('statsSection').style.display = 'block';
  document.getElementById('statUser').textContent = u;
  startSSE(u);
  refreshBalance();
  refreshWalletBalances();
  checkStakeStatus();
  if (stakePhase === 'approval_pending') pollApprovalConfirmation();
  if (walletRefreshInterval) clearInterval(walletRefreshInterval);
  walletRefreshInterval = setInterval(() => { refreshBalance(); refreshWalletBalances(); checkStakeStatus(); }, 30000);
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
  window._lastRstBal = rstBal;
  var lang = localStorage.getItem('htp_lang') || 'en';
  var d = DIFF_LANGS[lang] || DIFF_LANGS['en'];
  var labelEl = document.getElementById('diffLabel');
  if (labelEl) labelEl.textContent = d.label;
  const el = document.getElementById('statDifficulty');
  const hint = document.getElementById('statDifficultyHint');
  const stakeBtn = document.getElementById('stakeBtn');
  const stakedBadge = document.getElementById('stakedBadge');
  if (!el || !hint) return;
  if (isStaked || rstBal >= 1000) {
    el.textContent = isStaked ? 'FULL ACCESS' : 'EASY MODE';
    el.style.color = '#44cc44';
    hint.textContent = isStaked ? d.full_hint : d.easy_hint;
    if (stakeBtn) stakeBtn.style.display = 'none';
    if (stakedBadge) stakedBadge.style.display = isStaked ? 'block' : 'none';
  } else if (rstBal >= 10) {
    el.textContent = 'HARD MODE';
    el.style.color = '#ff8c00';
    hint.textContent = d.hard_hint;
    if (stakeBtn) stakeBtn.style.display = 'block';
    updateStakeBtnPhase();
  } else {
    el.textContent = 'EXTREME HARDCORE IRONMAN';
    el.style.color = '#ff4444';
    hint.textContent = d.xhc_hint;
    if (stakeBtn) stakeBtn.style.display = 'none';
  }
}

let isStaked = false;
// 'idle' | 'approval_pending' | 'approval_confirmed'
let stakePhase = localStorage.getItem('rst_stake_phase') || 'idle';

function updateStakeBtnPhase() {
  const btn = document.getElementById('stakeBtn');
  if (!btn || btn.style.display === 'none') return;
  if (stakePhase === 'approval_pending') {
    btn.textContent = '\u23F3 APPROVAL WAITING...';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'default';
  } else if (stakePhase === 'approval_confirmed') {
    btn.textContent = '\u26A1 STAKE NOW \u2014 UNLOCK FULL WORLD';
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  } else {
    btn.textContent = '\u26A1 STAKE RST \u2014 UNLOCK FULL WORLD';
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
}

function getStakeTierMultiplier(tier) {
  if (tier == 1) return 50;
  if (tier == 2) return 40;
  if (tier == 3) return 25;
  return 10; // tier 0 Flexible
}

function updateStakeTierInfo() {
  var tier = parseInt(document.getElementById('stakeTierSelect').value) || 0;
  var hints = [
    '1\u00D7 multiplier \u2014 no lock \u2014 20% early exit fee',
    '5\u00D7 multiplier \u2014 30-day lock \u2014 10% early exit fee',
    '4\u00D7 multiplier \u2014 90-day lock \u2014 1% early exit fee',
    '2.5\u00D7 multiplier \u2014 180-day lock \u2014 no exit fee',
  ];
  var hintEl = document.getElementById('stakeTierHint');
  if (hintEl) hintEl.textContent = hints[tier] || hints[0];
  updateStakeInputPreview();
}

function updateStakeInputPreview() {
  var amt = parseFloat(document.getElementById('stakeInput').value) || 10;
  var tier = parseInt(document.getElementById('stakeTierSelect').value) || 0;
  var multiplier = getStakeTierMultiplier(tier);
  var sRSTOut = (amt * multiplier / 10).toFixed(2);
  document.getElementById('stakeDisplayAmt').textContent = amt;
  var previewEl = document.getElementById('stakeSRSTPreview');
  if (previewEl) previewEl.textContent = sRSTOut;
}

function onStakeAmountChange() {
  updateStakeInputPreview();
  if (stakePhase === 'approval_confirmed') {
    var savedAmt = parseFloat(localStorage.getItem('rst_stake_amount') || '') || 10;
    var newAmt = parseFloat(document.getElementById('stakeInput').value) || 10;
    if (Math.abs(newAmt - savedAmt) > 0.001) {
      stakePhase = 'idle';
      localStorage.removeItem('rst_stake_phase');
      var confirmBtn = document.getElementById('stakeConfirmBtn');
      if (confirmBtn) { confirmBtn.textContent = 'APPROVE TO STAKE'; confirmBtn.onclick = executeApprove; }
      var statusEl = document.getElementById('stakeModalStatus');
      if (statusEl) { statusEl.textContent = 'Amount changed \u2014 re-approval required'; statusEl.className = 'modal-status info'; }
      updateStakeBtnPhase();
    }
  }
}

async function refreshOnlinePlayers() {
  try {
    var res = await fetch('/rst/online-players');
    var json = await res.json();
    var players = json.players || [];
    var countEl = document.getElementById('onlineCount');
    var listEl = document.getElementById('onlineList');
    if (countEl) countEl.textContent = '(' + players.length + ')';
    if (listEl) {
      if (players.length === 0) {
        listEl.innerHTML = '<div style="color:#333;font-size:0.72em;text-align:center;padding:4px;">No players online</div>';
      } else {
        listEl.innerHTML = players.map(function(p) { return '<div class="online-row"><span class="online-dot"></span>' + p + '</div>'; }).join('');
      }
    }
  } catch (e) {}
}

function openStakeModal() {
  if (stakePhase === 'approval_pending') return; // grayed out, not clickable
  const savedAmt = parseFloat(localStorage.getItem('rst_stake_amount') || '') || 10;
  const savedTier = parseInt(localStorage.getItem('rst_stake_tier') || '') || 0;
  const isConfirmed = stakePhase === 'approval_confirmed';
  const inputVal = isConfirmed ? String(savedAmt) : '10';
  document.getElementById('stakeInput').value = inputVal;
  document.getElementById('stakeInput').disabled = false;
  const tierSel = document.getElementById('stakeTierSelect');
  if (tierSel) { tierSel.value = String(savedTier); tierSel.disabled = false; }
  const statusEl = document.getElementById('stakeModalStatus');
  statusEl.textContent = isConfirmed ? '\u2705 Approval confirmed \u2014 ready to stake!' : '';
  statusEl.className = isConfirmed ? 'modal-status success' : 'modal-status';
  const confirmBtn = document.getElementById('stakeConfirmBtn');
  confirmBtn.disabled = false;
  confirmBtn.textContent = isConfirmed ? '\u26A1 STAKE NOW' : 'APPROVE TO STAKE';
  confirmBtn.onclick = isConfirmed ? executeStakeNow : executeApprove;
  updateStakeTierInfo();
  document.getElementById('stakeModal').classList.add('show');
}

async function pollApprovalConfirmation() {
  while (stakePhase === 'approval_pending') {
    await new Promise(r => setTimeout(r, 5000));
    if (stakePhase !== 'approval_pending') break;
    try {
      const walletAddr = wallet || localStorage.getItem('rst_stake_wallet');
      if (!walletAddr) continue;
      const res = await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_getUTXOs', params: [walletAddr, true] }) });
      const json = await res.json();
      const pending = (json?.result?.pending || []).length;
      if (pending === 0) {
        stakePhase = 'approval_confirmed';
        localStorage.setItem('rst_stake_phase', 'approval_confirmed');
        updateStakeBtnPhase();
        break;
      }
    } catch {}
  }
}
// Start polling on page load if a previous session left approval pending
if (stakePhase === 'approval_pending') setTimeout(pollApprovalConfirmation, 1000);

function _stakeHelpers(fromWallet, web3) {
  const network = { messagePrefix: '\\x18Bitcoin Signed Message:\\n', bech32: 'opt', bech32Opnet: 'opt', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
  async function getUtxos(addr) {
    const res = await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_getUTXOs', params: [addr, true] }) });
    const j = await res.json(); const r = j.result || {}; const rawTxs = Array.isArray(r.raw) ? r.raw : [];
    return [...(r.confirmed || []), ...(r.pending || [])].map(u => {
      const rawTx = typeof u.raw === 'number' ? rawTxs[u.raw] : (typeof u.raw === 'string' ? u.raw : undefined);
      const obj = { transactionId: u.transactionId, outputIndex: u.outputIndex, value: typeof u.value === 'bigint' ? u.value : BigInt(u.value || 0), scriptPubKey: u.scriptPubKey };
      if (rawTx) { obj.nonWitnessUtxoBase64 = rawTx; try { const bin = atob(rawTx); const b = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i); obj.nonWitnessUtxo = b; } catch {} }
      return obj;
    });
  }
  async function broadcastTx(label, hex) {
    if (!hex) throw new Error(label + ': missing TX data');
    const res = await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [hex, false] }) });
    const json = await res.json();
    console.log('[stake]', label, '\u2192', JSON.stringify(json));
    if (json.error) throw new Error(label + ' broadcast failed: ' + JSON.stringify(json.error));
    return json.result;
  }
  async function signAndSend(to, contractPubkey, calldata) {
    const utxos = await getUtxos(fromWallet);
    if (!utxos.length) throw new Error('No UTXOs found \u2014 fund your wallet');
    const params = { to, contract: contractPubkey, calldata, from: fromWallet, utxos, feeRate: 10, priorityFee: 0n, gasSatFee: 20000n, network, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: false };
    if (typeof web3.signInteraction === 'function') {
      const signed = await web3.signInteraction(params);
      if (signed && signed.error) throw new Error('signInteraction error: ' + JSON.stringify(signed.error));
      if (!signed || !signed.interactionTransaction) throw new Error('signInteraction returned no transaction');
      if (signed.fundingTransaction) await broadcastTx('fundingTx', signed.fundingTransaction);
      await broadcastTx('interactionTx', signed.interactionTransaction);
    } else { await web3.signAndBroadcastInteraction(params); }
  }
  return { signAndSend };
}

async function executeApprove() {
  const btn = document.getElementById('stakeConfirmBtn');
  const statusEl = document.getElementById('stakeModalStatus');
  const amount = parseFloat(document.getElementById('stakeInput').value) || 10;
  const tierIndex = parseInt(document.getElementById('stakeTierSelect').value) || 0;
  if (amount < 10) { statusEl.className = 'modal-status error'; statusEl.textContent = 'Minimum stake is 10 RST'; return; }
  btn.disabled = true;
  const setStatus = (msg, type) => { statusEl.className = 'modal-status ' + type; statusEl.textContent = msg; };
  try {
    const provider = window.opnet || window.unisat;
    if (!provider) { setStatus('OP_WALLET not found', 'error'); btn.disabled = false; return; }
    const accounts = await provider.requestAccounts();
    const fromWallet = accounts[0];
    const web3 = window.opnet?.web3;
    if (!web3) { setStatus('OP_WALLET web3 not found', 'error'); btn.disabled = false; return; }
    const { signAndSend } = _stakeHelpers(fromWallet, web3);
    const amountWei = BigInt(Math.floor(amount)) * (10n ** 18n);
    const amtHex = amountWei.toString(16).padStart(64, '0');
    const stakingPubkeyHex = STAKING_CONTRACT_PUBKEY.startsWith('0x') ? STAKING_CONTRACT_PUBKEY.slice(2) : STAKING_CONTRACT_PUBKEY;
    // increaseAllowance(address,uint256) = 0x8d645723
    const approveCalldata = hexToBytes('8d645723' + stakingPubkeyHex.padStart(64, '0') + amtHex);
    btn.textContent = 'APPROVING... CHECK OP_WALLET';
    setStatus('Approve RST spend \u2014 check OP_WALLET...', 'info');
    await signAndSend(RST_CONTRACT, RST_CONTRACT_PUBKEY, approveCalldata);
    localStorage.setItem('rst_stake_amount', String(amount));
    localStorage.setItem('rst_stake_tier', String(tierIndex));
    localStorage.setItem('rst_stake_wallet', fromWallet);
    stakePhase = 'approval_pending';
    localStorage.setItem('rst_stake_phase', 'approval_pending');
    updateStakeBtnPhase();
    setStatus('\u2705 Approval sent! Close this window \u2014 sidebar will update when confirmed.', 'success');
    setTimeout(() => { document.getElementById('stakeModal').classList.remove('show'); }, 3000);
    pollApprovalConfirmation();
  } catch(e) {
    setStatus('Error: ' + (e.message || String(e)), 'error');
    btn.disabled = false; btn.textContent = 'APPROVE TO STAKE'; btn.onclick = executeApprove;
  }
}

async function executeStakeNow() {
  const btn = document.getElementById('stakeConfirmBtn');
  const statusEl = document.getElementById('stakeModalStatus');
  const amount = parseFloat(localStorage.getItem('rst_stake_amount') || '') || 10;
  const tierIndex = parseInt(localStorage.getItem('rst_stake_tier') || '') || 0;
  btn.disabled = true;
  const setStatus = (msg, type) => { statusEl.className = 'modal-status ' + type; statusEl.textContent = msg; };
  try {
    const provider = window.opnet || window.unisat;
    if (!provider) { setStatus('OP_WALLET not found', 'error'); btn.disabled = false; return; }
    const accounts = await provider.requestAccounts();
    const fromWallet = accounts[0];
    const web3 = window.opnet?.web3;
    if (!web3) { setStatus('OP_WALLET web3 not found', 'error'); btn.disabled = false; return; }
    const { signAndSend } = _stakeHelpers(fromWallet, web3);
    const amountWei = BigInt(Math.floor(amount)) * (10n ** 18n);
    const amtHex = amountWei.toString(16).padStart(64, '0');
    // tierIndex encoded as uint32 = 4 bytes big-endian (readU32 reads 4 bytes, not 32)
    const tierHex = tierIndex.toString(16).padStart(8, '0');
    // stake(uint256,uint32) = 0x00beb73f
    const stakeCalldata = hexToBytes('00beb73f' + amtHex + tierHex);
    btn.textContent = 'STAKING... CHECK OP_WALLET';
    setStatus('Staking RST \u2014 check OP_WALLET...', 'info');
    await signAndSend(STAKING_CONTRACT, STAKING_CONTRACT_PUBKEY, stakeCalldata);
    await fetch('/rst/stake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, amount }) });
    stakePhase = 'idle';
    localStorage.removeItem('rst_stake_phase');
    localStorage.removeItem('rst_stake_amount');
    localStorage.removeItem('rst_stake_tier');
    isStaked = true;
    setStatus('\u2705 Staked! Full world unlocked.', 'success');
    document.getElementById('stakeBtn').style.display = 'none';
    document.getElementById('stakedBadge').style.display = 'block';
    document.getElementById('statDifficulty').textContent = 'FULL ACCESS';
    document.getElementById('statDifficulty').style.color = '#44cc44';
    var _sd = DIFF_LANGS[localStorage.getItem('htp_lang')||'en'] || DIFF_LANGS['en'];
    document.getElementById('statDifficultyHint').textContent = _sd.full_hint;
    setTimeout(() => { document.getElementById('stakeModal').classList.remove('show'); }, 3000);
  } catch(e) {
    setStatus('Error: ' + (e.message || String(e)), 'error');
    btn.disabled = false; btn.textContent = '\u26A1 STAKE NOW'; btn.onclick = executeStakeNow;
  }
}

function decodeU256Hex(raw) {
  if (!raw || typeof raw !== 'string') return '';
  if (raw.startsWith('0x')) return raw.slice(2);
  if (/^[0-9a-fA-F]+$/.test(raw)) return raw;
  try { const b = atob(raw); return Array.from(b).map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join(''); } catch { return ''; }
}

async function checkStakeStatus() {
  if (!mldsaHash) return;
  try {
    // sRST balance = balanceOf(address) = 0x5b46f8f6 on staking contract
    const balCalldata = '5b46f8f6' + mldsaHash.padStart(64, '0');
    const balResult = await opnetRpc('btc_call', [STAKING_CONTRACT, balCalldata, null, null]);
    const balRaw = typeof balResult === 'string' ? balResult : (balResult?.result ?? balResult?.data ?? '');
    const balHex = decodeU256Hex(balRaw);
    const sRSTWei = balHex.length >= 64 ? BigInt('0x' + balHex.slice(0, 64)) : 0n;
    sRSTBalance = Number(sRSTWei) / 1e18;

    // Update sidebar sRST display
    const srstEl = document.getElementById('statSRSTBal');
    if (srstEl) srstEl.textContent = sRSTBalance > 0 ? sRSTBalance.toFixed(4) + ' sRST' : '0 sRST';

    isStaked = sRSTBalance >= 10;

    // Update stake/unstake button visibility
    const stakeBtn = document.getElementById('stakeBtn');
    const stakedBadge = document.getElementById('stakedBadge');
    const unstakeBtn = document.getElementById('unstakeBtn');
    if (isStaked) {
      if (stakeBtn) stakeBtn.style.display = 'none';
      if (stakedBadge) stakedBadge.style.display = 'block';
      if (unstakeBtn) unstakeBtn.style.display = 'block';
    } else {
      if (stakedBadge) stakedBadge.style.display = 'none';
      if (unstakeBtn) unstakeBtn.style.display = 'none';
      updateDifficultyDisplay(window._lastRstBal !== undefined ? window._lastRstBal : 0);
    }

    // Fetch pending rewards — pendingRewards(address) = 0x52b85684
    try {
      const rewardsCalldata = '52b85684' + mldsaHash.padStart(64, '0');
      const rewardsResult = await opnetRpc('btc_call', [STAKING_CONTRACT, rewardsCalldata, null, null]);
      const rewardsRaw = typeof rewardsResult === 'string' ? rewardsResult : (rewardsResult?.result ?? rewardsResult?.data ?? '');
      const rewardsHex = decodeU256Hex(rewardsRaw);
      const rewardsWei = rewardsHex.length >= 64 ? BigInt('0x' + rewardsHex.slice(0, 64)) : 0n;
      pendingRewardsRST = Number(rewardsWei) / 1e18;
      const rewardsEl = document.getElementById('statPendingRewards');
      if (rewardsEl) rewardsEl.textContent = pendingRewardsRST > 0 ? pendingRewardsRST.toFixed(6) + ' RST' : '0 RST';
      const claimRewardsBtn = document.getElementById('claimRewardsBtn');
      if (claimRewardsBtn) claimRewardsBtn.style.display = (sRSTBalance > 0 && pendingRewardsRST > 0.000001) ? 'block' : 'none';
    } catch {}

    // Legacy: check pending withdrawal from old staking contract (no-op on V2)
    await checkPendingWithdrawal();
  } catch {}
}

async function checkPendingWithdrawal() {
  if (!mldsaHash) return;
  try {
    // pendingWithdrawal(address) = 0x1636b7ca
    const calldata = '1636b7ca' + mldsaHash.padStart(64, '0');
    const result = await opnetRpc('btc_call', [STAKING_CONTRACT, calldata, null, null]);
    const raw = typeof result === 'string' ? result : (result?.result ?? result?.data ?? '');
    const hexStr = decodeU256Hex(raw);
    const pendingWei = hexStr.length >= 64 ? BigInt('0x' + hexStr.slice(0, 64)) : 0n;
    pendingWithdrawalRST = Number(pendingWei) / 1e18;
    const withdrawBtn = document.getElementById('withdrawBtn');
    if (withdrawBtn) withdrawBtn.style.display = pendingWithdrawalRST > 0 ? 'block' : 'none';
    if (pendingWithdrawalRST > 0 && withdrawBtn) {
      withdrawBtn.textContent = '\u2B07 WITHDRAW ' + pendingWithdrawalRST.toFixed(4) + ' RST';
    }
  } catch {}
}

function openUnstakeModal() {
  const srstEl = document.getElementById('unstakeSRSTBal');
  if (srstEl) srstEl.textContent = sRSTBalance.toFixed(4);
  const input = document.getElementById('unstakeInput');
  if (input) { input.value = Math.min(sRSTBalance, 10).toFixed(4); input.max = sRSTBalance; }
  document.getElementById('unstakeDisplayAmt').textContent = input ? input.value : '10';
  document.getElementById('unstakeModalStatus').textContent = '';
  document.getElementById('unstakeConfirmBtn').disabled = false;
  updateUnstakePreview();
  document.getElementById('unstakeModal').classList.add('show');
}

function updateUnstakePreview() {
  const amt = parseFloat(document.getElementById('unstakeInput').value) || 0;
  document.getElementById('unstakeDisplayAmt').textContent = amt.toFixed(4);
  const rstOut = amt * vaultRatio;
  document.getElementById('unstakePreviewRST').textContent = rstOut.toFixed(4);
}

async function executeUnstake() {
  const btn = document.getElementById('unstakeConfirmBtn');
  const statusEl = document.getElementById('unstakeModalStatus');
  const setStatus = (msg, type) => { statusEl.className = 'modal-status ' + type; statusEl.textContent = msg; };
  const amount = parseFloat(document.getElementById('unstakeInput').value) || 0;
  if (amount <= 0 || amount > sRSTBalance) { setStatus('Invalid amount', 'error'); return; }
  btn.disabled = true;

  try {
    const provider = window.opnet || window.unisat;
    if (!provider) throw new Error('OP_WALLET not found');
    const accounts = await provider.requestAccounts();
    const fromWallet = accounts[0];
    const web3 = window.opnet?.web3;
    if (!web3) throw new Error('OP_WALLET web3 not found');

    const amountWei = BigInt(Math.round(amount * 1e18));
    const amtHex = amountWei.toString(16).padStart(64, '0');
    const network = { messagePrefix: '\\x18Bitcoin Signed Message:\\n', bech32: 'opt', bech32Opnet: 'opt', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };

    async function getUtxos(addr) {
      const res = await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_getUTXOs', params: [addr, true] }) });
      const j = await res.json(); const r = j.result || {}; const rawTxs = Array.isArray(r.raw) ? r.raw : [];
      return [...(r.confirmed || []), ...(r.pending || [])].map(u => {
        const rawTx = typeof u.raw === 'number' ? rawTxs[u.raw] : (typeof u.raw === 'string' ? u.raw : undefined);
        const obj = { transactionId: u.transactionId, outputIndex: u.outputIndex, value: typeof u.value === 'bigint' ? u.value : BigInt(u.value || 0), scriptPubKey: u.scriptPubKey };
        if (rawTx) { obj.nonWitnessUtxoBase64 = rawTx; try { const bin = atob(rawTx); const b = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i); obj.nonWitnessUtxo = b; } catch {} }
        return obj;
      });
    }

    const utxos = await getUtxos(fromWallet);
    if (!utxos.length) throw new Error('No UTXOs found');
    // unstake(uint256) = 0x5e445065
    const calldata = hexToBytes('5e445065' + amtHex);
    const params = { to: STAKING_CONTRACT, contract: STAKING_CONTRACT_PUBKEY, calldata, from: fromWallet, utxos, feeRate: 10, priorityFee: 0n, gasSatFee: 20000n, network, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: false };
    if (typeof web3.signInteraction === 'function') {
      const signed = await web3.signInteraction(params);
      if (signed.fundingTransaction) await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [signed.fundingTransaction, false] }) });
      await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [signed.interactionTransaction, false] }) });
    } else { await web3.signAndBroadcastInteraction(params); }

    isStaked = false;
    sRSTBalance = Math.max(0, sRSTBalance - amount);
    setStatus('\u23F3 Unstaked! Timelock: 1 block. Withdraw button will appear shortly.', 'success');
    document.getElementById('stakeBtn').style.display = 'none';
    document.getElementById('stakedBadge').style.display = 'none';
    document.getElementById('unstakeBtn').style.display = 'none';
    const srstEl = document.getElementById('statSRSTBal');
    if (srstEl) srstEl.textContent = sRSTBalance.toFixed(4) + ' sRST';
    setTimeout(() => { document.getElementById('unstakeModal').classList.remove('show'); checkStakeStatus(); }, 4000);
  } catch(e) {
    setStatus('Error: ' + (e.message || String(e)), 'error');
    btn.disabled = false;
  }
}

async function executeWithdraw() {
  const btn = document.getElementById('withdrawBtn');
  btn.disabled = true;
  btn.textContent = '\u23F3 Withdrawing...';
  try {
    const provider = window.opnet || window.unisat;
    if (!provider) throw new Error('OP_WALLET not found');
    const accounts = await provider.requestAccounts();
    const fromWallet = accounts[0];
    const web3 = window.opnet?.web3;
    if (!web3) throw new Error('OP_WALLET web3 not found');
    const network = { messagePrefix: '\\x18Bitcoin Signed Message:\\n', bech32: 'opt', bech32Opnet: 'opt', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };

    async function getUtxos(addr) {
      const res = await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_getUTXOs', params: [addr, true] }) });
      const j = await res.json(); const r = j.result || {}; const rawTxs = Array.isArray(r.raw) ? r.raw : [];
      return [...(r.confirmed || []), ...(r.pending || [])].map(u => {
        const rawTx = typeof u.raw === 'number' ? rawTxs[u.raw] : (typeof u.raw === 'string' ? u.raw : undefined);
        const obj = { transactionId: u.transactionId, outputIndex: u.outputIndex, value: typeof u.value === 'bigint' ? u.value : BigInt(u.value || 0), scriptPubKey: u.scriptPubKey };
        if (rawTx) { obj.nonWitnessUtxoBase64 = rawTx; try { const bin = atob(rawTx); const b = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i); obj.nonWitnessUtxo = b; } catch {} }
        return obj;
      });
    }

    const utxos = await getUtxos(fromWallet);
    if (!utxos.length) throw new Error('No UTXOs found');
    // withdraw() = 0xdfea82f3
    const calldata = hexToBytes('dfea82f3');
    const params = { to: STAKING_CONTRACT, contract: STAKING_CONTRACT_PUBKEY, calldata, from: fromWallet, utxos, feeRate: 10, priorityFee: 0n, gasSatFee: 20000n, network, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: false };
    if (typeof web3.signInteraction === 'function') {
      const signed = await web3.signInteraction(params);
      if (signed.fundingTransaction) await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [signed.fundingTransaction, false] }) });
      await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [signed.interactionTransaction, false] }) });
    } else { await web3.signAndBroadcastInteraction(params); }

    pendingWithdrawalRST = 0;
    btn.style.display = 'none';
    btn.disabled = false;
    setTimeout(() => refreshBalance(), 3000);
  } catch(e) {
    btn.textContent = '\u2B07 WITHDRAW RST';
    btn.disabled = false;
    console.error('Withdraw failed:', e.message || String(e));
  }
}

async function executeClaimRewards() {
  const btn = document.getElementById('claimRewardsBtn');
  btn.disabled = true;
  btn.textContent = '\u23F3 Claiming...';
  try {
    const provider = window.opnet || window.unisat;
    if (!provider) throw new Error('OP_WALLET not found');
    const accounts = await provider.requestAccounts();
    const fromWallet = accounts[0];
    const web3 = window.opnet?.web3;
    if (!web3) throw new Error('OP_WALLET web3 not found');
    const network = { messagePrefix: '\\x18Bitcoin Signed Message:\\n', bech32: 'opt', bech32Opnet: 'opt', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
    async function getUtxos(addr) {
      const res = await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_getUTXOs', params: [addr, true] }) });
      const j = await res.json(); const r = j.result || {}; const rawTxs = Array.isArray(r.raw) ? r.raw : [];
      return [...(r.confirmed || []), ...(r.pending || [])].map(u => {
        const rawTx = typeof u.raw === 'number' ? rawTxs[u.raw] : (typeof u.raw === 'string' ? u.raw : undefined);
        const obj = { transactionId: u.transactionId, outputIndex: u.outputIndex, value: typeof u.value === 'bigint' ? u.value : BigInt(u.value || 0), scriptPubKey: u.scriptPubKey };
        if (rawTx) { obj.nonWitnessUtxoBase64 = rawTx; try { const bin = atob(rawTx); const b = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i); obj.nonWitnessUtxo = b; } catch {} }
        return obj;
      });
    }
    const utxos = await getUtxos(fromWallet);
    if (!utxos.length) throw new Error('No UTXOs found');
    // claimRewards() = 0xc06cbdf1
    const calldata = hexToBytes('c06cbdf1');
    const params = { to: STAKING_CONTRACT, contract: STAKING_CONTRACT_PUBKEY, calldata, from: fromWallet, utxos, feeRate: 10, priorityFee: 0n, gasSatFee: 20000n, network, linkMLDSAPublicKeyToAddress: true, revealMLDSAPublicKey: false };
    if (typeof web3.signInteraction === 'function') {
      const signed = await web3.signInteraction(params);
      if (signed.fundingTransaction) await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [signed.fundingTransaction, false] }) });
      await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [signed.interactionTransaction, false] }) });
    } else { await web3.signAndBroadcastInteraction(params); }
    pendingRewardsRST = 0;
    btn.textContent = '\u2705 Claimed!';
    btn.style.display = 'none';
    const rewardsEl = document.getElementById('statPendingRewards');
    if (rewardsEl) rewardsEl.textContent = '0 RST';
    setTimeout(() => refreshBalance(), 4000);
  } catch(e) {
    btn.textContent = '\uD83D\uDCB0 CLAIM REWARDS';
    btn.disabled = false;
    console.error('Claim rewards failed:', e.message || String(e));
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
  const txLinkEl = document.getElementById('claimTxLink');
  if (txLinkEl) { txLinkEl.style.display = 'none'; txLinkEl.innerHTML = ''; }
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
    let claimTxid = null;
    if (typeof web3.signAndBroadcastInteraction === 'function') {
      const res = await web3.signAndBroadcastInteraction(params);
      console.log('[RST] signAndBroadcastInteraction result:', res);
      claimTxid = res?.txid || res?.transactionId || res?.result || null;
    } else {
      const signed = await web3.signInteraction(params);
      console.log('[RST] signInteraction result:', signed);
      if (signed.fundingTransaction) await broadcastOpnet(signed.fundingTransaction);
      const broadcastRes = await broadcastOpnet(signed.interactionTransaction);
      claimTxid = broadcastRes?.result || null;
    }
    await fetch('/rst/confirm-claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, wallet, gpAmount: d.gpAmount })
    });
    if (claimPollInterval) { clearInterval(claimPollInterval); claimPollInterval = null; }
    mintState = 'idle';
    lastMintTime = Date.now();
    setModalStatus('SUCCESS! ' + (d.rstAmount || 0).toFixed(4) + ' RST claimed!', 'success');
    const txLinkEl = document.getElementById('claimTxLink');
    if (txLinkEl && claimTxid) {
      txLinkEl.innerHTML = 'TX: <a href="https://testnet.opnet.org/tx/' + claimTxid + '" target="_blank" style="color:#44cc44;text-decoration:underline;">' + claimTxid.slice(0, 20) + '...</a>';
      txLinkEl.style.display = 'block';
    }
    mintData = null;
    document.getElementById('signBtn').textContent = 'CLAIMED!';
    const claimBtnDone = document.getElementById('claimBtn');
    if (claimBtnDone) { claimBtnDone.textContent = 'CLAIM RST'; claimBtnDone.disabled = true; }
    setTimeout(() => { dismissModal(); refreshBalance(); refreshWalletBalances(); fetchLeaderboard(); }, 8000);
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

// ─── HTP Language System ──────────────────────────────────────────────────────
var DIFF_LANGS = {
  en: { label:'Difficulty', xhc_hint:'No player trading \u2014 earn 10 RST to unlock', hard_hint:'10,000 GP trade cap \u2014 stake to unlock full world', easy_hint:'Full world \u2014 unlimited trading', full_hint:'Staked \u2014 full world unlocked' },
  es: { label:'Dificultad', xhc_hint:'Sin comercio \u2014 gana 10 RST para desbloquear', hard_hint:'L\xEDmite 10,000 GP \u2014 apuesta para desbloquear', easy_hint:'Mundo completo \u2014 comercio ilimitado', full_hint:'Apostado \u2014 mundo completo desbloqueado' },
  fr: { label:'Difficult\xE9', xhc_hint:'Pas d\u2019\xE9change \u2014 gagnez 10 RST pour d\xE9bloquer', hard_hint:'Plafond 10 000 PO \u2014 misez pour d\xE9bloquer', easy_hint:'Monde entier \u2014 commerce illimit\xE9', full_hint:'Mis\xE9 \u2014 monde entier d\xE9bloqu\xE9' },
  zh: { label:'\u96BE\u5EA6', xhc_hint:'\u65E0\u6CD5\u4EA4\u6613 \u2014 \u83B7\u5F9710 RST\u89E3\u9501', hard_hint:'1\u4E07GP\u4EA4\u6613\u4E0A\u9650 \u2014 \u8D28\u62BC\u89E3\u9501\u5168\u56FE', easy_hint:'\u5168\u5730\u56FE \u2014 \u65E0\u9650\u5236\u4EA4\u6613', full_hint:'\u5DF2\u8D28\u62BC \u2014 \u5168\u5730\u56FE\u89E3\u9501' },
  de: { label:'Schwierigkeit', xhc_hint:'Kein Handel \u2014 10 RST verdienen zum Freischalten', hard_hint:'10.000 GP Limit \u2014 staken f\xFCr volle Welt', easy_hint:'Volle Welt \u2014 unbegrenzter Handel', full_hint:'Gestakt \u2014 volle Welt freigeschaltet' },
  fa: { label:'\u0633\u062E\u062A\u06CC', xhc_hint:'\u0628\u062F\u0648\u0646 \u062A\u062C\u0627\u0631\u062A \u2014 10 RST \u06A9\u0633\u0628 \u06A9\u0646\u06CC\u062F', hard_hint:'\u0633\u0642\u0641 10,000 GP \u2014 \u0634\u0631\u0637\u200C\u0628\u0646\u062F\u06CC \u0628\u0631\u0627\u06CC \u0628\u0627\u0632\u06A9\u0631\u062F\u0646', easy_hint:'\u062F\u0633\u062A\u0631\u0633\u06CC \u06A9\u0627\u0645\u0644 \u2014 \u062A\u062C\u0627\u0631\u062A \u0622\u0632\u0627\u062F', full_hint:'\u0634\u0631\u0637\u200C\u0628\u0646\u062F\u06CC \u0634\u062F\u0647 \u2014 \u062F\u0633\u062A\u0631\u0633\u06CC \u06A9\u0627\u0645\u0644' },
  pt: { label:'Dificuldade', xhc_hint:'Sem com\xE9rcio \u2014 ganhe 10 RST para desbloquear', hard_hint:'Limite 10.000 PO \u2014 aposte para desbloquear', easy_hint:'Mundo completo \u2014 com\xE9rcio ilimitado', full_hint:'Apostado \u2014 mundo completo desbloqueado' },
  ja: { label:'\u96E3\u6613\u5EA6', xhc_hint:'\u53D6\u5F15\u4E0D\u53EF \u2014 RST 10\u679A\u3067\u89E3\u653E', hard_hint:'GP\u4E0A\u9650 1\u4E07 \u2014 \u30B9\u30C6\u30FC\u30AF\u3067\u5168\u30DE\u30C3\u30D7\u89E3\u653E', easy_hint:'\u5168\u30DE\u30C3\u30D7 \u2014 \u5236\u9650\u306A\u3057\u53D6\u5F15', full_hint:'\u30B9\u30C6\u30FC\u30AF\u6E08 \u2014 \u5168\u30DE\u30C3\u30D7\u89E3\u653E' },
};

var HTP_LANGS = {
  en: {
    dir: 'ltr',
    title: '&#x26CF; RST &mdash; Runescape Resource Terminal',
    sub: 'How to Play',
    req_title: 'BEFORE YOU START &mdash; Requirements',
    req_1: 'OP_WALLET browser extension installed',
    req_2: 'Testnet BTC (tBTC) in your wallet &mdash; get it free at <strong style="color:#44cc44">faucet.opnet.org</strong>',
    import_title: 'IMPORT THE RST TOKEN INTO OP_WALLET',
    import_p: 'Open OP_WALLET &rarr; Tokens &rarr; Import Token &rarr; paste this address:',
    steps_title: 'STEPS',
    s1_label: 'Go to the game', s1_body: 'You&#39;re already here!',
    s2_label: 'Enter a username &amp; connect', s2_body: 'On the right sidebar, type your desired username into the box, then click CONNECT OP_WALLET. It will silently sync your wallet to that username &mdash; no popup needed.',
    s3_label: 'Create your in-game account', s3_body: 'In the game client, enter that same username and choose a password. That password is permanent &mdash; it locks your account forever.',
    s_info: 'Forgot your password or username? You can always create a new account with the same wallet address.',
    s4_label: 'Chop some trees', s4_body: 'Walk to the trees near spawn and click one. Chop until you have 2&ndash;3 logs.',
    s5_label: 'Sell at the General Store', s5_body: 'Walk to the nearby General Store NPC and click them. Your logs convert to GP automatically.',
    s6_label: 'Sign &amp; Mint RST', s6_body: 'A mint button appears in the sidebar. Click SIGN &amp; CLAIM WITH OP_WALLET, approve in OP_WALLET. RST lands in your wallet on Bitcoin L1.',
    rates_title: 'CONVERSION RATES',
    footer: 'The more you play, the more you mint. Keep chopping. &#x1F333;&#x26CF;&#xFE0F;',
  },
  es: {
    dir: 'ltr',
    title: '&#x26CF; RST &mdash; Terminal de Recursos de RuneScape',
    sub: 'C&#xF3;mo Jugar',
    req_title: 'ANTES DE EMPEZAR &mdash; Requisitos',
    req_1: 'Extensi&#xF3;n OP_WALLET instalada en el navegador',
    req_2: 'BTC de testnet (tBTC) en tu billetera &mdash; cons&#xED;guelo gratis en <strong style="color:#44cc44">faucet.opnet.org</strong>',
    import_title: 'IMPORTAR EL TOKEN RST EN OP_WALLET',
    import_p: 'Abre OP_WALLET &rarr; Tokens &rarr; Importar Token &rarr; pega esta direcci&#xF3;n:',
    steps_title: 'PASOS',
    s1_label: 'Ve al juego', s1_body: '&#xA1;Ya est&#xE1;s aqu&#xED;!',
    s2_label: 'Ingresa un usuario y con&#xE9;ctate', s2_body: 'En la barra lateral derecha, escribe tu nombre de usuario y haz clic en CONECTAR OP_WALLET. Sincronizar&#xE1; tu billetera silenciosamente &mdash; sin ventanas emergentes.',
    s3_label: 'Crea tu cuenta en el juego', s3_body: 'En el cliente, ingresa ese mismo usuario y elige una contrase&#xF1;a. Es permanente &mdash; bloquea tu cuenta para siempre.',
    s_info: '&#xBF;Olvidaste tu contrase&#xF1;a o usuario? Siempre puedes crear una nueva cuenta con la misma direcci&#xF3;n de billetera.',
    s4_label: 'Corta algunos &#xE1;rboles', s4_body: 'Camina hacia los &#xE1;rboles cerca del inicio y haz clic en uno. Corta hasta tener 2&ndash;3 troncos.',
    s5_label: 'Vende en la Tienda General', s5_body: 'Habla con el NPC de la Tienda General cercana. Tus troncos se convierten en GP autom&#xE1;ticamente.',
    s6_label: 'Firma y acu&#xF1;a RST', s6_body: 'Aparece un bot&#xF3;n de acu&#xF1;ar en la barra lateral. Haz clic en FIRMAR Y RECLAMAR CON OP_WALLET. RST llega a tu billetera en Bitcoin L1.',
    rates_title: 'TASAS DE CONVERSI&#xD3;N',
    footer: 'Cuanto m&#xE1;s juegas, m&#xE1;s acu&#xF1;as. &#xA1;Sigue cortando! &#x1F333;&#x26CF;&#xFE0F;',
  },
  fr: {
    dir: 'ltr',
    title: '&#x26CF; RST &mdash; Terminal de Ressources RuneScape',
    sub: 'Comment Jouer',
    req_title: 'AVANT DE COMMENCER &mdash; Pr&#xE9;requis',
    req_1: 'Extension OP_WALLET install&#xE9;e dans le navigateur',
    req_2: 'BTC testnet (tBTC) dans votre portefeuille &mdash; obtenez-le gratuitement sur <strong style="color:#44cc44">faucet.opnet.org</strong>',
    import_title: 'IMPORTER LE TOKEN RST DANS OP_WALLET',
    import_p: 'Ouvrez OP_WALLET &rarr; Tokens &rarr; Importer un Token &rarr; collez cette adresse :',
    steps_title: '&#xC9;TAPES',
    s1_label: 'Aller au jeu', s1_body: 'Vous &#xEA;tes d&#xE9;j&#xE0; l&#xE0; !',
    s2_label: 'Entrez un nom et connectez-vous', s2_body: 'Dans la barre lat&#xE9;rale droite, tapez votre nom d&#39;utilisateur, puis cliquez sur CONNECTER OP_WALLET. Votre portefeuille sera synchronis&#xE9; silencieusement.',
    s3_label: 'Cr&#xE9;ez votre compte en jeu', s3_body: 'Dans le client, entrez ce m&#xEA;me nom et choisissez un mot de passe. Il est permanent &mdash; il verrouille votre compte pour toujours.',
    s_info: 'Mot de passe ou nom oubli&#xE9; ? Vous pouvez toujours cr&#xE9;er un nouveau compte avec la m&#xEA;me adresse de portefeuille.',
    s4_label: 'Coupez des arbres', s4_body: 'Marchez vers les arbres pr&#xE8;s du point de d&#xE9;part et cliquez sur un. Coupez jusqu&#39;&#xE0; avoir 2&ndash;3 b&#xFB;ches.',
    s5_label: 'Vendez au Magasin G&#xE9;n&#xE9;ral', s5_body: 'Parlez au PNJ du Magasin G&#xE9;n&#xE9;ral. Vos b&#xFB;ches se convertissent en PO automatiquement.',
    s6_label: 'Signez et cr&#xE9;ez des RST', s6_body: 'Un bouton de cr&#xE9;ation appara&#xEE;t dans la barre lat&#xE9;rale. Cliquez sur SIGNER ET R&#xC9;CLAMER AVEC OP_WALLET. RST arrive dans votre portefeuille sur Bitcoin L1.',
    rates_title: 'TAUX DE CONVERSION',
    footer: 'Plus vous jouez, plus vous cr&#xE9;ez. Continuez &#xE0; couper ! &#x1F333;&#x26CF;&#xFE0F;',
  },
  zh: {
    dir: 'ltr',
    title: '&#x26CF; RST &mdash; &#x7B26;&#x6587;&#x8D44;&#x6E90;&#x7EC8;&#x7AEF;',
    sub: '&#x5982;&#x4F55;&#x6E38;&#x73A9;',
    req_title: '&#x5F00;&#x59CB;&#x4E4B;&#x524D; &mdash; &#x5FC5;&#x8981;&#x6761;&#x4EF6;',
    req_1: '&#x5DF2;&#x5B89;&#x88C5; OP_WALLET &#x6D4F;&#x89C8;&#x5668;&#x6269;&#x5C55;',
    req_2: '&#x9322;&#x5305;&#x4E2D;&#x9700;&#x6709;&#x6D4B;&#x8BD5;&#x7F51; BTC&#xFF08;tBTC&#xFF09;&mdash;&#x5728; <strong style="color:#44cc44">faucet.opnet.org</strong> &#x514D;&#x8D39;&#x83B7;&#x53D6;',
    import_title: '&#x5C06; RST &#x4EE3;&#x5E01;&#x5BFC;&#x5165; OP_WALLET',
    import_p: '&#x6253;&#x5F00; OP_WALLET &rarr; &#x4EE3;&#x5E01; &rarr; &#x5BFC;&#x5165;&#x4EE3;&#x5E01; &rarr; &#x7C98;&#x8D34;&#x6B64;&#x5730;&#x5740;&#xFF1A;',
    steps_title: '&#x6B65;&#x9AA4;',
    s1_label: '&#x8FDB;&#x5165;&#x6E38;&#x620F;', s1_body: '&#x4F60;&#x5DF2;&#x7ECF;&#x5728;&#x8FD9;&#x91CC;&#x4E86;&#xFF01;',
    s2_label: '&#x8F93;&#x5165;&#x7528;&#x6237;&#x540D;&#x5E76;&#x8FDE;&#x63A5;', s2_body: '&#x5728;&#x53F3;&#x4FA7;&#x8FB9;&#x680F;&#x8F93;&#x5165;&#x60A8;&#x7684;&#x7528;&#x6237;&#x540D;&#xFF0C;&#x7136;&#x540E;&#x70B9;&#x51FB;&#x8FDE;&#x63A5; OP_WALLET&#x3002;&#x5B83;&#x4F1A;&#x9759;&#x9ED8;&#x540C;&#x6B65;&#x60A8;&#x7684;&#x9322;&#x5305;&mdash;&#x65E0;&#x9700;&#x5F39;&#x7A97;&#x3002;',
    s3_label: '&#x521B;&#x5EFA;&#x6E38;&#x620F;&#x8D26;&#x6237;', s3_body: '&#x5728;&#x6E38;&#x620F;&#x5BA2;&#x6237;&#x7AEF;&#x4E2D;&#x8F93;&#x5165;&#x76F8;&#x540C;&#x7684;&#x7528;&#x6237;&#x540D;&#x5E76;&#x8BBE;&#x7F6E;&#x5BC6;&#x7801;&#x3002;&#x5BC6;&#x7801;&#x662F;&#x6C38;&#x4E45;&#x6027;&#x7684;&mdash;&#x5C06;&#x6C38;&#x4E45;&#x9501;&#x5B9A;&#x60A8;&#x7684;&#x8D26;&#x6237;&#x3002;',
    s_info: '&#x5FD8;&#x8BB0;&#x5BC6;&#x7801;&#x6216;&#x7528;&#x6237;&#x540D;&#xFF1F;&#x60A8;&#x59CB;&#x7EC8;&#x53EF;&#x4EE5;&#x7528;&#x540C;&#x4E00;&#x9322;&#x5305;&#x5730;&#x5740;&#x521B;&#x5EFA;&#x65B0;&#x8D26;&#x6237;&#x3002;',
    s4_label: '&#x780D;&#x4E00;&#x4E9B;&#x6811;', s4_body: '&#x8D70;&#x5230;&#x51FA;&#x751F;&#x70B9;&#x9644;&#x8FD1;&#x7684;&#x6811;&#x6728;&#x5E76;&#x70B9;&#x51FB;&#x3002;&#x780D;&#x5230;&#x6709; 2&ndash;3 &#x6839;&#x539F;&#x6728;&#x4E3A;&#x6B62;&#x3002;',
    s5_label: '&#x5728;&#x6742;&#x8D27;&#x5E97;&#x51FA;&#x552E;', s5_body: '&#x8D70;&#x5230;&#x9644;&#x8FD1;&#x7684;&#x6742;&#x8D27;&#x5E97; NPC &#x5E76;&#x70B9;&#x51FB;&#x3002;&#x60A8;&#x7684;&#x539F;&#x6728;&#x4F1A;&#x81EA;&#x52A8;&#x8F6C;&#x6362;&#x4E3A;&#x91D1;&#x5E01;&#x3002;',
    s6_label: '&#x7B7E;&#x540D;&#x5E76;&#x94F8;&#x9020; RST', s6_body: '&#x4FA7;&#x8FB9;&#x680F;&#x4F1A;&#x51FA;&#x73B0;&#x94F8;&#x9020;&#x6309;&#x9215;&#x3002;&#x70B9;&#x51FB;&#x4F7F;&#x7528; OP_WALLET &#x7B7E;&#x540D;&#x5E76;&#x9886;&#x53D6;&#xFF0C;&#x5728; OP_WALLET &#x4E2D;&#x6279;&#x51C6;&#x3002;RST &#x5C06;&#x8FDB;&#x5165;&#x60A8;&#x5728;&#x6BD4;&#x7279;&#x5E01; L1 &#x4E0A;&#x7684;&#x9322;&#x5305;&#x3002;',
    rates_title: '&#x5151;&#x6362;&#x7387;',
    footer: '&#x73A9;&#x5F97;&#x8D8A;&#x591A;&#xFF0C;&#x94F8;&#x9020;&#x8D8A;&#x591A;&#x3002;&#x7EE7;&#x7EED;&#x780D;&#x6811;&#x5427;&#xFF01; &#x1F333;&#x26CF;&#xFE0F;',
  },
  de: {
    dir: 'ltr',
    title: '&#x26CF; RST &mdash; RuneScape Ressourcen Terminal',
    sub: 'Anleitung',
    req_title: 'BEVOR DU BEGINNST &mdash; Voraussetzungen',
    req_1: 'OP_WALLET Browser-Erweiterung installiert',
    req_2: 'Testnet-BTC (tBTC) in deiner Wallet &mdash; kostenlos auf <strong style="color:#44cc44">faucet.opnet.org</strong>',
    import_title: 'RST-TOKEN IN OP_WALLET IMPORTIEREN',
    import_p: 'OP_WALLET &#xF6;ffnen &rarr; Token &rarr; Token importieren &rarr; diese Adresse einf&#xFC;gen:',
    steps_title: 'SCHRITTE',
    s1_label: 'Zum Spiel gehen', s1_body: 'Du bist bereits hier!',
    s2_label: 'Benutzername eingeben und verbinden', s2_body: 'In der rechten Seitenleiste den gew&#xFC;nschten Benutzernamen eingeben, dann auf OP_WALLET VERBINDEN klicken. Deine Wallet wird still synchronisiert &mdash; kein Popup n&#xF6;tig.',
    s3_label: 'Spielkonto erstellen', s3_body: 'Im Client denselben Benutzernamen eingeben und ein Passwort w&#xE4;hlen. Es ist dauerhaft &mdash; sperrt dein Konto f&#xFC;r immer.',
    s_info: 'Passwort oder Benutzernamen vergessen? Du kannst immer ein neues Konto mit derselben Wallet-Adresse erstellen.',
    s4_label: 'B&#xE4;ume f&#xE4;llen', s4_body: 'Zu den B&#xE4;umen nahe dem Startpunkt gehen und auf einen klicken. F&#xE4;llen bis du 2&ndash;3 St&#xE4;mme hast.',
    s5_label: 'Im Allgemeinen Laden verkaufen', s5_body: 'Zum NPC des nahe gelegenen Ladens gehen und klicken. Deine St&#xE4;mme werden automatisch in GP umgewandelt.',
    s6_label: 'RST unterschreiben und pr&#xE4;gen', s6_body: 'Eine Schaltfl&#xE4;che erscheint in der Seitenleiste. Auf MIT OP_WALLET UNTERSCHREIBEN klicken, genehmigen. RST landet in deiner Wallet auf Bitcoin L1.',
    rates_title: 'UMRECHNUNGSKURSE',
    footer: 'Je mehr du spielst, desto mehr pr&#xE4;gst du. Weiterschlagen! &#x1F333;&#x26CF;&#xFE0F;',
  },
  fa: {
    dir: 'rtl',
    title: '&#x26CF; RST &mdash; &#x62A4;&#x631;&#x645;&#x6CC;&#x646;&#x627;&#x644; &#x645;&#x646;&#x627;&#x628;&#x639; &#x631;&#x627;&#x646;&#x633;&#x6A9;&#x6CC;&#x67E5;',
    sub: '&#x646;&#x62D;&#x648;&#x647; &#x628;&#x627;&#x632;&#x6CC;',
    req_title: '&#x642;&#x628;&#x644; &#x627;&#x632; &#x634;&#x631;&#x648;&#x639; &mdash; &#x627;&#x644;&#x632;&#x627;&#x645;&#x627;&#x62A;',
    req_1: '&#x627;&#x641;&#x632;&#x648;&#x646;&#x647; &#x645;&#x631;&#x648;&#x631;&#x6AF;&#x631; OP_WALLET &#x646;&#x635;&#x628; &#x634;&#x62F;&#x647; &#x628;&#x627;&#x634;&#x62F;',
    req_2: 'tBTC (&#x628;&#x6CC;&#x62A;&#x6A29;&#x6CC;&#x646; &#x634;&#x628;&#x6A9;&#x647; &#x622;&#x632;&#x645;&#x627;&#x6CC;&#x634;&#x6CC;) &#x62F;&#x631; &#x6A9;&#x6CC;&#x641; &#x67E5;&#x648;&#x644; &mdash; &#x628;&#x647; &#x635;&#x648;&#x631;&#x62A; &#x631;&#x627;&#x6CC;&#x62A;&#x627;&#x646; &#x627;&#x632; <strong style="color:#44cc44">faucet.opnet.org</strong> &#x62F;&#x631;&#x6CC;&#x627;&#x641;&#x62A; &#x6A9;&#x646;&#x6CC;&#x62F;',
    import_title: '&#x648;&#x627;&#x631;&#x62F; &#x6A9;&#x631;&#x62F;&#x646; &#x62A;&#x648;&#x6A9;&#x646; RST &#x628;&#x647; OP_WALLET',
    import_p: 'OP_WALLET &#x631;&#x627; &#x628;&#x627;&#x632; &#x6A9;&#x646;&#x6CC;&#x62F; &larr; &#x62A;&#x648;&#x6A9;&#x646;&#x200C;&#x647;&#x627; &larr; &#x648;&#x627;&#x631;&#x62F; &#x6A9;&#x631;&#x62F;&#x646; &#x62A;&#x648;&#x6A9;&#x646; &larr; &#x627;&#x6CC;&#x646; &#x622;&#x62F;&#x631;&#x633; &#x631;&#x627; &#x62C;&#x627;&#x6CC;&#x200C;&#x6AF;&#x630;&#x627;&#x631;&#x6CC; &#x6A9;&#x646;&#x6CC;&#x62F;:',
    steps_title: '&#x645;&#x631;&#x627;&#x62D;&#x644;',
    s1_label: '&#x628;&#x647; &#x628;&#x627;&#x632;&#x6CC; &#x628;&#x631;&#x648;&#x6CC;&#x62F;', s1_body: '&#x634;&#x645;&#x627; &#x627;&#x632; &#x642;&#x628;&#x644; &#x627;&#x6CC;&#x646;&#x62C;&#x627; &#x647;&#x633;&#x62A;&#x6CC;&#x62F;!',
    s2_label: '&#x646;&#x627;&#x645; &#x6A9;&#x627;&#x631;&#x628;&#x631;&#x6CC; &#x648;&#x627;&#x631;&#x62F; &#x648; &#x645;&#x62A;&#x635;&#x644; &#x634;&#x648;&#x6CC;&#x62F;', s2_body: '&#x62F;&#x631; &#x646;&#x648;&#x627;&#x631; &#x6A9;&#x646;&#x627;&#x631;&#x6CC; &#x633;&#x645;&#x62A; &#x631;&#x627;&#x633;&#x62A;&#x60C; &#x646;&#x627;&#x645; &#x6A9;&#x627;&#x631;&#x628;&#x631;&#x6CC; &#x62F;&#x644;&#x62E;&#x648;&#x627;&#x647; &#x62E;&#x648;&#x62F; &#x631;&#x627; &#x648;&#x627;&#x631;&#x62F; &#x6A9;&#x646;&#x6CC;&#x62F;&#x60C; &#x633;&#x67E5;&#x633; &#x631;&#x648;&#x6CC; &#x627;&#x62A;&#x635;&#x627;&#x644; OP_WALLET &#x6A9;&#x644;&#x6CC;&#x6A9; &#x6A9;&#x646;&#x6CC;&#x62F;. &#x6A9;&#x6CC;&#x641; &#x67E5;&#x648;&#x644; &#x628;&#x62F;&#x648;&#x646; &#x646;&#x645;&#x627;&#x6CC;&#x634; &#x67E5;&#x646;&#x62C;&#x631;&#x647; &#x647;&#x645;&#x6AF;&#x627;&#x645; &#x645;&#x6CC;&#x200C;&#x634;&#x648;&#x62F;.',
    s3_label: '&#x62D;&#x633;&#x627;&#x628; &#x628;&#x627;&#x632;&#x6CC; &#x627;&#x6CC;&#x62C;&#x627;&#x62F; &#x6A9;&#x646;&#x6CC;&#x62F;', s3_body: '&#x62F;&#x631; &#x6A9;&#x644;&#x627;&#x6CC;&#x646;&#x62A; &#x628;&#x627;&#x632;&#x6CC;&#x60C; &#x647;&#x645;&#x627;&#x646; &#x646;&#x627;&#x645; &#x6A9;&#x627;&#x631;&#x628;&#x631;&#x6CC; &#x631;&#x627; &#x648;&#x627;&#x631;&#x62F; &#x6A9;&#x631;&#x62F;&#x647; &#x648; &#x631;&#x645;&#x632; &#x639;&#x628;&#x648;&#x631; &#x627;&#x646;&#x62A;&#x62E;&#x627;&#x628; &#x6A9;&#x646;&#x6CC;&#x62F;. &#x631;&#x645;&#x632; &#x639;&#x628;&#x648;&#x631; &#x62F;&#x627;&#x626;&#x645;&#x6CC; &#x627;&#x633;&#x62A; &mdash; &#x62D;&#x633;&#x627;&#x628; &#x634;&#x645;&#x627; &#x631;&#x627; &#x628;&#x631;&#x627;&#x6CC; &#x647;&#x645;&#x6CC;&#x634;&#x647; &#x642;&#x641;&#x644; &#x645;&#x6CC;&#x200C;&#x6A9;&#x646;&#x62F;.',
    s_info: '&#x631;&#x645;&#x632; &#x639;&#x628;&#x648;&#x631; &#x6CC;&#x627; &#x646;&#x627;&#x645; &#x6A9;&#x627;&#x631;&#x628;&#x631;&#x6CC; &#x631;&#x627; &#x641;&#x631;&#x627;&#x645;&#x648;&#x634; &#x6A9;&#x631;&#x62F;&#x6CC;&#x62F;? &#x647;&#x645;&#x6CC;&#x634;&#x647; &#x645;&#x6CC;&#x200C;&#x62A;&#x648;&#x627;&#x646;&#x6CC;&#x62F; &#x628;&#x627; &#x647;&#x645;&#x627;&#x646; &#x622;&#x62F;&#x631;&#x633; &#x6A9;&#x6CC;&#x641; &#x67E5;&#x648;&#x644; &#x6CC;&#x6A9; &#x62D;&#x633;&#x627;&#x628; &#x62C;&#x62F;&#x6CC;&#x62F; &#x628;&#x633;&#x627;&#x632;&#x6CC;&#x62F;.',
    s4_label: '&#x686;&#x646;&#x62F; &#x62F;&#x631;&#x62E;&#x62A; &#x642;&#x637;&#x639; &#x6A9;&#x646;&#x6CC;&#x62F;', s4_body: '&#x628;&#x647; &#x62F;&#x631;&#x62E;&#x62A;&#x627;&#x646; &#x646;&#x632;&#x62F;&#x6CC;&#x6A9; &#x646;&#x642;&#x637;&#x647; &#x634;&#x631;&#x648;&#x639; &#x628;&#x631;&#x648;&#x6CC;&#x62F; &#x648; &#x631;&#x648;&#x6CC; &#x6CC;&#x6A9;&#x6CC; &#x6A9;&#x644;&#x6CC;&#x6A9; &#x6A9;&#x646;&#x6CC;&#x62F;. &#x62A;&#x627; &#x662;&#x2013;&#x663; &#x686;&#x648;&#x628; &#x62F;&#x627;&#x634;&#x62A;&#x647; &#x628;&#x627;&#x634;&#x6CC;&#x62F;.',
    s5_label: '&#x62F;&#x631; &#x641;&#x631;&#x648;&#x634;&#x6AF;&#x627;&#x647; &#x639;&#x645;&#x648;&#x645;&#x6CC; &#x628;&#x641;&#x631;&#x648;&#x634;&#x6CC;&#x62F;', s5_body: '&#x628;&#x647; NPC &#x641;&#x631;&#x648;&#x634;&#x6AF;&#x627;&#x647; &#x639;&#x645;&#x648;&#x645;&#x6CC; &#x646;&#x632;&#x62F;&#x6CC;&#x6A9; &#x628;&#x631;&#x648;&#x6CC;&#x62F; &#x648; &#x6A9;&#x644;&#x6CC;&#x6A9; &#x6A9;&#x646;&#x6CC;&#x62F;. &#x686;&#x648;&#x628;&#x200C;&#x647;&#x627;&#x6CC;&#x62A;&#x627;&#x646; &#x628;&#x647; &#x637;&#x648;&#x631; &#x62E;&#x648;&#x62F;&#x6A9;&#x627;&#x631; &#x628;&#x647; GP &#x62A;&#x628;&#x62F;&#x6CC;&#x644; &#x645;&#x6CC;&#x200C;&#x634;&#x648;&#x62F;.',
    s6_label: 'RST &#x631;&#x627; &#x627;&#x645;&#x636;&#x627; &#x648; &#x636;&#x631;&#x628; &#x6A9;&#x646;&#x6CC;&#x62F;', s6_body: '&#x6CC;&#x6A9; &#x62F;&#x6A9;&#x645;&#x647; &#x636;&#x631;&#x628; &#x62F;&#x631; &#x646;&#x648;&#x627;&#x631; &#x6A9;&#x646;&#x627;&#x631;&#x6CC; &#x638;&#x627;&#x647;&#x631; &#x645;&#x6CC;&#x200C;&#x634;&#x648;&#x62F;. &#x631;&#x648;&#x6CC; &#x627;&#x645;&#x636;&#x627; &#x648; &#x62F;&#x631;&#x6CC;&#x627;&#x641;&#x62A; &#x628;&#x627; OP_WALLET &#x6A9;&#x644;&#x6CC;&#x6A9; &#x6A9;&#x646;&#x6CC;&#x62F;. RST &#x62F;&#x631; &#x6A9;&#x6CC;&#x641; &#x67E5;&#x648;&#x644; &#x634;&#x645;&#x627; &#x631;&#x648;&#x6CC; Bitcoin L1 &#x642;&#x631;&#x627;&#x631; &#x645;&#x6CC;&#x200C;&#x6AF;&#x6CC;&#x631;&#x62F;.',
    rates_title: '&#x646;&#x631;&#x62E; &#x62A;&#x628;&#x62F;&#x6CC;&#x644;',
    footer: '&#x647;&#x631; &#x686;&#x647; &#x628;&#x6CC;&#x634;&#x62A;&#x631; &#x628;&#x627;&#x632;&#x6CC; &#x6A9;&#x646;&#x6CC;&#x62F;&#x60C; &#x628;&#x6CC;&#x634;&#x62A;&#x631; &#x636;&#x631;&#x628; &#x645;&#x6CC;&#x200C;&#x6A9;&#x646;&#x6CC;&#x62F;. &#x628;&#x647; &#x642;&#x637;&#x639; &#x6A9;&#x631;&#x62F;&#x646; &#x627;&#x62F;&#x627;&#x645;&#x647; &#x62F;&#x647;&#x6CC;&#x62F;! &#x1F333;&#x26CF;&#xFE0F;',
  },
  pt: {
    dir: 'ltr',
    title: '&#x26CF; RST &mdash; Terminal de Recursos do RuneScape',
    sub: 'Como Jogar',
    req_title: 'ANTES DE COME&#xC7;AR &mdash; Requisitos',
    req_1: 'Extens&#xE3;o OP_WALLET instalada no navegador',
    req_2: 'BTC de testnet (tBTC) na sua carteira &mdash; consiga gratuitamente em <strong style="color:#44cc44">faucet.opnet.org</strong>',
    import_title: 'IMPORTAR O TOKEN RST PARA O OP_WALLET',
    import_p: 'Abra o OP_WALLET &rarr; Tokens &rarr; Importar Token &rarr; cole este endere&#xE7;o:',
    steps_title: 'PASSOS',
    s1_label: 'V&#xE1; para o jogo', s1_body: 'Voc&#xEA; j&#xE1; est&#xE1; aqui!',
    s2_label: 'Digite um usu&#xE1;rio e conecte-se', s2_body: 'Na barra lateral direita, digite seu nome de usu&#xE1;rio, depois clique em CONECTAR OP_WALLET. Sua carteira ser&#xE1; sincronizada silenciosamente &mdash; sem popups.',
    s3_label: 'Crie sua conta no jogo', s3_body: 'No cliente, insira o mesmo nome de usu&#xE1;rio e escolha uma senha. &#xC9; permanente &mdash; bloqueia sua conta para sempre.',
    s_info: 'Esqueceu sua senha ou nome de usu&#xE1;rio? Voc&#xEA; sempre pode criar uma nova conta com o mesmo endere&#xE7;o de carteira.',
    s4_label: 'Corte algumas &#xE1;rvores', s4_body: 'Caminhe at&#xE9; as &#xE1;rvores perto do ponto inicial e clique em uma. Corte at&#xE9; ter 2&ndash;3 toras.',
    s5_label: 'Venda na Loja Geral', s5_body: 'Fale com o NPC da Loja Geral pr&#xF3;xima. Suas toras se convertem em PO automaticamente.',
    s6_label: 'Assine e cunhe RST', s6_body: 'Um bot&#xE3;o de cunhagem aparece na barra lateral. Clique em ASSINAR E REIVINDICAR COM OP_WALLET, aprove. RST chega na sua carteira no Bitcoin L1.',
    rates_title: 'TAXAS DE CONVERS&#xC3;O',
    footer: 'Quanto mais voc&#xEA; joga, mais voc&#xEA; cunha. Continue cortando! &#x1F333;&#x26CF;&#xFE0F;',
  },
  ja: {
    dir: 'ltr',
    title: '&#x26CF; RST &mdash; &#x30EB;&#x30FC;&#x30F3;&#x30B9;&#x30B1;&#x30FC;&#x30D7; &#x30EA;&#x30BD;&#x30FC;&#x30B9; &#x30BF;&#x30FC;&#x30DF;&#x30CA;&#x30EB;',
    sub: '&#x9059;&#x3073;&#x65B9;',
    req_title: '&#x59CB;&#x3081;&#x308B;&#x524D;&#x306B; &mdash; &#x5FC5;&#x8981;&#x6761;&#x4EF6;',
    req_1: 'OP_WALLET &#x30D6;&#x30E9;&#x30A6;&#x30B6;&#x62E1;&#x5F35;&#x6A5F;&#x80FD;&#x3092;&#x30A4;&#x30F3;&#x30B9;&#x30C8;&#x30FC;&#x30EB;&#x6E08;&#x307F;',
    req_2: '&#x30C6;&#x30B9;&#x30C8;&#x30CD;&#x30C3;&#x30C8; BTC&#xFF08;tBTC&#xFF09;&#x304C;&#x30A6;&#x30A9;&#x30EC;&#x30C3;&#x30C8;&#x306B;&#x3042;&#x308B;&#x3053;&#x3068; &mdash; <strong style="color:#44cc44">faucet.opnet.org</strong> &#x3067;&#x7121;&#x6599;&#x53D6;&#x5F97;',
    import_title: 'OP_WALLET &#x306B; RST &#x30C8;&#x30FC;&#x30AF;&#x30F3;&#x3092;&#x30A4;&#x30F3;&#x30DD;&#x30FC;&#x30C8;',
    import_p: 'OP_WALLET &#x3092;&#x958B;&#x304F; &rarr; &#x30C8;&#x30FC;&#x30AF;&#x30F3; &rarr; &#x30C8;&#x30FC;&#x30AF;&#x30F3;&#x3092;&#x30A4;&#x30F3;&#x30DD;&#x30FC;&#x30C8; &rarr; &#x3053;&#x306E;&#x30A2;&#x30C9;&#x30EC;&#x30B9;&#x3092;&#x8CBC;&#x308A;&#x4ED8;&#x3051;&#xFF1A;',
    steps_title: '&#x624B;&#x9806;',
    s1_label: '&#x30B2;&#x30FC;&#x30E0;&#x3078;&#x79FB;&#x52D5;', s1_body: '&#x3059;&#x3067;&#x306B;&#x3053;&#x3053;&#x306B;&#x3044;&#x307E;&#x3059;&#xFF01;',
    s2_label: '&#x30E6;&#x30FC;&#x30B6;&#x30FC;&#x540D;&#x3092;&#x5165;&#x529B;&#x3057;&#x3066;&#x63A5;&#x7D9A;', s2_body: '&#x53F3;&#x306E;&#x30B5;&#x30A4;&#x30C9;&#x30D0;&#x30FC;&#x3067;&#x5E0C;&#x671B;&#x306E;&#x30E6;&#x30FC;&#x30B6;&#x30FC;&#x540D;&#x3092;&#x5165;&#x529B;&#x3057;&#x3001;OP_WALLET &#x306B;&#x63A5;&#x7D9A;&#x3092;&#x30AF;&#x30EA;&#x30C3;&#x30AF;&#x3057;&#x307E;&#x3059;&#x3002;&#x30A6;&#x30A9;&#x30EC;&#x30C3;&#x30C8;&#x304C;&#x81EA;&#x52D5;&#x540C;&#x671F;&#x3055;&#x308C;&#x307E;&#x3059; &mdash; &#x30DD;&#x30C3;&#x30D7;&#x30A2;&#x30C3;&#x30D7;&#x4E0D;&#x8981;&#x3002;',
    s3_label: '&#x30B2;&#x30FC;&#x30E0;&#x30A2;&#x30AB;&#x30A6;&#x30F3;&#x30C8;&#x3092;&#x4F5C;&#x6210;', s3_body: '&#x30B2;&#x30FC;&#x30E0;&#x30AF;&#x30E9;&#x30A4;&#x30A2;&#x30F3;&#x30C8;&#x3067;&#x540C;&#x3058;&#x30E6;&#x30FC;&#x30B6;&#x30FC;&#x540D;&#x3092;&#x5165;&#x529B;&#x3057;&#x3001;&#x30D1;&#x30B9;&#x30EF;&#x30FC;&#x30C9;&#x3092;&#x8A2D;&#x5B9A;&#x3057;&#x307E;&#x3059;&#x3002;&#x6C38;&#x4E45;&#x7684;&#x3067;&#x3059; &mdash; &#x30A2;&#x30AB;&#x30A6;&#x30F3;&#x30C8;&#x3092;&#x6C38;&#x4E45;&#x306B;&#x30ED;&#x30C3;&#x30AF;&#x3057;&#x307E;&#x3059;&#x3002;',
    s_info: '&#x30D1;&#x30B9;&#x30EF;&#x30FC;&#x30C9;&#x3084;&#x30E6;&#x30FC;&#x30B6;&#x30FC;&#x540D;&#x3092;&#x5FD8;&#x308C;&#x305F;&#x5834;&#x5408;&#x3001;&#x540C;&#x3058;&#x30A6;&#x30A9;&#x30EC;&#x30C3;&#x30C8;&#x30A2;&#x30C9;&#x30EC;&#x30B9;&#x3067;&#x65B0;&#x3057;&#x3044;&#x30A2;&#x30AB;&#x30A6;&#x30F3;&#x30C8;&#x3092;&#x4F5C;&#x6210;&#x3067;&#x304D;&#x307E;&#x3059;&#x3002;',
    s4_label: '&#x6728;&#x3092;&#x5C65;&#x308B;', s4_body: '&#x30B9;&#x30DD;&#x30FC;&#x30F3;&#x5730;&#x70B9;&#x8FD1;&#x304F;&#x306E;&#x6728;&#x306B;&#x6B69;&#x3044;&#x3066;&#x30AF;&#x30EA;&#x30C3;&#x30AF;&#x3057;&#x307E;&#x3059;&#x3002;2&ndash;3&#x672C;&#x306E;&#x4E38;&#x592A;&#x304C;&#x5165;&#x308B;&#x307E;&#x3067;&#x5C65;&#x308A;&#x307E;&#x3059;&#x3002;',
    s5_label: '&#x96D1;&#x8CA8;&#x5E97;&#x3067;&#x58F2;&#x308B;', s5_body: '&#x8FD1;&#x304F;&#x306E;&#x96D1;&#x8CA8;&#x5E97; NPC &#x306B;&#x8A71;&#x3057;&#x304B;&#x3051;&#x307E;&#x3059;&#x3002;&#x4E38;&#x592A;&#x306F;&#x81EA;&#x52D5;&#x7684;&#x306B; GP &#x306B;&#x5909;&#x63DB;&#x3055;&#x308C;&#x307E;&#x3059;&#x3002;',
    s6_label: 'RST &#x306B;&#x7F72;&#x540D;&#x3057;&#x3066;&#x30DF;&#x30F3;&#x30C8;', s6_body: '&#x30B5;&#x30A4;&#x30C9;&#x30D0;&#x30FC;&#x306B;&#x30DF;&#x30F3;&#x30C8;&#x30DC;&#x30BF;&#x30F3;&#x304C;&#x8868;&#x793A;&#x3055;&#x308C;&#x307E;&#x3059;&#x3002;OP_WALLET &#x3067;&#x7F72;&#x540D;&#x3057;&#x3066;&#x30AF;&#x30EC;&#x30FC;&#x30E0;&#x3092;&#x30AF;&#x30EA;&#x30C3;&#x30AF;&#x3057;&#x3001;&#x627F;&#x8A8D;&#x3057;&#x307E;&#x3059;&#x3002;RST &#x304C; L1 &#x306E;&#x30A6;&#x30A9;&#x30EC;&#x30C3;&#x30C8;&#x306B;&#x5C4A;&#x304D;&#x307E;&#x3059;&#x3002;',
    rates_title: '&#x5909;&#x63DB;&#x30EC;&#x30FC;&#x30C8;',
    footer: '&#x30D7;&#x30EC;&#x30A4;&#x3059;&#x308C;&#x3070;&#x3059;&#x308B;&#x307B;&#x3069;&#x30DF;&#x30F3;&#x30C8;&#x3067;&#x304D;&#x307E;&#x3059;&#x3002;&#x5C65;&#x308A;&#x7D9A;&#x3051;&#x307E;&#x3057;&#x3087;&#x3046;&#xFF01; &#x1F333;&#x26CF;&#xFE0F;',
  },
};

function renderHTPContent(lang) {
  var t = HTP_LANGS[lang] || HTP_LANGS['en'];
  var el = document.getElementById('htpContent');
  if (!el) return;
  el.setAttribute('dir', t.dir || 'ltr');
  el.innerHTML =
    '<h1>' + t.title + '</h1>' +
    '<div class="htp-sub">' + t.sub + '</div>' +
    '<div class="htp-section">' +
      '<h3>' + t.req_title + '</h3>' +
      '<ul><li>' + t.req_1 + '</li><li>' + t.req_2 + '</li></ul>' +
    '</div>' +
    '<div class="htp-section">' +
      '<h3>' + t.import_title + '</h3>' +
      '<p>' + t.import_p + '</p>' +
      '<span class="htp-addr">0x8ea522eb4c95f38e9f4f9a9c4b6f4f1d9e4f7b8d2b10902dbd302779105afaf1</span>' +
    '</div>' +
    '<div class="htp-section">' +
      '<h3>' + t.steps_title + '</h3>' +
      '<div class="htp-step"><span class="htp-num">1.</span><span class="htp-desc"><strong style="color:#f0c030">' + t.s1_label + '</strong> &mdash; ' + t.s1_body + '</span></div>' +
      '<div class="htp-step"><span class="htp-num">2.</span><span class="htp-desc"><strong style="color:#f0c030">' + t.s2_label + '</strong> &mdash; ' + t.s2_body + '</span></div>' +
      '<div class="htp-step"><span class="htp-num">3.</span><span class="htp-desc"><strong style="color:#f0c030">' + t.s3_label + '</strong> &mdash; ' + t.s3_body + '</span></div>' +
      '<div class="htp-step"><span class="htp-num" style="color:#888">&#x2139;</span><span class="htp-desc" style="color:#666">' + t.s_info + '</span></div>' +
      '<div class="htp-step"><span class="htp-num">4.</span><span class="htp-desc"><strong style="color:#f0c030">' + t.s4_label + '</strong> &mdash; ' + t.s4_body + '</span></div>' +
      '<div class="htp-step"><span class="htp-num">5.</span><span class="htp-desc"><strong style="color:#f0c030">' + t.s5_label + '</strong> &mdash; ' + t.s5_body + '</span></div>' +
      '<div class="htp-step"><span class="htp-num">6.</span><span class="htp-desc"><strong style="color:#f0c030">' + t.s6_label + '</strong> &mdash; ' + t.s6_body + '</span></div>' +
    '</div>' +
    '<div class="htp-section">' +
      '<h3>' + t.rates_title + '</h3>' +
      '<div class="htp-rates">' +
        '<div class="htp-rate"><div class="r-gp">100 GP</div><div class="r-rst">0.01 RST</div></div>' +
        '<div class="htp-rate"><div class="r-gp">1,000 GP</div><div class="r-rst">0.1 RST</div></div>' +
        '<div class="htp-rate"><div class="r-gp">10,000 GP</div><div class="r-rst">1 RST</div></div>' +
      '</div>' +
    '</div>' +
    '<p style="color:#555;font-size:0.68em;margin-top:16px;text-align:center;">' + t.footer + '</p>';
}

function setHTPLang(lang) {
  if (!HTP_LANGS[lang]) lang = 'en';
  localStorage.setItem('htp_lang', lang);
  renderHTPContent(lang);
  var sel = document.getElementById('htpLangSelect');
  if (sel) sel.value = lang;
  var sidebarSel = document.getElementById('sidebarLangSelect');
  if (sidebarSel) sidebarSel.value = lang;
  updateDifficultyDisplay(window._lastRstBal !== undefined ? window._lastRstBal : 0);
}

// Auto-detect language on load
(function() {
  var stored = localStorage.getItem('htp_lang');
  if (stored && HTP_LANGS[stored]) { setHTPLang(stored); return; }
  var nav = ((navigator.language || 'en').split('-')[0]).toLowerCase();
  var map = { en: 'en', es: 'es', fr: 'fr', zh: 'zh', de: 'de', fa: 'fa', pt: 'pt', ja: 'ja' };
  setHTPLang(map[nav] || 'en');
})();
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
  <p class="sub">All-time GP converted to RST &mdash; updated live &mdash; ${entries.length} players</p>
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
      ${rows}${noRows}
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
