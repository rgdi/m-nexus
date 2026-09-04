#!/bin/bash
# fix-plugins.sh: parchea los build.gradle de plugins incompatibles con AGP 8.x.
# 
# v0.32: en AGP 8.x, project.android.flutter YA NO está disponible automáticamente.
# Los plugins viejos (speech_to_text 7.x, record 5.x, etc.) usan esa API.
# 
# Estrategia: parchear el build.gradle del plugin para usar project.ext.flutter
# que se puede inyectar como property externa.
#
# También añadimos project.ext.flutter al build.gradle del plugin si no existe.

set -e

echo "════════════════════════════════════════════════════════════════"
echo "fix-plugins.sh: patching plugins for AGP 8.3 compat"
echo "════════════════════════════════════════════════════════════════"

CACHE_DIR="${PUB_CACHE:-$HOME/.pub-cache}/hosted/pub.dev"
if [ ! -d "$CACHE_DIR" ]; then
  echo "WARNING: pub cache not found at $CACHE_DIR, skipping patch"
  exit 0
fi

COUNT=0
for build_file in $(find "$CACHE_DIR" -path "*/android/build.gradle" -not -path "*/build/*"); do
  PATCHED=false
  
  # Sustituir 'project.android.flutter' por 'project.ext.flutter'
  if grep -q "project.android.flutter" "$build_file" 2>/dev/null; then
    sed -i 's|project\.android\.flutter|project.ext.flutter|g' "$build_file"
    PATCHED=true
  fi
  
  # También la sintaxis 'flutter' (sin project.) dentro de un bloque android { }
  if grep -q "^[[:space:]]*flutter[[:space:]]*[\\.]" "$build_file" 2>/dev/null; then
    sed -i 's|^\([[:space:]]*\)flutter[[:space:]]*[\\.]|\1project.ext.flutter.|g' "$build_file"
    PATCHED=true
  fi
  
  if [ "$PATCHED" = true ]; then
    echo "  patched: $build_file"
    COUNT=$((COUNT+1))
  fi
done

echo "Patched $COUNT build.gradle files."

# Inyectar project.ext.flutter en build.gradle de cada plugin que use AGP
# Esto se hace desde el parent project (root) o desde local.properties
echo "════════════════════════════════════════════════════════════════"
echo "Verifying patches..."
REMAINING=$(grep -r "project.android.flutter" "$CACHE_DIR" 2>/dev/null | wc -l)
echo "  Remaining 'project.android.flutter' references: $REMAINING"
echo "════════════════════════════════════════════════════════════════"
