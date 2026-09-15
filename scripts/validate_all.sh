#!/bin/bash
# validate_all.sh — corre TODAS las validaciones históricas de M-NEXUS.
#
# v2.1.5+ W10: Añadido como parte del plan de CI completeness.
# Cada validate_v*.cjs es una suite de regresión para features de una versión.
# Todas pasan contra el bundle actual si la feature está intacta.
#
# Uso: bash scripts/validate_all.sh
#      (opcionalmente --skip=N para saltarse las primeras N, ej: --skip=10)

set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0
FAIL=0
FAILED_FILES=()
VALIDATIONS=""

# Run all validation scripts in order
for f in app/test/validations/validate_v*.cjs; do
  [ -f "$f" ] || continue
  VALIDATIONS="$VALIDATIONS $f"
done

# Strip leading space
VALIDATIONS="${VALIDATIONS# }"

if [ -z "$VALIDATIONS" ]; then
  echo "No validation scripts found in app/test/validations/"
  exit 1
fi

COUNT=$(echo "$VALIDATIONS" | wc -w)
echo "Running $COUNT validation suites..."

echo "Running $COUNT validation suites..."
echo "=============================================="

for v in $VALIDATIONS; do
  name=$(basename "$v" .cjs)
  # Run with 30s timeout
  output=$(timeout 30 node "$v" 2>&1)
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    # Extract pass count
    pass_count=$(echo "$output" | grep -oE "[0-9]+/[0-9]+ pass|[0-9]+/[0-9]+ passed" | tail -1)
    if [ -z "$pass_count" ]; then
      pass_count="OK"
    fi
    printf "  \033[32m✓\033[0m %-35s %s\n" "$name" "$pass_count"
    PASS=$((PASS + 1))
  else
    # Show last lines of failure
    last=$(echo "$output" | tail -3 | tr '\n' ' ')
    printf "  \033[31m✗\033[0m %-35s FAIL: %s\n" "$name" "$last"
    FAILED_FILES+=("$name")
    FAIL=$((FAIL + 1))
  fi
done

echo "=============================================="
echo "Summary: $PASS passed, $FAIL failed (out of $((PASS+FAIL)))"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "Failed validations:"
  for f in "${FAILED_FILES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

echo ""
echo "✅ All validations passed!"
exit 0
