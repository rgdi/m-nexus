#!/bin/bash
cd /workspace/m-nexus/backend
# kill any existing server
pkill -9 -f "tsx src/server.ts" 2>/dev/null
pkill -9 -f "preflight.cjs" 2>/dev/null
sleep 2
PORT=4100 nohup npx tsx src/server.ts > /tmp/backend.log 2>&1 &
echo $! > /tmp/backend.pid
echo "Backend started, PID=$(cat /tmp/backend.pid)"
