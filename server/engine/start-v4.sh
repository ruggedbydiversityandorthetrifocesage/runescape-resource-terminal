#!/bin/bash
# Start the v4 development server on localhost:9999
# Web UI:  http://localhost:9999
# Game TCP: 43595
# Mgmt:    http://localhost:9998

set -e
cd "$(dirname "$0")"

# One-time: copy db.sqlite → db.v4.sqlite if v4 DB doesn't exist yet
if [ ! -f db.v4.sqlite ]; then
    echo "[v4] Creating db.v4.sqlite (copying from db.sqlite)..."
    cp db.sqlite db.v4.sqlite
    echo "[v4] db.v4.sqlite created."
fi

echo "[v4] Starting server on :9999 (game TCP :43595)..."
~/.bun/bin/bun --env-file=.env.v4 run src/app.ts
