# Setup de GitHub para M-NEXUS

**Estado**: 90% completado · El token actual es read-only.

## ✅ Lo que ya está hecho

1. **Repo creado**: https://github.com/rgdi/m-nexus
2. **Estructura monorepo** lista en `/workspace/m-nexus`:
   ```
   m-nexus/
   ├── obsidian-plugin/     # Plugin de Obsidian v0.28.0
   ├── backend/             # Backend Node.js v0.28.0
   ├── companion-app/       # Flutter Android v0.28.0
   ├── docs/                # 5 guías de instalación
   ├── install/             # Script universal
   ├── scripts/             # bump-version.sh
   ├── .github/workflows/   # CI + Release + Update version
   ├── README.md            # Con quicklinks a /releases/latest/
   ├── LICENSE              # MIT
   └── .gitignore
   ```

3. **GitHub Actions workflows** listos:
   - `ci.yml` — Tests en cada push (plugin + backend + Flutter analyze)
   - `release.yml` — Al pushear tag `v*.*.*`, compila todo y crea release
   - `update-version.yml` — Para bumpear versiones manualmente

4. **Auto-updating implementado**:
   - **Plugin**: `src/updateChecker.ts` — consulta GitHub API al abrir
   - **Backend**: `src/utils/updateChecker.ts` — chequea al arrancar (no bloquea)
   - **Companion**: `lib/services/update_checker.dart` — chequea al abrir

5. **Quicklinks en README.md** apuntan a `/releases/latest/download/...`:
   - Plugin: `m-nexus-plugin.zip`
   - Backend: `m-nexus-backend.zip`
   - Companion: `m-nexus-companion.apk`
   - Install script: `m-nexus-install.sh`

6. **Script de bump version** listo en `scripts/bump-version.sh`

## ⚠️ Lo que falta (requiere token con write scope)

El PAT que tengo es **read-only**. Para hacer push y crear el tag/release inicial, necesitas:

### Opción 1: Generar un nuevo PAT con scope write

1. Ve a https://github.com/settings/tokens/new
2. **Note**: "M-NEXUS v0.28.0 release"
3. **Expiration**: 30 días
4. **Scopes** (marca solo estos):
   - `repo` (acceso completo a repos)
   - `workflow` (para que Actions pueda crear releases)
   - `write:packages` (opcional)

5. Click "Generate token"
6. Cópialo y úsalo así:

```bash
cd /workspace/m-nexus

# Configurar el nuevo token
git remote set-url origin https://github.com/rgdi/m-nexus.git
git config --local credential.helper "store --file=/tmp/.git-credentials-tmp"
echo "https://rgdi:TU_NUEVO_TOKEN_AQUI@github.com" > /tmp/.git-credentials-tmp
chmod 600 /tmp/.git-credentials-tmp

# Push
git push -u origin main

# Crear tag v0.28.0 (esto triggerea el workflow de release)
git tag v0.28.0
git push origin v0.28.0
```

### Opción 2: Manual con GitHub web UI

1. Sube los archivos manualmente al repo:
   ```bash
   cd /workspace/m-nexus
   git bundle create m-nexus.bundle --all
   ```
   Sube el bundle a https://github.com/rgdi/m-nexus (botón "Upload files")

2. Crea un tag en GitHub:
   - https://github.com/rgdi/m-nexus/releases/new
   - Tag: `v0.28.0`
   - Title: `v0.28.0 — Backups ultrarrápidos ZIP + drag-and-drop`
   - Adjunta los archivos:
     - `obsidian-plugin/dist/main.js`
     - `obsidian-plugin/dist/manifest.json`
     - `obsidian-plugin/dist/styles.css`
     - `obsidian-plugin/dist/versions.json`
     - `backend/dist/` (como ZIP)
     - `companion-app/build/app/outputs/flutter-apk/app-release.apk`
     - `install/install.sh`

3. El GitHub Actions NO se ejecutará porque no hay push, pero el release sí.

### Opción 3: Asks me again con el token correcto

Pega el nuevo token en otro mensaje y hago todo el push + release automáticamente.

## 📋 Verificación

Una vez que el push se complete:

1. **Repo**: https://github.com/rgdi/m-nexus
2. **Actions**: https://github.com/rgdi/m-nexus/actions
3. **Release**: https://github.com/rgdi/m-nexus/releases/tag/v0.28.0
4. **Latest**: https://github.com/rgdi/m-nexus/releases/latest

Los quicklinks del README deberían funcionar:
- https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-plugin.zip
- https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-backend.zip
- https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-companion.apk

## 🧪 Probar autoupdate localmente

Una vez que el repo esté público y con una release, puedes probar el autoupdate:

### Plugin
```bash
# En Obsidian, abre la consola (Ctrl+Shift+I) y ejecuta:
const { checkForUpdates } = await import('./obsidian-plugin/src/updateChecker');
await checkForUpdates('0.27.0', { silent: true });
// Debería decir "M-NEXUS 0.28.0 disponible"
```

### Backend
```bash
cd /workspace/m-nexus/backend
PORT=4000 node dist/server.js
# Verás en el log:
# "Nueva versión disponible: vX.Y.Z" (si hay una más reciente)
# O "Versión actual v0.28.0 es la última"
```

### Companion app
```bash
# Abre la app, click en el icono de settings
# Click en "Check for updates"
# Si hay una nueva, muestra el dialog con el link
```

## 📊 Resumen de lo que se entregó

| Componente | Estado |
|---|---|
| Repo en GitHub | ✅ Creado |
| Código fuente | ✅ Listo para push (commit local hecho) |
| GitHub Actions workflows | ✅ 3 workflows (ci, release, update-version) |
| Quicklinks autoupdate | ✅ En README.md |
| UpdateChecker plugin | ✅ Implementado |
| UpdateChecker backend | ✅ Implementado |
| UpdateChecker companion | ✅ Implementado |
| Script bump-version | ✅ Listo |
| Token con write | ❌ Necesario para push |
| Primer release v0.28.0 | ⏳ Pendiente del push |

## 🎯 Próximos pasos

1. **Genera un nuevo PAT** con scope `repo` + `workflow`
2. **Pásamelo** y yo hago el push + tag + release automáticamente
3. **Verifica** que los quicklinks funcionan y el autoupdate se activa

Si tienes cualquier problema, abre un issue en https://github.com/rgdi/m-nexus/issues (cuando esté público) o escribe aquí.
