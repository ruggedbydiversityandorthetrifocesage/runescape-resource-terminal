import { createHash } from 'node:crypto';
import { getContract, JSONRpcProvider } from 'opnet';
import { networks as _networks } from '@btc-vision/bitcoin';
import { EcKeyPair, Wallet, Address } from '@btc-vision/transaction';
import { QuantumBIP32Factory, MLDSASecurityLevel } from '@btc-vision/bip32';

// Hardcode opnetTestnet — older @btc-vision/bitcoin versions don't export it
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

export const RST_CONTRACT_ADDR = 'opt1sqq0uxr9f5e9qdswpaptpvgc8qr9thv2a4gwaj6fl';
export const RST_GP_PER_TOKEN = 1000; // 1,000 GP = 1 RST (18 decimals)

const RST_MINT_ABI = [
    {
        name: 'grantClaim',
        type: 'function',
        payable: false,
        onlyOwner: false,
        inputs: [
            { name: 'player', type: 'ADDRESS' },
            { name: 'amount', type: 'UINT256' },
        ],
        outputs: [],
    },
];

// Prevent concurrent mints for the same player
const mintingInProgress = new Set<string>();

let _provider: JSONRpcProvider | null = null;

function getProvider(): JSONRpcProvider {
    if (!_provider) {
        _provider = new JSONRpcProvider({ url: 'https://testnet.opnet.org', network: networks.opnetTestnet });
    }
    return _provider;
}

function buildWallet(wif: string): { wallet: Wallet; mldsaHash: string; mldsaKeyHex: string } {
    const ecKeypair = EcKeyPair.fromWIF(wif, networks.opnetTestnet);
    const privateKeyBytes = ecKeypair.privateKey;
    if (!privateKeyBytes) throw new Error('Could not extract private key from WIF');
    const mldsaNode = QuantumBIP32Factory.fromSeed(privateKeyBytes, networks.opnetTestnet, MLDSASecurityLevel.LEVEL2);
    const wallet = new Wallet(wif, mldsaNode.toBase58(), networks.opnetTestnet);
    // wallet.mldsaKeypair.publicKey is the actual 1312-byte MLDSA public key.
    // mldsaNode.publicKey is the 33-byte EC compressed key — NOT what we want.
    const mldsaPubKey: Uint8Array = (wallet.mldsaKeypair as any).publicKey;
    console.log('[RST] MLDSA pubkey bytes: ' + mldsaPubKey.length);
    const mldsaHash = createHash('sha256').update(mldsaPubKey).digest('hex');
    const mldsaKeyHex = Buffer.from(mldsaPubKey).toString('hex');
    return { wallet, mldsaHash, mldsaKeyHex };
}

/**
 * Returns the server's OPNet MLDSA identity hash (64 hex chars / 32 bytes).
 * This is what the RST contract sees as msg.sender when the server calls grantClaim.
 * Pass this to setMinter() from the deployer's OP_WALLET to authorize the server.
 */
export function getServerMldsaHash(): string | null {
    const wif = process.env.RST_MINTER_WIF;
    if (!wif) return null;
    try {
        const { mldsaHash } = buildWallet(wif);
        return mldsaHash;
    } catch {
        return null;
    }
}

// Server's tweaked pubkey (P2TR witness program) — used to build the caller Address for simulation
const SERVER_TWEAKED_PUBKEY = '6445eefbdce10dc31e294119b562aa3f83514ff5d3c4d2b4acd150b0a1f9a901';

