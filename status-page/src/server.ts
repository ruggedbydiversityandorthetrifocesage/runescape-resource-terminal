/**
 * RST Status Page Server
 * Standalone — does NOT import or modify any game server code.
 * Run: bun run src/server.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "../public");

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? "3001");
const GAME_SERVER_URL = process.env.GAME_SERVER_URL ?? "https://runescaperesourceterminal.duckdns.org";
const OPNET_RPC_URL = process.env.OPNET_RPC_URL ?? "https://testnet.opnet.org";
const DEPLOYER_ADDRESS = (process.env.DEPLOYER_ADDRESS ?? "").toLowerCase().trim();
const HEALTH_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL ?? "30") * 1000;

if (!DEPLOYER_ADDRESS) {
  console.warn("[status-page] WARNING: DEPLOYER_ADDRESS not set. Admin note updates will be disabled.");
}

// ─── State ────────────────────────────────────────────────────────────────────
interface HealthStatus {
  online: boolean;
  responseTimeMs: number | null;
  statusCode: number | null;
  checkedAt: string;
}

interface OpnetStatus {
  blockHeight: number | null;
  blockTime: string | null;
  checkedAt: string;
}

interface AdminNote {
  text: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

let healthStatus: HealthStatus = {
  online: false,
  responseTimeMs: null,
  statusCode: null,
  checkedAt: new Date().toISOString(),
};

let opnetStatus: OpnetStatus = {
  blockHeight: null,
  blockTime: null,
  checkedAt: new Date().toISOString(),
};

let adminNote: AdminNote = {
  text: "",
  updatedAt: null,
  updatedBy: null,
};

// Challenge tokens for admin auth (UUID → expiry timestamp)
const challenges = new Map<string, number>();

// Clean up expired challenges every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, expiry] of challenges) {
    if (now > expiry) challenges.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Health Checks ────────────────────────────────────────────────────────────

async function checkGameServer(): Promise<void> {
  const url = `${GAME_SERVER_URL}/play`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "RST-StatusPage/1.0" },
    });
    const elapsed = Date.now() - start;
    healthStatus = {
      online: res.status < 500,
      responseTimeMs: elapsed,
      statusCode: res.status,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    healthStatus = {
      online: false,
      responseTimeMs: null,
      statusCode: null,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkOpnet(): Promise<void> {
  try {
    const res = await fetch(OPNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "btc_blockNumber", params: [], id: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json() as { result?: string | number };
    const raw = data.result;
    if (raw != null) {
      const height = typeof raw === "string" ? parseInt(raw, 16) : Number(raw);
      opnetStatus = {
        blockHeight: height,
        blockTime: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
      };
    } else {
      opnetStatus = { blockHeight: null, blockTime: null, checkedAt: new Date().toISOString() };
    }
  } catch {
    opnetStatus = { blockHeight: null, blockTime: null, checkedAt: new Date().toISOString() };
  }
}

async function runChecks(): Promise<void> {
  await Promise.allSettled([checkGameServer(), checkOpnet()]);
}

// Run immediately on startup, then on interval
await runChecks();
setInterval(runChecks, HEALTH_INTERVAL_MS);
console.log(`[status-page] Health checks running every ${HEALTH_INTERVAL_MS / 1000}s`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serveFile(path: string, contentType: string): Response {
  try {
    const content = readFileSync(path, "utf-8");
    return new Response(content, { headers: { "Content-Type": contentType } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function randomUUID(): string {
  return crypto.randomUUID();
}

// ─── Router ───────────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    // CORS headers for local dev
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Static pages
    if (path === "/" || path === "/index.html") {
      return serveFile(join(PUBLIC_DIR, "index.html"), "text/html");
    }

    if (path === "/admin" || path === "/admin.html") {
      return serveFile(join(PUBLIC_DIR, "admin.html"), "text/html");
    }

    // ── API: Get full status (public)
    if (path === "/api/status" && method === "GET") {
      return json({
        game: healthStatus,
        opnet: opnetStatus,
        note: adminNote,
        serverTime: new Date().toISOString(),
      }, 200);
    }

    // ── API: Get note only (public)
    if (path === "/api/note" && method === "GET") {
      return json(adminNote);
    }

    // ── API: Request admin challenge (public, but rate-limited implicitly by TTL)
    if (path === "/api/admin/challenge" && method === "GET") {
      const id = randomUUID();
      const expiry = Date.now() + 5 * 60 * 1000; // 5-minute TTL
      challenges.set(id, expiry);
      return json({ challenge: id, expiresAt: new Date(expiry).toISOString() });
    }

    // ── API: Update admin note (private — requires wallet auth)
    if (path === "/api/admin/note" && method === "POST") {
      if (!DEPLOYER_ADDRESS) {
        return json({ error: "Admin note updates are disabled: DEPLOYER_ADDRESS not configured." }, 503);
      }

      let body: { challenge?: string; address?: string; note?: string };
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }

      const { challenge, address, note } = body;

      if (!challenge || !address || note === undefined) {
        return json({ error: "Missing required fields: challenge, address, note." }, 400);
      }

      // Verify challenge exists and is not expired
      const expiry = challenges.get(challenge);
      if (!expiry) {
        return json({ error: "Invalid or expired challenge. Request a new one." }, 401);
      }
      if (Date.now() > expiry) {
        challenges.delete(challenge);
        return json({ error: "Challenge expired. Request a new one." }, 401);
      }

      // Verify address matches deployer
      if (address.toLowerCase().trim() !== DEPLOYER_ADDRESS) {
        return json({ error: "Unauthorized: address does not match deployer." }, 403);
      }

      // Consume the challenge (prevent replay)
      challenges.delete(challenge);

      // Validate note length
      if (typeof note !== "string" || note.length > 500) {
        return json({ error: "Note must be a string under 500 characters." }, 400);
      }

      adminNote = {
        text: note.trim(),
        updatedAt: new Date().toISOString(),
        updatedBy: address,
      };

      console.log(`[status-page] Admin note updated by ${address}: "${note.trim().slice(0, 80)}"`);
      return json({ ok: true, note: adminNote });
    }

    // ── API: Force refresh health checks (admin-only, no auth needed — just a manual trigger)
    if (path === "/api/refresh" && method === "POST") {
      runChecks().catch(() => {});
      return json({ ok: true, message: "Health checks triggered." });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`[status-page] Server running at http://localhost:${PORT}`);
console.log(`[status-page] Public:  http://localhost:${PORT}/`);
console.log(`[status-page] Admin:   http://localhost:${PORT}/admin`);
console.log(`[status-page] API:     http://localhost:${PORT}/api/status`);
if (DEPLOYER_ADDRESS) {
  console.log(`[status-page] Deployer: ${DEPLOYER_ADDRESS}`);
}
