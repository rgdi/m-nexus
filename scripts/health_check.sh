#!/bin/bash
# Health-check del sistema completo M-NEXUS (backend + ollama + device + app + vault).
# Uso: bash scripts/health_check.sh

echo "=== M-NEXUS Health Check ==="
echo

echo "[backend :4100]"
if ss -tlnp 2>/dev/null | grep -q ':4100'; then
  echo "  listening"
else
  echo "  DOWN"
fi
echo "  /api/v1/health ->"
curl -sS --max-time 5 http://localhost:4100/api/v1/health 2>&1 | head -1
echo

echo "[ollama :11434]"
if ss -tlnp 2>/dev/null | grep -q ':11434'; then
  echo "  listening"
else
  echo "  DOWN"
fi
echo "  /api/tags ->"
curl -sS --max-time 5 http://localhost:11434/api/tags 2>&1 | head -1
echo

echo "[device]"
adb devices 2>&1
echo

echo "[app]"
adb shell pm dump com.mnexus.app 2>&1 | grep versionName | head -1
echo

echo "[vault en /data/user/0/com.mnexus.app/app_flutter/Mi_Vault/]"
adb shell "run-as com.mnexus.app ls /data/user/0/com.mnexus.app/app_flutter/Mi_Vault/" 2>&1 | head -5
echo

echo "=== done ==="