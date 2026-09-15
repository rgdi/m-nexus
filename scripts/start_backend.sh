#!/bin/bash
cd /workspace/m-nexus/backend
# kill any existing server
pkill -9 -f "tsx src/server.ts" 2>/dev/null
pkill -9 -f "node.*dist/server.js" 2>/dev/null
pkill -9 -f "preflight.cjs" 2>/dev/null
sleep 2

# v2.1.5: ensure JWT_SECRET is set (config.ts fails fast on weak/empty).
# For dev, generate a random one and persist to .env so it survives restarts.
if [ -z "${JWT_SECRET:-}" ]; then
  if [ -f ".env" ] && grep -q "^JWT_SECRET=" .env; then
    export JWT_SECRET="$(grep '^JWT_SECRET=' .env | cut -d= -f2-)"
  else
    if command -v openssl >/dev/null; then
      export JWT_SECRET="$(openssl rand -hex 32)"
    else
      export JWT_SECRET="$(head -c 64 /dev/urandom | xxd -p -c 64)"
    fi
    echo "JWT_SECRET=$JWT_SECRET" >> .env
    echo "Generated new JWT_SECRET → .env (dev only)"
  fi
fi

PORT=4100 nohup npx tsx src/server.ts > /tmp/backend.log 2>&1 &
echo $! > /tmp/backend.pid
echo "Backend started, PID=$(cat /tmp/backend.pid)"
