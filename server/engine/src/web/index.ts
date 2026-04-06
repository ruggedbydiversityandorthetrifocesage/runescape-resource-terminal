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
import { db } from '#/db/query.js';

// RST price cache (5-min TTL)
let _rstPriceCache: { priceInSats: number; liquidityRST: number; liquiditySats: number; btcUSD: number; ts: number } | null = null;

async function fetchRstPrice() {
    if (_rstPriceCache && Date.now() - _rstPriceCache.ts < 5 * 60 * 1000) return _rstPriceCache;
    try {
        const NATIVE_SWAP = '0x4397befe4e067390596b3c296e77fe86589487bf3bf3f0a9a93ce794e2d78fb5';
        const RST_PUBKEY = 'f4d9ed7f424ca09d41655eb2a3c69d559fd2fdd857a75ffbafa9373ce4ac62d4';
        const calldata = 'efec69cc' + RST_PUBKEY;
        const [rpcRes, geckoRes] = await Promise.all([
            fetch('https://testnet.opnet.org/api/v1/json-rpc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_call', params: [NATIVE_SWAP, calldata, null, null] }),
            }),
            fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd').catch(() => null),
        ]);
        const rpcJson = await rpcRes.json() as any;
        const rpcResult = rpcJson?.result;
        const raw: string = typeof rpcResult === 'string' ? rpcResult : (rpcResult?.result ?? '');
        if (!raw) throw new Error('empty');
        const buf = Buffer.from(raw, 'base64');
        // layout: liquidity(32) + reservedLiquidity(32) + virtualBTCReserve(8) + virtualTokenReserve(32)
        const liquidity = BigInt('0x' + buf.slice(0, 32).toString('hex'));
        const virtualBTCReserve = BigInt('0x' + buf.slice(64, 72).toString('hex'));
        const virtualTokenReserve = BigInt('0x' + buf.slice(72, 104).toString('hex'));
        const liquidityRST = Math.round(Number(liquidity) / 1e18);
        const priceInSats = virtualTokenReserve > 0n
            ? Number(virtualBTCReserve) / (Number(virtualTokenReserve) / 1e18)
            : 0;
        let btcUSD = _rstPriceCache?.btcUSD ?? 0;
        if (geckoRes?.ok) {
            const g = await geckoRes.json() as any;
            btcUSD = g?.bitcoin?.usd ?? btcUSD;
        }
        _rstPriceCache = { priceInSats: Math.round(priceInSats), liquidityRST, liquiditySats: Number(virtualBTCReserve), btcUSD, ts: Date.now() };
        return _rstPriceCache;
    } catch {
        return _rstPriceCache ?? null;
    }
}

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
const RST_CONTRACT = 'opt1sqzvnq5yetkcnwqzz02h23ch8294kgt0hxvvt9xyw';
const RST_CONTRACT_PUBKEY = '0xf4d9ed7f424ca09d41655eb2a3c69d559fd2fdd857a75ffbafa9373ce4ac62d4';
// RSTStaking V2 MasterChef — redeployed 2026-03-09 (bob fixed to ad5bad18... = actual OPNet sender)
const STAKING_CONTRACT = 'opt1sqznx9cv0lhl6f7e5pxufhzegy6fmuf3w9cqpky5t';
const STAKING_CONTRACT_PUBKEY = '0x611a529e3da62357e4959ad3b3f98d1f05bb8676425476af5d25926b4f9737cb';
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
    const contractHexClaim = '0xf4d9ed7f424ca09d41655eb2a3c69d559fd2fdd857a75ffbafa9373ce4ac62d4';
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

            // RST: Leaderboard — HTML page at /leaderboard, JSON at /rst/leaderboard-json
            if (url.pathname === '/rst/leaderboard' || url.pathname === '/leaderboard') {
                const { getLeaderboard } = await import('../engine/pill/PillMerchant.js');
                if (req.headers.get('accept')?.includes('text/html') || url.pathname === '/leaderboard') {
                    const entries = getLeaderboard();
                    const rows = entries.length === 0
                        ? '<tr><td colspan="3" style="text-align:center;color:#666;padding:20px;">No data yet — be the first to earn RST!</td></tr>'
                        : entries.slice(0, 50).map((e, i) => {
                            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
                            const rst = (e.rst || e.gp / 1000).toFixed(2);
                            const gp = (e.gp || 0).toLocaleString();
                            return `<tr>
                                <td style="padding:8px 12px;color:${i<3?'#f0c030':'#888'};font-weight:${i<3?'bold':'normal'};text-align:center;">${medal}</td>
                                <td style="padding:8px 12px;"><a href="/rst/player/${encodeURIComponent(e.username)}" style="color:#c8c8b8;text-decoration:none;" onmouseover="this.style.color='#f0c030'" onmouseout="this.style.color='#c8c8b8'">${e.username}</a></td>
                                <td style="padding:8px 12px;color:#f7931a;text-align:right;font-family:monospace;">${rst} RST</td>
                                <td style="padding:8px 12px;color:#888;text-align:right;font-family:monospace;">${gp} GP</td>
                            </tr>`;
                        }).join('');
                    const lbHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Leaderboard — Resource Terminal</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a08; color:#c8c8b8; font-family:Arial,sans-serif; min-height:100vh; }
.page { max-width:760px; margin:0 auto; padding:30px 16px; }
nav { margin-bottom:24px; font-size:13px; }
nav a { color:#8ebc44; text-decoration:none; margin-right:16px; }
nav a:hover { text-decoration:underline; }
h1 { font-family:Georgia,serif; font-size:32px; background:linear-gradient(180deg,#f0e080 0%,#c08010 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-bottom:6px; }
.sub { color:#666; font-size:13px; margin-bottom:24px; }
.box { border:1px solid #3a3000; background:#0e0c04; padding:0; overflow:hidden; }
.box-title { background:linear-gradient(180deg,#2a2400,#1a1600); border-bottom:1px solid #2a2000; padding:12px 16px; color:#f0c030; font-weight:bold; font-size:14px; }
table { width:100%; border-collapse:collapse; }
tr { border-bottom:1px solid #111008; }
tr:hover { background:#141008; }
th { padding:8px 12px; text-align:left; color:#666; font-size:12px; font-weight:normal; border-bottom:1px solid #2a2000; background:#0e0c04; }
.refresh { margin-top:12px; color:#555; font-size:12px; text-align:center; }
.play-link { display:inline-block; margin-top:20px; background:linear-gradient(180deg,#5a1010,#3a0808); border:1px solid #8a2020; color:#f0c030; padding:10px 24px; text-decoration:none; font-weight:bold; font-size:14px; }
.play-link:hover { background:linear-gradient(180deg,#7a2020,#5a1010); }
</style>
</head>
<body>
<div class="page">
  <nav><a href="/">&#8592; Home</a><a href="/play">Play Now</a><a href="/rst/claim">Claim RST</a></nav>
  <h1>&#x1F3C6; Leaderboard</h1>
  <div class="sub">Top RST earners — all-time scores. Updated live.</div>
  <div class="box">
    <div class="box-title">Top Players by RST Earned</div>
    <table>
      <thead><tr><th style="width:60px;text-align:center;">Rank</th><th>Player</th><th style="text-align:right;">RST Earned</th><th style="text-align:right;">Total GP</th></tr></thead>
      <tbody id="lbBody">${rows}</tbody>
    </table>
  </div>
  <div class="refresh">Scores update in real-time as players earn and claim RST.</div>
  <br>
  <a class="play-link" href="/play">&#x2694;&#xFE0F; Play &amp; Earn RST</a>
</div>
</body>
</html>`;
                    return new Response(lbHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
                }
                return new Response(JSON.stringify(getLeaderboard()), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            // RST: Player stats page — reads directly from .sav file, no DB needed
            const playerMatch = url.pathname.match(/^\/rst\/player\/([^/]+)\/?$/);
            if (playerMatch) {
                const username = decodeURIComponent(playerMatch[1]).toLowerCase().replace(/[^a-z0-9_-]/g, '');
                const savPath = `data/players/main/${username}.sav`;
                const { existsSync, readFileSync } = await import('fs');
                if (!existsSync(savPath)) {
                    return new Response(`Player "${username}" not found.`, { status: 404, headers: { 'Content-Type': 'text/html' } });
                }

                // Parse XP table — must match server formula exactly (Player.ts)
                const levelXp = new Int32Array(99);
                let acc = 0;
                for (let i = 0; i < 99; i++) {
                    const lv = i + 1;
                    acc += Math.floor(lv + Math.pow(2.0, lv / 10.0) * 300.0);
                    levelXp[i] = Math.floor(acc / 4) * 10;
                }
                function xpToLevel(xp: number): number {
                    for (let i = 98; i >= 0; i--) if (xp >= levelXp[i]) return i + 2;
                    return 1;
                }
                function fmtXp(x: number): string {
                    return x.toLocaleString();
                }

                const SKILL_NAMES = ['Attack','Defence','Strength','Hitpoints','Ranged','Prayer','Magic','Cooking','Woodcutting','Fletching','Fishing','Firemaking','Crafting','Smithing','Mining','Herblore','Agility','Thieving','Slayer','Farming','Runecrafting','Hunter','Construction'];
                const SKILL_ICONS: Record<string, string> = {
                    Attack:'⚔️', Defence:'🛡️', Strength:'💪', Hitpoints:'❤️', Ranged:'🏹', Prayer:'🙏',
                    Magic:'🔮', Cooking:'🍳', Woodcutting:'🪓', Fletching:'🪶', Fishing:'🎣',
                    Firemaking:'🔥', Crafting:'🧶', Smithing:'⚒️', Mining:'⛏️', Herblore:'🌿',
                    Agility:'🤸', Thieving:'🗝️', Runecrafting:'🌀',
                };

                const data = readFileSync(savPath);
                // Parse: [magic:2][version:2] then pos=4: [x:2][z:2][level:1][body:7][colors:5][gender:1][energy:2][playtime:4or2][skills:5×21]
                const magic = (data[0] << 8) | data[1];
                if (magic !== 0x2004 || data.length < 40) {
                    return new Response(`Save file for "${username}" is invalid.`, { status: 500, headers: { 'Content-Type': 'text/html' } });
                }
                const version = (data[2] << 8) | data[3];
                let pos = 4 + 2 + 2 + 1 + 7 + 5 + 1 + 2; // = 24
                pos += version >= 2 ? 4 : 2; // playtime

                const skills: { name: string; level: number; xp: number }[] = [];
                let totalLevel = 0;
                for (let i = 0; i < 21; i++) {
                    if (pos + 5 > data.length - 4) break;
                    const rawXp = ((data[pos] << 24) | (data[pos+1] << 16) | (data[pos+2] << 8) | data[pos+3]) >>> 0;
                    const storedLevel = data[pos + 4]; // level byte as stored in .sav
                    pos += 5;
                    const level = storedLevel > 0 ? Math.min(storedLevel, 99) : xpToLevel(rawXp);
                    const xp = Math.round(rawXp / 10); // server stores XP * 10 internally
                    const name = SKILL_NAMES[i];
                    if (name === '—') continue;
                    totalLevel += level;
                    skills.push({ name, level, xp });
                }

                const { getLeaderboard } = await import('../engine/pill/PillMerchant.js');
                const lb = getLeaderboard();
                const lbEntry = lb.find(e => e.username.toLowerCase() === username);
                const rst = lbEntry ? (lbEntry.rst || lbEntry.gp / 1000).toFixed(2) : '0.00';
                const rank = lbEntry ? lb.indexOf(lbEntry) + 1 : null;

                const rows = skills.map(s => `
                  <tr>
                    <td style="padding:7px 12px;color:#8ebc44;">${SKILL_ICONS[s.name] ?? ''} ${s.name}</td>
                    <td style="padding:7px 12px;color:#f0c030;font-weight:bold;text-align:center;">${s.level}</td>
                    <td style="padding:7px 12px;color:#888;text-align:right;font-family:monospace;">${fmtXp(s.xp)}</td>
                  </tr>`).join('');

                const playerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${username} — Resource Terminal</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a08; color:#c8c8b8; font-family:Arial,sans-serif; min-height:100vh; }
.page { max-width:560px; margin:0 auto; padding:30px 16px 60px; }
nav { margin-bottom:24px; font-size:13px; }
nav a { color:#8ebc44; text-decoration:none; margin-right:16px; }
nav a:hover { text-decoration:underline; }
h1 { font-family:Georgia,serif; font-size:28px; color:#f0c030; margin-bottom:4px; }
.sub { color:#666; font-size:13px; margin-bottom:20px; }
.meta { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
.meta-pill { background:#1a1200; border:1px solid #3a2800; padding:6px 14px; border-radius:3px; font-size:13px; color:#888; }
.meta-pill span { color:#f0c030; font-weight:bold; }
.box { border:1px solid #3a3000; background:#0e0c04; overflow:hidden; }
.box-title { background:linear-gradient(180deg,#2a2400,#1a1600); border-bottom:1px solid #2a2000; padding:10px 14px; color:#f0c030; font-weight:bold; font-size:13px; }
table { width:100%; border-collapse:collapse; }
tr { border-bottom:1px solid #111008; }
tr:hover { background:#141008; }
th { padding:7px 12px; text-align:left; color:#555; font-size:11px; font-weight:normal; border-bottom:1px solid #2a2000; }
.back { display:inline-block; margin-top:20px; color:#555; font-size:12px; text-decoration:none; }
.back:hover { color:#8ebc44; }
</style>
</head>
<body>
<div class="page">
  <nav><a href="/">&#8592; Home</a><a href="/leaderboard">Leaderboard</a></nav>
  <h1>${username}</h1>
  <div class="sub">Resource Terminal player stats</div>
  <div class="meta">
    <div class="meta-pill">Total Level: <span>${totalLevel}</span></div>
    <div class="meta-pill">RST Earned: <span>${rst} RST</span></div>
    ${rank ? `<div class="meta-pill">Rank: <span>#${rank}</span></div>` : ''}
  </div>
  <div class="box">
    <div class="box-title">&#x1F4CA; Skills</div>
    <table>
      <thead><tr><th>Skill</th><th style="text-align:center;">Level</th><th style="text-align:right;">XP</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <a class="back" href="/leaderboard">&#8592; Back to Leaderboard</a>
</div>
</body></html>`;
                return new Response(playerHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            // RST: Server analytics stats
            if (url.pathname === '/rst/server-stats') {
                const { walletRegistry, getLeaderboard } = await import('../engine/pill/PillMerchant.js');
                return new Response(JSON.stringify({
                    online: Array.from(World.players).length,
                    wallets: walletRegistry.size,
                    leaderboard: getLeaderboard().length
                }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }

            if (url.pathname === '/rst/dragon-slayer-progress') {
                const { getTotalCommunityGP, isDragonSlayerEnabled, DRAGON_SLAYER_THRESHOLD_GP } = await import('../engine/pill/PillMerchant.js');
                const totalGP = getTotalCommunityGP();
                const threshold = DRAGON_SLAYER_THRESHOLD_GP;
                const pct = Math.min(100, (totalGP / threshold) * 100);
                return new Response(JSON.stringify({
                    enabled: isDragonSlayerEnabled(),
                    totalGP,
                    thresholdGP: threshold,
                    totalRST: totalGP / 1000,
                    thresholdRST: threshold / 1000,
                    pct: parseFloat(pct.toFixed(2)),
                }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }

            // RST: Activity analytics — top earners per 1h/6h/24h
            if (url.pathname === '/rst/activity') {
                const { activityLog } = await import('../engine/pill/PillMerchant.js');
                const now = Date.now();
                const windows: [string, number][] = [['1h', 3600000], ['6h', 21600000], ['24h', 86400000], ['7d', 7 * 86400000], ['30d', 30 * 86400000]];
                const result: Record<string, unknown> = {};
                for (const [label, ms] of windows) {
                    const cutoff = now - ms;
                    const events = activityLog.filter(e => e.timestamp >= cutoff);
                    const byUser = new Map<string, number>();
                    let totalGP = 0;
                    for (const e of events) {
                        byUser.set(e.username, (byUser.get(e.username) ?? 0) + e.gp);
                        totalGP += e.gp;
                    }
                    const top = Array.from(byUser.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([username, gp]) => ({ username, gp, rst: +(gp / 1000).toFixed(3) }));
                    result[label] = { top, totalGP, totalRST: +(totalGP / 1000).toFixed(3), players: byUser.size };
                }
                return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }

            // RST: Live price from NativeSwap LP
            if (url.pathname === '/rst/price') {
                const data = await fetchRstPrice();
                return new Response(JSON.stringify(data ?? { error: 'unavailable' }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }

            // RST: NFT metadata — serves OpenSea-compatible JSON for BankLog OP721
            const nftMatch = url.pathname.match(/^\/rst\/nft\/(\d+)\/?$/);
            if (nftMatch) {
                const tokenId = parseInt(nftMatch[1], 10);
                const { getBankLogEntry } = await import('../engine/pill/BankLogMinter.js');
                const entry = getBankLogEntry(tokenId);
                if (!entry) {
                    return new Response(JSON.stringify({ error: 'Token not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
                }
                const { username } = entry;

                // Parse .sav for live stats
                const savPath = `data/players/main/${username}.sav`;
                const { existsSync, readFileSync } = await import('fs');
                let totalLevel = 0;
                const skillAttrs: { trait_type: string; value: number }[] = [];
                if (existsSync(savPath)) {
                    const data = readFileSync(savPath);
                    const magic = (data[0] << 8) | data[1];
                    if (magic === 0x2004 && data.length >= 40) {
                        const version = (data[2] << 8) | data[3];
                        let pos = 24 + (version >= 2 ? 4 : 2);
                        const SKILL_NAMES = ['Attack','Defence','Strength','Hitpoints','Ranged','Prayer','Magic','Cooking','Woodcutting','Fletching','Fishing','Firemaking','Crafting','Smithing','Mining','Herblore','Agility','Thieving','Slayer','Farming','Runecrafting','Hunter','Construction'];
                        for (let i = 0; i < 21; i++) {
                            if (pos + 5 > data.length - 4) break;
                            const storedLevel = data[pos + 4];
                            pos += 5;
                            const name = SKILL_NAMES[i];
                            if (name === '—') continue;
                            const level = Math.min(storedLevel, 99);
                            totalLevel += level;
                            skillAttrs.push({ trait_type: name, value: level });
                        }
                    }
                }

                // Pull RST earned from leaderboard
                const { getLeaderboard } = await import('../engine/pill/PillMerchant.js');
                const lb = getLeaderboard();
                const lbEntry = lb.find((e: any) => e.username.toLowerCase() === username);
                const rstEarned = lbEntry ? +(lbEntry.rst || lbEntry.gp / 1000).toFixed(2) : 0;
                const rank = lbEntry ? lb.indexOf(lbEntry) + 1 : null;
                const score = totalLevel * 10 + Math.floor(rstEarned * 5);

                const metadata = {
                    name: `${username}'s Bank Log`,
                    description: `Verified in-game identity on Bitcoin L1. Total Level: ${totalLevel}. RST Earned: ${rstEarned}. Score: ${score}.`,
                    image: `https://runescaperesourceterminal.duckdns.org/favicon.ico`,
                    external_url: `https://runescaperesourceterminal.duckdns.org/rst/player/${encodeURIComponent(username)}`,
                    attributes: [
                        { trait_type: 'Total Level', value: totalLevel },
                        { trait_type: 'RST Earned', value: rstEarned },
                        { trait_type: 'Score', value: score },
                        ...(rank ? [{ trait_type: 'Leaderboard Rank', value: rank }] : []),
                        ...skillAttrs,
                    ],
                };
                return new Response(JSON.stringify(metadata, null, 2), {
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
                const { pendingGP, grantedGP, totalGPConverted, walletRegistry, claimedRegistry } = await import('../engine/pill/PillMerchant.js');
                const pending = pendingGP.get(username) ?? 0;
                const granted = grantedGP.get(username) ?? 0;
                const totalGP = totalGPConverted.get(username) ?? 0;
                const wallet = walletRegistry.get(username) ?? null;
                const hasClaimedBefore = claimedRegistry.has(username);
                return new Response(JSON.stringify({ username, pending, granted, totalGP, rstPending: pending / 1000, rstGranted: granted / 1000, wallet, hasClaimedBefore }), {
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

            // Admin: World broadcast — send a game chat message to all connected players
            if (url.pathname === '/admin/broadcast' && req.method === 'POST') {
                const body = await req.json() as any;
                const message = String(body?.message ?? '').trim().slice(0, 200);
                if (!message) return new Response(JSON.stringify({ error: 'Empty message' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
                World.broadcastMes('[Bob] ' + message);
                const players = Array.from(World.players).length;
                console.log('[BROADCAST] "' + message + '" → ' + players + ' player(s)');
                return new Response(JSON.stringify({ ok: true, players }), { headers: { 'Content-Type': 'application/json' } });
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

            // RST: Earned staking rewards — persistent cross-device tracking
            if (url.pathname === '/rst/earned-rewards') {
                if (req.method === 'GET') {
                    const w = url.searchParams.get('wallet') ?? '';
                    const { earnedRewardsRegistry } = await import('../engine/pill/PillMerchant.js');
                    const earned = earnedRewardsRegistry.get(w) ?? 0;
                    return new Response(JSON.stringify({ earned }), {
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                    });
                }
                if (req.method === 'POST') {
                    const body = await req.json() as any;
                    const w = body.wallet ?? '';
                    const amount = parseFloat(body.amount) || 0;
                    if (!w || amount <= 0) return new Response(JSON.stringify({ error: 'Invalid' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
                    const { earnedRewardsRegistry, saveEarnedRewards } = await import('../engine/pill/PillMerchant.js');
                    const prev = earnedRewardsRegistry.get(w) ?? 0;
                    earnedRewardsRegistry.set(w, prev + amount);
                    saveEarnedRewards();
                    return new Response(JSON.stringify({ success: true, total: prev + amount }), {
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                    });
                }
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
                        player.invAdd(InvTypeMod.INV, result.itemId, result.itemQty ?? 1, false);
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

                        // Auto-mint Bank Log NFT on first wallet connect
                        if (mldsaKey) {
                            const { mintBankLog } = await import('../engine/pill/BankLogMinter.js');
                            mintBankLog(username, mldsaKey).catch((e: unknown) => console.error('[BankLog] auto-mint error:', e));
                        }

                        return new Response(JSON.stringify({ success: true, username, wallet, pendingGP: pending, hasMldsa: !!mldsaKey }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                    } catch (e: any) {
                        console.error('[RST] register-wallet error:', e.message);
                        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                    }
                }
            }

            // Roadmap page
            // News article pages
            if (url.pathname === '/news/world-gating') {
                return new Response(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>World Gating + Difficulty System — Resource Terminal</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a00;color:#c0a060;font-family:'Courier New',monospace;min-height:100vh}nav{background:#1a1200;border-bottom:2px solid #4a3800;padding:10px 24px;display:flex;gap:18px;flex-wrap:wrap}nav a{color:#8ebc44;text-decoration:none;font-size:0.85em}nav a:hover{color:#f0c030}.container{max-width:800px;margin:0 auto;padding:40px 24px}.tag{display:inline-block;background:#0a2000;border:1px solid #3a6000;color:#8ebc44;font-size:0.72em;padding:3px 10px;border-radius:3px;margin-bottom:16px}.headline{color:#f0c030;font-size:2em;font-weight:bold;margin-bottom:8px;line-height:1.2}.dateline{color:#666;font-size:0.8em;margin-bottom:28px;border-bottom:1px solid #2a2000;padding-bottom:16px}.body p{color:#aaa;line-height:1.8;margin-bottom:16px;font-size:0.95em}.body h3{color:#f0c030;font-size:1.1em;margin:24px 0 10px}.body ul{color:#aaa;line-height:1.8;padding-left:20px;margin-bottom:16px}.body ul li{margin-bottom:6px}.cta{display:inline-block;margin-top:28px;background:#f7931a;color:#000;padding:10px 24px;font-family:monospace;font-weight:bold;text-decoration:none;border-radius:3px}.cta:hover{background:#e07800}</style>
</head>
<body>
<nav><a href="/">&#8592; Home</a><a href="/play">Play Now</a><a href="/difficulty">Difficulty</a><a href="/roadmap">Roadmap</a></nav>
<div class="container">
  <span class="tag">UPDATE &mdash; Mar-2026</span>
  <div class="headline">World Gating + Difficulty System Live</div>
  <div class="dateline">March 2026 &mdash; Resource Terminal</div>
  <div class="body">
    <p>The World Gating system is now live on Resource Terminal. Your RST balance directly determines which zones of the world you can access, creating a meaningful progression loop tied to on-chain token ownership.</p>
    <h3>How It Works</h3>
    <ul>
      <li><strong style="color:#ff4444">Tier 0 — EXTREMELY HARDCORE</strong>: 0–9 RST. Misthalin only. Cut trees, sell logs, survive.</li>
      <li><strong style="color:#f7931a">Tier 1 — HARD MODE</strong>: 10–999 RST. Asgarnia, Falador, Port Sarim, Wilderness unlocked.</li>
      <li><strong style="color:#44cc44">Tier 2 — NORMAL</strong>: 1,000+ RST. Full world access. All content available.</li>
    </ul>
    <h3>Difficulty Index</h3>
    <p>Your current difficulty tier is displayed in the sidebar after connecting your OP_WALLET. The server checks your RST balance every 60 seconds and updates your access accordingly.</p>
    <h3>Why This Matters</h3>
    <p>World gating makes RST ownership meaningful beyond speculation. Holding RST literally changes what you can do in the game. It creates a natural on-ramp: new players start in Misthalin, earn RST by chopping and selling, then unlock more of the world as they accumulate tokens.</p>
    <a class="cta" href="/play">&#x2694;&#xFE0F; Start Playing</a>
  </div>
</div>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            if (url.pathname === '/news/rst-staking') {
                return new Response(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>$RST Staking (sRST) Deployed — Resource Terminal</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a00;color:#c0a060;font-family:'Courier New',monospace;min-height:100vh}nav{background:#1a1200;border-bottom:2px solid #4a3800;padding:10px 24px;display:flex;gap:18px;flex-wrap:wrap}nav a{color:#8ebc44;text-decoration:none;font-size:0.85em}nav a:hover{color:#f0c030}.container{max-width:800px;margin:0 auto;padding:40px 24px}.tag{display:inline-block;background:#0a2000;border:1px solid #3a6000;color:#8ebc44;font-size:0.72em;padding:3px 10px;border-radius:3px;margin-bottom:16px}.headline{color:#f0c030;font-size:2em;font-weight:bold;margin-bottom:8px;line-height:1.2}.dateline{color:#666;font-size:0.8em;margin-bottom:28px;border-bottom:1px solid #2a2000;padding-bottom:16px}.body p{color:#aaa;line-height:1.8;margin-bottom:16px;font-size:0.95em}.body h3{color:#f0c030;font-size:1.1em;margin:24px 0 10px}.body ul{color:#aaa;line-height:1.8;padding-left:20px;margin-bottom:16px}.body ul li{margin-bottom:6px}.tier-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid #2a2000;border-radius:4px;margin-bottom:8px;background:#0e0e00}.tier-name{color:#f0c030;font-weight:bold;min-width:120px}.tier-detail{color:#888;font-size:0.88em}.cta{display:inline-block;margin-top:28px;background:#f7931a;color:#000;padding:10px 24px;font-family:monospace;font-weight:bold;text-decoration:none;border-radius:3px}.cta:hover{background:#e07800}</style>
</head>
<body>
<nav><a href="/">&#8592; Home</a><a href="/play">Play Now</a><a href="/tokenomics">Tokenomics</a><a href="/roadmap">Roadmap</a></nav>
<div class="container">
  <span class="tag">UPDATE &mdash; Mar-2026</span>
  <div class="headline">$RST Staking (sRST) Deployed</div>
  <div class="dateline">March 2026 &mdash; Resource Terminal</div>
  <div class="body">
    <p>The RST MasterChef staking contract (V2) is now live on Bitcoin mainnet via OPNet. Players can stake their RST tokens to earn sRST rewards, with four lockup tiers offering different multipliers and early-exit penalties.</p>
    <h3>Staking Tiers</h3>
    <div class="tier-row"><span class="tier-name">Flexible</span><span class="tier-detail">1&times; multiplier &mdash; No lockup &mdash; 20% early exit penalty</span></div>
    <div class="tier-row"><span class="tier-name">30-Day</span><span class="tier-detail">5&times; multiplier &mdash; 4,320 block lockup &mdash; 10% early exit penalty</span></div>
    <div class="tier-row"><span class="tier-name">90-Day</span><span class="tier-detail">4&times; multiplier &mdash; 12,960 block lockup &mdash; 1% early exit penalty</span></div>
    <div class="tier-row"><span class="tier-name">180-Day</span><span class="tier-detail">2.5&times; multiplier &mdash; 25,920 block lockup &mdash; 0% early exit penalty</span></div>
    <h3>How to Stake</h3>
    <p>Connect your OP_WALLET in the sidebar on the play page. Once connected, the staking panel appears automatically. Select a tier, enter an amount, and sign the transaction. Rewards accumulate on every block and can be claimed at any time.</p>
    <h3>Contract</h3>
    <p>The sRST staking contract is deployed on OPNet Bitcoin mainnet. All staking logic is on-chain — no custodians, no servers holding your tokens.</p>
    <a class="cta" href="/play">&#x20BF; Stake RST Now</a>
  </div>
</div>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            if (url.pathname === '/news/rst-v8') {
                return new Response(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RST v8 — Full End-to-End Claim Working — Resource Terminal</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a00;color:#c0a060;font-family:'Courier New',monospace;min-height:100vh}nav{background:#1a1200;border-bottom:2px solid #4a3800;padding:10px 24px;display:flex;gap:18px;flex-wrap:wrap}nav a{color:#8ebc44;text-decoration:none;font-size:0.85em}nav a:hover{color:#f0c030}.container{max-width:800px;margin:0 auto;padding:40px 24px}.tag{display:inline-block;background:#0a2000;border:1px solid #3a6000;color:#8ebc44;font-size:0.72em;padding:3px 10px;border-radius:3px;margin-bottom:16px}.headline{color:#f0c030;font-size:2em;font-weight:bold;margin-bottom:8px;line-height:1.2}.dateline{color:#666;font-size:0.8em;margin-bottom:28px;border-bottom:1px solid #2a2000;padding-bottom:16px}.body p{color:#aaa;line-height:1.8;margin-bottom:16px;font-size:0.95em}.body h3{color:#f0c030;font-size:1.1em;margin:24px 0 10px}.body ul{color:#aaa;line-height:1.8;padding-left:20px;margin-bottom:16px}.body ul li{margin-bottom:6px}.flow-step{display:flex;align-items:flex-start;gap:14px;padding:10px 0;border-bottom:1px solid #1a1200}.flow-num{color:#f7931a;font-weight:bold;font-size:1.1em;min-width:24px}.flow-text{color:#aaa;font-size:0.9em;line-height:1.6}.cta{display:inline-block;margin-top:28px;background:#f7931a;color:#000;padding:10px 24px;font-family:monospace;font-weight:bold;text-decoration:none;border-radius:3px}.cta:hover{background:#e07800}</style>
</head>
<body>
<nav><a href="/">&#8592; Home</a><a href="/play">Play Now</a><a href="/tokenomics">Tokenomics</a><a href="/roadmap">Roadmap</a></nav>
<div class="container">
  <span class="tag">MILESTONE &mdash; Mar-2026</span>
  <div class="headline">RST v8 — Full End-to-End Claim Working</div>
  <div class="dateline">March 2026 &mdash; Resource Terminal</div>
  <div class="body">
    <p>RST v8 marks the first fully working end-to-end flow for earning and claiming RST tokens — from chopping a tree in-game to holding RST in your OP_WALLET on Bitcoin mainnet.</p>
    <h3>The Full Flow</h3>
    <div class="flow-step"><span class="flow-num">1</span><span class="flow-text">Connect OP_WALLET and register your username in the sidebar</span></div>
    <div class="flow-step"><span class="flow-num">2</span><span class="flow-text">Chop trees and sell logs to Bob the Resource Broker in-game for GP</span></div>
    <div class="flow-step"><span class="flow-num">3</span><span class="flow-text">GP accumulates server-side and automatically converts to RST via grantClaim on Bitcoin</span></div>
    <div class="flow-step"><span class="flow-num">4</span><span class="flow-text">The sidebar updates showing your pending RST. Click CLAIM RST and sign with OP_WALLET</span></div>
    <div class="flow-step"><span class="flow-num">5</span><span class="flow-text">RST lands in your OP_WALLET. Fully on-chain, fully yours.</span></div>
    <h3>What Makes v8 Special</h3>
    <p>Previous versions had issues with MLDSA key registration, sender identity resolution, and transaction signing. v8 resolves all of these. The server correctly identifies the player's on-chain identity, grantClaim executes without reverting, and the browser wallet signs and broadcasts in one step.</p>
    <a class="cta" href="/play">&#x2694;&#xFE0F; Play &amp; Earn RST</a>
  </div>
</div>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            if (url.pathname === '/news/motoswap-lp') {
                return new Response(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MotoSwap LP Created — Resource Terminal</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a00;color:#c0a060;font-family:'Courier New',monospace;min-height:100vh}nav{background:#1a1200;border-bottom:2px solid #4a3800;padding:10px 24px;display:flex;gap:18px;flex-wrap:wrap}nav a{color:#8ebc44;text-decoration:none;font-size:0.85em}nav a:hover{color:#f0c030}.container{max-width:800px;margin:0 auto;padding:40px 24px}.tag{display:inline-block;background:#0a2000;border:1px solid #3a6000;color:#8ebc44;font-size:0.72em;padding:3px 10px;border-radius:3px;margin-bottom:16px}.headline{color:#f0c030;font-size:2em;font-weight:bold;margin-bottom:8px;line-height:1.2}.dateline{color:#666;font-size:0.8em;margin-bottom:28px;border-bottom:1px solid #2a2000;padding-bottom:16px}.body p{color:#aaa;line-height:1.8;margin-bottom:16px;font-size:0.95em}.body h3{color:#f0c030;font-size:1.1em;margin:24px 0 10px}.stat-box{background:#0e0e00;border:1px solid #2a2000;border-radius:4px;padding:14px 18px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}.stat-label{color:#888;font-size:0.85em}.stat-val{color:#f0c030;font-weight:bold}.cta{display:inline-block;margin-top:28px;background:#f7931a;color:#000;padding:10px 24px;font-family:monospace;font-weight:bold;text-decoration:none;border-radius:3px}.cta:hover{background:#e07800}</style>
</head>
<body>
<nav><a href="/">&#8592; Home</a><a href="/play">Play Now</a><a href="/tokenomics">Tokenomics</a><a href="/roadmap">Roadmap</a></nav>
<div class="container">
  <span class="tag">MILESTONE &mdash; Mar-2026</span>
  <div class="headline">MotoSwap LP Created</div>
  <div class="dateline">March 2026 &mdash; Resource Terminal</div>
  <div class="body">
    <p>The RST/BTC liquidity pool is now live on MotoSwap — OPNet's native DEX on Bitcoin. This makes RST tradeable on-chain for the first time, with real BTC as the pair asset.</p>
    <h3>LP Details</h3>
    <div class="stat-box"><span class="stat-label">DEX</span><span class="stat-val">MotoSwap (NativeSwap)</span></div>
    <div class="stat-box"><span class="stat-label">Pair</span><span class="stat-val">RST / BTC</span></div>
    <div class="stat-box"><span class="stat-label">Initial Supply to LP</span><span class="stat-val">500,000 RST</span></div>
    <div class="stat-box"><span class="stat-label">1% LP Burn</span><span class="stat-val">Active after setLPPair</span></div>
    <h3>What This Means</h3>
    <p>RST earned in-game can now be swapped for BTC directly on MotoSwap. The 1% transaction fee on LP trades is partially burned, creating deflationary pressure as trading volume grows. The remaining 500,000 RST (of the 1M total supply) is reserved for player claims via the grantClaim mechanism.</p>
    <h3>Trade RST</h3>
    <p>Visit MotoSwap at <a href="https://motoswap.org" target="_blank" style="color:#8ebc44">motoswap.org</a> and search for the RST contract to trade.</p>
    <a class="cta" href="/play">&#x2694;&#xFE0F; Earn RST to Trade</a>
  </div>
</div>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            if (url.pathname === '/news/alpha-launch') {
                return new Response(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resource Terminal Alpha Launch — Resource Terminal</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a00;color:#c0a060;font-family:'Courier New',monospace;min-height:100vh}nav{background:#1a1200;border-bottom:2px solid #4a3800;padding:10px 24px;display:flex;gap:18px;flex-wrap:wrap}nav a{color:#8ebc44;text-decoration:none;font-size:0.85em}nav a:hover{color:#f0c030}.container{max-width:800px;margin:0 auto;padding:40px 24px}.tag{display:inline-block;background:#0a2000;border:1px solid #3a6000;color:#8ebc44;font-size:0.72em;padding:3px 10px;border-radius:3px;margin-bottom:16px}.headline{color:#f0c030;font-size:2em;font-weight:bold;margin-bottom:8px;line-height:1.2}.dateline{color:#666;font-size:0.8em;margin-bottom:28px;border-bottom:1px solid #2a2000;padding-bottom:16px}.body p{color:#aaa;line-height:1.8;margin-bottom:16px;font-size:0.95em}.body h3{color:#f0c030;font-size:1.1em;margin:24px 0 10px}.body ul{color:#aaa;line-height:1.8;padding-left:20px;margin-bottom:16px}.body ul li{margin-bottom:6px}.highlight{background:#0a2000;border-left:3px solid #f7931a;padding:12px 16px;margin:20px 0;color:#c0a060;font-size:0.9em;line-height:1.7}.cta{display:inline-block;margin-top:28px;background:#f7931a;color:#000;padding:10px 24px;font-family:monospace;font-weight:bold;text-decoration:none;border-radius:3px}.cta:hover{background:#e07800}</style>
</head>
<body>
<nav><a href="/">&#8592; Home</a><a href="/play">Play Now</a><a href="/roadmap">Roadmap</a><a href="/tokenomics">Tokenomics</a></nav>
<div class="container">
  <span class="tag">LAUNCH &mdash; Feb-2026</span>
  <div class="headline">Resource Terminal Alpha Launch</div>
  <div class="dateline">February 2026 &mdash; Resource Terminal</div>
  <div class="body">
    <div class="highlight">The first Bitcoin-native play-to-earn RuneScape server is live. Chop trees. Sell resources. Earn real BTC-backed tokens.</div>
    <p>Resource Terminal launched in alpha in February 2026 — the first RuneScape-style MMO where in-game actions earn real on-chain tokens on Bitcoin via OPNet.</p>
    <h3>What Launched</h3>
    <ul>
      <li>Fully playable 2004-era RuneScape server (browser-based, no download)</li>
      <li>RST token contract deployed on OPNet Bitcoin mainnet</li>
      <li>Bob the Resource Broker — sell logs and resources for GP that converts to RST</li>
      <li>OP_WALLET integration for connecting Bitcoin identity to game account</li>
      <li>Real-time SSE-based RST claim flow</li>
    </ul>
    <h3>The Vision</h3>
    <p>Resource Terminal is an experiment in on-chain game economies. Every log chopped, every resource sold, every token earned is recorded on Bitcoin. The game is the interface. Bitcoin is the backend.</p>
    <h3>Alpha Status</h3>
    <p>The alpha is intentionally limited. Content is gated by RST balance. New zones, skills, and mechanics unlock as the ecosystem grows. This is the beginning — not the final form.</p>
    <a class="cta" href="/play">&#x2694;&#xFE0F; Join the Alpha</a>
  </div>
</div>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            if (url.pathname === '/roadmap') {
                const roadmapHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Roadmap — Resource Terminal</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a08; color:#c8c8b8; font-family:Arial,sans-serif; min-height:100vh; }
.page { max-width:760px; margin:0 auto; padding:30px 16px 60px; }
nav { margin-bottom:24px; font-size:13px; }
nav a { color:#8ebc44; text-decoration:none; margin-right:16px; }
nav a:hover { text-decoration:underline; }
h1 { font-family:Georgia,serif; font-size:36px; background:linear-gradient(180deg,#f0e080 0%,#c08010 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-bottom:6px; }
.sub { color:#888; font-size:14px; margin-bottom:28px; }
.phase { border:1px solid #3a3000; background:#0e0c04; margin-bottom:18px; overflow:hidden; }
.phase-header { padding:12px 16px; font-weight:bold; font-size:15px; display:flex; align-items:center; gap:10px; }
.phase-header.done { background:linear-gradient(90deg,#0a1f0a,#0e0c04); border-bottom:1px solid #1a3a1a; color:#44cc44; }
.phase-header.next { background:linear-gradient(90deg,#1a1400,#0e0c04); border-bottom:1px solid #3a2800; color:#f7931a; }
.phase-header.planned { background:linear-gradient(90deg,#141420,#0e0c04); border-bottom:1px solid #2a2a40; color:#8888ff; }
.phase-header.tbd { background:linear-gradient(90deg,#1a1420,#0e0c04); border-bottom:1px solid #3a2a40; color:#cc88ff; }
.phase-header.final { background:linear-gradient(90deg,#1a1000,#0e0c04); border-bottom:1px solid #4a3000; color:#f0c030; }
.phase-body { padding:14px 16px; }
.phase-body ul { list-style:none; padding:0; }
.phase-body ul li { padding:5px 0; font-size:14px; line-height:1.5; color:#c8c8b8; }
.phase-body ul li::before { content:""; margin-right:6px; }
.phase-body p { font-size:14px; color:#aaa; line-height:1.7; margin-bottom:8px; }
.badge-done { color:#44cc44; }
.badge-soon { color:#f7931a; }
.badge-plan { color:#8888ff; }
.mainnet { text-align:center; padding:20px; }
.mainnet h3 { color:#f0c030; font-size:18px; margin-bottom:8px; }
.mainnet p { color:#888; font-size:13px; line-height:1.7; }
.cta { display:inline-block; margin-top:24px; background:linear-gradient(180deg,#5a1010,#3a0808); border:1px solid #8a2020; color:#f0c030; padding:10px 24px; text-decoration:none; font-weight:bold; }
.cta:hover { background:linear-gradient(180deg,#7a2020,#5a1010); }
</style>
</head>
<body>
<div class="page">
  <nav><a href="/">&#8592; Home</a><a href="/play">Play Now</a><a href="/tokenomics">Tokenomics</a><a href="/difficulty">Difficulty</a></nav>
  <h1>&#x1F5FA; Roadmap</h1>
  <div class="sub">From Testnet to Mainnet &mdash; the path ahead</div>

  <div class="phase">
    <div class="phase-header done">&#x2705; V1 &mdash; FOUNDATION <span style="font-size:12px;font-weight:normal;color:#44aa44;">(Live)</span></div>
    <div class="phase-body">
      <ul>
        <li><span class="badge-done">&#x2705;</span> OP20 Contract deployed on BTC L1 (Testnet)</li>
        <li><span class="badge-done">&#x2705;</span> Basic earn &amp; claim system (chop trees &#x2192; sell &#x2192; claim RST)</li>
        <li><span class="badge-done">&#x2705;</span> LP pool available on MotoSwap &mdash; RST tradeable</li>
        <li><span class="badge-done">&#x2705;</span> 1% swap burn on every trade</li>
        <li><span class="badge-done">&#x2705;</span> Difficulty system &mdash; unlock world by earning RST</li>
        <li><span class="badge-done">&#x2705;</span> OG Rank airdrop tracking for V1 LP traders</li>
        <li><span class="badge-done">&#x2705;</span> sRST staking contract &mdash; stake RST, earn rewards</li>
        <li><span class="badge-done">&#x2705;</span> Stake 10+ RST &#x2192; instantly unlock Hard Mode (skip the grind)</li>
      </ul>
    </div>
  </div>

  <div class="phase">
    <div class="phase-header next">&#x1F504; V2 &mdash; STAKING &amp; REWARDS <span style="font-size:12px;font-weight:normal;color:#cc7700;">(Upcoming)</span></div>
    <div class="phase-body">
      <ul>
        <li><span class="badge-soon">&#x1F539;</span> 1% swap fee now split 3 ways: LP providers, Deployer, sRST stakers</li>
        <li><span class="badge-soon">&#x1F539;</span> sRST burn/convert mechanism &mdash; grow the staking reward pool</li>
        <li><span class="badge-soon">&#x1F539;</span> Blacklist mechanism</li>
        <li><span class="badge-soon">&#x1F539;</span> Fishing &amp; Cooking now unlocked! Catch raw fish and sell them to the general store (or cook them for double &mdash; careful, don&apos;t burn ALL your food ;)</li>
        <li><span class="badge-soon">&#x1F539;</span> Veteran Rank awarded to V2 participants</li>
      </ul>
    </div>
  </div>

  <div class="phase">
    <div class="phase-header planned">&#x1F6A7; V3 &mdash; EXPANDED ECONOMY <span style="font-size:12px;font-weight:normal;color:#6666cc;">(Planned)</span></div>
    <div class="phase-body">
      <ul>
        <li><span class="badge-plan">&#x1F537;</span> Smelting bars, Creating Runes (Runecrafting) and making potions &mdash; all tradeable for RST</li>
        <li><span class="badge-plan">&#x1F537;</span> Farming &amp; Yield Farming</li>
        <li><span class="badge-plan">&#x1F537;</span> Bob &amp; Satoshi live AI in-game chatbot</li>
        <li><span class="badge-plan">&#x1F537;</span> Deeper crafting &#x2192; on-chain item economy &amp; the introduction of the bank value system (mint your progress to chain)</li>
      </ul>
    </div>
  </div>

  <div class="phase">
    <div class="phase-header tbd">&#x1F4BC; V4 &mdash; TBD <span style="font-size:12px;font-weight:normal;color:#aa66dd;">(Master Rank)</span></div>
    <div class="phase-body">
      <p>Scope depends on community growth and roadmap progress. Master Rank holders shape the direction.</p>
    </div>
  </div>

  <div class="phase">
    <div class="phase-header final">&#x1F3C6; MAINNET LAUNCH &mdash; THE FINAL MILESTONE</div>
    <div class="mainnet">
      <h3>Real Bitcoin. Real RST.</h3>
      <p>All ranks carried over. OG / Veteran / Officer / Master wallets recognised at launch.</p>
      <p style="margin-top:8px;">The grind you do on Testnet counts. <strong style="color:#f0c030;">Your wallet history is your reputation.</strong></p>
    </div>
  </div>

  <div style="text-align:center;margin-top:8px;">
    <a class="cta" href="/play">&#x2694;&#xFE0F; Start Earning RST Now</a>
  </div>
</div>
</body>
</html>`;
                return new Response(roadmapHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            // Tokenomics page
            if (url.pathname === '/tokenomics') {
                const tokenomicsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tokenomics — $RST — Resource Terminal</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a08; color:#c8c8b8; font-family:Arial,sans-serif; min-height:100vh; }
.page { max-width:760px; margin:0 auto; padding:30px 16px 60px; }
nav { margin-bottom:24px; font-size:13px; }
nav a { color:#8ebc44; text-decoration:none; margin-right:16px; }
nav a:hover { text-decoration:underline; }
h1 { font-family:Georgia,serif; font-size:36px; background:linear-gradient(180deg,#f0e080 0%,#c08010 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-bottom:6px; }
.sub { color:#888; font-size:14px; margin-bottom:28px; }
.box { border:1px solid #3a3000; background:#0e0c04; margin-bottom:18px; overflow:hidden; }
.box-title { padding:12px 16px; font-weight:bold; font-size:14px; background:linear-gradient(90deg,#2a1800,#0e0c04); border-bottom:1px solid #3a2000; color:#f7931a; }
.box-body { padding:16px; }
.box-body p { font-size:14px; line-height:1.7; color:#c8c8b8; margin-bottom:10px; }
.box-body ul { list-style:none; padding:0; }
.box-body ul li { padding:5px 0; font-size:14px; line-height:1.5; color:#c8c8b8; }
.supply-bar { background:#1a1600; border:1px solid #2a2000; border-radius:4px; overflow:hidden; height:28px; margin:12px 0; display:flex; }
.supply-lp { background:linear-gradient(90deg,#5a3000,#3a1800); height:100%; width:50%; display:flex; align-items:center; justify-content:center; font-size:12px; color:#f7931a; font-weight:bold; }
.supply-play { background:linear-gradient(90deg,#0a3a0a,#061806); height:100%; width:50%; display:flex; align-items:center; justify-content:center; font-size:12px; color:#44cc44; font-weight:bold; }
.contract-addr { font-family:monospace; font-size:11px; color:#888; background:#080808; border:1px solid #2a2000; padding:8px 10px; margin-top:8px; word-break:break-all; }
.contract-addr span { color:#f7931a; }
.rank-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:4px; }
.rank-card { background:#080808; border:1px solid #2a2000; padding:10px; text-align:center; }
.rank-icon { font-size:24px; display:block; margin-bottom:4px; }
.rank-name { color:#f0c030; font-weight:bold; font-size:13px; }
.rank-desc { color:#666; font-size:11px; margin-top:3px; }
.step { display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-bottom:1px solid #111008; }
.step:last-child { border-bottom:none; }
.step-num { background:#3a2000; color:#f7931a; font-weight:bold; font-size:13px; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px; }
.step-text { font-size:14px; line-height:1.5; color:#c8c8b8; }
.cta { display:inline-block; margin-top:20px; background:linear-gradient(180deg,#102010,#081008); border:1px solid #208020; color:#44cc44; padding:10px 24px; text-decoration:none; font-weight:bold; }
.cta:hover { background:linear-gradient(180deg,#204020,#102010); }
.cta-orange { background:linear-gradient(180deg,#5a1010,#3a0808); border-color:#8a2020; color:#f0c030; }
.cta-orange:hover { background:linear-gradient(180deg,#7a2020,#5a1010); }
</style>
</head>
<body>
<div class="page">
  <nav><a href="/">&#8592; Home</a><a href="/play">Play Now</a><a href="/roadmap">Roadmap</a><a href="/difficulty">Difficulty</a></nav>
  <h1>&#x20BF; Tokenomics</h1>
  <div class="sub">RST &mdash; Runescape Resource Terminal Token &mdash; BTC L1 OP20</div>

  <div class="box">
    <div class="box-title">&#x1F7E0; V1 CONTRACT &mdash; LIVE NOW (Testnet)</div>
    <div class="box-body">
      <p><strong style="color:#f0c030;">Total Supply: 1,000,000 RST</strong></p>
      <div class="supply-bar">
        <div class="supply-lp">500,000 RST &mdash; LP</div>
        <div class="supply-play">500,000 RST &mdash; Players</div>
      </div>
      <ul>
        <li>&#x1F4B0; 500,000 RST &mdash; Deployer reserve (LP seeding)</li>
        <li>&#x1F3AE; 500,000 RST &mdash; Player claim pool (earn in-game &#x2192; claim on-chain)</li>
        <li>&#x2705; Basic earn &amp; claim system active &mdash; chop logs, sell to merchant, claim RST to your wallet</li>
        <li>&#x2705; LP pool live on MotoSwap NativeSwap &mdash; RST tradeable now</li>
        <li>&#x1F525; 1% swap fee on every trade goes to the LP</li>
      </ul>
      <div class="contract-addr">V1 Contract: <span>opt1sqzvnq5yetkcnwqzz02h23ch8294kgt0hxvvt9xyw</span></div>
    </div>
  </div>

  <div class="box">
    <div class="box-title">&#x1F451; RANKS &mdash; Earn Your Place on Mainnet</div>
    <div class="box-body">
      <p>Early players earn ranks. Ranks carry to Mainnet. Your wallet history is your reputation.</p>
      <div class="rank-grid">
        <div class="rank-card"><span class="rank-icon">&#x1F947;</span><div class="rank-name">OG</div><div class="rank-desc">V1 LP traders</div></div>
        <div class="rank-card"><span class="rank-icon">&#x1F396;</span><div class="rank-name">Veteran</div><div class="rank-desc">V2 stakers</div></div>
        <div class="rank-card"><span class="rank-icon">&#x1F6E1;</span><div class="rank-name">Officer</div><div class="rank-desc">V3 participants</div></div>
        <div class="rank-card"><span class="rank-icon">&#x1F451;</span><div class="rank-name">Master</div><div class="rank-desc">V4 &mdash; TBD</div></div>
      </div>
    </div>
  </div>

  <div class="box">
    <div class="box-title">&#x1F4C8; HOW TO EARN RST</div>
    <div class="box-body">
      <p>This is a BTC L1 Free-to-Play, Play-to-Earn game. <strong style="color:#44cc44;">No purchase required.</strong></p>
      <div class="step"><div class="step-num">1</div><div class="step-text">Download <a href="https://opnet.org/opwallet/" target="_blank" style="color:#8ebc44;">OP_WALLET</a></div></div>
      <div class="step"><div class="step-num">2</div><div class="step-text">Load Bitcoin (testnet BTC for now &mdash; Mainnet at launch)</div></div>
      <div class="step"><div class="step-num">3</div><div class="step-text">Connect wallet &#x2192; enter username &#x2192; play</div></div>
      <div class="step"><div class="step-num">4</div><div class="step-text">Mine ores, chop trees, sell resources &#x2192; GP converts to RST</div></div>
      <div class="step"><div class="step-num">5</div><div class="step-text">Claim RST directly to your Bitcoin wallet on-chain</div></div>
      <p style="margin-top:12px;color:#888;font-size:13px;">Conversion rate: 1,000 GP = 1 RST</p>
    </div>
  </div>

  <div class="box">
    <div class="box-title">&#x1F512; STAKING CONTRACT &mdash; sRST</div>
    <div class="box-body">
      <p>Lock your RST to earn staking rewards. Longer locks = higher multiplier. All locks are enforced on-chain.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;">
        <thead>
          <tr style="border-bottom:1px solid #444;color:#f0c030;">
            <th style="text-align:left;padding:8px 10px;">Tier</th>
            <th style="text-align:center;padding:8px 10px;">Multiplier</th>
            <th style="text-align:center;padding:8px 10px;">Lock</th>
            <th style="text-align:center;padding:8px 10px;">Exit Fee</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid #333;">
            <td style="padding:8px 10px;">&#x1F7E2; Flexible</td>
            <td style="text-align:center;padding:8px 10px;">1&times;</td>
            <td style="text-align:center;padding:8px 10px;color:#888;">No lock</td>
            <td style="text-align:center;padding:8px 10px;color:#ff8844;">20% (anytime)</td>
          </tr>
          <tr style="border-bottom:1px solid #333;">
            <td style="padding:8px 10px;">&#x1F7E1; 30-Day</td>
            <td style="text-align:center;padding:8px 10px;color:#f0c030;font-weight:bold;">5&times;</td>
            <td style="text-align:center;padding:8px 10px;color:#ff4444;">HARD LOCK</td>
            <td style="text-align:center;padding:8px 10px;color:#ff8844;">10% (after expiry)</td>
          </tr>
          <tr style="border-bottom:1px solid #333;">
            <td style="padding:8px 10px;">&#x1F7E0; 90-Day</td>
            <td style="text-align:center;padding:8px 10px;color:#f0c030;font-weight:bold;">4&times;</td>
            <td style="text-align:center;padding:8px 10px;color:#ff4444;">HARD LOCK</td>
            <td style="text-align:center;padding:8px 10px;color:#ff8844;">5% (after expiry)</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;">&#x1F534; 180-Day</td>
            <td style="text-align:center;padding:8px 10px;color:#f0c030;font-weight:bold;">2.5&times;</td>
            <td style="text-align:center;padding:8px 10px;color:#ff4444;">HARD LOCK</td>
            <td style="text-align:center;padding:8px 10px;color:#44cc44;">1% (after expiry)</td>
          </tr>
        </tbody>
      </table>
      <p style="color:#888;font-size:12px;">Exit fees are burned. Hard locks cannot be broken early — funds are inaccessible until the lock expires on-chain.</p>
      <div class="contract-addr">sRST Contract: <span>opt1sqzn9sjwyjm9cwnfxn8ympasxpedt2mjzwuxww4tx</span></div>
    </div>
  </div>

  <div style="display:flex;gap:12px;margin-top:4px;flex-wrap:wrap;">
    <a class="cta cta-orange" href="/play">&#x2694;&#xFE0F; Play &amp; Earn Now</a>
    <a class="cta" href="https://motoswap.org" target="_blank">&#x1F4B1; Buy RST on MotoSwap</a>
  </div>
</div>
</body>
</html>`;
                return new Response(tokenomicsHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            // Difficulty page
            if (url.pathname === '/difficulty') {
                const difficultyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Difficulty — Resource Terminal</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a08; color:#c8c8b8; font-family:Arial,sans-serif; min-height:100vh; }
.page { max-width:800px; margin:0 auto; padding:30px 16px 60px; }
nav { margin-bottom:24px; font-size:13px; }
nav a { color:#8ebc44; text-decoration:none; margin-right:16px; }
nav a:hover { text-decoration:underline; }
h1 { font-family:Georgia,serif; font-size:36px; background:linear-gradient(180deg,#f0e080 0%,#c08010 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-bottom:6px; }
.sub { color:#888; font-size:14px; margin-bottom:28px; }
.phase { border:1px solid #3a3000; background:#0e0c04; margin-bottom:18px; overflow:hidden; }
.phase-header { padding:14px 18px; font-size:16px; font-weight:bold; display:flex; align-items:center; gap:12px; border-bottom:1px solid #2a2000; }
.phase-header.p1 { background:linear-gradient(90deg,#2a0808,#0e0c04); color:#ff4444; }
.phase-header.p2 { background:linear-gradient(90deg,#2a1a00,#0e0c04); color:#f7931a; }
.phase-header.p3 { background:linear-gradient(90deg,#0a2a0a,#0e0c04); color:#44cc44; }
.badge { font-size:12px; font-weight:normal; padding:3px 8px; border-radius:3px; }
.badge.p1 { background:#3a0808; color:#ff6666; }
.badge.p2 { background:#3a2000; color:#ffaa44; }
.badge.p3 { background:#0a2a0a; color:#66ee66; }
.phase-body { padding:16px 18px; }
.phase-body ul { list-style:none; columns:2; column-gap:20px; }
.phase-body ul li { padding:4px 0; font-size:13px; color:#c8c8b8; break-inside:avoid; }
.phase-body ul li::before { content:"\2022"; color:#666; margin-right:6px; }
.phase-body p { font-size:14px; color:#aaa; line-height:1.6; margin-bottom:6px; }
.earn-box { background:#080808; border:1px solid #2a2000; padding:14px; margin-top:14px; }
.earn-box h4 { color:#f0c030; margin-bottom:8px; }
.earn-box p { font-size:13px; color:#aaa; line-height:1.7; }
.guide-box { border:1px solid #2a3a1a; background:#081008; margin-top:24px; overflow:hidden; }
.guide-box-title { padding:12px 16px; background:linear-gradient(90deg,#0a2000,#081008); border-bottom:1px solid #1a3000; color:#8ebc44; font-weight:bold; }
.guide-body { padding:16px; }
.guide-body p { font-size:13px; color:#aaa; line-height:1.8; margin-bottom:12px; }
.guide-body p:last-child { margin-bottom:0; }
.guide-links { display:flex; gap:12px; padding:12px 16px; background:#060e04; border-top:1px solid #1a3000; flex-wrap:wrap; }
.guide-links a { color:#8ebc44; font-size:13px; text-decoration:none; }
.guide-links a:hover { text-decoration:underline; }
.cta { display:inline-block; margin-top:24px; background:linear-gradient(180deg,#5a1010,#3a0808); border:1px solid #8a2020; color:#f0c030; padding:10px 24px; text-decoration:none; font-weight:bold; }
.cta:hover { background:linear-gradient(180deg,#7a2020,#5a1010); }
</style>
</head>
<body>
<div class="page">
  <nav><a href="/">&#8592; Home</a><a href="/play">Play Now</a><a href="/roadmap">Roadmap</a><a href="/tokenomics">Tokenomics</a></nav>
  <h1>&#x1F30D; Difficulty System</h1>
  <div class="sub">Unlock more of the world by earning RST</div>

  <div class="phase">
    <div class="phase-header p1">&#x1F534; Phase 1 &mdash; Kingdom of Misthalin <span class="badge p1">0 RST &mdash; EXTREME HARDCORE</span></div>
    <div class="phase-body">
      <p>Everyone starts here. No RST required. No player trading.</p>
      <ul>
        <li>Lumbridge</li>
        <li>Draynor Village &amp; Draynor Manor</li>
        <li>Varrock &amp; Palace &amp; Lumber Yard</li>
        <li>Edgeville &amp; Cooks&apos; Guild</li>
        <li>Barbarian Village</li>
      </ul>
    </div>
  </div>

  <div class="phase">
    <div class="phase-header p2">&#x1F7E0; Phase 2 &mdash; Kingdom of Asgarnia <span class="badge p2">10 RST &mdash; HARD MODE</span></div>
    <div class="phase-body">
      <p>Earn 10 RST to unlock the western kingdom. 10,000 GP trade cap.</p>
      <ul>
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
  </div>

  <div class="phase">
    <div class="phase-header p3">&#x1F7E2; Phase 3 &mdash; Full World <span class="badge p3">1,000 RST or Stake &mdash; EASY MODE</span></div>
    <div class="phase-body">
      <p>Unlimited trading, full Gielinor. Two paths to unlock:</p>
      <ul>
        <li>Earn 1,000 RST &mdash; own it, no staking required</li>
        <li>Stake any RST &mdash; 10+ RST unlocks instantly</li>
        <li>Kandarin (Seers&apos; Village, Catherby, Ardougne)</li>
        <li>Morytania (Canifis, Barrows)</li>
        <li>Karamja (Brimhaven, TzHaar)</li>
        <li>Desert &amp; Feldip Hills &amp; Tirannwn, and more</li>
      </ul>
      <div class="earn-box">
        <h4>&#x1F4B0; How to Earn RST</h4>
        <p>Chop logs &#x2192; sell at General Store &#x2192; GP converts to RST automatically. <strong style="color:#f0c030;">1,000 GP = 1 RST.</strong><br>The harder you grind, the more you unlock. Can you reach the full world? &#x1F30D;</p>
      </div>
    </div>
  </div>

  <div class="guide-box">
    <div class="guide-box-title">&#x1F4D6; Player Guide &mdash; by the Triforce Sage</div>
    <div class="guide-body">
      <p>Playing RuneScape is a lot like playing chess &mdash; there are many different ways to go about it. This server runs on the 2004 RS2 client: the upgrade that defined a generation. No Grand Exchange, no bonds &mdash; just the grind.</p>
      <p>In 2004&ndash;2006, 1 million GP was worth $5 USD on the black market. Partyhats were 100M GP. The Venezuela gold farming era documented something fascinating: a broken national economy found real income in a virtual world. Jagex invented Bonds in 2013 to capture that market &mdash; essentially an in-game stablecoin backed by membership time, with a floating GP exchange rate. They became the biggest gold seller without anyone realising it.</p>
      <p>Resource Terminal takes the next step: on-chain settlement. The RWT market is already $50&ndash;120M/year in the dark. RST just makes it transparent and legitimate. The gap between &ldquo;this already happens&rdquo; and &ldquo;this happens on a chain&rdquo; is smaller than most people think.</p>
    </div>
    <div class="guide-links">
      <a href="https://oldschool.runescape.wiki/" target="_blank">&#x1F4D8; Official Wiki</a>
      <a href="/play">&#x2694;&#xFE0F; Start Playing</a>
      <a href="/roadmap">&#x1F5FA; Roadmap</a>
    </div>
  </div>

  <div style="margin-top:24px;text-align:center">
    <a href="/disclaimer" style="color:#555;font-size:11px;text-decoration:none" onmouseover="this.style.color='#8ebc44'" onmouseout="this.style.color='#555'">Non-Affiliation Disclaimer &#x2197;</a>
  </div>

  <a class="cta" href="/play">&#x2694;&#xFE0F; Start Grinding</a>
</div>
</body>
</html>`;
                return new Response(difficultyHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            // Beginner's Guide
            if (url.pathname === '/guide') {
                const guideHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Beginner's Guide — Resource Terminal</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a08; color:#c8c8b8; font-family:Arial,sans-serif; min-height:100vh; }
.page { max-width:760px; margin:0 auto; padding:30px 16px 60px; }
nav { margin-bottom:24px; font-size:13px; }
nav a { color:#8ebc44; text-decoration:none; margin-right:16px; }
nav a:hover { text-decoration:underline; }
h1 { font-family:Georgia,serif; font-size:36px; background:linear-gradient(180deg,#f0e080 0%,#c08010 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-bottom:6px; }
.sub { color:#888; font-size:14px; margin-bottom:28px; }
.section { border:1px solid #3a2800; background:#0e0c04; margin-bottom:18px; overflow:hidden; }
.section-header { padding:12px 16px; font-weight:bold; font-size:15px; display:flex; align-items:center; gap:10px; background:linear-gradient(90deg,#1a1000,#0e0c04); border-bottom:1px solid #3a2800; color:#f0c030; }
.section-body { padding:16px; }
.section-body p { font-size:13px; color:#aaa; line-height:1.9; margin-bottom:12px; }
.section-body p:last-child { margin-bottom:0; }
.section-body ul { padding-left:20px; margin-bottom:12px; }
.section-body li { font-size:13px; color:#aaa; line-height:1.9; }
.step { display:flex; gap:12px; align-items:flex-start; margin-bottom:14px; }
.step-num { background:#3a2800; border:1px solid #f0c030; color:#f0c030; font-weight:bold; font-size:13px; min-width:28px; height:28px; display:flex; align-items:center; justify-content:center; border-radius:3px; flex-shrink:0; margin-top:2px; }
.step-text { font-size:13px; color:#aaa; line-height:1.8; }
.step-text strong { color:#f0c030; }
.highlight-box { background:#0a1800; border:1px solid #2a4000; border-left:3px solid #8ebc44; padding:12px 16px; margin:14px 0; border-radius:0 4px 4px 0; }
.highlight-box p { color:#8ebc44 !important; font-size:13px; line-height:1.8; margin:0 !important; }
.bitcoin-box { background:#100800; border:1px solid #4a2800; border-left:3px solid #f7931a; padding:12px 16px; margin:14px 0; border-radius:0 4px 4px 0; }
.bitcoin-box p { color:#f0a060 !important; font-size:13px; line-height:1.8; margin:0 !important; }
.convert-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:14px 0; font-size:13px; }
.convert-pill { background:#1a1200; border:1px solid #3a2800; color:#f0c030; padding:6px 14px; border-radius:3px; font-weight:bold; }
.convert-arrow { color:#555; font-size:18px; }
.cta { display:inline-block; margin-top:24px; background:linear-gradient(180deg,#5a1010,#3a0808); border:1px solid #8a2020; color:#f0c030; padding:10px 24px; text-decoration:none; font-weight:bold; }
.cta:hover { background:linear-gradient(180deg,#7a2020,#5a1010); }
footer-links { margin-top:18px; font-size:13px; }
</style>
</head>
<body>
<div class="page">
  <nav>
    <a href="/">&#x2190; Home</a>
    <a href="/play">Play Now</a>
    <a href="/roadmap">Roadmap</a>
  </nav>

  <h1>Beginner's Guide</h1>
  <p class="sub">New to Resource Terminal? Start here. Two skills, infinite grind, real Bitcoin.</p>

  <!-- WOODCUTTING -->
  <div class="section">
    <div class="section-header">&#x1FA93; Woodcutting — Your First Gold</div>
    <div class="section-body">
      <p>When you first spawn in Lumbridge, you have a woodcutting axe in your inventory. Trees are everywhere. This is where the grind begins.</p>

      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text"><strong>Find a tree.</strong> Walk east from Lumbridge castle. You'll see regular trees lining the path. Click on one — your character will start chopping automatically.</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text"><strong>Wait for logs.</strong> Each chop attempt has a chance of success based on your Woodcutting level. Logs will appear in your inventory. Keep chopping until your inventory fills up (28 slots).</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text"><strong>Sell at the General Store.</strong> Walk north to the Lumbridge General Store. Click "Sell" and sell all your logs. The shop pays GP based on supply and demand — the less logs they have in stock, the more they pay you.</div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-text"><strong>Repeat.</strong> Every 1,000 GP you earn converts to 1 RST automatically. The merchant handles it. You just grind.</div>
      </div>

      <div class="highlight-box">
        <p>&#x2B06; As your Woodcutting level grows, you unlock better trees: <strong>Willows</strong> (level 30) in Draynor Village, <strong>Maples</strong> (level 45), and <strong>Yews</strong> (level 60) in Edgeville — each paying significantly more GP per log.</p>
      </div>
    </div>
  </div>

  <!-- MINING -->
  <div class="section">
    <div class="section-header">&#x26CF;&#xFE0F; Mining — Digging for Bitcoin</div>
    <div class="section-body">
      <p>Mining is the second core skill. You need a pickaxe — buy one at the General Store for a few coins if you don't already have one. Then head to any mine.</p>

      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text"><strong>Get a pickaxe.</strong> A bronze pickaxe from the General Store will do to start. Better pickaxes require higher Mining levels — iron (level 1), steel (level 6), mithril (level 21), rune (level 41).</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text"><strong>Find a mine.</strong> The Varrock East Mine (northeast of Varrock) has iron, copper, and tin rocks. The Varrock West Mine has copper and tin. Click a rock to start mining it.</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text"><strong>Mine until full.</strong> Ore goes straight to your inventory. When you hit 28 items, walk to the Varrock East bank, deposit everything, then head back to the mine.</div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-text"><strong>Sell your ore.</strong> Bring your ores to the General Store or hold them. Iron ore pays well early game. Coal and mithril from the Mining Guild (level 60) pay the most.</div>
      </div>

      <div class="highlight-box">
        <p>&#x26A1; <strong>Power miners</strong> drop ore on the ground instead of banking — trading profit for faster XP. Once your Mining level is high enough to mine fast rocks, the XP rate matters more than the GP per trip.</p>
      </div>
    </div>
  </div>

  <!-- WHY IT MATTERS -->
  <div class="section">
    <div class="section-header">&#x20BF; Why This Matters — GP to Bitcoin</div>
    <div class="section-body">
      <p>Here's the part that's different from any other private server. Every GP you earn isn't just a number in a database — it gets converted to <strong style="color:#f7931a;">$RST</strong>, an OP20 token deployed on the Bitcoin blockchain via OPNet.</p>

      <div class="convert-row">
        <div class="convert-pill">Chop logs / Mine ore</div>
        <div class="convert-arrow">&#x2192;</div>
        <div class="convert-pill">Sell for GP</div>
        <div class="convert-arrow">&#x2192;</div>
        <div class="convert-pill">1,000 GP = 1 RST</div>
        <div class="convert-arrow">&#x2192;</div>
        <div class="convert-pill">RST on Bitcoin</div>
      </div>

      <div class="bitcoin-box">
        <p>OPNet is a smart contract layer that runs <em>inside</em> Bitcoin transactions using Tapscript. Your RST tokens are settled directly on the Bitcoin blockchain — not a sidechain, not a wrapped token, not a bridge. Real Bitcoin finality.</p>
      </div>

      <p>Once you have RST in your OP_WALLET, you can:</p>
      <ul>
        <li>Hold it &mdash; account value grows as more players join</li>
        <li>Stake it at the sRST contract to earn passive rewards from game fees</li>
        <li>Trade it on MotoSwap (NativeSwap) for BTC directly</li>
        <li>Use it to unlock harder areas of the game world</li>
      </ul>

      <p>The Venezuela gold farming era proved that broken economies could find real income in virtual ones. Jagex captured that market in 2013 with Bonds — an in-game stablecoin backed by membership. Resource Terminal goes further: <strong style="color:#f0c030;">the GP settlement is on-chain and transparent.</strong> Your grind is your ledger entry. Bob says so every hour.</p>

      <div class="highlight-box">
        <p>&#x1F9E0; The harder you grind, the more the world unlocks. Phase 1 (Misthalin) is free. Earn 10 RST and Asgarnia opens up. Hit 1,000 RST and the full world is yours — Karamja, Morytania, Kandarin, everything.</p>
      </div>
    </div>
  </div>

  <div style="margin-top:24px;text-align:center">
    <a href="/disclaimer" style="color:#555;font-size:11px;text-decoration:none" onmouseover="this.style.color='#8ebc44'" onmouseout="this.style.color='#555'">Non-Affiliation Disclaimer &#x2197;</a>
  </div>

  <a class="cta" href="/play">&#x2694;&#xFE0F; Start Grinding</a>
</div>
</body></html>`;
                return new Response(guideHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }

            // Homepage — landing page for Resource Terminal
            if (url.pathname === '/' || url.pathname === '/home') {
                const homepageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Resource Terminal - Bitcoin-Powered RuneScape</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0a0a08;
  background-image: radial-gradient(ellipse at 20% 50%, #1a1200 0%, transparent 50%),
                    radial-gradient(ellipse at 80% 20%, #0e0c00 0%, transparent 50%);
  font-family: Arial, Helvetica, sans-serif;
  color: #c8c8b8;
  min-height: 100vh;
  font-size: 14px;
}
/* Subtle coin texture overlay */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23f0c030' fill-opacity='0.03'%3E%3Ccircle cx='30' cy='30' r='12'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 0;
}
.page { position: relative; z-index: 1; max-width: 980px; margin: 0 auto; padding: 20px 16px 40px; }

/* ── TOP ROW ── */
.top-row { display: flex; gap: 20px; align-items: flex-start; margin-bottom: 18px; }
.logo-block { flex: 0 0 300px; text-align: center; }
.logo-title {
  font-size: 52px;
  font-weight: 900;
  letter-spacing: -1px;
  line-height: 1.0;
  background: linear-gradient(180deg, #f0e080 0%, #c08010 50%, #7a5000 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  text-shadow: none;
  font-family: Georgia, serif;
}
.logo-subtitle { color: #888; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; margin-top: 4px; }
.player-count { margin-top: 16px; color: #c8c8b8; font-size: 14px; }
.player-count strong { color: #f0c030; }
.rst-ticker {
  margin-top: 14px;
  display: inline-block;
  background: #1a1200;
  border: 1px solid #3a2800;
  border-radius: 4px;
  padding: 6px 14px;
  font-family: monospace;
  font-size: 13px;
  color: #f7931a;
  letter-spacing: 1px;
}

/* News box */
.news-box {
  flex: 1;
  border: 1px solid #3a3000;
  background: linear-gradient(135deg, #0e0c04 0%, #141000 100%);
  padding: 14px 16px;
}
.news-box h2 { text-align: center; color: #f0c030; font-size: 14px; font-weight: bold; margin-bottom: 12px; border-bottom: 1px solid #2a2000; padding-bottom: 8px; }
.news-list { list-style: none; }
.news-list li { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #111008; }
.news-list a { color: #8ebc44; text-decoration: none; font-size: 13px; }
.news-list a:hover { text-decoration: underline; color: #c0e060; }
.news-date { color: #666; font-size: 12px; white-space: nowrap; margin-left: 12px; }
.news-footer { margin-top: 10px; text-align: center; color: #888; font-size: 12px; }
.news-footer a { color: #8ebc44; text-decoration: none; }

/* ── RST PRICE TICKER ── */
.price-ticker {
  display: flex; align-items: center; gap: 0;
  font-size: 12px; font-family: monospace;
  flex-wrap: wrap;
}
.price-ticker-label { color: #f0c030; font-weight: bold; font-size: 12px; letter-spacing: 1px; padding-right: 12px; border-right: 1px solid #3a2800; margin-right: 12px; white-space: nowrap; }
.price-ticker-item { display: flex; align-items: center; gap: 5px; padding: 0 12px; border-right: 1px solid #2a2000; white-space: nowrap; }
.price-ticker-item:last-child { border-right: none; }
.price-ticker-key { color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
.price-ticker-val { color: #f0c030; font-weight: bold; }
.price-ticker-sub { color: #888; font-size: 10px; }
.price-ticker-link { color: #8ebc44; text-decoration: none; font-size: 11px; }
.price-ticker-link:hover { color: #c0e060; text-decoration: underline; }
.price-loading { color: #444; }

/* ── MAIN FEATURES ── */
.section-box {
  border: 1px solid #3a3000;
  background: linear-gradient(135deg, #0e0c04 0%, #141000 100%);
  padding: 14px 16px;
  margin-bottom: 18px;
}
.section-box h2 { text-align: center; color: #f0c030; font-size: 14px; font-weight: bold; margin-bottom: 16px; }
.features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.feature-card { text-align: center; }
.feature-icon { font-size: 42px; line-height: 1; margin-bottom: 8px; display: block; }
.feature-btn {
  display: block;
  background: linear-gradient(180deg, #5a1010 0%, #3a0808 100%);
  border: 1px solid #8a2020;
  color: #f0c030;
  font-size: 14px;
  font-weight: bold;
  padding: 8px 12px;
  margin-bottom: 8px;
  cursor: pointer;
  text-decoration: none;
  text-align: center;
}
.feature-btn:hover { background: linear-gradient(180deg, #7a2020 0%, #5a1010 100%); }
.feature-btn.blue {
  background: linear-gradient(180deg, #103050 0%, #081830 100%);
  border-color: #205080;
}
.feature-btn.blue:hover { background: linear-gradient(180deg, #204060 0%, #103050 100%); }
.feature-btn.green {
  background: linear-gradient(180deg, #103010 0%, #081808 100%);
  border-color: #208020;
}
.feature-btn.green:hover { background: linear-gradient(180deg, #204020 0%, #103010 100%); }
.feature-desc { color: #c8c8b8; font-size: 13px; line-height: 1.5; }
.feature-link { display: block; color: #8ebc44; text-decoration: none; margin-top: 4px; font-size: 13px; }
.feature-link:hover { text-decoration: underline; }

/* ── BOTTOM GRID ── */
.bottom-row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.sub-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sub-card { border: 1px solid #2a2000; background: #0a0800; padding: 10px; }
.sub-card-title {
  text-align: center;
  background: linear-gradient(180deg, #2a2400 0%, #1a1600 100%);
  border: 1px solid #3a3000;
  color: #f0c030;
  font-size: 13px;
  font-weight: bold;
  padding: 6px;
  margin: -10px -10px 10px;
  display: block;
}
.sub-card-inner { display: flex; align-items: flex-start; gap: 8px; }
.sub-icon { font-size: 26px; flex-shrink: 0; line-height: 1; margin-top: 2px; }
.sub-text { font-size: 12px; color: #c8c8b8; line-height: 1.5; }
.sub-text a { color: #8ebc44; text-decoration: none; display: block; margin-top: 2px; }
.sub-text a:hover { text-decoration: underline; }

/* ── FOOTER ── */
footer { text-align: center; color: #444; font-size: 11px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #1a1600; }
footer a { color: #666; }

/* responsive */
@media (max-width: 700px) {
  .top-row { flex-direction: column; }
  .logo-block { flex: none; }
  .features-grid { grid-template-columns: 1fr 1fr; }
  .bottom-row { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="page">

  <!-- TOP ROW: Logo + News -->
  <div class="top-row">
    <div class="logo-block">
      <div class="logo-title">Resource<br>Terminal</div>
      <div class="logo-subtitle">Bitcoin-Powered RuneScape</div>
      <div class="rst-ticker">&#x20BF; $RST</div>
      <div class="player-count" id="playerCount">There are currently <strong>...</strong> people playing!</div>
      <div style="margin-top:14px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;" id="serverStats">
        <div style="background:#1a1200;border:1px solid #3a2800;border-radius:6px;padding:8px 18px;text-align:center;min-width:100px;">
          <div style="color:#f0c030;font-size:1.3em;font-weight:bold;" id="statOnline">—</div>
          <div style="color:#888;font-size:11px;margin-top:2px;">Online Now</div>
        </div>
        <div style="background:#1a1200;border:1px solid #3a2800;border-radius:6px;padding:8px 18px;text-align:center;min-width:100px;">
          <div style="color:#f0c030;font-size:1.3em;font-weight:bold;" id="statWallets">—</div>
          <div style="color:#888;font-size:11px;margin-top:2px;">Wallets</div>
        </div>
        <div style="background:#1a1200;border:1px solid #3a2800;border-radius:6px;padding:8px 18px;text-align:center;min-width:100px;">
          <div style="color:#f0c030;font-size:1.3em;font-weight:bold;" id="statLbEntries">—</div>
          <div style="color:#888;font-size:11px;margin-top:2px;">RST Holders</div>
        </div>
      </div>
    </div>

    <!-- Dragon Slayer Community Milestone Progress Bar -->
    <div id="dragonMilestone" style="margin:18px auto;max-width:480px;background:#1a0a00;border:1px solid #8b0000;border-radius:8px;padding:14px 20px;display:none;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="color:#ff4400;font-weight:bold;font-size:1.05em;">&#x1F409; DRAGON SLAYER QUEST</span>
        <span id="dsStatus" style="font-size:0.85em;color:#888;"></span>
      </div>
      <div id="dsUnlocked" style="display:none;color:#44cc44;font-weight:bold;text-align:center;padding:6px 0;font-size:1.1em;">&#x2705; UNLOCKED — Dragon Slayer is LIVE!</div>
      <div id="dsProgress" style="">
        <div style="font-size:0.82em;color:#aaa;margin-bottom:6px;">Community must earn <strong>10,000 RST</strong> from resources to unlock Dragon Slayer I</div>
        <div style="background:#0a0000;border-radius:4px;height:18px;overflow:hidden;border:1px solid #440000;">
          <div id="dsBar" style="height:100%;background:linear-gradient(90deg,#8b0000,#ff4400);border-radius:4px;width:0%;transition:width 0.8s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:0.78em;color:#888;">
          <span id="dsGPLabel">0 RST earned</span>
          <span id="dsPctLabel">0%</span>
        </div>
      </div>
    </div>

    <div class="news-box">
      <h2>Latest News &amp; Updates</h2>
      <ul class="news-list">
        <li><a href="/news/world-gating">World Gating + Difficulty System Live</a><span class="news-date">Mar-2026</span></li>
        <li><a href="/news/rst-staking">$RST Staking (sRST) Deployed</a><span class="news-date">Mar-2026</span></li>
        <li><a href="/news/rst-v8">RST v8 — Full End-to-End Claim Working</a><span class="news-date">Mar-2026</span></li>
        <li><a href="/news/motoswap-lp">MotoSwap LP Created</a><span class="news-date">Mar-2026</span></li>
        <li><a href="/news/alpha-launch">Resource Terminal Alpha Launch</a><span class="news-date">Feb-2026</span></li>
      </ul>
      <div class="news-footer">Earn RST by playing. &mdash; <a href="/play">Connect &amp; Play Now</a></div>
    </div>
  </div>

  <!-- TESTNET DISCLAIMER -->
  <div style="background:#1a0000;border:2px solid #cc0000;border-radius:6px;padding:10px 18px;margin-bottom:12px;text-align:center;">
    <span style="color:#ff2222;font-weight:bold;font-size:13px;letter-spacing:0.5px;">&#x26A0; This project is currently in testing phase on OP_NET Testnet &mdash; <a href="https://mempool.opnet.org/testnet4" target="_blank" rel="noopener" style="color:#ff6666;text-decoration:underline;">mempool.opnet.org/testnet4</a></span>
  </div>

  <!-- RST PRICE TICKER -->
  <div class="section-box" style="margin-bottom:18px;padding:8px 16px">
    <div class="price-ticker">
      <span class="price-ticker-label">&#x20BF; $RST</span>
      <div class="price-ticker-item">
        <span class="price-ticker-key">Price</span>
        <span class="price-ticker-val" id="rstPriceSats"><span class="price-loading">…</span></span>
        <span class="price-ticker-sub" id="rstPriceUSD"></span>
      </div>
      <div class="price-ticker-item">
        <span class="price-ticker-key">Pool</span>
        <span class="price-ticker-val" id="rstLiqRST"><span class="price-loading">…</span></span>
        <span class="price-ticker-sub" id="rstLiqBTC"></span>
      </div>
      <div class="price-ticker-item">
        <a class="price-ticker-link" href="https://motoswap.org/token/0xf4d9ed7f424ca09d41655eb2a3c69d559fd2fdd857a75ffbafa9373ce4ac62d4" target="_blank">Trade on MotoSwap &#x2197;</a>
      </div>
      <div class="price-ticker-item">
        <a class="price-ticker-link" href="https://opscan.org/tokens/0xf4d9ed7f424ca09d41655eb2a3c69d559fd2fdd857a75ffbafa9373ce4ac62d4?network=op_testnet" target="_blank">OPScan &#x2197;</a>
      </div>
    </div>
  </div>

  <!-- MAIN FEATURES -->
  <div class="section-box">
    <h2>Main Features</h2>
    <div class="features-grid">

      <div class="feature-card">
        <span class="feature-icon">&#x2694;&#xFE0F;</span>
        <a class="feature-btn" href="/play">Play Now<br><small>(Existing Account)</small></a>
        <div class="feature-desc">Play Resource Terminal &amp; earn $RST on Bitcoin.</div>
        <a class="feature-link" href="/play">Click Here</a>
      </div>

      <div class="feature-card">
        <span class="feature-icon">&#x1F4F2;</span>
        <a class="feature-btn blue" href="https://opnet.org/opwallet/" target="_blank">Download<br>OP_WALLET</a>
        <div class="feature-desc">Install the Bitcoin wallet to claim &amp; stake your $RST.</div>
        <a class="feature-link" href="https://opnet.org/opwallet/" target="_blank">Get Extension</a>
      </div>

      <div class="feature-card">
        <span class="feature-icon">&#x1F3C6;</span>
        <a class="feature-btn green" href="/rst/leaderboard">Leaderboard<br><small>(Top Players)</small></a>
        <div class="feature-desc">See who has earned the most $RST on the chain.</div>
        <a class="feature-link" href="/rst/leaderboard">Click Here</a>
      </div>

    </div>
  </div>

  <!-- BOTTOM ROW -->
  <div class="bottom-row">

    <!-- LEFT: Game Info -->
    <div class="section-box" style="margin-bottom:0">
      <h2>How to Play</h2>
      <div class="sub-grid">

        <div class="sub-card" style="grid-column:span 2">
          <span class="sub-card-title">&#x26CF;&#xFE0F; The Story</span>
          <div class="sub-card-inner" style="align-items:flex-start">
            <span class="sub-icon">&#x1F30D;</span>
            <div class="sub-text">
              You wake up in Lumbridge with nothing but an axe and a pickaxe. <strong style="color:#d4af37">You are stuck in this world.</strong> The only way out is through &mdash; chop trees, mine ore, sell your resources and keep grinding.<br><br>
              As you progress, you earn <strong style="color:#f0c030">$RST</strong> &mdash; a real Bitcoin token. Stack enough RST and your world expands: new regions, harder content, bigger rewards. <strong style="color:#8ebc44">The grind is the game. The game pays in $BTC.</strong><br><br>
              Convert your RST to Bitcoin on <a href="https://motoswap.org" target="_blank">Motoswap</a>. No bank. No permission. Just play.
            </div>
          </div>
        </div>

        <div class="sub-card">
          <span class="sub-card-title">&#x20BF; Earn $RST &rarr; $BTC</span>
          <div class="sub-card-inner">
            <span class="sub-icon">&#x1F4B0;</span>
            <div class="sub-text">
              Sell logs &amp; ore to the merchant. Earn RST on-chain. Swap RST for BTC on Motoswap &mdash; real money, real Bitcoin.
              <a href="/rst/claim">Claim RST</a>
            </div>
          </div>
        </div>

        <div class="sub-card">
          <span class="sub-card-title">&#x1F4AA; Difficulty &amp; Tiers</span>
          <div class="sub-card-inner">
            <span class="sub-icon">&#x1F480;</span>
            <div class="sub-text">
              0 RST: Hardcore &mdash; Misthalin only<br>
              10 RST: Hard &mdash; +Falador/Wilderness<br>
              1000 RST: Normal &mdash; Full world
              <a href="/difficulty">Learn More</a>
            </div>
          </div>
        </div>

        <div class="sub-card">
          <span class="sub-card-title">&#x1F30D; World Map</span>
          <div class="sub-card-inner">
            <span class="sub-icon">&#x1F5FA;&#xFE0F;</span>
            <div class="sub-text">
              Explore Gielinor. Unlock more regions as your RST balance grows.
              <a href="https://runescaperesourceterminal.duckdns.org/mapview/" target="_blank">View Map</a>
            </div>
          </div>
        </div>

        <div class="sub-card">
          <span class="sub-card-title">&#x1F4D6; Beginner's Guide</span>
          <div class="sub-card-inner">
            <span class="sub-icon">&#x1FA93;</span>
            <div class="sub-text">
              How to chop trees, mine ores, and turn your grind into Bitcoin.
              <a href="/guide">Read Guide</a>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- RIGHT: $RST & Links -->
    <div class="section-box" style="margin-bottom:0">
      <h2>$RST Token &amp; Links</h2>
      <div class="sub-grid">

        <div class="sub-card">
          <span class="sub-card-title">&#x20BF; Tokenomics</span>
          <div class="sub-card-inner">
            <span class="sub-icon">&#x1F4B0;</span>
            <div class="sub-text">
              1M supply. 500k LP. 500k earned in-game.<br>
              1% LP burn on trades.
              <a href="/tokenomics">Read More</a>
            </div>
          </div>
        </div>

        <div class="sub-card">
          <span class="sub-card-title">&#x1F4C8; Roadmap</span>
          <div class="sub-card-inner">
            <span class="sub-icon">&#x1F9ED;</span>
            <div class="sub-text">
              Fishing, smithing, new areas &amp; NFT logs.
              <a href="/roadmap">See Roadmap</a>
            </div>
          </div>
        </div>

        <div class="sub-card">
          <span class="sub-card-title">&#x1F4AC; Discord</span>
          <div class="sub-card-inner">
            <span class="sub-icon">&#x1F3AE;</span>
            <div class="sub-text">
              Join the community. Talk to the devs.
              <a href="https://discord.gg/placeholder" target="_blank">Join Discord</a>
            </div>
          </div>
        </div>

        <div class="sub-card">
          <span class="sub-card-title">&#x1F4BB; Source Code</span>
          <div class="sub-card-inner">
            <span class="sub-icon">&#x1F4D6;</span>
            <div class="sub-text">
              Open source. Built on OPNet + RS2.
              <a href="https://github.com/ruggedbydiversityandorthetrifocesage" target="_blank">View GitHub</a>
            </div>
          </div>
        </div>

      </div>

      <!-- Server Activity Analytics -->
      <div style="margin-top:14px;border-top:1px solid #2a2000;padding-top:12px;">
        <div style="color:#f0c030;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">&#x26A1; Server Activity</div>
        <div style="display:flex;gap:6px;margin-bottom:10px;">
          <button onclick="switchActivityTab('1h')" id="tab1h" style="background:#2a1a00;border:1px solid #f0c030;color:#f0c030;padding:3px 10px;font-family:monospace;font-size:11px;cursor:pointer;border-radius:3px;">1H</button>
          <button onclick="switchActivityTab('6h')" id="tab6h" style="background:#1a1200;border:1px solid #3a2800;color:#888;padding:3px 10px;font-family:monospace;font-size:11px;cursor:pointer;border-radius:3px;">6H</button>
          <button onclick="switchActivityTab('24h')" id="tab24h" style="background:#1a1200;border:1px solid #3a2800;color:#888;padding:3px 10px;font-family:monospace;font-size:11px;cursor:pointer;border-radius:3px;">24H</button>
          <button onclick="switchActivityTab('7d')" id="tab7d" style="background:#1a1200;border:1px solid #3a2800;color:#888;padding:3px 10px;font-family:monospace;font-size:11px;cursor:pointer;border-radius:3px;">7D</button>
          <button onclick="switchActivityTab('30d')" id="tab30d" style="background:#1a1200;border:1px solid #3a2800;color:#888;padding:3px 10px;font-family:monospace;font-size:11px;cursor:pointer;border-radius:3px;">30D</button>
          <span style="margin-left:auto;color:#555;font-size:10px;align-self:center;" id="activityUpdated"></span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <div style="background:#1a1200;border:1px solid #2a1a00;border-radius:4px;padding:6px 10px;flex:1;text-align:center;">
            <div style="color:#f0c030;font-size:1.1em;font-weight:bold;" id="actTotalRST">—</div>
            <div style="color:#888;font-size:10px;margin-top:1px;">RST Earned</div>
          </div>
          <div style="background:#1a1200;border:1px solid #2a1a00;border-radius:4px;padding:6px 10px;flex:1;text-align:center;">
            <div style="color:#f0c030;font-size:1.1em;font-weight:bold;" id="actPlayers">—</div>
            <div style="color:#888;font-size:10px;margin-top:1px;">Active Players</div>
          </div>
        </div>
        <div style="font-size:10px;color:#666;margin-bottom:5px;letter-spacing:1px;" id="actEarnersLabel">TOP EARNERS</div>
        <div id="actTopList" style="font-size:12px;">
          <div style="color:#444;font-size:11px;padding:4px 0;">Loading...</div>
        </div>
      </div>

    </div>

  </div><!-- end bottom-row -->

  <div style="border:1px solid #2a2000;background:#080600;padding:10px 24px;margin-top:4px;margin-bottom:0;display:flex;justify-content:space-between;align-items:center">
    <span style="color:#f0c030;font-size:12px;font-weight:bold;letter-spacing:1px">NON-AFFILIATION DISCLAIMER</span>
    <a href="/disclaimer" style="color:#666;font-size:11px;text-decoration:none" onmouseover="this.style.color='#8ebc44'" onmouseout="this.style.color='#666'">Read full disclaimer &#x2197;</a>
  </div>
  <footer>
    <a href="/play">Play Now</a> &mdash; <a href="/rst/claim">Claim $RST</a> &mdash; <a href="/disclaimer">Disclaimer</a>
  </footer>
</div>

<script>
fetch('/rst/online-players')
  .then(r => r.json())
  .then(d => {
    const count = Array.isArray(d.players) ? d.players.length : (d.players || 0);
    const el = document.getElementById('playerCount');
    if (el) el.innerHTML = 'There are currently <strong>' + count + '</strong> people playing!';
    const statOnline = document.getElementById('statOnline');
    if (statOnline) statOnline.textContent = count;
  })
  .catch(() => {});
fetch('/rst/server-stats')
  .then(r => r.json())
  .then(d => {
    const sw = document.getElementById('statWallets');
    if (sw) sw.textContent = d.wallets ?? '—';
    const sl = document.getElementById('statLbEntries');
    if (sl) sl.textContent = d.leaderboard ?? '—';
  })
  .catch(() => {});
fetch('/rst/dragon-slayer-progress')
  .then(r => r.json())
  .then(d => {
    const box = document.getElementById('dragonMilestone');
    if (!box) return;
    box.style.display = 'block';
    const bar = document.getElementById('dsBar');
    const gpLabel = document.getElementById('dsGPLabel');
    const pctLabel = document.getElementById('dsPctLabel');
    const status = document.getElementById('dsStatus');
    const unlocked = document.getElementById('dsUnlocked');
    const progress = document.getElementById('dsProgress');
    if (d.enabled) {
      if (unlocked) unlocked.style.display = 'block';
      if (progress) progress.style.display = 'none';
      if (status) status.textContent = 'TIER 2 ACTIVE';
    } else {
      if (bar) bar.style.width = d.pct + '%';
      if (gpLabel) gpLabel.textContent = Math.floor(d.totalRST).toLocaleString() + ' / 10,000 RST earned';
      if (pctLabel) pctLabel.textContent = d.pct.toFixed(1) + '%';
      if (status) status.textContent = d.pct.toFixed(1) + '% complete';
    }
  })
  .catch(() => {});
fetch('/rst/price')
  .then(r => r.json())
  .then(d => {
    if (!d || d.error) return;
    const satsEl = document.getElementById('rstPriceSats');
    const usdEl = document.getElementById('rstPriceUSD');
    const liqRST = document.getElementById('rstLiqRST');
    const liqBTC = document.getElementById('rstLiqBTC');
    if (satsEl) satsEl.textContent = d.priceInSats.toLocaleString() + ' sats';
    if (usdEl && d.btcUSD) {
      const usd = (d.priceInSats / 1e8 * d.btcUSD).toFixed(4);
      usdEl.textContent = '≈ $' + usd + ' USD';
    }
    if (liqRST) liqRST.textContent = Number(d.liquidityRST).toLocaleString() + ' RST';
    if (liqBTC) liqBTC.textContent = (d.liquiditySats / 1e8).toFixed(4) + ' BTC';
  })
  .catch(() => {});

// Activity analytics
var _activityData = null;
var _activeTab = '1h';
function switchActivityTab(tab) {
  _activeTab = tab;
  ['1h','6h','24h','7d','30d'].forEach(function(t) {
    var btn = document.getElementById('tab' + t);
    if (!btn) return;
    if (t === tab) {
      btn.style.background = '#2a1a00'; btn.style.borderColor = '#f0c030'; btn.style.color = '#f0c030';
    } else {
      btn.style.background = '#1a1200'; btn.style.borderColor = '#3a2800'; btn.style.color = '#888';
    }
  });
  if (_activityData) renderActivity(_activityData);
}
function renderActivity(data) {
  var d = data[_activeTab];
  if (!d) return;
  var rEl = document.getElementById('actTotalRST');
  var pEl = document.getElementById('actPlayers');
  var lEl = document.getElementById('actTopList');
  var lblEl = document.getElementById('actEarnersLabel');
  if (rEl) rEl.textContent = d.totalRST.toFixed(3) + ' RST';
  if (pEl) pEl.textContent = d.players;
  if (lblEl) lblEl.textContent = d.top && d.top.length > 0 ? 'EARNERS (' + d.top.length + ')' : 'EARNERS';
  if (lEl) {
    if (!d.top || d.top.length === 0) {
      lEl.innerHTML = '<div style="color:#444;font-size:11px;padding:4px 0;">No activity yet</div>';
    } else {
      lEl.innerHTML = d.top.map(function(e, i) {
        var medal = i === 0 ? '&#x1F947;' : i === 1 ? '&#x1F948;' : i === 2 ? '&#x1F949;' : (i + 1) + '.';
        return '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1a1200;">' +
          '<span style="color:#c8c8b8;">' + medal + ' <a href="/rst/player/' + encodeURIComponent(e.username) + '" style="color:#8ebc44;text-decoration:none;">' + e.username + '</a></span>' +
          '<span style="color:#f0c030;">' + e.rst.toFixed(3) + ' RST</span></div>';
      }).join('');
    }
  }
  var uEl = document.getElementById('activityUpdated');
  if (uEl) uEl.textContent = 'updated ' + new Date().toLocaleTimeString();
}
function loadActivity() {
  fetch('/rst/activity').then(function(r) { return r.json(); }).then(function(data) {
    _activityData = data;
    renderActivity(data);
  }).catch(function() {});
}
loadActivity();
setInterval(loadActivity, 60000);
</script>
</body>
</html>`;
                return new Response(homepageHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
/* Prices modal */
.prices-modal-box { background: #0a0a0a; border: 2px solid #f0c030; padding: 24px 28px; max-width: 920px; width: 98%; border-radius: 4px; position: relative; }
.prices-modal-box h1 { color: #f0c030; font-size: 1em; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 4px; }
.prices-modal-box .htp-sub { color: #555; font-size: 0.72em; margin-bottom: 16px; border-bottom: 1px solid #1e1600; padding-bottom: 10px; }
.prices-grid { display: flex; gap: 32px; flex-wrap: wrap; }
.prices-section { flex-shrink: 0; }
.prices-section h3 { color: #888; font-size: 0.62em; letter-spacing: 2px; text-transform: uppercase; padding-bottom: 5px; border-bottom: 1px solid #2a2000; margin-bottom: 6px; white-space: nowrap; }
.prices-tbl { border-collapse: collapse; font-size: 0.73em; }
.prices-tbl td { padding: 2px 16px 2px 0; color: #c0a060; white-space: nowrap; }
.prices-tbl td:last-child { color: #f0c030; text-align: right; padding-right: 0; font-weight: bold; }
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
  <a href="/" style="text-decoration:none;color:inherit;"><span class="logo">&#x26CF; RUNESCAPE RESOURCE TERMINAL</span></a>
  <div style="display:flex;align-items:center;gap:12px;">
    <button onclick="document.getElementById('htpModal').classList.add('show')" style="background:#1a1200;border:1px solid #f0c030;color:#f0c030;padding:5px 12px;font-family:monospace;font-size:0.72em;cursor:pointer;border-radius:3px;font-weight:bold;">&#x2753; HOW TO PLAY</button>
    <button onclick="document.getElementById('dsModal').classList.add('show')" style="background:#1a1200;border:1px solid #f0c030;color:#f0c030;padding:5px 12px;font-family:monospace;font-size:0.72em;cursor:pointer;border-radius:3px;font-weight:bold;">&#x1F30D; DIFFICULTY</button>
    <button onclick="document.getElementById('tokenomicsModal').classList.add('show')" style="background:#1a1200;border:1px solid #f0c030;color:#f0c030;padding:5px 12px;font-family:monospace;font-size:0.72em;cursor:pointer;border-radius:3px;font-weight:bold;">&#x20BF; TOKENOMICS</button>
    <button onclick="document.getElementById('roadmapModal').classList.add('show')" style="background:#1a1200;border:1px solid #f0c030;color:#f0c030;padding:5px 12px;font-family:monospace;font-size:0.72em;cursor:pointer;border-radius:3px;font-weight:bold;">&#x1F5FA; ROADMAP</button>
    <button onclick="document.getElementById('pricesModal').classList.add('show')" style="background:#1a1200;border:1px solid #f0c030;color:#f0c030;padding:5px 12px;font-family:monospace;font-size:0.72em;cursor:pointer;border-radius:3px;font-weight:bold;">&#x1F4B0; PRICES</button>
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
      <div class="stat-row"><span>Pending Rewards</span><span id="statPendingRewards" style="color:#f7931a">-</span></div>
      <div class="stat-row"><span>Earned Rewards</span><span id="statEarnedRewards" style="color:#aaffaa">-</span></div>
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
      <a href="/rst/leaderboard" target="_blank" rel="noopener" style="display:block;margin-top:6px;color:#444;font-size:0.65em;text-align:center;text-decoration:none;">&#x1F4CA; Full Hiscores &#x2197;</a>
    </div>
    <!-- Online Players -->
    <div class="s-section">
      <h3>Online Now <span id="onlineCount" style="color:#44cc44;font-weight:normal;font-size:0.9em;"></span></h3>
      <div id="onlineList"><div style="color:#333;font-size:0.72em;text-align:center;padding:4px;">-</div></div>
    </div>
    <!-- Bottom sidebar buttons -->
    <div style="padding: 10px 12px; border-bottom: 1px solid #1e1600;">
      <button class="htp-btn" onclick="openTxHistoryModal()" style="background:#0a0a1a;border-color:#4444aa;color:#8888ff;margin-bottom:4px;">&#x1F4CB; TX HISTORY</button>
      <button class="htp-btn" onclick="document.getElementById('changelogModal').classList.add('show')">&#x1F4DC; CHANGE LOG</button>
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

    <p style="color:#555;font-size:0.68em;margin-top:16px;text-align:center;">V1 Contract: <span style="color:#888;">opt1sqzvnq5yetkcnwqzz02h23ch8294kgt0hxvvt9xyw</span></p>
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
<!-- Prices Modal -->
<div class="htp-modal-bg" id="pricesModal">
  <div class="prices-modal-box">
    <button class="htp-close" onclick="document.getElementById('pricesModal').classList.remove('show')">&#x2715; CLOSE</button>
    <h1>&#x1F4B0; GENERAL STORE PRICES</h1>
    <div class="htp-sub">Base coin values &mdash; what the general store pays for your goods</div>
    <div class="prices-grid">
      <div class="prices-section">
        <h3>&#x1FA93; Woodcutting</h3>
        <table class="prices-tbl">
          <tr><td>Logs</td><td>4 gp</td></tr>
          <tr><td>Oak logs</td><td>20 gp</td></tr>
          <tr><td>Willow logs</td><td>40 gp</td></tr>
          <tr><td>Maple logs</td><td>80 gp</td></tr>
          <tr><td>Yew logs</td><td>160 gp</td></tr>
          <tr><td>Magic logs</td><td>320 gp</td></tr>
        </table>
      </div>
      <div class="prices-section">
        <h3>&#x26CF; Mining &mdash; Ores</h3>
        <table class="prices-tbl">
          <tr><td>Copper ore</td><td>3 gp</td></tr>
          <tr><td>Tin ore</td><td>3 gp</td></tr>
          <tr><td>Iron ore</td><td>17 gp</td></tr>
          <tr><td>Coal</td><td>45 gp</td></tr>
          <tr><td>Silver ore</td><td>75 gp</td></tr>
          <tr><td>Gold ore</td><td>150 gp</td></tr>
          <tr><td>Mithril ore</td><td>162 gp</td></tr>
          <tr><td>Adamantite ore</td><td>400 gp</td></tr>
          <tr><td>Runite ore</td><td>3,200 gp</td></tr>
          <tr><td>Rune essence</td><td>4 gp</td></tr>
        </table>
      </div>
      <div class="prices-section">
        <h3>&#x1F525; Smelting &mdash; Bars</h3>
        <table class="prices-tbl">
          <tr><td>Bronze bar</td><td>8 gp</td></tr>
          <tr><td>Iron bar</td><td>28 gp</td></tr>
          <tr><td>Steel bar</td><td>100 gp</td></tr>
          <tr><td>Silver bar</td><td>150 gp</td></tr>
          <tr><td>Gold bar</td><td>300 gp</td></tr>
          <tr><td>Mithril bar</td><td>300 gp</td></tr>
          <tr><td>Adamantite bar</td><td>640 gp</td></tr>
          <tr><td>Runite bar</td><td>5,000 gp</td></tr>
        </table>
      </div>
      <div class="prices-section">
        <h3>&#x1F3A3; Fishing &mdash; Raw</h3>
        <table class="prices-tbl">
          <tr><td>Raw shrimps</td><td>5 gp</td></tr>
          <tr><td>Raw sardine</td><td>10 gp</td></tr>
          <tr><td>Raw herring</td><td>15 gp</td></tr>
          <tr><td>Raw anchovies</td><td>15 gp</td></tr>
          <tr><td>Raw trout</td><td>20 gp</td></tr>
          <tr><td>Raw cod</td><td>25 gp</td></tr>
          <tr><td>Raw pike</td><td>30 gp</td></tr>
          <tr><td>Raw salmon</td><td>50 gp</td></tr>
          <tr><td>Raw tuna</td><td>100 gp</td></tr>
          <tr><td>Raw lobster</td><td>150 gp</td></tr>
          <tr><td>Raw swordfish</td><td>200 gp</td></tr>
          <tr><td>Raw shark</td><td>300 gp</td></tr>
        </table>
      </div>
      <div class="prices-section">
        <h3>&#x1F356; Cooking &mdash; Cooked</h3>
        <table class="prices-tbl">
          <tr><td>Shrimps</td><td>5 gp</td></tr>
          <tr><td>Sardine</td><td>10 gp</td></tr>
          <tr><td>Herring</td><td>15 gp</td></tr>
          <tr><td>Anchovies</td><td>15 gp</td></tr>
          <tr><td>Trout</td><td>20 gp</td></tr>
          <tr><td>Cod</td><td>25 gp</td></tr>
          <tr><td>Salmon</td><td>50 gp</td></tr>
          <tr><td>Tuna</td><td>100 gp</td></tr>
          <tr><td>Lobster</td><td>150 gp</td></tr>
          <tr><td>Swordfish</td><td>200 gp</td></tr>
          <tr><td>Shark</td><td>300 gp</td></tr>
          <tr><td>Cooked chicken</td><td>4 gp</td></tr>
          <tr><td>Cooked meat</td><td>4 gp</td></tr>
        </table>
      </div>
      <div class="prices-section">
        <h3>&#x1F3F9; Fletching &mdash; Bows</h3>
        <table class="prices-tbl">
          <tr><td>Short bow</td><td>25 gp</td></tr>
          <tr><td>Long bow</td><td>30 gp</td></tr>
          <tr><td>Oak short bow</td><td>80 gp</td></tr>
          <tr><td>Oak long bow</td><td>90 gp</td></tr>
          <tr><td>Willow short bow</td><td>125 gp</td></tr>
          <tr><td>Willow long bow</td><td>150 gp</td></tr>
          <tr><td>Maple short bow</td><td>225 gp</td></tr>
          <tr><td>Maple long bow</td><td>350 gp</td></tr>
          <tr><td>Yew short bow</td><td>500 gp</td></tr>
          <tr><td>Yew long bow</td><td>700 gp</td></tr>
        </table>
      </div>
      <div class="prices-section">
        <h3>&#x2728; Runes &mdash; Coming Soon</h3>
        <table class="prices-tbl">
          <tr><td colspan="2" style="color:#555;text-align:center;padding:10px 0;">Rune prices coming in a future update</td></tr>
        </table>
      </div>
    </div>
  </div>
</div>
<!-- Changelog Modal -->
<div class="htp-modal-bg" id="changelogModal">
  <div class="htp-box">
    <button class="htp-close" onclick="document.getElementById('changelogModal').classList.remove('show')">&#x2715; CLOSE</button>
    <h1>&#x1F4DC; CHANGE LOG</h1>
    <div class="htp-sub">Server updates &mdash; most recent first</div>

    <div class="htp-section">
      <h3 style="color:#44cc44;">&#x1F7E2; 2026-03-09 &mdash; V2 STAKING LIVE (Testnet)</h3>
      <ul style="margin-top:6px;">
        <li>&#x26A1; sRST staking contract deployed &mdash; stake RST to earn rewards</li>
        <li>&#x1F3AF; 4 lock tiers: Flexible (1x), 30-day (5x), 90-day (4x), 180-day (2.5x)</li>
        <li>&#x1F4B0; 1% of every GP sale now flows to sRST stakers as rewards</li>
        <li>&#x1F30D; World gating updated: stake 10+ RST to instantly unlock Hard Mode</li>
        <li>&#x1F3C6; Hiscores page now shows full skill levels, time played, and bank value</li>
        <li>&#x2694; Admin broadcast system added &mdash; server-wide announcements via Bob</li>
      </ul>
    </div>

    <div class="htp-section">
      <h3 style="color:#f7931a;">&#x1F7E1; 2026-03-03 &mdash; V1 LAUNCH (Testnet)</h3>
      <ul style="margin-top:6px;">
        <li>&#x2705; RST OP20 contract deployed on Bitcoin L1 (Testnet)</li>
        <li>&#x1FA93; Earn RST by chopping trees, mining, fishing &amp; selling to the general store</li>
        <li>&#x1F4E4; Claim RST directly to your OP_WALLET</li>
        <li>&#x1F30D; Difficulty system: RST balance unlocks new areas of the world</li>
        <li>&#x1F4C8; LP pool live on MotoSwap &mdash; RST tradeable</li>
        <li>&#x1F3C5; OG Rank tracking begins &mdash; early LP traders recorded</li>
      </ul>
    </div>

    <p style="color:#555;font-size:0.68em;margin-top:16px;text-align:center;">Runescape Resource Terminal &mdash; BTC L1 F2P P2E &#x26CF;</p>
  </div>
</div>
<!-- TX History Modal -->
<div class="htp-modal-bg" id="txHistoryModal">
  <div class="htp-box">
    <button class="htp-close" onclick="document.getElementById('txHistoryModal').classList.remove('show')">&#x2715; CLOSE</button>
    <h1>&#x1F4CB; TX HISTORY</h1>
    <div class="htp-sub">Your interactions with this dapp &mdash; stored locally</div>
    <div id="txHistoryList" style="max-height:400px;overflow-y:auto;"></div>
    <button class="htp-btn" onclick="if(confirm('Clear TX history?')){localStorage.removeItem('rst_tx_history');openTxHistoryModal();}" style="margin-top:12px;background:#1a0a0a;border-color:#aa4444;color:#ff8888;">&#x1F5D1; CLEAR HISTORY</button>
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
        <option value="0">&#x1F513; Flexible (1&#xD7; sRST, unstake anytime)</option>
        <option value="1">&#x1F512; 30-day lock (5&#xD7; sRST, HARD LOCK)</option>
        <option value="2">&#x1F512; 90-day lock (4&#xD7; sRST, HARD LOCK)</option>
        <option value="3">&#x1F512; 180-day lock (2.5&#xD7; sRST, HARD LOCK)</option>
      </select>
      <div id="stakeTierHint" style="font-size:0.65em;color:#f7931a;margin-top:3px;text-align:center;">1&#xD7; multiplier &mdash; no lock &mdash; unstake anytime</div>
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
const RST_CONTRACT = 'opt1sqzvnq5yetkcnwqzz02h23ch8294kgt0hxvvt9xyw';
const RST_CONTRACT_PUBKEY = '0xf4d9ed7f424ca09d41655eb2a3c69d559fd2fdd857a75ffbafa9373ce4ac62d4';
// RSTStaking V2 MasterChef — redeployed 2026-03-09 (bob fixed to ad5bad18... = actual OPNet sender)
const STAKING_CONTRACT = 'opt1sqznx9cv0lhl6f7e5pxufhzegy6fmuf3w9cqpky5t';
const STAKING_CONTRACT_PUBKEY = '0x611a529e3da62357e4959ad3b3f98d1f05bb8676425476af5d25926b4f9737cb';
// RST v8 — hardcoded server MLDSA hash as minter in onDeployment
const RST_V2_CONTRACT = 'opt1sqzvnq5yetkcnwqzz02h23ch8294kgt0hxvvt9xyw';
const RST_V2_CONTRACT_HEX = '0xf4d9ed7f424ca09d41655eb2a3c69d559fd2fdd857a75ffbafa9373ce4ac62d4';
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
let earnedRewardsRST = 0;      // cumulative sRST rewards claimed — loaded from server on connect
let pendingRewardsRST = 0; // RST rewards claimable from MasterChef staking
let lastClaimRewardsTime = 0; // cooldown — skip on-chain rewards fetch for 2 min after claiming
let mempoolDisplay = 0;    // RST in mempool/claimable (updated by refreshBalance)

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
    // Reset claim cooldown — don't bleed previous wallet's state into new session
    lastClaimRewardsTime = 0;
    pendingRewardsRST = 0;
  }
  document.getElementById('walletStatus').textContent = w.slice(0,12) + '...' + w.slice(-6);
  document.getElementById('walletStatus').className = 'wallet-status connected';
  document.getElementById('connectSection').style.display = 'none';
  document.getElementById('statsSection').style.display = 'block';
  document.getElementById('statUser').textContent = u;
  startSSE(u);
  refreshBalance();
  refreshWalletBalances();
  fetchEarnedRewards();
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
  // If OP_WALLET switched accounts behind our back, disconnect cleanly
  try {
    const p = window.opnet || window.unisat;
    if (p && wallet) {
      const accs = await p.getAccounts?.();
      if (accs && accs.length > 0 && accs[0] !== wallet) { disconnectWallet(); return; }
    }
  } catch {}
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
    mempoolDisplay = claimableRst > serverGrantedRst ? claimableRst : serverGrantedRst;
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
    '1\u00D7 multiplier \u2014 no lock \u2014 20% exit fee',
    '5\u00D7 multiplier \u2014 30-day HARD LOCK \u2014 10% exit fee after lock',
    '4\u00D7 multiplier \u2014 90-day HARD LOCK \u2014 5% exit fee after lock',
    '2.5\u00D7 multiplier \u2014 180-day HARD LOCK \u2014 1% exit fee after lock',
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

function addTxHistoryEntry(type, details, txid) {
  var history = JSON.parse(localStorage.getItem('rst_tx_history') || '[]');
  history.unshift({ type: type, details: details, txid: txid || null, ts: Date.now() });
  if (history.length > 50) history.pop();
  localStorage.setItem('rst_tx_history', JSON.stringify(history));
}

async function fetchEarnedRewards() {
  if (!wallet) return;
  try {
    const r = await fetch('/rst/earned-rewards?wallet=' + encodeURIComponent(wallet));
    const d = await r.json();
    earnedRewardsRST = parseFloat(d.earned) || 0;
    refreshEarnedRewards();
  } catch {}
}

async function addEarnedRewards(amount) {
  earnedRewardsRST += amount;
  refreshEarnedRewards();
  try {
    await fetch('/rst/earned-rewards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet, amount }) });
  } catch {}
}

function refreshEarnedRewards() {
  var el = document.getElementById('statEarnedRewards');
  if (el) el.textContent = earnedRewardsRST > 0 ? earnedRewardsRST.toFixed(4) + ' RST' : '0 RST';
}

function openTxHistoryModal() {
  var history = JSON.parse(localStorage.getItem('rst_tx_history') || '[]');
  var listEl = document.getElementById('txHistoryList');
  if (!history.length) {
    listEl.innerHTML = '<div style="color:#555;font-size:0.75em;text-align:center;padding:20px;">No transactions yet.</div>';
  } else {
    listEl.innerHTML = history.map(function(e) {
      var d = new Date(e.ts);
      var ds = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      var txid = e.txid || null;
      var txShort = txid ? txid.slice(0,10) + '...' + txid.slice(-8) : null;
      var opscanUrl = txid ? 'https://opscan.org/transactions/' + txid + '?network=op_testnet' : null;
      var txLine = txid
        ? '<div style="margin-top:3px;display:flex;align-items:center;gap:6px;">' +
            '<span style="color:#555;font-size:0.62em;font-family:monospace;">' + txShort + '</span>' +
            '<a href="' + opscanUrl + '" target="_blank" style="color:#8888ff;font-size:0.62em;text-decoration:none;border:1px solid #333;padding:1px 5px;border-radius:3px;">↗ opscan</a>' +
          '</div>'
        : '<div style="color:#444;font-size:0.62em;margin-top:3px;">no txid recorded</div>';
      return '<div style="padding:8px 0;border-bottom:1px solid #1a1600;">' +
        '<div style="color:#f0c030;font-size:0.75em;font-weight:bold;">' + e.type + '</div>' +
        '<div style="color:#ccc;font-size:0.72em;margin-top:2px;">' + e.details + '</div>' +
        txLine +
        '<div style="color:#555;font-size:0.62em;margin-top:3px;">' + ds + '</div>' +
        '</div>';
    }).join('');
  }
  document.getElementById('txHistoryModal').classList.add('show');
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
  var seenPending = false;
  // Wait 10s before first check — gives TX time to propagate to mempool
  await new Promise(r => setTimeout(r, 10000));
  while (stakePhase === 'approval_pending') {
    if (stakePhase !== 'approval_pending') break;
    try {
      const walletAddr = wallet || localStorage.getItem('rst_stake_wallet');
      if (!walletAddr) { await new Promise(r => setTimeout(r, 5000)); continue; }
      const res = await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_getUTXOs', params: [walletAddr, true] }) });
      const json = await res.json();
      const pending = (json?.result?.pending || []).length;
      if (pending > 0) seenPending = true;
      // Only mark confirmed after we've actually seen the TX in the mempool
      if (seenPending && pending === 0) {
        stakePhase = 'approval_confirmed';
        localStorage.setItem('rst_stake_phase', 'approval_confirmed');
        updateStakeBtnPhase();
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 5000));
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
    var tierNames = ['Flexible', '30-day', '90-day', '180-day'];
    addTxHistoryEntry('\u26A1 STAKED RST', amount + ' RST staked \u2014 ' + (tierNames[tierIndex] || 'Flexible') + ' tier');
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

      // Fetch tier info to check hard lock
      try {
        const tierCalldata = '7f07774d' + mldsaHash.padStart(64, '0');
        const tierResult = await opnetRpc('btc_call', [STAKING_CONTRACT, tierCalldata, null, null]);
        const tierRaw = typeof tierResult === 'string' ? tierResult : (tierResult?.result ?? tierResult?.data ?? '');
        const tierHex = decodeU256Hex(tierRaw);
        if (tierHex.length >= 128) {
          const tierIdx = Number(BigInt('0x' + tierHex.slice(0, 64)));
          const lockEnd = BigInt('0x' + tierHex.slice(64, 128));
          // Fetch current block number
          var currentBlock = -1n;
          try {
            const blkRes = await opnetRpc('btc_blockNumber', []);
            const blkVal = blkRes?.result ?? blkRes;
            if (blkVal != null) currentBlock = BigInt(blkVal);
          } catch {}
          // If we couldn't get block number, assume locked if lockEnd > 0
          const isLocked = tierIdx > 0 && lockEnd > 0n && (currentBlock < 0n || currentBlock < lockEnd);
          if (unstakeBtn) {
            if (isLocked) {
              unstakeBtn.textContent = '\uD83D\uDD12 LOCKED \u2014 BLOCK ' + lockEnd.toString();
              unstakeBtn.style.opacity = '0.5';
              unstakeBtn.style.cursor = 'default';
              unstakeBtn.onclick = null;
            } else {
              var tierLabels = ['Flexible (20% fee)', '30-day (10% fee)', '90-day (5% fee)', '180-day (1% fee)'];
              unstakeBtn.textContent = '\u21A9 UNSTAKE sRST \u2014 ' + (tierLabels[tierIdx] || '');
              unstakeBtn.style.opacity = '1';
              unstakeBtn.style.cursor = 'pointer';
              unstakeBtn.onclick = function() { openUnstakeModal(); };
            }
          }
        }
      } catch {}
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
      // Skip stale on-chain value for 5 min after claiming — TX not confirmed yet
      const claimCoolingDown = Date.now() - lastClaimRewardsTime < 300000;
      if (!claimCoolingDown) {
        pendingRewardsRST = Number(rewardsWei) / 1e18;
      }
      const rewardsEl = document.getElementById('statPendingRewards');
      if (rewardsEl) rewardsEl.textContent = claimCoolingDown ? '⏳ claiming...' : (pendingRewardsRST > 0 ? pendingRewardsRST.toFixed(6) + ' RST' : '0 RST');
      refreshEarnedRewards();
      const claimRewardsBtn = document.getElementById('claimRewardsBtn');
      if (claimRewardsBtn) {
        const shouldShow = sRSTBalance > 0 && pendingRewardsRST > 0.000001 && !claimCoolingDown;
        if (shouldShow) {
          claimRewardsBtn.textContent = '\uD83D\uDCB0 CLAIM REWARDS';
          claimRewardsBtn.disabled = false;
          claimRewardsBtn.style.display = 'block';
        } else {
          claimRewardsBtn.style.display = 'none';
        }
      }
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
    addTxHistoryEntry('\u21A9 UNSTAKED sRST', amount.toFixed(4) + ' sRST unstaked');
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
    var claimTxid = null;
    if (typeof web3.signInteraction === 'function') {
      const signed = await web3.signInteraction(params);
      if (signed.fundingTransaction) await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [signed.fundingTransaction, false] }) });
      const interactionRes = await fetch('https://testnet.opnet.org/api/v1/json-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_sendRawTransaction', params: [signed.interactionTransaction, false] }) });
      try { const interactionJson = await interactionRes.json(); claimTxid = interactionJson?.result || null; } catch {}
    } else {
      const broadcastResult = await web3.signAndBroadcastInteraction(params);
      claimTxid = broadcastResult?.txid || broadcastResult?.interactionAddress || null;
    }
    var claimedAmount = pendingRewardsRST;
    addTxHistoryEntry('\uD83D\uDCB0 CLAIMED REWARDS', claimedAmount.toFixed(4) + ' RST staking rewards claimed', claimTxid);
    addEarnedRewards(claimedAmount);
    pendingRewardsRST = 0;
    lastClaimRewardsTime = Date.now();
    refreshEarnedRewards();
    btn.textContent = '\u2705 Claimed!';
    btn.disabled = true;
    btn.style.display = 'none';
    const rewardsEl = document.getElementById('statPendingRewards');
    if (rewardsEl) rewardsEl.textContent = '\u23F3 claiming...';
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
    const gpThreshold = d.hasClaimedBefore ? 10000 : 1000;
    if (gp < gpThreshold) {
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
      if (mempoolDisplay > 0) {
        // grantClaim TX is in mempool but not yet indexed by OPNet — auto-poll so modal opens when ready
        if (!claimPollInterval && mldsaHash) pollClaimableUntilReady(mldsaHash);
        alert('Your RST is on the way! Confirming on-chain (~1 min). The sign window will open automatically.');
      } else {
        alert('Keep earning! Need ' + gpThreshold.toLocaleString() + ' GP to claim RST (' + gp.toLocaleString() + '/' + gpThreshold.toLocaleString() + ' GP).');
      }
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
  username = null; wallet = null; mintData = null; mldsaHash = null; mintState = 'idle'; earnedRewardsRST = 0;
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
    const contractHex = '0xf4d9ed7f424ca09d41655eb2a3c69d559fd2fdd857a75ffbafa9373ce4ac62d4';
    const params = { to: RST_CONTRACT, contract: contractHex, calldata, from: wallet, utxos, feeRate: 10, priorityFee: BigInt(0), gasSatFee: BigInt(20000), network, linkMLDSAPublicKeyToAddress: false, revealMLDSAPublicKey: false };
    setModalStatus('Waiting for OP_WALLET signature...', 'info');
    let claimTxid = null;
    if (typeof web3.signAndBroadcastInteraction === 'function') {
      const res = await web3.signAndBroadcastInteraction(params);
      console.log('[RST] signAndBroadcastInteraction result:', JSON.stringify(res));
      claimTxid = res?.txid || res?.transactionId || res?.result
        || res?.interactionTransactionId || res?.broadcastResult
        || res?.hash || res?.id
        || (res && typeof res === 'string' ? res : null)
        || null;
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
    addTxHistoryEntry('\u26CF RST CLAIMED', (d.rstAmount || 0).toFixed(4) + ' RST claimed from game', claimTxid);
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
    const errMsg = e.message || String(e);
    // RBF rejection = claim TX is already in the mempool from a prior attempt.
    // Do NOT re-enable the button — the TX is in flight and a second claim would be a duplicate.
    if (errMsg.includes('rejecting replacement') || errMsg.includes('less fees than conflicting') || errMsg.includes('conflicting txs')) {
      mintState = 'in_progress';
      setModalStatus('You have a claim in progress! Your TX is already in the mempool — it should confirm in ~1 min. No need to sign again.', 'info');
      document.getElementById('signBtn').disabled = true;
      document.getElementById('signBtn').textContent = 'CLAIM IN PROGRESS...';
      // Poll for confirmation: once claimableOf drops to 0, state resets automatically
      setTimeout(() => { refreshBalance(); refreshWalletBalances(); }, 90000);
    } else {
      setModalStatus('Failed: ' + errMsg, 'error');
      document.getElementById('signBtn').disabled = false;
      document.getElementById('signBtn').textContent = 'SIGN & CLAIM WITH OP_WALLET';
    }
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
    '<div style="margin-top:8px;display:flex;gap:4px;align-items:center;">' +
    '<input id="fundAmountInput" type="number" value="100" min="1" max="10000" style="width:70px;background:#1a0a0a;border:1px solid #cc0000;color:#fff;font-family:monospace;font-size:0.75em;padding:4px;border-radius:3px;" />' +
    '<span style="color:#aaa;font-size:0.72em;">RST</span>' +
    '<button class="admin-btn" id="fundRewardBtn" onclick="executeFundRewardPool()" style="margin-top:0;flex:1;">FUND POOL</button>' +
    '</div>' +
    '<div style="margin-top:8px;">' +
    '<input id="broadcastInput" type="text" placeholder="World message..." style="width:100%;background:#1a0a0a;border:1px solid #cc0000;color:#fff;font-family:monospace;font-size:0.75em;padding:4px 6px;border-radius:3px;margin-bottom:4px;" />' +
    '<button class="admin-btn" onclick="executeBroadcast()" style="margin-top:0;">&#x1F4E2; WORLD BROADCAST</button>' +
    '</div>' +
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

async function executeFundRewardPool() {
  if (!wallet) { setAdminStatus('No wallet connected.', 'error'); return; }

  const btn = document.getElementById('fundRewardBtn');
  const amtInput = document.getElementById('fundAmountInput');
  const rstAmount = parseInt(amtInput.value, 10) || 100;
  btn.disabled = true;
  btn.textContent = 'SIGNING...';
  setAdminStatus('Funding staking reward pool with ' + rstAmount + ' RST...', 'info');

  try {
    const web3 = window.opnet?.web3;
    if (!web3) { setAdminStatus('OP_WALLET not found.', 'error'); btn.disabled = false; btn.textContent = 'FUND POOL'; return; }

    // RST.transfer(to, amount)
    // selector: 3b88ef57 (transfer(address,uint256))
    // to:       329994247d73f2a3a8424bac127dbd2d8e22dd0d3185c27fc300f4d12028a200 (staking contract tweaked pubkey)
    // amount:   rstAmount × 10^18 in 32-byte big-endian
    const stakingPubkeyHex = STAKING_CONTRACT_PUBKEY.startsWith('0x') ? STAKING_CONTRACT_PUBKEY.slice(2) : STAKING_CONTRACT_PUBKEY;
    const amountWei = (BigInt(rstAmount) * (10n ** 18n)).toString(16).padStart(64, '0');
    const calldata = hexToBytes('3b88ef57' + stakingPubkeyHex.padStart(64, '0') + amountWei);

    setAdminStatus('Fetching UTXOs...', 'info');
    const utxos = await fetchUTXOs(wallet);
    if (!utxos.length) {
      setAdminStatus('No UTXOs found. Fund your deployer wallet.', 'error');
      btn.disabled = false; btn.textContent = 'FUND POOL'; return;
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

    setAdminStatus(rstAmount + ' RST sent to staking vault! Rewards will flow once TX confirms.', 'success');
    btn.textContent = 'FUND POOL';
  } catch (e) {
    setAdminStatus('Failed: ' + (e.message || String(e)), 'error');
    btn.disabled = false;
    btn.textContent = 'FUND POOL';
  }
}

async function executeBroadcast() {
  const input = document.getElementById('broadcastInput');
  const msg = input ? input.value.trim() : '';
  if (!msg) { setAdminStatus('Enter a message first.', 'error'); return; }
  try {
    setAdminStatus('Broadcasting...', 'info');
    const res = await fetch('/admin/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Failed');
    setAdminStatus('Sent to ' + json.players + ' player(s).', 'success');
    if (input) input.value = '';
  } catch (e) {
    setAdminStatus('Broadcast failed: ' + (e.message || String(e)), 'error');
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
  en: { label:'Difficulty', xhc_hint:'No player trading \u2014 earn 10 RST to unlock', hard_hint:'Stake your RST to earn more', easy_hint:'Full world \u2014 unlimited trading', full_hint:'Staked \u2014 full world unlocked' },
  es: { label:'Dificultad', xhc_hint:'Sin comercio \u2014 gana 10 RST para desbloquear', hard_hint:'Apuesta tu RST para ganar m\xE1s', easy_hint:'Mundo completo \u2014 comercio ilimitado', full_hint:'Apostado \u2014 mundo completo desbloqueado' },
  fr: { label:'Difficult\xE9', xhc_hint:'Pas d\u2019\xE9change \u2014 gagnez 10 RST pour d\xE9bloquer', hard_hint:'Misez votre RST pour gagner plus', easy_hint:'Monde entier \u2014 commerce illimit\xE9', full_hint:'Mis\xE9 \u2014 monde entier d\xE9bloqu\xE9' },
  zh: { label:'\u96BE\u5EA6', xhc_hint:'\u65E0\u6CD5\u4EA4\u6613 \u2014 \u83B7\u5F9710 RST\u89E3\u9501', hard_hint:'\u8D28\u62BC RST \u83B7\u5F97\u66F4\u591A\u6536\u76CA', easy_hint:'\u5168\u5730\u56FE \u2014 \u65E0\u9650\u5236\u4EA4\u6613', full_hint:'\u5DF2\u8D28\u62BC \u2014 \u5168\u5730\u56FE\u89E3\u9501' },
  de: { label:'Schwierigkeit', xhc_hint:'Kein Handel \u2014 10 RST verdienen zum Freischalten', hard_hint:'Stake dein RST f\xFCr mehr Ertrag', easy_hint:'Volle Welt \u2014 unbegrenzter Handel', full_hint:'Gestakt \u2014 volle Welt freigeschaltet' },
  fa: { label:'\u0633\u062E\u062A\u06CC', xhc_hint:'\u0628\u062F\u0648\u0646 \u062A\u062C\u0627\u0631\u062A \u2014 10 RST \u06A9\u0633\u0628 \u06A9\u0646\u06CC\u062F', hard_hint:'RST \u062E\u0648\u062F \u0631\u0627 \u0634\u0631\u0637\u200C\u0628\u0646\u062F\u06CC \u06A9\u0646\u06CC\u062F \u0648 \u0628\u06CC\u0634\u062A\u0631 \u06A9\u0633\u0628 \u06A9\u0646\u06CC\u062F', easy_hint:'\u062F\u0633\u062A\u0631\u0633\u06CC \u06A9\u0627\u0645\u0644 \u2014 \u062A\u062C\u0627\u0631\u062A \u0622\u0632\u0627\u062F', full_hint:'\u0634\u0631\u0637\u200C\u0628\u0646\u062F\u06CC \u0634\u062F\u0647 \u2014 \u062F\u0633\u062A\u0631\u0633\u06CC \u06A9\u0627\u0645\u0644' },
  pt: { label:'Dificuldade', xhc_hint:'Sem com\xE9rcio \u2014 ganhe 10 RST para desbloquear', hard_hint:'Aposte seu RST para ganhar mais', easy_hint:'Mundo completo \u2014 com\xE9rcio ilimitado', full_hint:'Apostado \u2014 mundo completo desbloqueado' },
  ja: { label:'\u96E3\u6613\u5EA6', xhc_hint:'\u53D6\u5F15\u4E0D\u53EF \u2014 RST 10\u679A\u3067\u89E3\u653E', hard_hint:'RST\u3092\u30B9\u30C6\u30FC\u30AF\u3057\u3066\u3082\u3063\u3068\u7A3C\u304C\u3046', easy_hint:'\u5168\u30DE\u30C3\u30D7 \u2014 \u5236\u9650\u306A\u3057\u53D6\u5F15', full_hint:'\u30B9\u30C6\u30FC\u30AF\u6E08 \u2014 \u5168\u30DE\u30C3\u30D7\u89E3\u653E' },
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
      '<span class="htp-addr">0xf4d9ed7f424ca09d41655eb2a3c69d559fd2fdd857a75ffbafa9373ce4ac62d4</span>' +
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

            // RST Leaderboard
            if (url.pathname === '/hiscores' || url.pathname === '/hiscores/') {
                const { totalGPConverted, RST_GP_PER_TOKEN } = await import('../engine/pill/PillMerchant.js');
                const entries = Array.from(totalGPConverted.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 50);

                // Batch-enrich from DB: playtime, skill levels, bank value
                const SKILL_TYPE = { wc: 9, mining: 15, smithing: 14, cooking: 8, fishing: 11 };
                let playtimeMap = new Map<string, number>();   // username.lower → ticks
                let skillsMap   = new Map<string, Record<string, number>>(); // username.lower → {wc,mining,...}
                let wealthMap   = new Map<string, number>();   // username.lower → gp value

                if (entries.length > 0) {
                    const usernames = entries.map(([u]) => u.toLowerCase());
                    const accounts = await db.selectFrom('account')
                        .select(['id', 'username'])
                        .where(eb => eb(eb.fn('lower', ['username']), 'in', usernames))
                        .execute();
                    const idByName = new Map(accounts.map(a => [a.username.toLowerCase(), a.id]));
                    const ids = accounts.map(a => a.id);

                    if (ids.length > 0) {
                        // Playtime
                        const ptRows = await db.selectFrom('hiscore_large')
                            .innerJoin('account', 'account.id', 'hiscore_large.account_id')
                            .select(['account.username', 'hiscore_large.playtime'])
                            .where('hiscore_large.type', '=', 0)
                            .where('hiscore_large.profile', '=', 'main')
                            .where('hiscore_large.account_id', 'in', ids)
                            .execute();
                        for (const r of ptRows) playtimeMap.set(r.username.toLowerCase(), r.playtime);

                        // Skill levels
                        const skRows = await db.selectFrom('hiscore')
                            .innerJoin('account', 'account.id', 'hiscore.account_id')
                            .select(['account.username', 'hiscore.type', 'hiscore.level'])
                            .where('hiscore.type', 'in', Object.values(SKILL_TYPE))
                            .where('hiscore.profile', '=', 'main')
                            .where('hiscore.account_id', 'in', ids)
                            .execute();
                        for (const r of skRows) {
                            const key = r.username.toLowerCase();
                            if (!skillsMap.has(key)) skillsMap.set(key, {});
                            skillsMap.get(key)![r.type] = r.level;
                        }

                        // Bank/outfit value
                        const wRows = await db.selectFrom('hiscore_outfit')
                            .innerJoin('account', 'account.id', 'hiscore_outfit.account_id')
                            .select(['account.username', 'hiscore_outfit.value'])
                            .where('hiscore_outfit.profile', '=', 'main')
                            .where('hiscore_outfit.account_id', 'in', ids)
                            .execute();
                        for (const r of wRows) wealthMap.set(r.username.toLowerCase(), r.value);
                    }
                }

                function fmtGP(v: number): string {
                    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
                    if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
                    return v.toLocaleString();
                }
                function fmtTicks(ticks: number): string {
                    const secs = Math.floor(ticks * (Environment.NODE_TICKRATE / 1000));
                    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
                    return h > 0 ? `${h}h ${m}m` : `${m}m`;
                }
                function skillCell(skills: Record<string, number> | undefined, type: number): string {
                    const lvl = skills?.[type] ?? 1;
                    const col = lvl >= 99 ? '#f0c030' : lvl >= 70 ? '#44cc44' : lvl >= 50 ? '#aaa' : '#555';
                    return `<td style="padding:4px 8px;color:${col};text-align:center;">${lvl}</td>`;
                }

                const rows = entries.map(([username, gp], i) => {
                    const rst = (gp / RST_GP_PER_TOKEN).toFixed(2);
                    const key = username.toLowerCase();
                    const rankColor = i === 0 ? '#f0c030' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#c0a060';
                    const pt = playtimeMap.get(key);
                    const skills = skillsMap.get(key);
                    const wealth = wealthMap.get(key);
                    return `<tr>
                        <td style="padding:4px 8px;color:#555;font-size:0.85em;">${i + 1}</td>
                        <td style="padding:4px 8px;color:${rankColor};font-weight:bold;">${username}</td>
                        <td style="padding:4px 8px;color:#f0c030;text-align:right;">${fmtGP(gp)}</td>
                        <td style="padding:4px 8px;color:#44cc44;text-align:right;">${rst}</td>
                        <td style="padding:4px 8px;color:#888;text-align:right;">${pt != null ? fmtTicks(pt) : '-'}</td>
                        <td style="padding:4px 8px;color:#f7931a;text-align:right;">${wealth != null ? fmtGP(wealth) : '-'}</td>
                        ${skillCell(skills, SKILL_TYPE.wc)}
                        ${skillCell(skills, SKILL_TYPE.mining)}
                        ${skillCell(skills, SKILL_TYPE.smithing)}
                        ${skillCell(skills, SKILL_TYPE.cooking)}
                        ${skillCell(skills, SKILL_TYPE.fishing)}
                    </tr>`;
                }).join('');
                const noRows = entries.length === 0
                    ? '<tr><td colspan="11" style="padding:20px;text-align:center;color:#444;">No conversions yet — start playing!</td></tr>'
                    : '';

                const rstHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>RST Hiscores — Runescape Resource Terminal</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0e0e0e; color:#c0a060; font-family:'Courier New',monospace; min-height:100vh; }
header { background:#1a1200; border-bottom:2px solid #4a3800; padding:0 20px; height:44px; display:flex; align-items:center; justify-content:space-between; }
.logo { color:#f0c030; font-size:1em; font-weight:bold; letter-spacing:2px; }
.back { background:#1a1200; border:1px solid #f0c030; color:#f0c030; padding:5px 14px; font-family:monospace; font-size:0.72em; border-radius:3px; text-decoration:none; }
.back:hover { background:#2a2000; }
.wrap { max-width:1100px; margin:30px auto; padding:0 16px; overflow-x:auto; }
h1 { color:#f0c030; font-size:1em; letter-spacing:3px; text-transform:uppercase; margin-bottom:4px; }
.sub { color:#555; font-size:0.72em; margin-bottom:20px; border-bottom:1px solid #1e1600; padding-bottom:12px; }
table { width:100%; border-collapse:collapse; white-space:nowrap; }
th { color:#888; font-size:0.65em; letter-spacing:1px; text-transform:uppercase; padding:6px 8px; border-bottom:2px solid #2a2000; text-align:left; }
th.r { text-align:right; } th.c { text-align:center; }
tr:nth-child(even) { background:#0a0a0a; }
tr:hover { background:#141000; }
.skill-hdr { color:#4a6; font-size:0.62em; }
</style>
</head>
<body>
<header>
  <span class="logo">&#x26CF; RST HISCORES</span>
  <a href="/play" class="back">&#x2190; BACK TO GAME</a>
</header>
<div class="wrap">
  <h1>&#x1F3C6; Runescape Resource Terminal — Hiscores</h1>
  <p class="sub">All-time GP converted to RST &mdash; updated live &mdash; ${entries.length} players</p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Player</th>
        <th class="r">GP Converted</th>
        <th class="r">RST Earned</th>
        <th class="r">Time Played</th>
        <th class="r">Bank Value</th>
        <th class="c skill-hdr">WC</th>
        <th class="c skill-hdr">Mining</th>
        <th class="c skill-hdr">Smithing</th>
        <th class="c skill-hdr">Cooking</th>
        <th class="c skill-hdr">Fishing</th>
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
