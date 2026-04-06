#!/bin/sh
# Start bot browser sessions in background, then dashboard

echo "[Start] Launching headless bot browsers..."
node bot-launcher.mjs &
LAUNCHER_PID=$!

echo "[Start] Waiting 35s for bots to log in before starting dashboard..."
sleep 35

echo "[Start] Starting dashboard..."
bun dashboard.ts --all wc &
DASHBOARD_PID=$!

# If either process dies, kill both and exit
wait $LAUNCHER_PID $DASHBOARD_PID
