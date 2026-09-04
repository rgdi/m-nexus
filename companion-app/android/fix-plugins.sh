#!/bin/bash
# fix-plugins.sh: parchea los build.gradle de plugins incompatibles con AGP 8.x.
# Se ejecuta DESPUÉS de flutter pub get.
set -e

echo "════════════════════════════════════════════════════════════════"
echo "fix-plugins.sh: patching plugin build.gradle files for AGP 8.3"
echo "════════════════════════════════════════════════════════════════"

# Buscar todos los build.gradle en el pub-cache
CACHE_DIR="${PUB_CACHE:-$HOME/.pub-cache}/hosted/pub.dev"
echo "Pub cache: $CACHE_DIR"
if [ ! -d "$CACHE_DIR" ]; then
  echo "WARNING: pub cache not found at $CACHE_DIR, skipping patch"
  exit 0
fi

COUNT=0
for build_file in $(find "$CACHE_DIR" -path "*/android/build.gradle" -not -path "*/build/*"); do
  if grep -q "android.flutter" "$build_file" 2>/dev/null; then
    sed -i 's|project\.android\.flutter|project.ext.flutter|g' "$build_file"
    echo "  patched: $(basename $(dirname $(dirname $build_file)))/build.gradle"
    COUNT=$((COUNT+1))
  fi
done
echo "Patched $COUNT build.gradle files."

# Si no se patcheó ninguno, mostrar un warning
if [ "$COUNT" -eq 0 ]; then
  echo "WARNING: no plugins needed patching (maybe they're already AGP 8.3 compatible)"
fi

# Verificación
echo "════════════════════════════════════════════════════════════════"
echo "Verifying no remaining 'project.android.flutter' references..."
REMAINING=$(grep -r "project.android.flutter" "$CACHE_DIR" 2>/dev/null | wc -l)
echo "  Remaining references: $REMAINING"
echo "════════════════════════════════════════════════════════════════"
