#!/bin/bash
# fix-plugins.sh: parchea los build.gradle de plugins incompatibles con AGP 8.x
# 
# v0.32: speech_to_text 7.x, record 5.x, etc. usan la API vieja
# `project.android.flutter` que AGP 8.x ya no expone automáticamente.
# Las nuevas versiones de Flutter inyectan `project.android.flutter`
# vía el plugin gradle, pero los paquetes viejos no se han actualizado.
# 
# Este script parchea el build.gradle de cada plugin problemático
# para usar `project.ext.flutter` como fallback.

set -e
PLUGIN_DIRS=(
  "$HOME/.pub-cache/hosted/pub.dev/speech_to_text-*/android"
  "$HOME/.pub-cache/hosted/pub.dev/record-*/android"
  "$HOME/.pub-cache/hosted/pub.dev/record_android-*/android"
)

for pattern in "${PLUGIN_DIRS[@]}"; do
  for dir in $pattern; do
    if [ -d "$dir" ]; then
      build_file="$dir/build.gradle"
      if [ -f "$build_file" ]; then
        # Sustituir 'project.android.flutter' por 'project.ext.flutter' si existe
        if grep -q "android.flutter" "$build_file"; then
          sed -i 's|project\.android\.flutter|project.ext.flutter|g' "$build_file"
          echo "Patched: $build_file"
        fi
      fi
    fi
  done
done
