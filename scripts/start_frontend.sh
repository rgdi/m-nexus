#!/bin/bash
cd /workspace/m-nexus/frontend
pkill -9 -f "http.server" 2>/dev/null
sleep 1
nohup python3 -m http.server 8080 > /tmp/web.log 2>&1 &
echo $! > /tmp/web.pid
echo "Frontend started, PID=$(cat /tmp/web.pid)"
