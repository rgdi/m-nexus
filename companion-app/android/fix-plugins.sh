#!/bin/bash
# fix-plugins.sh: parchea los build.gradle de plugins incompatibles con AGP 8.x.
# 
# Strategy: en build.gradle files, sustituir cualquier referencia a 'flutter.'
# (sin project. antes) por 'project.ext.flutter.' dentro de bloques android { }.
# 
# Esto cubre patrones como:
#   compileSdk = flutter.compileSdkVersion
#   ndkVersion = flutter.ndkVersion
#   apply from: "${flutter.path}/..."

set -e

echo "═══ fix-plugins.sh: AGP 8.3 plugin patcher ═══"

PUB_CACHE="${PUB_CACHE:-$HOME/.pub-cache}/hosted/pub.dev"
if [ ! -d "$PUB_CACHE" ]; then
  echo "WARNING: pub cache not found at $PUB_CACHE"
  exit 0
fi

# 1) Para cada build.gradle, parchea cualquier "flutter." (sin "project." antes)
# por "project.ext.flutter."
# Pero solo en líneas que NO son comentarios
echo "Patching 'flutter.' -> 'project.ext.flutter.'..."

COUNT=0
for build_file in $(find "$PUB_CACHE" -path "*/android/build.gradle" -not -path "*/example/*" -not -path "*/build/*" 2>/dev/null); do
  # Skip archivos sin 'flutter.'
  if ! grep -q "flutter\." "$build_file" 2>/dev/null; then
    continue
  fi
  
  # Backup
  cp "$build_file" "$build_file.bak" 2>/dev/null || true
  
  # Parchear: 'flutter.' (sin 'project.' antes) → 'project.ext.flutter.'
  # Solo en líneas que NO son comentarios
  python3 -c "
import re
import sys
with open('$build_file') as f:
    content = f.read()
lines = content.split('\n')
new_lines = []
for line in lines:
    # Skip comentarios
    stripped = line.lstrip()
    if stripped.startswith('//') or stripped.startswith('*'):
        new_lines.append(line)
        continue
    # Reemplazar 'flutter.' con 'project.ext.flutter.' (si no está precedido por 'project.' o '.')
    # Patrón: 'flutter.' donde no hay identificador inmediatamente antes
    new_line = re.sub(r'(?<![\w.])flutter\.', 'project.ext.flutter.', line)
    new_lines.append(new_line)
with open('$build_file', 'w') as f:
    f.write('\n'.join(new_lines))
"
  echo "  patched: $build_file"
  COUNT=$((COUNT+1))
done

echo "Patched $COUNT build.gradle files."
echo "═══ done ═══"
