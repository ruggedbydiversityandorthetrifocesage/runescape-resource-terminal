import { getContract, JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { EcKeyPair, Wallet, Address } from '@btc-vision/transaction';
import { QuantumBIP32Factory, MLDSASecurityLevel } from '@btc-vision/bip32';

export const RST_CONTRACT_ADDR = 'opt1sqqsrj9ex92gwjwus3ufz60nclkdgzdtgnqkv9ya8';
export const RST_GP_PER_TOKEN = 10000; // 10,000 GP = 1 RST (18 decimals)

const RST_MINT_ABI = [
    {
        name: 'mint',
        type: 'function',
        payable: false,
        onlyOwner: false,
        inputs: [
            { name: 'to', type: 'ADDRESS' },
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

function buildWallet(wif: string): Wallet {
    const ecKeypair = EcKeyPair.fromWIF(wif, networks.opnetTestnet);
    const privateKeyBytes = ecKeypair.privateKey;
    if (!privateKeyBytes) throw new Error('Could not extract private key from WIF');
    const mldsaNode = QuantumBIP32Factory.fromSeed(privateKeyBytes, networks.opnetTestnet, MLDSASecurityLevel.LEVEL2);
    return new Wallet(wif, mldsaNode.toBase58(), networks.opnetTestnet);
}

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
        const wallet = buildWallet(wif);
        console.log('[RST] Minter address: ' + wallet.p2tr);

        // Resolve recipient Address.
        // Address.fromString accepts EITHER:
        //   - 64 hex chars (32 bytes)  → treated as pre-hashed, stored as-is (NO full key in tx)
        //   - 2624 hex chars (1312 bytes) → SHA256'd internally AND full key included in tx
        // The wallet registered on-chain via SatSlots with its FULL key, so we must pass the
        // full 1312-byte key so the SDK includes it in the tx and the protocol matches the registration.
        let recipientAddr: Address;
        try {
            // Get tweakedPubkey from node (classical key component)
            const raw = await (provider as any).getPublicKeysInfoRaw(recipientBech32m, false);
            const rawEntry = raw?.[recipientBech32m] ?? raw;
            const tweaked: string | undefined = rawEntry?.tweakedPubkey ?? rawEntry?.tweakedPubKey ?? rawEntry?.originalPubKey;
            if (!tweaked) throw new Error('Could not get tweakedPubkey from node for ' + recipientBech32m);

            if (mldsaPublicKey) {
                // Full 1312-byte key: pass it directly so SDK hashes it AND includes full key in tx
                // This matches the on-chain registration type (full key, not hashed-only)
                recipientAddr = Address.fromString('0x' + mldsaPublicKey.replace(/^0x/, ''), '0x' + tweaked);
                console.log('[RST] Using full MLDSA key address for ' + username + ' (tweaked: ' + tweaked.slice(0, 8) + '...)');
            } else {
                throw new Error('No MLDSA key registered for ' + username + ' — ask them to reconnect wallet at /play');
            }
        } catch (resolveErr: unknown) {
            const msg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
            throw new Error('Cannot resolve OPNet address for ' + username + ' (' + recipientBech32m.slice(0, 12) + '...): ' + msg);
        }

        const rstWei = BigInt(gpAmount) * (10n ** 18n) / BigInt(RST_GP_PER_TOKEN);
        const rstDisplay = (Number(rstWei) / 1e18).toFixed(4);

        const contract = getContract(RST_CONTRACT_ADDR, RST_MINT_ABI as any, provider, networks.opnetTestnet, wallet.address);

        console.log('[RST] Simulating mint(' + rstDisplay + ' RST) to ' + username + ' (' + recipientBech32m.slice(0, 12) + '...)');
        const sim = await (contract as any).mint(recipientAddr, rstWei);
        if ('error' in sim) throw new Error('Mint simulation failed: ' + (sim as any).error);

        const receipt = await sim.sendTransaction({
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            refundTo: wallet.p2tr,
            maximumAllowedSatToSpend: 50_000n,
            network: networks.opnetTestnet,
        });

        if (!receipt || 'error' in receipt) throw new Error('Mint transaction rejected: ' + JSON.stringify(receipt));

        console.log('[RST] ✅ Minted ' + rstDisplay + ' RST to ' + username + ' (' + recipientBech32m.slice(0, 12) + '...)');
        return true;
    } catch (e: unknown) {
        console.error('[RST] ❌ Mint failed for ' + username + ':', e instanceof Error ? e.message : String(e));
        return false;
    } finally {
        mintingInProgress.delete(username);
    }
}

export function isMintConfigured(): boolean {
    return !!process.env.RST_MINTER_WIF;
}
