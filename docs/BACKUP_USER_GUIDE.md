# M-NEXUS Backup — Guía de Usuario

**v0.28.0** · Cómo usar el sistema de backups con drag-and-drop

Esta guía explica el día a día: crear backups, restaurar, arrastrar archivos,
entender qué hace cada botón.

---

## Tabla de contenidos

1. [Conceptos básicos](#conceptos-básicos)
2. [Abrir el panel de backups](#abrir-el-panel-de-backups)
3. [Crear un backup manual](#crear-un-backup-manual)
4. [Drag & Drop: subir un .zip](#drag--drop-subir-un-zip)
5. [Drag & Drop: descargar un backup](#drag--drop-descargar-un-backup)
6. [Restaurar un backup](#restaurar-un-backup)
7. [Backups automáticos](#backups-automáticos)
8. [Backups de emergencia](#backups-de-emergencia)
9. [Entender la lista](#entender-la-lista)
10. [Borrar backups](#borrar-backups)
11. [Buenas prácticas](#buenas-prácticas)

---

## Conceptos básicos

Hay **dos tipos de backups** que se sincronizan automáticamente:

| | Local | Remoto (servidor) |
|---|---|---|
| **Dónde** | `<vault>/.mnexus-backups/` | `BACKUP_STORAGE_PATH/{deviceId}/` |
| **Formato** | `.mnexus-backup` (ZIP) | `.zip` |
| **Cuándo** | Siempre (cada backup crea local) | Después del local, si está online |
| **Drag-and-drop** | Arrastra el card al escritorio | Arrastra el card al escritorio |
| **Riesgo si se pierde** | Solo tú | Disco del server |

> **Mentalidad**: el local es "rápido y siempre disponible". El remoto es "seguro
> y compartido entre devices".

### Kinds de backup

| Icono | Kind | Cuándo se crea | Rotación |
|---|---|---|---|
| 🤖 | **auto** | Automáticamente cada N horas | Sí, se rotan los antiguos |
| 🖐 | **manual** | Cuando tú haces click en "➕" | **Nunca** se borra automáticamente |
| 🚨 | **emergency** | Antes de operaciones riesgosas | **Nunca** se borra automáticamente |

---

## Abrir el panel de backups

Tres formas:

1. **Command Palette** (Ctrl/Cmd + P) → escribe `backup` → **📦 Gestor de backups**
2. **Ribbon icon** (cinta izquierda): click en el icono del plugin → **Backups**
3. **Settings** → M-NEXUS → **Abrir gestor de backups**

El panel tiene 3 secciones:

```
┌─────────────────────────────────────────────────┐
│  📦 Backups                          [+] [🔄]   │
├─────────────────────────────────────────────────┤
│  🪂 Arrastra un .zip aquí para subirlo          │  ← drop zone
├─────────────────────────────────────────────────┤
│  💾 BACKUPS LOCALES                              │
│  ┌──────────────────────────────────────┐       │
│  │ 🖐 manual-2026-09-01T15-30-00-abc     │       │
│  │ 2.4 MB · 47 archivos · hace 2 h      │       │  ← arrastrable
│  │ [↩ Restaurar] [☁ Subir] [🗑 Borrar]  │       │
│  └──────────────────────────────────────┘       │
│  ...                                              │
├─────────────────────────────────────────────────┤
│  ☁️ BACKUPS EN EL SERVIDOR                        │
│  ┌──────────────────────────────────────┐       │
│  │ 🖐 manual-2026-09-01T15-30-00-abc     │       │
│  │ 2.4 MB · 47 archivos · hace 2 h      │       │  ← arrastrable
│  │ SHA-256: a1b2c3d4e5f6...              │       │
│  │ [⬇ Descargar] [↩ Restaurar] [🗑 Borrar]│      │
│  └──────────────────────────────────────┘       │
│  ...                                              │
└─────────────────────────────────────────────────┘
```

---

## Crear un backup manual

**Cuándo**: antes de hacer cambios grandes, antes de sincronizar, o simplemente
como snapshot de "punto seguro".

1. Abre el panel de backups
2. Click **➕ Backup manual** (esquina superior derecha)
3. Espera ~1-3 segundos (depende del tamaño del vault)
4. Aparece un notice: `✅ Backup creado: 47 archivos, 2.4 MB en 320ms`
5. El nuevo backup aparece al inicio de **💾 Backups locales**
6. Si el server está disponible, también aparece en **☁️ Backups en el servidor**
   (2-3 segundos después)

**Tamaños típicos**:

| Vault | Notas | Tamaño | Tiempo |
|---|---|---|---|
| Pequeño | 50 notas | 200 KB | ~100 ms |
| Mediano | 500 notas | 2 MB | ~500 ms |
| Grande | 5000 notas | 20 MB | ~3 s |
| Muy grande | 20000 notas | 100 MB | ~15 s |

---

## Drag & Drop: subir un .zip

**El caso de uso principal**: tienes un backup de otro vault o un backup antiguo
que quieres restaurar al server. O quieres subir un backup manual que creaste
fuera del plugin.

### Paso a paso

1. Localiza tu archivo `.zip` en Finder / Explorer / Files
2. Arrástralo al panel de backups (sobre la zona punteada **🪂 Arrastra un .zip**)
3. La zona se ilumina en azul cuando detecta el drag
4. Suelta el archivo
5. Notice: `Subiendo backup.zip (2.4 MB)…`
6. Verificación:
   - ✅ Magic bytes ZIP correctos (PK\x03\x04)
   - ✅ SHA-256 calculado en el cliente
   - ✅ Subida como `application/zip` binario (no base64)
7. Notice: `✅ Subido: manual-...-xyz en 23ms`
8. El backup aparece en **☁️ Backups en el servidor**

### Si algo va mal

| Mensaje | Causa | Solución |
|---|---|---|
| `❌ Solo se aceptan archivos .zip` | El archivo no termina en `.zip` | Renómbralo o usa la API directa |
| `❌ El archivo no es un ZIP válido` | Faltan los magic bytes PK\x03\x04 | Re-empaqueta con `zip` / WinRAR |
| `❌ No hay credenciales de servidor` | Plugin no registrado | Ve a Settings → M-NEXUS → URL del server |
| `❌ Error al subir: HTTP 413` | Backup excede `MAX_BACKUP_SIZE` | Reduce el tamaño o aumenta el límite en el server |
| `❌ Error al subir: HTTP 401` | Token expirado | Re-registra el device (toggle "Auto-registrar") |

---

## Drag & Drop: descargar un backup

**El caso de uso**: quieres una copia local del backup (por seguridad adicional),
o quieres el `.zip` en otro dispositivo.

### Desde un card de backup (en la lista)

1. En el panel de backups, busca el card del backup que quieres
2. **Arrástralo** desde el panel hacia:
   - Tu escritorio
   - Finder / Explorer
   - Una carpeta específica
   - Otra app que acepte archivos
3. Se descarga como `manual-2026-09-01T15-30-00-abc.zip`

> **Truco**: el card tiene un grip cursor (mano) cuando pasas el ratón por encima.
> Eso indica que es arrastrable.

### Desde el botón (alternativa)

1. Click **⬇ Descargar** en el card
2. El navegador hace la descarga estándar
3. Aparece en tu carpeta de Downloads

### ¿Qué puedes hacer con el .zip descargado?

Es un **ZIP estándar**. Puedes:

```bash
# Ver contenido
unzip -l manual-2026-09-01T15-30-00-abc.zip

# Extraer a una carpeta
unzip manual-2026-09-01T15-30-00-abc.zip -d /tmp/vault-backup/

# Extraer una sola nota
unzip manual-2026-09-01T15-30-00-abc.zip "Anatomía/2026-09-07.md"

# Verificar integridad
unzip -t manual-2026-09-01T15-30-00-abc.zip
```

Verás un archivo `META.json` que contiene metadata (kind, fecha, autor, etc).

---

## Restaurar un backup

**Cuándo**: borraste algo por error, quieres volver a un estado anterior, o
estás migrando de otro vault.

### Restaurar desde un backup local

1. Click **↩ Restaurar** en el card de **💾 Backups locales**
2. Confirmación: `¿Restaurar manual-...? Esto sobrescribirá archivos del vault.`
3. Click **OK**
4. Notice: `↩ Restaurado: 47 archivos`
5. Los archivos del vault ahora coinciden con el snapshot

**Importante**:

- ⚠️ **Sobrescribe** archivos que ya existen con el mismo nombre
- ❌ **NO borra** archivos nuevos que no estén en el backup
- Si el vault tiene notas más recientes que el backup, se mantienen las del vault
  (porque el backup solo restaura los que existían en él)

### Restaurar desde un backup del server

1. Click **↩ Restaurar** en el card de **☁️ Backups en el servidor**
2. Confirmación: `¿Descargar y restaurar manual-...?`
3. Click **OK**
4. Notice: `Descargando y restaurando…`
5. Notice: `↩ Restaurado: 47 archivos`

Internamente:
- Descarga el ZIP del server
- Lo guarda temporalmente en `.mnexus-backups/`
- Lo restaura como si fuera un backup local

### Dry run (ver qué se restauraría sin hacerlo)

Si quieres ver **qué archivos se restaurarían** sin realmente hacerlo:

1. Ve a la consola del plugin (Settings → M-NEXUS → Open console)
2. Ejecuta:
   ```js
   const { local } = window.__mnexusInternals;
   const entries = await local.readEntries("manual-2026-09-01T15-30-00-abc");
   console.table(entries.map(e => ({ path: e.path, size: e.size })));
   ```

Esto te muestra todos los archivos que **se restaurarían** si pulsaras ↩.

---

## Backups automáticos

**Por defecto**: cada 24 horas se crea un backup automático (kind = `auto`).

### Configurar intervalo

Settings → M-NEXUS → **Backups** → **Intervalo de auto-backup (horas)**

Recomendaciones:
- **Vault < 1000 notas**: 24h (default)
- **Vault 1000-10000 notas**: 12h
- **Vault > 10000 notas**: 6h (o desactivar y hacer manuales)

### ¿Qué pasa con los backups automáticos antiguos?

El plugin **rota** automáticamente, manteniendo:

- ✅ Los **N más recientes** (configurable, default = 10)
- ✅ **1 por día** durante los últimos 7 días
- ✅ **1 por semana** durante las últimas 4 semanas
- ✅ **Todos los manuales** (nunca se borran automáticamente)
- ✅ **Todos los de emergencia** (nunca se borran automáticamente)

**Ejemplo**: si tienes 30 backups automáticos, después de la rotación tendrás ~10
recientes + 7 diarios + 4 semanales = ~21 backups.

### Ver cuándo se hizo el último auto-backup

En el log del plugin, busca: `Backup auto-<fecha> creado`.

También puedes consultar el storage:

```bash
ls -lah ~/.config/obsidian/<vault>/.mnexus-backups/
# auto-2026-09-01T15-00-00-abc.mnexus-backup  2.4 MB
# auto-2026-09-02T15-00-00-def.mnexus-backup  2.4 MB
# auto-2026-09-03T15-00-00-ghi.mnexus-backup  2.4 MB
# manual-2026-09-01T10-30-00-jkl.mnexus-backup 2.4 MB  ← no se rota
```

---

## Backups de emergencia

**Cuándo se crean automáticamente**: el plugin los dispara antes de operaciones
riesgosas como:

- Cambios en la configuración del plugin
- Migración de flashcards
- Operaciones de reseteo de FSRS
- Errores graves detectados (corrupción de data.json, etc.)

**Cómo se ven**: 🚨 en el card, kind = "emergency".

**Rotación**: NUNCA se borran automáticamente. Solo se borran manualmente.

**Para verlos todos**: en el panel de backups, busca los que tienen 🚨.

---

## Entender la lista

Cada card muestra:

```
🖐 manual-2026-09-01T15-30-00-abc
─────────────────────────────────
2.4 MB · 47 archivos · hace 2 h
Creado en 320ms
[↩ Restaurar] [☁ Subir] [🗑 Borrar]
```

| Campo | Significado |
|---|---|
| **ID** | `manual-YYYY-MM-DDTHH-MM-SS-xxx` (timestamp + random) |
| **Tamaño** | En bytes human-readable (KB, MB, GB) |
| **Archivos** | Cuántas notas contiene el snapshot |
| **Fecha relativa** | "hace 2 h", "ayer", "hace 3 d", o fecha absoluta si >7d |
| **Tiempo de creación** | Cuánto tardó en crearse (ms o s) |

Para los remotos además:

```
SHA-256: a1b2c3d4e5f6...
```

Permite verificar integridad comparando con el hash del archivo descargado.

---

## Borrar backups

### Borrar uno específico

1. Click **🗑 Borrar** en el card
2. Confirmación: `¿Borrar backup local manual-...?`
3. Click **OK**
4. Notice: `🗑 Backup borrado`

> **Cuidado**: borrar es destructivo. Si el backup es **manual** o **emergency** y
> era tu única copia, perderás esos datos. Recomendamos descargar el `.zip` antes
> si no estás seguro.

### Forzar rotación manual

Si quieres limpiar los backups automáticos antiguos **ahora** (sin esperar a la
próxima rotación automática):

```js
// En la consola del plugin
await window.__mnexusInternals.local.prune();
```

Esto aplica las reglas de rotación (10 recientes + 7 diarios + 4 semanales).

### Borrar masivamente

Si quieres borrar **todos** los backups (locales y remotos), ve a:

Settings → M-NEXUS → **Backups** → **Borrar todos los backups**

⚠️ No hay confirmación adicional — ten cuidado.

---

## Buenas prácticas

### 🔒 Regla 3-2-1

- **3** copias de tus datos (1 local + 1 server + 1 externa)
- **2** medios diferentes (disco local + servidor remoto, p.ej.)
- **1** copia off-site (un disco USB en casa de un amigo, o S3, o similar)

M-NEXUS te da las 2 primeras. La tercera es responsabilidad tuya.

### 🕐 Cuándo hacer backups manuales

- ✅ Antes de instalar plugins nuevos
- ✅ Antes de actualizar Obsidian
- ✅ Antes de hacer una operación masiva (rename, refactor)
- ✅ Después de un día de estudio intenso (como cierre)
- ❌ Cada 5 minutos (es automático, no hace falta)

### 🔍 Cómo verificar que un backup es válido

```bash
# 1. Verificar que el ZIP no está corrupto
unzip -t manual-2026-09-01T15-30-00-abc.zip

# 2. Verificar el SHA-256 (si lo tienes del server)
sha256sum manual-2026-09-01T15-30-00-abc.zip
# Comparar con el que muestra el panel de backups
```

Si el SHA-256 coincide, el backup está intacto y sin corrupción.

### 📦 ¿Dónde guardar el dump del índice?

Si haces `GET /api/v1/backup/dump` (drag-and-drop del `.db`):

- El archivo pesa ~16KB
- Contiene la metadata de todos tus backups
- Es muy útil para auditoría o migración a otro server
- Recomendación: guárdalo junto con tus `.zip` descargados

### 🗑 ¿Cuándo borrar manualmente?

- Después de verificar que un backup antiguo se puede restaurar correctamente
  (test de restore real, no solo el archivo existe)
- Para liberar espacio si estás cerca del límite de tu disco
- Después de descargar el `.zip` y guardarlo en otro lugar

---

## Troubleshooting rápido

| Problema | Solución |
|---|---|
| El panel no abre | Reinicia Obsidian. Si sigue: `Settings → Community plugins → M-NEXUS → Disable → Enable` |
| No aparece el card tras crear | Click 🔄 en el panel. Si sigue, mira el log de Obsidian |
| Drag-and-drop no funciona | Verifica que el archivo termina en `.zip` y empieza con `PK` (puedes verificar con `xxd archivo.zip | head -1`) |
| Drag-and-drop sube pero no aparece | Refresca con 🔄. Si sigue, el server no está accesible (ver [BACKUP_TROUBLESHOOTING.md](./BACKUP_TROUBLESHOOTING.md)) |
| No se ve el icono "grip cursor" en cards | El plugin no está habilitado para drag. Settings → M-NEXUS → habilitar "Drag-and-drop" |

---

## Más información

- **[BACKUP_ADMIN_GUIDE.md](./BACKUP_ADMIN_GUIDE.md)** — Administración del server
- **[BACKUP_INSTALL.md](./BACKUP_INSTALL.md)** — Instalación detallada
- **[BACKUP_TROUBLESHOOTING.md](./BACKUP_TROUBLESHOOTING.md)** — Problemas comunes
- **[BACKUP_DOCKER.md](./BACKUP_DOCKER.md)** — Deployment con Docker
