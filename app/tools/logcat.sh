#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# M-NEXUS — adb logcat helper (v0.39+)
# ═══════════════════════════════════════════════════════════════════
#
# Uso:
#   ./tools/logcat.sh              # Tail en vivo (INFO+)
#   ./tools/logcat.sh TRACE        # Todo, incluso TRACE
#   ./tools/logcat.sh DEBUG        # DEBUG+
#   ./tools/logcat.sh WARN         # Solo WARN y ERROR
#   ./tools/logcat.sh ERROR        # Solo ERROR
#   ./tools/logcat.sh FILE         # Logs desde archivo en el dispositivo
#   ./tools/logcat.sh SET DEBUG    # Cambiar nivel en runtime
#   ./tools/logcat.sh STATS        # Ver stats del logger
#   ./tools/logcat.sh RECENT 50    # Últimos 50 logs del buffer
#   ./tools/logcat.sh CLEAR        # Limpia el logcat buffer
#
# Filtros:
#   -s mnexus:* → solo nuestro tag
#   -v threadtime → con timestamp + thread
#   --pid=$(adb shell pidof com.mnexus.installer) → solo nuestro proceso

set -euo pipefail

PKG="com.mnexus.installer"
LEVEL="${1:-INFO}"

# Buscar el PID del proceso
PID=$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r' || echo "")

# Si no hay dispositivo, error claro
if ! adb devices | grep -q "device$"; then
  echo "❌ No hay dispositivo Android conectado."
  echo ""
  echo "Verificá:"
  echo "  1. El cable USB está conectado"
  echo "  2. La depuración USB está activada (Settings → Developer options)"
  echo "  3. Autorizaste la conexión en el teléfono"
  echo ""
  echo "Después de conectar, podés verificar con: adb devices"
  exit 1
fi

case "$LEVEL" in
  TRACE|trace)
    FILTER="*:V"
    DESC="TODO (TRACE+)"
    ;;
  DEBUG|debug)
    FILTER="*:D"
    DESC="DEBUG+"
    ;;
  INFO|info)
    FILTER="*:I"
    DESC="INFO+ (recomendado para uso normal)"
    ;;
  WARN|warn|WARNING|warning)
    FILTER="*:W"
    DESC="Solo WARN y ERROR"
    ;;
  ERROR|error)
    FILTER="*:E"
    DESC="Solo ERROR"
    ;;
  FILE|file)
    if [ -z "$PID" ]; then
      echo "❌ App no está corriendo. Iniciala primero."
      exit 1
    fi
    # El logger escribe a getApplicationDocumentsDirectory()/logs/*.log
    # Usamos run-as para acceder a archivos privados de la app
    LOG_DIR="/data/data/$PKG/files/logs"
    echo "📁 Logs en $LOG_DIR:"
    adb shell "run-as $PKG ls -la $LOG_DIR" 2>/dev/null || {
      echo "❌ No se puede acceder (¿app debuggable?). Probá con logcat en vivo."
      exit 1
    }
    echo ""
    LATEST=$(adb shell "run-as $PKG ls -t $LOG_DIR" 2>/dev/null | head -1 | tr -d '\r')
    if [ -n "$LATEST" ]; then
      echo "📄 Mostrando: $LATEST"
      adb shell "run-as $PKG cat $LOG_DIR/$LATEST" 2>/dev/null | tail -100
    fi
    exit 0
    ;;
  SET|set)
    NEW_LEVEL="${2:-INFO}"
    echo "🔧 Cambiando nivel a $NEW_LEVEL..."
    # El cambio se hace dentro de la app, vía SharedPreferences.
    # Lo más simple: matamos la app y la reabrimos con un extra de Android.
    # Pero como el AdvancedLogger lee SharedPreferences en init() y setLevel()
    # se puede llamar vía platform channel, lo más limpio es:
    #   adb shell input keyevent (no funciona)
    # Workaround: la app expone un endpoint de debug, pero requiere UI.
    # Solución: setear SharedPreferences directamente:
    adb shell "run-as $PKG sh -c 'mkdir -p shared_prefs && cat > shared_prefs/FlutterSharedPreferences.xml << EOF
<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\" ?>
<map>
    <string name=\"flutter.mnexus.log_level\">$NEW_LEVEL</string>
</map>
EOF'"
    echo "✅ Nivel guardado como $NEW_LEVEL. Reiniciá la app."
    exit 0
    ;;
  STATS|stats)
    echo "📊 Stats del logger:"
    if [ -n "$PID" ]; then
      echo "  PID: $PID"
    else
      echo "  App no corriendo"
    fi
    adb shell "run-as $PKG cat shared_prefs/FlutterSharedPreferences.xml" 2>/dev/null | grep mnexus.log_level || echo "  Nivel: INFO (default)"
    exit 0
    ;;
  RECENT|recent)
    N="${2:-100}"
    echo "📋 Últimos $N logs del buffer in-memory:"
    echo "    (solo en debug builds, requiere un endpoint)"
    # Workaround: dump del último archivo de log
    LOG_DIR="/data/data/$PKG/files/logs"
    LATEST=$(adb shell "run-as $PKG ls -t $LOG_DIR" 2>/dev/null | head -1 | tr -d '\r')
    if [ -n "$LATEST" ]; then
      adb shell "run-as $PKG cat $LOG_DIR/$LATEST" 2>/dev/null | tail -n "$N"
    else
      echo "  (no hay archivos de log todavía)"
    fi
    exit 0
    ;;
  CLEAR|clear)
    adb logcat -c
    echo "🧹 logcat buffer limpiado"
    exit 0
    ;;
  *)
    echo "Nivel desconocido: $LEVEL"
    echo ""
    echo "Uso: $0 [TRACE|DEBUG|INFO|WARN|ERROR|FILE|SET <nivel>|STATS|RECENT <n>|CLEAR]"
    exit 1
    ;;
esac

echo "═══════════════════════════════════════════════════════════════════"
echo "  M-NEXUS logcat — nivel: $DESC"
echo "  pkg: $PKG  pid: ${PID:-?}"
echo "  Ctrl+C para salir"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Build filter
if [ -n "$PID" ]; then
  adb logcat -v threadtime --pid="$PID" "$FILTER"
else
  adb logcat -v threadtime -s mnexus "$FILTER"
fi
