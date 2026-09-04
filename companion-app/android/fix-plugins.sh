#!/bin/bash
# fix-plugins.sh: parchea los build.gradle de plugins incompatibles con AGP 8.x.
# 
# speech_to_text 7.4.0 line 16: usa "flutter" property que ya no existe en AGP 8.x.
# Necesitamos inyectar project.android.flutter o cambiar la línea 16 a usar
# una property alternativa.

set -e

echo "═══ fix-plugins.sh: AGP 8.3 plugin patcher ═══"

PUB_CACHE="${PUB_CACHE:-$HOME/.pub-cache}/hosted/pub.dev"
if [ ! -d "$PUB_CACHE" ]; then
  echo "WARNING: pub cache not found at $PUB_CACHE"
  exit 0
fi

# 1) Listar todos los build.gradle
echo "Found build.gradle files:"
find "$PUB_CACHE" -path "*/android/build.gradle" -not -path "*/build/*" 2>/dev/null | head -10
echo "..."

# 2) Para cada build.gradle, mostrar las primeras 20 líneas si tiene "flutter" en él
for build_file in $(find "$PUB_CACHE" -path "*/android/build.gradle" -not -path "*/build/*" 2>/dev/null); do
  if grep -q "flutter" "$build_file" 2>/dev/null; then
    echo "  flutter reference: $build_file"
    # Mostrar las líneas que contienen flutter
    grep -n "flutter" "$build_file" 2>/dev/null | head -5
  fi
done

# 3) Parchear
echo "Patching..."
for build_file in $(find "$PUB_CACHE" -path "*/android/build.gradle" -not -path "*/build/*" 2>/dev/null); do
  if grep -E "^\s*flutter\s*(\.|\$)" "$build_file" 2>/dev/null; then
    # Parchear: añadir prefijo "project.ext." a "flutter" (cuando no es comentario)
    sed -i 's|^\([[:space:]]*\)flutter\b[[:space:]]*\.\([[:alnum:]]\)|\1project.ext.flutter.\2|g' "$build_file"
    echo "  patched: $build_file"
  fi
done

echo "═══ done ═══"
