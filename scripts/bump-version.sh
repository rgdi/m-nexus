#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# bump-version.sh — actualiza la versión en todos los componentes
# ═══════════════════════════════════════════════════════════════════
#
# Uso: ./scripts/bump-version.sh 0.29.0
#
# Actualiza:
#   - backend/package.json
#   - backend/src/version.ts
#   - companion-app/pubspec.yaml
#   - README.md (referencias a la versión)
#
# Después de ejecutar, haz commit y push:
#   git add -A
#   git commit -m "chore: bump version to 0.29.0"
#   git tag v0.29.0
#   git push --tags

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Uso: $0 <nueva-version>  (ej. 0.29.0)"
    exit 1
fi

NEW_VERSION="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Validar formato semver básico
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    echo "❌ Versión inválida: $NEW_VERSION (debe ser semver, ej. 0.29.0)"
    exit 1
fi

echo "🔄 Bumping version a $NEW_VERSION"
echo ""

# 1. Backend package.json
if [[ -f "$REPO_ROOT/backend/package.json" ]]; then
    sed -i.bak "s/\"version\": \"[0-9.]*[-a-zA-Z0-9.]*\"/\"version\": \"$NEW_VERSION\"/" \
        "$REPO_ROOT/backend/package.json"
    rm -f "$REPO_ROOT/backend/package.json.bak"
    echo "  ✅ backend/package.json"
fi

# 2. Backend src/version.ts
if [[ -f "$REPO_ROOT/backend/src/version.ts" ]]; then
    sed -i.bak "s/VERSION = \"[0-9.]*[-a-zA-Z0-9.]*\"/VERSION = \"$NEW_VERSION\"/" \
        "$REPO_ROOT/backend/src/version.ts"
    rm -f "$REPO_ROOT/backend/src/version.ts.bak"
    echo "  ✅ backend/src/version.ts"
fi

# 3. Companion pubspec.yaml
if [[ -f "$REPO_ROOT/companion-app/pubspec.yaml" ]]; then
    # Bump build number
    CURRENT_BUILD=$(grep -o '+[0-9]*' "$REPO_ROOT/companion-app/pubspec.yaml" | head -1 | tr -d '+')
    NEW_BUILD=$((CURRENT_BUILD + 1))
    sed -i.bak "s/^version: [0-9.]*+[0-9]*/version: $NEW_VERSION+$NEW_BUILD/" \
        "$REPO_ROOT/companion-app/pubspec.yaml"
    rm -f "$REPO_ROOT/companion-app/pubspec.yaml.bak"
    echo "  ✅ companion-app/pubspec.yaml (build $NEW_BUILD)"
fi

# 7. Companion release-info.json
if [[ -f "$REPO_ROOT/companion-app/assets/release-info.json" ]]; then
    sed -i.bak "s/\"latest_version\": \"[0-9.]*[-a-zA-Z0-9.]*\"/\"latest_version\": \"$NEW_VERSION\"/" \
        "$REPO_ROOT/companion-app/assets/release-info.json"
    rm -f "$REPO_ROOT/companion-app/assets/release-info.json.bak"
    echo "  ✅ companion-app/assets/release-info.json"
fi

echo ""
echo "✅ Versión actualizada a $NEW_VERSION en todos los componentes"
echo ""
echo "Próximos pasos:"
echo "  1. Verifica los cambios: git diff"
echo "  2. Commit: git add -A && git commit -m 'chore: bump to $NEW_VERSION'"
echo "  3. Tag: git tag v$NEW_VERSION"
echo "  4. Push: git push --tags"
echo ""
echo "GitHub Actions se encargará de compilar y crear la release automáticamente."
