# M-NEXUS Backup — Troubleshooting

**v0.28.0** · Soluciones a problemas comunes

Esta guía cubre los problemas más frecuentes con el sistema de backups y sus
soluciones paso a paso.

---

## Tabla de contenidos

1. [Diagnóstico rápido](#diagnóstico-rápido)
2. [El server no arranca](#el-server-no-arranca)
3. [El plugin no se conecta al server](#el-plugin-no-se-conecta-al-server)
4. [Drag-and-drop no funciona](#drag-and-drop-no-funciona)
5. [Upload falla](#upload-falla)
6. [Download falla](#download-falla)
7. [Backups automáticos no se crean](#backups-automáticos-no-se-crean)
8. [Restauración no funciona](#restauración-no-funciona)
9. [Performance lenta](#performance-lenta)
10. [Errores de SQLite](#errores-de-sqlite)
11. [Permisos y filesystem](#permisos-y-filesystem)
12. [Errores específicos de Obsidian](#errores-específicos-de-obsidian)

---

## Diagnóstico rápido

Antes de investigar a fondo, ejecuta estos 3 comandos:

```bash
# 1. ¿Está el server vivo?
curl -s http://localhost:4000/api/v1/health | python3 -m json.tool

# 2. ¿Hay espacio en disco?
df -h /var/lib/mnexus

# 3. ¿Hay errores en el log?
journalctl -u mnexus-backend -n 50 --no-pager
```

Si los 3 funcionan, el problema está en el plugin (lado cliente).

---

## El server no arranca

### Síntoma

```bash
$ node dist/server.js
node:internal/modules/esm/resolve:274
    throw new ERR_MODULE_NOT_FOUND(...)
Error: Cannot find module 'node:sqlite'
```

### Causa y solución

**Causa**: Node < 22 o SQLite experimental no disponible.

```bash
# Verificar versión
node --version
# → debe ser v22.0.0 o superior

# Si es menor, instalar Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# En macOS con nvm
nvm install 22
nvm use 22
```

### Síntoma: "EADDRINUSE"

```bash
$ node dist/server.js
Error: listen EADDRINUSE: address already in use :::4000
```

**Solución**:

```bash
# Encontrar qué proceso usa el puerto
sudo lsof -i :4000
# o
sudo ss -tlnp | grep 4000

# Opción 1: matar el proceso
sudo kill <PID>

# Opción 2: cambiar el puerto del server
PORT=4001 node dist/server.js
```

### Síntoma: "Permission denied" al escribir en /var/lib/mnexus

```bash
Error: EACCES: permission denied, open '/var/lib/mnexus/backups-index.db'
```

**Solución**:

```bash
# Verificar owner
ls -la /var/lib/mnexus

# Si no es mnexus, cambiar
sudo chown -R mnexus:mnexus /var/lib/mnexus

# Si el directorio no existe
sudo mkdir -p /var/lib/mnexus/backups
sudo chown -R mnexus:mnexus /var/lib/mnexus
```

---

## El plugin no se conecta al server

### Síntoma: "❌ No hay credenciales de servidor configuradas"

**Causa**: el plugin no se ha registrado con el server.

**Solución**:

1. Settings → M-NEXUS → **Backend**
2. Verifica que la URL es correcta (sin trailing slash, con http:// o https://)
3. **Auto-registrar dispositivo**: ✅ ON
4. Click **Guardar**
5. Espera 3 segundos
6. Mira el log de Obsidian (Ctrl/Cmd+Shift+I → Console tab)

### Síntoma: "HTTP 401" o "Token inválido"

**Causa**: el `JWT_SECRET` del server cambió, o el token del plugin expiró.

**Solución**:

```bash
# Opción 1: re-registrar el device
# Settings → M-NEXUS → Auto-registrar (toggle off → on)

# Opción 2: si cambiaste el JWT_SECRET del server
# Todos los devices deben re-registrarse
# (borrar el .db del server no es suficiente)
```

### Síntoma: "Network error" o timeout

**Causa**: el server no es accesible desde el cliente.

**Solución**:

```bash
# Verificar conectividad desde el cliente al server
curl -v http://server-ip:4000/api/v1/health

# Si usas HTTPS y el certificado es self-signed
# Settings → M-NEXUS → "Aceptar certificados self-signed": ✅ ON
```

---

## Drag-and-drop no funciona

### Síntoma: la zona de drop no se ilumina al arrastrar

**Causa**: el navegador no detectó el archivo como drop válido.

**Solución**:

```bash
# 1. Verificar que el archivo es realmente un ZIP
file archivo.zip
# → archivo.zip: Zip archive data, ...

# 2. Verificar los magic bytes manualmente
xxd archivo.zip | head -1
# → 00000000: 504b 0304 ...   ← "PK\x03\x04" = ZIP válido

# 3. Si no, re-empaquetar
zip archivo.zip nota1.md nota2.md
```

### Síntoma: "Solo se aceptan archivos .zip"

**Causa**: el archivo no termina en `.zip`.

**Solución**:

```bash
# Renombrar
mv backup.mnexus-backup backup.zip
```

### Síntoma: el drop se ve pero no pasa nada

**Causa**: bug en el handler de drag-and-drop. Pasa en Obsidian si el panel se
abrió con la versión anterior del plugin.

**Solución**:

1. Cierra el panel de backups
2. Re-abre (Ctrl/Cmd+P → "Gestor de backups")
3. Si sigue, reinicia Obsidian

### Síntoma: el drop sube pero el archivo aparece como 0 bytes

**Causa**: el archivo se leyó antes de que terminara de transferirse al
sistema de archivos.

**Solución**: arrastra de nuevo. Si el archivo es muy grande (>100MB), puede
tardar varios segundos y necesitas mantener el archivo sobre la zona hasta que
el notice de "Subiendo" aparezca.

---

## Upload falla

### Síntoma: "HTTP 413: Payload Too Large"

**Causa**: el backup excede `MAX_BACKUP_SIZE` del server.

**Solución**:

```bash
# Opción 1: aumentar el límite (en el server)
# /etc/mnexus/backend.env
MAX_BACKUP_SIZE=1073741824  # 1GB

sudo systemctl restart mnexus-backend

# Opción 2: reducir el tamaño del backup
# Excluir carpetas pesadas (audios, PDFs) del backup
# (esto se puede hacer en el plugin en v0.29)
```

### Síntoma: "HTTP 500: Internal Server Error"

**Causa**: bug del server. Mira el log:

```bash
journalctl -u mnexus-backend -n 30 --no-pager
```

Si ves `node:sqlite no disponible`, actualiza Node.

Si ves `EACCES`, problema de permisos.

Si ves otra cosa, reportar como bug con el log completo.

### Síntoma: "CHECKSUM_MISMATCH"

**Causa**: el archivo se corrompió durante la transferencia (raro pero posible).

**Solución**:

1. Reintenta el drag-and-drop
2. Si persiste, verifica que el archivo local tiene el SHA-256 correcto
3. Si tu red es inestable, sube por SSH/HTTPS directo en vez de HTTP

### Síntoma: "INVALID_ZIP"

**Causa**: el archivo no es un ZIP válido.

```bash
# Verificar
unzip -t archivo.zip
```

Si `unzip -t` reporta errores, el archivo está corrupto. Re-empaqueta.

---

## Download falla

### Síntoma: "404 NOT_FOUND" al descargar

**Causa**: el backup fue borrado del server (o el ID es incorrecto).

**Solución**:

```bash
# Verificar que existe en el índice
sqlite3 /var/lib/mnexus/backups-index.db \
  "SELECT * FROM backups WHERE id = 'manual-2026-09-01-...';"

# Si no aparece, fue borrado. Si aparece pero el archivo no:
ls -la /var/lib/mnexus/backups/<deviceId>/<id>.zip
```

### Síntoma: el archivo descargado está vacío (0 bytes)

**Causa**: el server tenía el índice pero el archivo se borró del disco.

```bash
# Verificar
ls -la /var/lib/mnexus/backups/<deviceId>/<id>.zip

# Si no existe, restaurar desde tu backup off-site
```

---

## Backups automáticos no se crean

### Síntoma: no aparece ningún backup `auto-` después de 24h

**Causa**: el intervalo es muy largo, o el auto-backup está desactivado.

**Solución**:

1. Settings → M-NEXUS → **Backups**
2. **Auto-backup**: ✅ ON
3. **Intervalo (horas)**: 24 (o menos)
4. **Guardar**
5. Reinicia Obsidian (los timers se resetean)

### Síntoma: error "Backup auto: ..." en el log

**Causa**: la creación del backup falló.

**Solución**:

1. Abre la consola de Obsidian (Ctrl/Cmd+Shift+I)
2. Busca líneas `[ERROR] Backup auto`
3. Mira el mensaje específico:
   - "ENOSPC": no space left on device → liberar espacio
   - "EACCES": permisos → `chmod` o cambiar owner
   - "Vault no inicializado": reiniciar Obsidian

---

## Restauración no funciona

### Síntoma: "Backup no encontrado: manual-..."

**Causa**: el backup fue borrado entre que lo creaste y lo intentaste restaurar.

**Solución**:

```bash
# Listar backups locales
ls -la <vault>/.mnexus-backups/

# Si no hay, descarga del server primero
# (panel de backups → cloud icon del backup → "Restaurar")
```

### Síntoma: "permission denied" al restaurar

**Causa**: la carpeta de destino no tiene permisos de escritura.

**Solución**:

```bash
# El plugin corre con permisos del usuario de Obsidian
# Verificar que el vault es escribible
ls -la <vault>/
# drwx------  ← si esto es 700, OK para tu usuario
# drwxr-xr-x  ← OK

# Si está en modo read-only (sync de iCloud a veces lo hace)
chmod u+w <vault>/<carpeta>
```

### Síntoma: solo se restauran algunos archivos

**Causa**: el backup está corrupto o parcial.

**Solución**:

```bash
# Verificar integridad
unzip -t <vault>/.mnexus-backups/manual-*.mnexus-backup

# Si hay errores, intentar con otro backup
```

---

## Performance lenta

### Síntoma: el backup tarda más de 10 segundos

**Causa**: vault muy grande O usando DEFLATE en lugar de STORE.

**Solución**:

1. Ver cuántos archivos tiene tu vault: `find <vault> -name "*.md" | wc -l`
2. Si > 10000, considera excluir carpetas pesadas del backup:
   - `audios/` (pueden ser GBs)
   - `PDFs/`
   - `Photos/`
3. Usar STORE en vez de DEFLATE (más rápido, ~3% más grande)

### Síntoma: el upload es lento

**Causa**: red lenta o server sobrecargado.

**Solución**:

```bash
# Medir velocidad de red entre cliente y server
iperf3 -c server-ip

# Si la red es < 5 Mbps, considera comprimir más (DEFLATE)

# Si el server está sobrecargado
top -p $(pgrep -f "node dist/server.js")
# Si CPU está al 100%, hay algo mal. Reinicia y mira logs.
```

---

## Errores de SQLite

### Síntoma: "database disk image is malformed"

**Causa**: el archivo `.db` se corrompió.

**Solución**:

```bash
# 1. Stop el server
sudo systemctl stop mnexus-backend

# 2. Intentar reparar
sqlite3 /var/lib/mnexus/backups-index.db "PRAGMA integrity_check;"
# Si dice "ok", el .db está bien

# Si dice "malformed", restaurar desde el último backup
cp /var/lib/mnexus/backups-index.db.backup-20260901 \
   /var/lib/mnexus/backups-index.db

# 3. Reconstruir el índice desde los .zip en disco
# (necesitas un script que lea cada .zip y vuelva a popular el índice)
# Contactar al autor del plugin para obtenerlo

# 4. Start el server
sudo systemctl start mnexus-backend
```

### Síntoma: "database is locked"

**Causa**: dos procesos intentan escribir al mismo tiempo.

**Solución**:

```bash
# Solo debería haber UN proceso del server
ps aux | grep "node dist/server.js"
# Si hay 2, matar el más reciente
sudo kill <PID>

# Verificar configuración WAL
sqlite3 /var/lib/mnexus/backups-index.db "PRAGMA journal_mode;"
# → wal  (correcto, permite lecturas concurrentes)
```

---

## Permisos y filesystem

### Síntoma: "EACCES" al subir

**Causa**: el server no puede escribir en `BACKUP_STORAGE_PATH`.

```bash
# Verificar
ls -la /var/lib/mnexus/
# drwxr-xr-x mnexus mnexus  ← OK

# Si el owner no es mnexus
sudo chown -R mnexus:mnexus /var/lib/mnexus
```

### Síntoma: "ENOSPC: no space left on device"

**Causa**: disco lleno.

```bash
# Ver espacio
df -h /var/lib/mnexus

# Soluciones:
# 1. Borrar backups antiguos automáticamente
# /etc/cron.d/mnexus-cleanup
0 3 * * * mnexus find /var/lib/mnexus/backups -name "auto-*.zip" -mtime +30 -delete

# 2. Aumentar el disco
# 3. Mover a otro disco y symlink
```

### Síntoma: archivos con permisos raros (no se pueden borrar)

```bash
# Ver permisos extendidos
lsattr /var/lib/mnexus/backups/<deviceId>/<file>.zip

# Si tiene 'i' (inmutable)
chattr -i /var/lib/mnexus/backups/<deviceId>/<file>.zip
sudo rm /var/lib/mnexus/backups/<deviceId>/<file>.zip
```

---

## Errores específicos de Obsidian

### Síntoma: "Cannot read property of undefined" en consola

**Causa**: race condition durante el primer arranque del plugin.

**Solución**:

1. Cerrar Obsidian completamente
2. Abrir de nuevo
3. Si sigue, abrir la consola (Ctrl/Cmd+Shift+I) y copiar el error completo
4. Reportar como bug

### Síntoma: el panel de backups está vacío pero el log dice que hay backups

**Causa**: el panel necesita refresco manual.

**Solución**: Click en el botón **🔄 Refrescar** del panel.

### Síntoma: el plugin consume mucha CPU

**Causa**: el timer de auto-backup está mal configurado o un backup está en
loop infinito.

**Solución**:

1. Settings → M-NEXUS → **Intervalo auto-backup**: poner 24h (no menos)
2. Reiniciar Obsidian
3. Si sigue, abrir `~/.config/obsidian/obsidian.log` y buscar loops

---

## Obtener más ayuda

Si nada de esto resuelve el problema:

1. **Recopila información**:
   ```bash
   # Versión del plugin
   cat <vault>/.obsidian/plugins/m-nexus/manifest.json | grep version
   
   # Versión del server
   curl -s http://localhost:4000/api/v1/health | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])"
   
   # Log del server (últimas 100 líneas)
   journalctl -u mnexus-backend -n 100 --no-pager > /tmp/server.log
   
   # Log de Obsidian (Ctrl+Shift+I → Console → copy)
   ```

2. **Abre un issue** en el repositorio con:
   - Versión del plugin y del server
   - Pasos para reproducir
   - Logs relevantes
   - Output de `curl /api/v1/health`

3. **Busca en issues existentes** antes de crear uno nuevo.

---

## Siguiente

- **[BACKUP_INSTALL.md](./BACKUP_INSTALL.md)** — Instalación desde cero
- **[BACKUP_USER_GUIDE.md](./BACKUP_USER_GUIDE.md)** — Cómo usar el sistema
- **[BACKUP_ADMIN_GUIDE.md](./BACKUP_ADMIN_GUIDE.md)** — Administración
- **[BACKUP_DOCKER.md](./BACKUP_DOCKER.md)** — Deployment con Docker
