#!/bin/bash
# fix-plugins.sh: parchea los build.gradle de plugins incompatibles con AGP 8.x.
# 
# En AGP 8.x, 'project.android.flutter' ya no existe.
# Parcheamos los build.gradle para usar 'project.ext.flutter' (un Map).
# 
# Necesitamos:
# 1) Cambiar 'flutter.x' → 'project.ext.flutter.x' en build.gradle
# 2) Inyectar ext.flutter = [path: ..., compileSdkVersion: 34, ndkVersion: '...']
#    en cada subproject que use estos plugins
#
# La inyección se hace desde el build.gradle root.

set -e

echo "═══ fix-plugins.sh: AGP 8.3 plugin patcher ═══"

PUB_CACHE="${PUB_CACHE:-$HOME/.pub-cache}/hosted/pub.dev"
if [ ! -d "$PUB_CACHE" ]; then
  echo "WARNING: pub cache not found at $PUB_CACHE"
  exit 0
fi

# Lee el flutter path
FLUTTER_PATH="${FLUTTER_ROOT:-$HOME/flutter}"
if [ ! -d "$FLUTTER_PATH" ]; then
  # Buscar en paths comunes
  for p in /opt/flutter /opt/hostedtoolcache/flutter/stable-3.24.0-x64/flutter ~/flutter; do
    if [ -d "$p" ]; then
      FLUTTER_PATH="$p"
      break
    fi
  done
fi
echo "Using flutter path: $FLUTTER_PATH"

# 1) Patchear build.gradle files: 'flutter.' → 'project.ext.flutter.'
echo "Patching 'flutter.' references..."
COUNT=0
for build_file in $(find "$PUB_CACHE" -path "*/android/build.gradle" -not -path "*/example/*" -not -path "*/build/*" 2>/dev/null); do
  if ! grep -q "flutter\." "$build_file" 2>/dev/null; then
    continue
  fi
  
  python3 -c "
import re
with open('$build_file') as f:
    content = f.read()
lines = content.split('\n')
new_lines = []
for line in lines:
    stripped = line.lstrip()
    if stripped.startswith('//') or stripped.startswith('*'):
        new_lines.append(line)
        continue
    new_line = re.sub(r'(?<![\w.])flutter\.', 'project.ext.flutter.', line)
    new_lines.append(new_line)
with open('$build_file', 'w') as f:
    f.write('\n'.join(new_lines))
"
  echo "  patched: $build_file"
  COUNT=$((COUNT+1))
done
echo "Patched $COUNT build.gradle files."

# 2) Crear un init script que inyecte ext.flutter en cada subproject
cat > /tmp/init-flutter.gradle << INNEREOF
allprojects {
    afterEvaluate { project ->
        try {
            project.ext.flutter = [
                path: '$FLUTTER_PATH',
                compileSdkVersion: 34,
                ndkVersion: '26.1.10909125',
                minSdkVersion: 23,
                targetSdkVersion: 34,
            ]
        } catch (Exception e) {
            // ignore
        }
    }
}
INNEREOF
echo "Created /tmp/init-flutter.gradle"

echo "═══ done ═══"
