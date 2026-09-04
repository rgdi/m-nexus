#!/bin/bash
# fix-plugins.sh: parchea los build.gradle de plugins incompatibles con AGP 8.x.
# Strategy: cambiar `android.flutter` (que ya no existe) por una property del proyecto.
set -e

echo "═══ fix-plugins.sh: AGP 8.3 plugin patcher ═══"

# List todos los build.gradle que existen
echo "Searching $HOME/.pub-cache/hosted/pub.dev..."
ls $HOME/.pub-cache/hosted/pub.dev/ 2>/dev/null | head -20
echo ""

# Find + patch
find $HOME/.pub-cache/hosted/pub.dev -path "*/android/build.gradle" -not -path "*/build/*" 2>/dev/null | while read build_file; do
  if grep -q "android\.flutter" "$build_file"; then
    sed -i 's|project\.android\.flutter|project.ext.flutter|g; s|android\.flutter|project.ext.flutter|g' "$build_file"
    echo "  patched: $build_file"
  fi
done

echo "═══ done ═══"
