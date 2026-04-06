import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getContract, JSONRpcProvider } from 'opnet';
import { networks as _networks } from '@btc-vision/bitcoin';
import { EcKeyPair, Wallet, Address } from '@btc-vision/transaction';
import { QuantumBIP32Factory, MLDSASecurityLevel } from '@btc-vision/bip32';
import { walletQueue, runWalletQueue } from './RSTMinter.js';

// V4 BankLog — deployed 2026-03-17, btc-runtime 1.11.0
export const BANKLOG_CONTRACT_ADDR = 'opt1sqpy9gunnr7l0sxsnwwl4lgydw8g9dx6x2s97x7kf';

const networks = {
    ..._networks,
    opnetTestnet: _networks.opnetTestnet ?? {
        messagePrefix: '\x18Bitcoin Signed Message:\n',
        bech32: 'opt',
        bech32Opnet: 'opt',
        bip32: { public: 0x043587cf, private: 0x04358394 },
        pubKeyHash: 0x6f,
        scriptHash: 0xc4,
        wif: 0xef,
    },
};

const BANKLOG_MINT_ABI = [
    {
        name: 'mint',
        type: 'function',
        payable: false,
        onlyOwner: false,
        inputs: [{ name: 'to', type: 'ADDRESS' }],
        outputs: [{ name: 'tokenId', type: 'UINT256' }],
    },
];

// updateScore: 8 fields — tokenId, score, wcXp, miningXp, fishXp, rstEarned, resourcesSold, bankValue
const BANKLOG_UPDATE_SCORE_ABI = [
    {
        name: 'updateScore',
        type: 'function',
        payable: false,
        onlyOwner: false,
        inputs: [
            { name: 'tokenId',       type: 'UINT256' },
            { name: 'score',         type: 'UINT256' },
            { name: 'woodcuttingXp', type: 'UINT256' },
            { name: 'miningXp',      type: 'UINT256' },
            { name: 'fishingXp',     type: 'UINT256' },
            { name: 'rstEarned',     type: 'UINT256' },
            { name: 'resourcesSold', type: 'UINT256' },
            { name: 'bankValue',     type: 'UINT256' },
        ],
        outputs: [{ name: 'success', type: 'BOOL' }],
    },
];

const SERVER_TWEAKED_PUBKEY = '6445eefbdce10dc31e294119b562aa3f83514ff5d3c4d2b4acd150b0a1f9a901';
const REGISTRY_PATH = 'data/banklog-registry.json';

interface BankLogEntry { username: string; mldsaHash: string; mintedAt: number; }
interface BankLogRegistry {
    nextTokenId: number;
    byTokenId: Record<string, BankLogEntry>;
    byUsername: Record<string, number>;
}

function loadRegistry(): BankLogRegistry {
    if (existsSync(REGISTRY_PATH)) {
        try { return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as BankLogRegistry; } catch { /* fall through */ }
    }
    return { nextTokenId: 1, byTokenId: {}, byUsername: {} };
}

