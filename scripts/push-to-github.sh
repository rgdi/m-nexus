#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# push-to-github.sh — hacer push y crear la primera release de v0.28.0
# ═══════════════════════════════════════════════════════════════════
#
# Uso: ./scripts/push-to-github.sh <GITHUB_TOKEN>
#
# Requiere un PAT con scope 'repo' + 'workflow'.
# Después de ejecutar, la release v0.28.0 estará lista y los
# quicklinks funcionarán.

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Uso: $0 <GITHUB_TOKEN>"
    echo ""
    echo "Genera un token en: https://github.com/settings/tokens/new"
    echo "Scopes requeridos: repo, workflow"
    exit 1
fi

TOKEN="$1"
REPO="rgdi/m-nexus"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "═══════════════════════════════════════════════════════"
echo "  M-NEXUS v0.28.0 — Push to GitHub"
echo "═══════════════════════════════════════════════════════"
echo ""

# 1. Verificar token
echo "1️⃣  Verificando token..."
USER=$(curl -s -H "Authorization: token $TOKEN" https://api.github.com/user | python3 -c "import sys,json; print(json.load(sys.stdin)['login'])")
if [[ -z "$USER" ]]; then
    echo "❌ Token inválido"
    exit 1
fi
echo "   ✅ Autenticado como: $USER"

# 2. Verificar que el repo existe
echo ""
echo "2️⃣  Verificando repo..."
REPO_INFO=$(curl -s -H "Authorization: token $TOKEN" https://api.github.com/repos/$REPO)
if ! echo "$REPO_INFO" | grep -q '"id"'; then
    echo "❌ Repo no existe. Creando..."
    curl -s -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
      -d '{"name":"m-nexus","description":"M-NEXUS — sistema de estudio médico para Obsidian","private":false,"has_issues":true}' \
      https://api.github.com/user/repos | python3 -c "import sys,json; r=json.load(sys.stdin); print('   ✅ Creado:', r.get('html_url', r))"
fi

# 3. Configurar remote con token
echo ""
echo "3️⃣  Configurando remote..."
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"
echo "   ✅ Remote configurado"

# 4. Push del código
echo ""
echo "4️⃣  Pusheando código..."
git push -u origin main 2>&1 | tail -5

# 5. Crear tag v0.28.0
echo ""
echo "5️⃣  Creando tag v0.28.0..."
git tag -d v0.28.0 2>/dev/null || true
git tag v0.28.0
git push origin v0.28.0 2>&1 | tail -3

# 6. Esperar a que el workflow de release termine
echo ""
echo "6️⃣  Esperando a GitHub Actions..."
echo "   (puede tardar 5-10 minutos para build del APK Android)"
echo "   Ver progreso: https://github.com/$REPO/actions"

# 7. Verificar release
echo ""
echo "7️⃣  Esperando release..."
MAX_ATTEMPTS=30
ATTEMPT=0
while [[ $ATTEMPT -lt $MAX_ATTEMPTS ]]; do
    sleep 20
    RESP=$(curl -s -H "Authorization: token $TOKEN" https://api.github.com/repos/$REPO/releases/tags/v0.28.0)
    if echo "$RESP" | grep -q '"id"'; then
        echo ""
        echo "═══════════════════════════════════════════════════════"
        echo "  ✅ ¡Release v0.28.0 publicada!"
        echo "═══════════════════════════════════════════════════════"
        echo ""
        echo "  URL: https://github.com/$REPO/releases/tag/v0.28.0"
        echo "  Latest: https://github.com/$REPO/releases/latest"
        echo ""
        echo "  Quicklinks (siempre apuntan a la última versión):"
        echo "    Plugin:    https://github.com/$REPO/releases/latest/download/m-nexus-plugin.zip"
        echo "    Backend:   https://github.com/$REPO/releases/latest/download/m-nexus-backend.zip"
        echo "    Companion: https://github.com/$REPO/releases/latest/download/m-nexus-companion.apk"
        echo "    Installer: https://github.com/$REPO/releases/latest/download/m-nexus-install.sh"
        echo ""
        break
    fi
    ATTEMPT=$((ATTEMPT+1))
    echo "   ⏳ Esperando... ($ATTEMPT/$MAX_ATTEMPTS)"
done

# Limpiar
git remote set-url origin "https://github.com/${REPO}.git"
unset TOKEN

echo ""
echo "✅ Listo. Quicklinks activos en:"
echo "   https://github.com/$REPO#readme"
