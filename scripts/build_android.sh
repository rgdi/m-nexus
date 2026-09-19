#!/bin/bash
# build_android.sh — Build the M-NEXUS Android APK (v2.18.0).
#
# Uses Capacitor to wrap the webview bundle as a native Android app.
#
# Steps:
#   1. Build webview bundle (scripts/build_webview.sh) into ./frontend-bundle/
#   2. cap sync android (copies bundle into android/app/src/main/assets/public/)
#   3. gradle assembleDebug (or assembleRelease with signing config)
#
# Requirements:
#   - Node.js >= 20
#   - Java 17 (JDK)
#   - Android SDK with build-tools 34, platform-tools, platform 34
#   - ANDROID_HOME (or ANDROID_SDK_ROOT) env var set
#
# Usage:
#   bash scripts/build_android.sh              # debug APK
#   bash scripts/build_android.sh release      # release APK (unsigned)
#   bash scripts/build_android.sh bundle       # webview bundle only (no APK)

set -e

cd "$(dirname "$0")/.."

VARIANT="${1:-debug}"
echo "=== M-NEXUS Android build (variant: $VARIANT) ==="

# 1. Build webview bundle
echo ""
echo "[1/4] Building webview bundle..."
bash scripts/build_webview.sh frontend-bundle

# 2. Install capacitor + android platform deps if missing
if [ ! -d "node_modules/@capacitor" ]; then
  echo ""
  echo "[2/4] Installing Capacitor CLI + core..."
  npm install --save-dev @capacitor/cli @capacitor/core @capacitor/android @capacitor/splash-screen @capacitor/status-bar --no-audit --no-fund
else
  echo ""
  echo "[2/4] Capacitor already installed."
fi

# 3. Add android platform if not present
if [ ! -d "android" ]; then
  if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
    echo ""
    echo "ERROR: ANDROID_HOME or ANDROID_SDK_ROOT must be set to scaffold android/."
    echo "  export ANDROID_HOME=/opt/android-sdk"
    exit 1
  fi
  echo ""
  echo "[3/4] Adding Android platform via capacitor..."
  ./node_modules/.bin/cap add android
  # Sync copies the bundle + plugins
  ./node_modules/.bin/cap sync android
else
  echo ""
  echo "[3/4] android/ exists — running cap sync..."
  ./node_modules/.bin/cap sync android
fi

# 4. Build APK
if [ "$VARIANT" = "bundle" ]; then
  echo ""
  echo "=== Webview bundle ready at frontend-bundle/ ==="
  exit 0
fi

if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
  echo ""
  echo "ERROR: ANDROID_HOME required to build APK."
  exit 1
fi

echo ""
echo "[4/4] Building APK with gradle ($VARIANT)..."
cd android
if [ "$VARIANT" = "release" ]; then
  ./gradlew assembleRelease
else
  ./gradlew assembleDebug
fi

APK_PATH="android/app/build/outputs/apk/$( [ "$VARIANT" = "release" ] && echo release || echo debug )/app-$( [ "$VARIANT" = "release" ] && echo release-unsigned || echo debug ).apk"
echo ""
echo "=== APK ready ==="
ls -la "$APK_PATH" 2>&1 || ls -la android/app/build/outputs/apk/ 2>&1
echo ""
echo "Install with:"
echo "  adb install $APK_PATH"