function saveRegistry(reg: BankLogRegistry): void {
    writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

export function getBankLogTokenId(username: string): number | null {
    const reg = loadRegistry();
    return reg.byUsername[username.toLowerCase()] ?? null;
}

export function getBankLogEntry(tokenId: number): BankLogEntry | null {
    const reg = loadRegistry();
    return reg.byTokenId[String(tokenId)] ?? null;
}

// Reuse provider singleton
let _provider: JSONRpcProvider | null = null;
function getProvider(): JSONRpcProvider {
    if (!_provider) _provider = new JSONRpcProvider('https://testnet.opnet.org', networks.opnetTestnet);
    return _provider;
}

function buildWallet(wif: string): { wallet: Wallet; mldsaKeyHex: string } {
    const ecKeypair = EcKeyPair.fromWIF(wif, networks.opnetTestnet);
    const privateKeyBytes = ecKeypair.privateKey;
    if (!privateKeyBytes) throw new Error('Could not extract private key from WIF');
    const mldsaNode = QuantumBIP32Factory.fromSeed(privateKeyBytes, networks.opnetTestnet, MLDSASecurityLevel.LEVEL2);
    const wallet = new Wallet(wif, mldsaNode.toBase58(), networks.opnetTestnet);
    const mldsaKeyHex = Buffer.from((wallet.mldsaKeypair as any).publicKey).toString('hex');
    return { wallet, mldsaKeyHex };
}

// ─── Mint ────────────────────────────────────────────────────────────────────

const mintingInProgress = new Set<string>();

async function _mintBankLog(username: string, mldsaPublicKey: string): Promise<boolean> {
    if (BANKLOG_CONTRACT_ADDR === 'DEPLOY_PENDING') {
        console.log('[BankLog] Contract not deployed yet — skipping mint for ' + username);
        return false;
    }
    const wif = process.env.RST_MINTER_WIF;
    if (!wif) { console.log('[BankLog] RST_MINTER_WIF not set'); return false; }

    try {
        const provider = getProvider();
        const { wallet, mldsaKeyHex } = buildWallet(wif);
        const callerAddr = Address.fromString('0x' + mldsaKeyHex, '0x' + SERVER_TWEAKED_PUBKEY);

        // Recipient = SHA256 of player's raw MLDSA public key
        const mldsaHash = createHash('sha256')
            .update(Buffer.from(mldsaPublicKey.replace(/^0x/, ''), 'hex'))
            .digest('hex');
        const recipientAddr = (Address as any).fromString('0x' + mldsaHash);

        const contract = getContract(BANKLOG_CONTRACT_ADDR, BANKLOG_MINT_ABI as any, provider, networks.opnetTestnet, callerAddr);

        const reg = loadRegistry();
        const tokenId = reg.nextTokenId;

        console.log('[BankLog] Minting tokenId=' + tokenId + ' to ' + username + ' (' + mldsaHash.slice(0, 8) + '...)');
        const sim = await (contract as any).mint(recipientAddr);
        if ('error' in sim) throw new Error('mint simulation failed: ' + (sim as any).error);

        const receipt = await sim.sendTransaction({
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            refundTo: wallet.p2tr,
            maximumAllowedSatToSpend: 50_000n,
            network: networks.opnetTestnet,
            linkMLDSAPublicKeyToAddress: false,
        });
        if (!receipt || 'error' in receipt) throw new Error('mint TX rejected: ' + JSON.stringify(receipt));

        const txid = (receipt as any).txid ?? (receipt as any).hash ?? (receipt as any).id ?? JSON.stringify(receipt).slice(0, 200);
        console.log('[BankLog] ✅ Minted tokenId=' + tokenId + ' for ' + username + ' txid=' + txid);

        reg.nextTokenId = tokenId + 1;
        reg.byTokenId[String(tokenId)] = { username: username.toLowerCase(), mldsaHash, mintedAt: Date.now() };
        reg.byUsername[username.toLowerCase()] = tokenId;
        saveRegistry(reg);

        return true;
    } catch (e: unknown) {
        console.error('[BankLog] ❌ mint failed for ' + username + ':', e instanceof Error ? e.message : String(e));
        return false;
    } finally {
        mintingInProgress.delete(username);
    }
}

/**
 * Mint a Bank Log NFT for a player on wallet connect. No-op if already minted.
 * Runs through the shared walletQueue to avoid UTXO contention.
 */
export function mintBankLog(username: string, mldsaPublicKey: string): Promise<boolean> {
    const key = username.toLowerCase();

    const reg = loadRegistry();
    if (reg.byUsername[key] !== undefined) {
        console.log('[BankLog] ' + username + ' already has tokenId=' + reg.byUsername[key]);
        return Promise.resolve(false);
    }

    if (mintingInProgress.has(key)) {
        console.log('[BankLog] Mint already queued for ' + username);
        return Promise.resolve(false);
    }

    mintingInProgress.add(key);
    return new Promise<boolean>(resolve => {
        walletQueue.push({
            label: 'banklog:mint:' + username,
            run: () => _mintBankLog(username, mldsaPublicKey),
            resolve,
        });
        console.log('[BankLog] Queued mint for ' + username + ' (queue depth: ' + walletQueue.length + ')');
        runWalletQueue();
    });
}

// ─── Stamp score ─────────────────────────────────────────────────────────────

interface StampData {
    score: number;
    woodcuttingXp: number;
    miningXp: number;
    fishingXp: number;
    rstEarned: number;
    resourcesSold: number;
    bankValue: number; // GP value of player's bank (0 until tracked)
}

async function _stampBankLog(username: string, tokenId: number, d: StampData): Promise<boolean> {
    const wif = process.env.RST_MINTER_WIF;
    if (!wif) return false;

    try {
        const provider = getProvider();
        const { wallet, mldsaKeyHex } = buildWallet(wif);
        const callerAddr = Address.fromString('0x' + mldsaKeyHex, '0x' + SERVER_TWEAKED_PUBKEY);

        const contract = getContract(BANKLOG_CONTRACT_ADDR, BANKLOG_UPDATE_SCORE_ABI as any, provider, networks.opnetTestnet, callerAddr);

        console.log('[BankLog] Stamping score=' + d.score + ' wc=' + d.woodcuttingXp + ' mine=' + d.miningXp + ' fish=' + d.fishingXp + ' rst=' + d.rstEarned + ' res=' + d.resourcesSold + ' for ' + username + ' tokenId=' + tokenId);
        const sim = await (contract as any).updateScore(
            BigInt(tokenId),
            BigInt(d.score),
            BigInt(d.woodcuttingXp),
            BigInt(d.miningXp),
            BigInt(d.fishingXp),
            BigInt(Math.floor(d.rstEarned * 1e18)), // RST as wei (18 decimals)
            BigInt(d.resourcesSold),
            BigInt(d.bankValue),                     // GP value of bank contents
        );
        if ('error' in sim) throw new Error('updateScore simulation failed: ' + (sim as any).error);

        const receipt = await sim.sendTransaction({
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            refundTo: wallet.p2tr,
            maximumAllowedSatToSpend: 50_000n,
            network: networks.opnetTestnet,
            linkMLDSAPublicKeyToAddress: false,
        });
        if (!receipt || 'error' in receipt) throw new Error('updateScore TX rejected: ' + JSON.stringify(receipt));

        const txid = (receipt as any).txid ?? (receipt as any).hash ?? (receipt as any).id ?? JSON.stringify(receipt).slice(0, 120);
        console.log('[BankLog] ✅ Score stamped on-chain for ' + username + ' score=' + d.score + ' txid=' + txid);
        return true;
    } catch (e: unknown) {
        console.error('[BankLog] ❌ stampBankLog failed for ' + username + ':', e instanceof Error ? e.message : String(e));
        return false;
    }
}

/**
 * Stamp an on-chain score snapshot when a player converts at the general store.
 * Writes score + per-skill XP + resourcesSold — full audit trail on Bitcoin.
 *
 * Event-driven: only fires for active converters, not all players.
 * Runs through the shared walletQueue after the preceding grantClaim TX.
 */
export function stampBankLog(username: string, totalLevel: number, wcXp: number, mineXp: number, fishXp: number, rstEarned: number, resourcesSold: number, bankValue: number = 0): void {
    const key = username.toLowerCase();
    const reg = loadRegistry();
    const tokenId = reg.byUsername[key];
    if (tokenId === undefined) {
        console.log('[BankLog] No Bank Log for ' + username + ' — skip stamp (will mint on next wallet connect)');
        return;
    }

    const score = totalLevel * 10 + Math.floor(rstEarned * 5);
    const stampData: StampData = { score, woodcuttingXp: wcXp, miningXp: mineXp, fishingXp: fishXp, rstEarned, resourcesSold, bankValue };
    walletQueue.push({
        label: 'banklog:stamp:' + username + ':score=' + score,
        run: () => _stampBankLog(username, tokenId, stampData),
        resolve: () => {},
    });
    console.log('[BankLog] Queued score stamp for ' + username + ' score=' + score + ' (queue depth: ' + walletQueue.length + ')');
    runWalletQueue();
}
