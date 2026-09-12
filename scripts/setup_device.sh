#!/bin/bash
# Setup Xiaomi Redmi Note A063 con preferencias correctas para v0.62.8
# Aplica fixes que NO requieren rebuild APK:
#   1. Dismiss update banner permanentemente (elimina lastUpdateCheck*)
#   2. Normaliza backend URL key (flutter.mnexus.backend_url usa guiones bajos)
#   3. Relanza la app
#
# Uso: bash scripts/setup_device.sh
# Requiere: adb en PATH, device conectado, USB debugging habilitado, app debuggable

set -e

PKG="com.mnexus.app"

echo "[1/4] Force-stop $PKG..."
adb shell am force-stop "$PKG"

echo "[2/4] Detectando forma actual del key de backend URL..."
KEY_FORM=$(adb shell "run-as $PKG cat shared_prefs/FlutterSharedPreferences.xml" 2>/dev/null \
  | grep -o "flutter.mnexus.backend[._]url" | head -1 || true)
if [ -z "$KEY_FORM" ]; then
  echo "  (no se encontró key de backend, se creará al primer arranque con URL)"
else
  echo "  key actual: $KEY_FORM"
fi

echo "[3/4] Normalizando flutter.mnexus.backend.url -> flutter.mnexus.backend_url..."
adb shell "run-as $PKG sed -i 's|flutter.mnexus.backend.url|flutter.mnexus.backend_url|g' shared_prefs/FlutterSharedPreferences.xml" 2>/dev/null || true

echo "[4/4] Eliminando claves lastUpdateCheck* (dismiss permanente del banner)..."
adb shell "run-as $PKG sed -i '/lastUpdateCheck/d' shared_prefs/FlutterSharedPreferences.xml" 2>/dev/null || true

echo "Relanzando app..."
adb shell am start -n "$PKG/.MainActivity" >/dev/null

echo
echo "✅ Device configurado para v0.62.8"
echo "   - Banner de actualización: dismissed (se revisará al próximo update manual)"
echo "   - Backend URL key: flutter.mnexus.backend_url (underscore canonical)"