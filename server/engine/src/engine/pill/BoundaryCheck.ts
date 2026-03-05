import { NetworkPlayer } from '#/engine/entity/NetworkPlayer.js';
import { getPlayerRSTTier } from '#/engine/pill/PillMerchant.js';

// Phase 1 — Misthalin (0 RST required)
const P1_ZONE = { minX: 3080, maxX: 3300, minZ: 3200, maxZ: 3560 };
const P1_AL_KHARID = { minX: 3280, maxX: 3320, minZ: 3140, maxZ: 3210 };

// Phase 2 — +Asgarnia (Falador, Port Sarim, Rimmington) + Duel Arena + Wilderness (10 RST required)
const P2_ZONE = { minX: 2920, maxX: 3420, minZ: 3080, maxZ: 3904 };

const SPAWN_X = 3097, SPAWN_Z = 3277;

export function checkPlayerBoundary(player: NetworkPlayer): void {
    const tier = getPlayerRSTTier(player.username);

    if (tier >= 2) return; // full world access

    const { x, z } = player;

    if (z >= 6400) return; // underground — surface zone already enforced at entry

    if (tier === 1) {
        const inP2 = x >= P2_ZONE.minX && x <= P2_ZONE.maxX && z >= P2_ZONE.minZ && z <= P2_ZONE.maxZ;
        if (!inP2) {
            player.teleport(SPAWN_X, SPAWN_Z, 0);
            player.messageGame('You need 1,000 RST to access this area. Keep earning — you\'re almost there!');
        }
        return;
    }

    // tier === 0
    const inMain = x >= P1_ZONE.minX && x <= P1_ZONE.maxX && z >= P1_ZONE.minZ && z <= P1_ZONE.maxZ;
    const inAlKharid = x >= P1_AL_KHARID.minX && x <= P1_AL_KHARID.maxX && z >= P1_AL_KHARID.minZ && z <= P1_AL_KHARID.maxZ;
    if (!inMain && !inAlKharid) {
        player.teleport(SPAWN_X, SPAWN_Z, 0);
        player.messageGame('You need 10 RST to explore further. Earn GP and convert to RST at /rst!');
    }
}
