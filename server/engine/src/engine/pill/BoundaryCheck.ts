import { NetworkPlayer } from '#/engine/entity/NetworkPlayer.js';

const ZONE = { minX: 3080, maxX: 3300, minZ: 3200, maxZ: 3560 };
const AL_KHARID = { minX: 3280, maxX: 3320, minZ: 3140, maxZ: 3210 };

export function checkPlayerBoundary(player: NetworkPlayer): void {
    const x = player.x;
    const z = player.z;
    const inMain = x >= ZONE.minX && x <= ZONE.maxX && z >= ZONE.minZ && z <= ZONE.maxZ;
    const inAlKharid = x >= AL_KHARID.minX && x <= AL_KHARID.maxX && z >= AL_KHARID.minZ && z <= AL_KHARID.maxZ;
    if (!inMain && !inAlKharid) {
        player.teleport(3097, 3277, 0);
        player.messageGame('The path is blocked. Stick to woodcutting and mining!');
    }
}
