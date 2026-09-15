#!/bin/bash
cd /workspace/m-nexus/backend
PORT=4100 nohup npx tsx src/server.ts > /tmp/backend.log 2>&1 &
echo $! > /tmp/backend.pid
echo "Backend started, PID=$(cat /tmp/backend.pid)"