/** Decode a bech32m address to its 32-byte witness program as a hex string. */
function bech32mToHex(addr: string): string | null {
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const lower = addr.toLowerCase();
    const sep = lower.lastIndexOf('1');
    if (sep < 1) return null;
    const values: number[] = [];
    for (const c of lower.slice(sep + 1)) {
        const v = CHARSET.indexOf(c);
        if (v === -1) return null;
        values.push(v);
    }
    const prog = values.slice(1, -6); // strip witness version + checksum
    let acc = 0, bits = 0;
    const bytes: number[] = [];
    for (const v of prog) {
        acc = (acc << 5) | v;
        bits += 5;
        while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
    }
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mint RST tokens to a player's wallet from the server.
 * Requires RST_MINTER_WIF environment variable set to the contract deployer's WIF key.
 * Returns true if mint was dispatched, false if skipped/failed.
 */
export async function mintRST(username: string, recipientBech32m: string, gpAmount: number, mldsaPublicKey?: string): Promise<boolean> {
    const wif = process.env.RST_MINTER_WIF;
    if (!wif) {
        console.log('[RST] RST_MINTER_WIF not set — cannot auto-mint for ' + username);
        return false;
    }

    if (mintingInProgress.has(username)) {
        console.log('[RST] Mint already in progress for ' + username + ', skipping duplicate');
        return false;
    }

    mintingInProgress.add(username);
    try {
        const provider = getProvider();
        const { wallet, mldsaHash: serverHash, mldsaKeyHex: serverMldsaKey } = buildWallet(wif);
        console.log('[RST] Minter address: ' + wallet.p2tr);
        console.log('[RST] Minter MLDSA hash: ' + serverHash);

        // Build the server's caller Address explicitly using full MLDSA key + tweaked pubkey.
        // wallet.address alone doesn't resolve to the correct on-chain identity for simulation.
        const callerAddr = Address.fromString('0x' + serverMldsaKey, '0x' + SERVER_TWEAKED_PUBKEY);

        // Resolve recipient Address.
        // We pass ONLY the 32-byte SHA256 hash of the player's MLDSA key — NO tweakedPubkey.
        //
        // Root cause of previous reverts: passing Address.fromString(hash, tweakedPubkey) caused
        // the SDK to embed a "legacy key linkage" in the tx (tweakedPubkey → hash). OPNet rejects
        // this with "Can not reassign existing MLDSA public key to legacy or hashed key" because
        // the player already registered their full 1312-byte key via OP_WALLET for that tweakedPubkey.
        //
        // Fix: omit tweakedPubkey entirely. The calldata only needs the 32-byte MLDSA hash.
        // No key registration = no conflict. The contract stores claimAllowances[hash] = amount,
        // and Blockchain.tx.sender when the player calls claim() == SHA256(their MLDSA key) == hash.
        let recipientAddr: Address;
        if (!mldsaPublicKey) {
            throw new Error('No MLDSA key registered for ' + username + ' — ask them to reconnect wallet at /play');
        }
        const mldsaHash = createHash('sha256')
            .update(Buffer.from(mldsaPublicKey.replace(/^0x/, ''), 'hex'))
            .digest('hex');
        recipientAddr = (Address as any).fromString('0x' + mldsaHash);
        console.log('[RST] grantClaim address for ' + username + ': ' + mldsaHash.slice(0, 8) + '...');

        const rstWei = BigInt(gpAmount) * (10n ** 18n) / BigInt(RST_GP_PER_TOKEN);
        const rstDisplay = (Number(rstWei) / 1e18).toFixed(4);

        const contract = getContract(RST_CONTRACT_ADDR, RST_MINT_ABI as any, provider, networks.opnetTestnet, callerAddr);

        console.log('[RST] Simulating grantClaim(' + rstDisplay + ' RST) to ' + username + ' (' + recipientBech32m.slice(0, 12) + '...)');
        const sim = await (contract as any).grantClaim(recipientAddr, rstWei);
        if ('error' in sim) throw new Error('grantClaim simulation failed: ' + (sim as any).error);

        const receipt = await sim.sendTransaction({
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            refundTo: wallet.p2tr,
            maximumAllowedSatToSpend: 50_000n,
            network: networks.opnetTestnet,
            linkMLDSAPublicKeyToAddress: false, // key already registered — don't re-register
        });

        if (!receipt || 'error' in receipt) throw new Error('grantClaim transaction rejected: ' + JSON.stringify(receipt));

        const txid = (receipt as any).txid ?? (receipt as any).hash ?? (receipt as any).id ?? JSON.stringify(receipt).slice(0, 120);
        console.log('[RST] ✅ grantClaim ' + rstDisplay + ' RST to ' + username + ' (' + recipientBech32m.slice(0, 12) + '...) txid=' + txid);
        return true;
    } catch (e: unknown) {
        console.error('[RST] ❌ grantClaim failed for ' + username + ':', e instanceof Error ? e.message : String(e));
        return false;
    } finally {
        mintingInProgress.delete(username);
    }
}

export function isMintConfigured(): boolean {
    return !!process.env.RST_MINTER_WIF;
}

export const SRST_STAKING_CONTRACT = 'opt1sqp0zf6u3j0t4ja894fegmz29g498p0079q0ujwj6';

const SRST_ADD_REWARDS_ABI = [
    {
        name: 'increaseAllowance',
        type: 'function',
        payable: false,
        onlyOwner: false,
        inputs: [
            { name: 'spender', type: 'ADDRESS' },
            { name: 'amount', type: 'UINT256' },
        ],
        outputs: [],
    },
    {
        name: 'addRewards',
        type: 'function',
        payable: false,
        onlyOwner: false,
        inputs: [{ name: 'amount', type: 'UINT256' }],
        outputs: [],
    },
];

/**
 * Deposit RST rewards into the sRST vault. Only callable by the server (BOB address).
 * Increases vault total without minting new sRST — improves exchange ratio for all stakers.
 * Step 1: RST.increaseAllowance(stakingContract, amount)
 * Step 2: sRST.addRewards(amount)
 */
export async function addRewardsRST(rstAmount: number): Promise<boolean> {
    const wif = process.env.RST_MINTER_WIF;
    if (!wif) {
        console.log('[RST] RST_MINTER_WIF not set — cannot add rewards');
        return false;
    }
    try {
        const provider = getProvider();
        const { wallet } = buildWallet(wif);

        const serverMldsaKey = Buffer.from((wallet.mldsaKeypair as any).publicKey).toString('hex');
        const callerAddr = Address.fromString('0x' + serverMldsaKey, '0x' + SERVER_TWEAKED_PUBKEY);

        const rstWei = BigInt(Math.floor(rstAmount * 1e18));
        const rstDisplay = rstAmount.toFixed(4);

        // Step 1: approve staking contract to pull RST
        const stakingHex = bech32mToHex(SRST_STAKING_CONTRACT);
        if (!stakingHex) throw new Error('Could not decode staking contract address');
        const stakingAddr = (Address as any).fromString('0x' + stakingHex);

        const rstContract = getContract(RST_CONTRACT_ADDR, SRST_ADD_REWARDS_ABI as any, provider, networks.opnetTestnet, callerAddr);
        console.log('[RST] Approving staking contract to pull ' + rstDisplay + ' RST...');
        const approveSim = await (rstContract as any).increaseAllowance(stakingAddr, rstWei);
        if ('error' in approveSim) throw new Error('increaseAllowance simulation failed: ' + (approveSim as any).error);
        const approveReceipt = await approveSim.sendTransaction({
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            refundTo: wallet.p2tr,
            maximumAllowedSatToSpend: 50_000n,
            network: networks.opnetTestnet,
            linkMLDSAPublicKeyToAddress: false,
        });
        if (!approveReceipt || 'error' in approveReceipt) throw new Error('increaseAllowance rejected: ' + JSON.stringify(approveReceipt));
        console.log('[RST] Allowance approved. Adding rewards...');

        // Step 2: addRewards on sRST staking contract
        const stakingContract = getContract(SRST_STAKING_CONTRACT, SRST_ADD_REWARDS_ABI as any, provider, networks.opnetTestnet, callerAddr);
        const rewardSim = await (stakingContract as any).addRewards(rstWei);
        if ('error' in rewardSim) throw new Error('addRewards simulation failed: ' + (rewardSim as any).error);
        const rewardReceipt = await rewardSim.sendTransaction({
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            refundTo: wallet.p2tr,
            maximumAllowedSatToSpend: 50_000n,
            network: networks.opnetTestnet,
            linkMLDSAPublicKeyToAddress: false,
        });
        if (!rewardReceipt || 'error' in rewardReceipt) throw new Error('addRewards rejected: ' + JSON.stringify(rewardReceipt));

        const txid = (rewardReceipt as any).txid ?? (rewardReceipt as any).hash ?? JSON.stringify(rewardReceipt).slice(0, 80);
        console.log('[RST] ✅ addRewards ' + rstDisplay + ' RST to vault txid=' + txid);
        return true;
    } catch (e: unknown) {
        console.error('[RST] ❌ addRewards failed:', e instanceof Error ? e.message : String(e));
        return false;
    }
}

const OPNET_RPC = 'https://testnet.opnet.org/api/v1/json-rpc';

/**
 * Fetch on-chain RST balance for a player, identified by their raw MLDSA public key hex.
 * Returns balance as a float (e.g. 2.12). Returns 0 on any error.
 */
export async function fetchRSTBalance(mldsaPublicKeyHex: string): Promise<number> {
    try {
        const mldsaHash = createHash('sha256')
            .update(Buffer.from(mldsaPublicKeyHex.replace(/^0x/, ''), 'hex'))
            .digest('hex');
        // balanceOf(address) selector: 5b46f8f6
        const calldata = '5b46f8f6' + mldsaHash.padStart(64, '0');
        const res = await fetch(OPNET_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'btc_call', params: [RST_CONTRACT_ADDR, calldata, null, null] }),
        });
        const json = await res.json() as any;
        // btc_call response: { result: { result: "<base64>", events: {}, ... } }
        const rpcResult = json?.result;
        const raw: string = typeof rpcResult === 'string' ? rpcResult : (rpcResult?.result ?? rpcResult?.data ?? rpcResult?.output ?? '');
        if (!raw) return 0;
        // Decode: may be base64 or hex
        let hexStr = '';
        if (raw.startsWith('0x')) {
            hexStr = raw.slice(2);
        } else if (/^[0-9a-fA-F]+$/.test(raw)) {
            hexStr = raw;
        } else {
            hexStr = Buffer.from(raw, 'base64').toString('hex');
        }
        if (hexStr.length < 64) return 0;
        return Number(BigInt('0x' + hexStr.slice(0, 64))) / 1e18;
    } catch {
        return 0;
    }
}
