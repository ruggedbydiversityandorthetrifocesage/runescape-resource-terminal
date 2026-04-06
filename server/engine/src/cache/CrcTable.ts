import fs from 'fs';

import Packet from '#/io/Packet.js';
import Environment from '#/util/Environment.js';

export const CrcBuffer: Packet = new Packet(new Uint8Array(4 * 9));
export let CrcTable: number[] = [];
export let CrcBuffer32: number = 0;

// Client JAG files in data/pack/client/ — indices match the /crc response positions.
// Index 0 is unused (padding); indices 1-8 map to the files served by handleCacheEndpoints.
const CLIENT_FILES: (string | null)[] = [
    null,          // 0 — unused
    'title',       // 1
    'config',      // 2
    'interface',   // 3
    'media',       // 4
    'versionlist', // 5
    'textures',    // 6
    'wordenc',     // 7 — may not exist
    'sounds',      // 8
];

export function makeCrcs() {
    CrcTable = [];
    CrcBuffer.pos = 0;

    for (let i = 0; i < CLIENT_FILES.length; i++) {
        const name = CLIENT_FILES[i];
        if (name) {
            const path = `data/pack/client/${name}`;
            if (fs.existsSync(path)) {
                const data = new Uint8Array(fs.readFileSync(path));
                CrcBuffer.p4(Packet.getcrc(data, 0, data.length));
            } else {
                CrcBuffer.p4(0);
            }
        } else {
            CrcBuffer.p4(0);
        }
    }

    CrcBuffer32 = Packet.getcrc(CrcBuffer.data, 0, CrcBuffer.data.length);
}

if (!Environment.STANDALONE_BUNDLE) {
    if (fs.existsSync('data/pack/client/')) {
        makeCrcs();
    }
}
