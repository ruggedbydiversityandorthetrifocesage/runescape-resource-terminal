import ejs from 'ejs';

import { CrcBuffer } from '#/cache/CrcTable.js';
import OnDemand from '#/engine/OnDemand.js';
import { getPublicPerDeploymentToken } from '#/io/PemUtil.js';
import { tryParseInt } from '#/util/TryParse.js';
import Environment from '#/util/Environment.js';

export async function handleClientPage(url: URL): Promise<Response | null> {
    // Bot client at / and /bot
    if (url.pathname === '/' || url.pathname === '/bot' || url.pathname === '/bot/') {
        const lowmem = tryParseInt(url.searchParams.get('lowmem'), 0);
        const botUsername = url.searchParams.get('bot') || 'default';

        return new Response(await ejs.renderFile('view/bot.ejs', {
            nodeid: Environment.NODE_ID,
            lowmem,
            members: Environment.NODE_MEMBERS,
            botUsername,
            per_deployment_token: Environment.WEB_SOCKET_TOKEN_PROTECTION ? getPublicPerDeploymentToken() : ''
        }), {
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // Vanilla client at /vanilla
    if (url.pathname === '/vanilla' || url.pathname === '/vanilla/') {
        const lowmem = tryParseInt(url.searchParams.get('lowmem'), 0);

        return new Response(await ejs.renderFile('view/client.ejs', {
            nodeid: Environment.NODE_ID,
            lowmem,
            members: Environment.NODE_MEMBERS,
            per_deployment_token: Environment.WEB_SOCKET_TOKEN_PROTECTION ? getPublicPerDeploymentToken() : ''
        }), {
            headers: { 'Content-Type': 'text/html' }
        });
    }

    if (url.pathname === '/rs2.cgi') {
        const plugin = tryParseInt(url.searchParams.get('plugin'), 0);
        const lowmem = tryParseInt(url.searchParams.get('lowmem'), 0);

        if (Environment.NODE_DEBUG && plugin === 1) {
            return new Response(await ejs.renderFile('view/java.ejs', {
                nodeid: Environment.NODE_ID,
                lowmem,
                members: Environment.NODE_MEMBERS,
                portoff: Environment.NODE_PORT - 43594
            }), {
                headers: { 'Content-Type': 'text/html' }
            });
        } else {
            return new Response(await ejs.renderFile('view/client.ejs', {
                nodeid: Environment.NODE_ID,
                lowmem,
                members: Environment.NODE_MEMBERS,
                per_deployment_token: Environment.WEB_SOCKET_TOKEN_PROTECTION ? getPublicPerDeploymentToken() : ''
            }), {
                headers: { 'Content-Type': 'text/html' }
            });
        }
    }

    return null;
}

export function handleCacheEndpoints(url: URL): Response | null {
    if (url.pathname.startsWith('/crc')) {
        return new Response(Buffer.from(CrcBuffer.data));
    }
    if (url.pathname.startsWith('/title')) {
        return new Response(Bun.file('data/pack/client/title'));
    }
    if (url.pathname.startsWith('/config')) {
        return new Response(Bun.file('data/pack/client/config'));
    }
    if (url.pathname.startsWith('/interface')) {
        return new Response(Bun.file('data/pack/client/interface'));
    }
    if (url.pathname.startsWith('/media')) {
        return new Response(Bun.file('data/pack/client/media'));
    }
    if (url.pathname.startsWith('/versionlist')) {
        return new Response(Bun.file('data/pack/client/versionlist'));
    }
    if (url.pathname.startsWith('/textures')) {
        return new Response(Bun.file('data/pack/client/textures'));
    }
    if (url.pathname.startsWith('/wordenc')) {
        return new Response(Bun.file('data/pack/client/wordenc'));
    }
    if (url.pathname.startsWith('/sounds')) {
        return new Response(Bun.file('data/pack/client/sounds'));
    }
    if (url.pathname.startsWith('/ondemand.zip')) {
        return new Response(Bun.file('data/pack/ondemand.zip'));
    }
    if (url.pathname === '/worldmap.jag') {
        return new Response(Bun.file('data/pack/mapview/worldmap.jag'));
    }
    if (url.pathname.startsWith('/build')) {
        return new Response(Bun.file('data/pack/server/build'));
    }

    return null;
}
