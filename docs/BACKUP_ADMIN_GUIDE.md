# M-NEXUS Backup — Guía de Administrador del Servidor

**v0.28.0** · Administración, mantenimiento, automatización del server de backups

Esta guía es para quien **opera** el servidor. Cubre la estructura en disco,
SQLite, automatización con cron, sincronización externa, y monitorización.

---

## Tabla de contenidos

1. [Estructura en disco](#estructura-en-disco)
2. [El índice SQLite](#el-índice-sqlite)
3. [Operaciones de mantenimiento](#operaciones-de-mantenimiento)
4. [Drag-and-drop: copia el índice completo](#drag-and-drop-copia-el-índice-completo)
5. [Sincronización externa (S3, rsync)](#sincronización-externa-s3-rsync)
6. [Monitorización y alertas](#monitorización-y-alertas)
7. [Rotación y limpieza](#rotación-y-limpieza)
8. [Migración entre servidores](#migración-entre-servidores)
9. [Seguridad](#seguridad)
10. [Multi-tenancy y aislamiento](#multi-tenancy-y-aislamiento)

---

## Estructura en disco

```
BACKUP_STORAGE_PATH/                (default: /var/lib/mnexus/backups)
├── <deviceId-1>/                   ← cada device tiene su carpeta
│   ├── manual-2026-09-01T15-30-00-abc123.zip
│   ├── manual-2026-09-02T10-15-00-def456.zip
│   ├── auto-2026-09-02T03-00-00-ghi789.zip        ← automático
│   ├── auto-2026-09-03T03-00-00-jkl012.zip
│   ├── emergency-2026-09-03T08-15-00-mno345.zip   ← emergencia
│   └── ...
├── <deviceId-2>/
│   └── ...
└── <deviceId-3>/
    └── ...

BACKUP_INDEX_PATH/                  (default: /var/lib/mnexus/backups-index.db)
└── backups-index.db                ← SQLite con metadata de todos los .zip
```

### ¿Por qué un `.zip` por backup?

- **Drag-and-drop**: copias el archivo con Finder/Explorer/cp/rsync
- **Estandard**: abrible con `unzip`, WinRAR, Finder, GNOME Files
- **Sin lock**: cada upload escribe un archivo nuevo, no necesita coordinación
- **Recovery**: si el índice se corrompe, los .zip siguen siendo válidos

### Layout de nombres

`<kind>-<timestamp>-<random>.zip`

- `kind`: `manual`, `auto`, `emergency` (o `imported` que se trata como manual)
- `timestamp`: `YYYY-MM-DDTHH-MM-SS` (ISO 8601 sin `:` porque algunos FS no lo permiten)
- `random`: 6 caracteres alfanuméricos (anti-colisión)

Ejemplo: `manual-2026-09-01T15-30-00-abc123.zip`

---

## El índice SQLite

**Archivo**: `backups-index.db` (~16KB con 100 backups)

### Schema

```sql
CREATE TABLE backups (
  id TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  uploadedAt TEXT NOT NULL,        -- ISO 8601
  size INTEGER NOT NULL,           -- bytes
  kind TEXT NOT NULL,              -- manual | auto | emergency
  vaultPath TEXT NOT NULL,
  note TEXT,
  fileCount INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,            -- hex de 64 chars
  storagePath TEXT NOT NULL,       -- relative a BACKUP_STORAGE_PATH
  PRIMARY KEY (deviceId, id)
);

CREATE INDEX idx_device_uploaded ON backups(deviceId, uploadedAt DESC);
```

### Consultar directamente con `sqlite3`

```bash
# Listar últimos 10 backups
sqlite3 /var/lib/mnexus/backups-index.db \
  "SELECT id, size, kind, uploadedAt FROM backups ORDER BY uploadedAt DESC LIMIT 10;"

# Tamaño total por device
sqlite3 /var/lib/mnexus/backups-index.db \
  "SELECT deviceId, COUNT(*) as count, SUM(size) as total_bytes
   FROM backups GROUP BY deviceId;"

# Buscar backups con SHA-256 específico (para auditoría)
sqlite3 /var/lib/mnexus/backups-index.db \
  "SELECT * FROM backups WHERE sha256 = 'a1b2c3d4...';"

# Backups manuales/emergencia (los que NO se rotan)
sqlite3 /var/lib/mnexus/backups-index.db \
  "SELECT id, kind, uploadedAt FROM backups
   WHERE kind IN ('manual', 'emergency')
   ORDER BY uploadedAt DESC;"
```

Salida:

```
manual-2026-09-01T15-30-00-abc123|2456678|manual|2026-09-01T15:30:00
auto-2026-09-02T03-00-00-ghi789|2456678|auto|2026-09-02T03:00:00
```

### Backup y restore del índice

```bash
# Backup simple (SQLite es atómico, así que cp funciona)
cp /var/lib/mnexus/backups-index.db /var/lib/mnexus/backups-index.db.backup-$(date +%Y%m%d)

# Backup con VACUUM (compacta el .db)
sqlite3 /var/lib/mnexus/backups-index.db "VACUUM;"
cp /var/lib/mnexus/backups-index.db /var/lib/mnexus/backups-index.db.compact

# Restore desde backup
cp /var/lib/mnexus/backups-index.db.backup-20260901 /var/lib/mnexus/backups-index.db
```

> **Importante**: SQLite es atómico. Si el proceso del server muere durante un
> write, el `.db` se queda consistente (puede perder el último write, pero no se
> corrompe). Para máxima seguridad, usa WAL mode (ya activo por defecto en
> Node 22+).

### Limpiar entradas huérfanas

Si borraste un `.zip` manualmente pero quedó la entrada en el índice:

```bash
# Ver huérfanos
sqlite3 /var/lib/mnexus/backups-index.db <<EOF
SELECT b.id, b.deviceId, b.storagePath
FROM backups b
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT 1) WHERE 0  -- no filesystem check desde SQL
);
EOF

# Listar .zip que NO están en el índice
for d in /var/lib/mnexus/backups/*/; do
  for f in "$d"*.zip; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")
    deviceId=$(basename "$d")
    in_db=$(sqlite3 /var/lib/mnexus/backups-index.db \
      "SELECT COUNT(*) FROM backups WHERE deviceId='$deviceId' AND id='${fname%.zip}';")
    if [ "$in_db" = "0" ]; then
      echo "Huérfano en disco: $f"
    fi
  done
done

# Listar entradas del índice que NO tienen archivo en disco
sqlite3 /var/lib/mnexus/backups-index.db \
  "SELECT deviceId, storagePath FROM backups;" | while IFS='|' read -r dev path; do
  full="/var/lib/mnexus/backups/$path"
  if [ ! -f "$full" ]; then
    echo "Huérfano en índice: $full"
  fi
done
```

### Drag-and-drop del índice completo

```bash
# Opción 1: Con curl
TOKEN="tu-jwt-token"
DEVICE_ID="tu-device-id"
curl -H "Authorization: Bearer $TOKEN" \
     -H "X-Device-Id: $DEVICE_ID" \
     http://localhost:4000/api/v1/backup/dump \
     -o backups-index.db

# Opción 2: Con wget
wget --header="Authorization: Bearer $TOKEN" \
     --header="X-Device-Id: $DEVICE_ID" \
     -O backups-index.db \
     http://localhost:4000/api/v1/backup/dump

# Verificar que es un SQLite válido
file backups-index.db
# → backups-index.db: SQLite 3.x database
```

**Tamaño típico**: 16KB para 100 backups. Es muy pequeño.

**Para qué sirve**:
- Auditoría offline
- Migración a otro server (combinar con los `.zip`)
- Backup del índice sin tocar la DB en vivo

---

## Operaciones de mantenimiento

### Tareas diarias (cron)

```bash
# /etc/cron.d/mnexus-maintenance
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
MNEXUS_USER=mnexus
BACKUP_DIR=/var/lib/mnexus/backups
INDEX=/var/lib/mnexus/backups-index.db

# 1. Backup del índice (3am diario)
0 3 * * * $MNEXUS_USER cp $INDEX $INDEX.$(date +\%Y\%m\%d)
0 4 * * * $MNEXUS_USER find /var/lib/mnexus -name "backups-index.db.20*" -mtime +30 -delete

# 2. VACUUM del SQLite (semanal, domingo 4am)
0 4 * * 0 $MNEXUS_USER sqlite3 $INDEX "VACUUM;"

# 3. Reporte de uso (diario, 8am, email)
0 8 * * * $MNEXUS_USER /opt/mnexus/scripts/usage-report.sh | mail -s "M-NEXUS Backup Report" admin@example.com
```

### Tareas semanales

```bash
# 1. Verificar integridad de todos los .zip
find /var/lib/mnexus/backups -name "*.zip" -exec unzip -t {} \; 2>&1 | grep -v "No errors detected"

# 2. Reportar backups huérfanos
/opt/mnexus/scripts/find-orphans.sh

# 3. Estadísticas para capacity planning
sqlite3 /var/lib/mnexus/backups-index.db <<EOF
SELECT
  'Total backups: ' || COUNT(*),
  'Total size: ' || printf('%.1f GB', SUM(size) / 1024.0 / 1024.0 / 1024.0),
  'Devices: ' || COUNT(DISTINCT deviceId),
  'Average size: ' || printf('%.1f MB', AVG(size) / 1024.0 / 1024.0),
  'Oldest: ' || MIN(uploadedAt),
  'Newest: ' || MAX(uploadedAt);
EOF
```

### Tareas mensuales

```bash
# Rotación de .zip antiguos en disco
# (esto es independiente del plugin: el server NO borra .zip automáticamente,
# solo se rotan desde el cliente. Si quieres forzar rotación server-side:)

# Borrar todos los .auto de más de 90 días
find /var/lib/mnexus/backups -name "auto-*.zip" -mtime +90 -delete

# Borrar entradas huérfanas del índice
sqlite3 /var/lib/mnexus/backups-index.db <<EOF
DELETE FROM backups
WHERE storagePath IN (
  -- listar huérfanos primero y pegar aquí
);
EOF
```

### Script de reporte (`/opt/mnexus/scripts/usage-report.sh`)

```bash
#!/bin/bash
INDEX=/var/lib/mnexus/backups-index.db
STORAGE=/var/lib/mnexus/backups

echo "=== M-NEXUS Backup Report ==="
echo "Date: $(date -Iseconds)"
echo ""

echo "## Storage"
echo "Disk usage: $(du -sh $STORAGE | cut -f1)"
echo "Disk free: $(df -h $STORAGE | tail -1 | awk '{print $4}')"
echo ""

echo "## Index"
echo "Index size: $(du -sh $INDEX | cut -f1)"
echo ""

echo "## Statistics"
sqlite3 -header -column $INDEX <<EOF
SELECT
  deviceId,
  COUNT(*) as backups,
  printf('%.1f MB', SUM(size) / 1024.0 / 1024.0) as total_size,
  MAX(uploadedAt) as last_backup
FROM backups
GROUP BY deviceId;
EOF

echo ""
echo "## Recent backups (last 24h)"
sqlite3 -header -column $INDEX <<EOF
SELECT id, deviceId, kind, printf('%.1f MB', size/1024.0/1024.0) as size, uploadedAt
FROM backups
WHERE uploadedAt > datetime('now', '-1 day')
ORDER BY uploadedAt DESC;
EOF
```

---

## Drag-and-drop: copia el índice completo

El caso de uso más simple: **copiar el estado completo del server a otro lado**.

```bash
# 1. Stop el server (opcional pero recomendado para consistencia)
sudo systemctl stop mnexus-backend

# 2. Copia TODO el directorio (índice + zips)
sudo rsync -avz /var/lib/mnexus/ /mnt/backup-drive/mnexus-2026-09-01/

# 3. Restart el server
sudo systemctl start mnexus-backend
```

O sin parar el server (SQLite es atómico):

```bash
# Rsync con --delay-updates para evitar corrupciones
sudo rsync -avz --delay-updates --delete \
  /var/lib/mnexus/ /mnt/backup-drive/mnexus-2026-09-01/
```

**Tiempo**: para 10GB de backups, ~2 minutos en SSD local.

**Restaurar desde el backup**:

```bash
# Restaurar TODO (índice + zips)
sudo rsync -avz /mnt/backup-drive/mnexus-2026-09-01/ /var/lib/mnexus/
sudo chown -R mnexus:mnexus /var/lib/mnexus
sudo systemctl restart mnexus-backend
```

---

## Sincronización externa (S3, rsync, etc.)

### A S3 con aws-cli

```bash
# Sync diario (cron)
0 2 * * * mnexus aws s3 sync /var/lib/mnexus/backups/ \
  s3://mi-bucket-mnexus/backups/ \
  --exclude "*.tmp" \
  --storage-class STANDARD_IA \
  --delete

# Backup del índice (separado, crítico)
0 3 * * * mnexus aws s3 cp /var/lib/mnexus/backups-index.db \
  s3://mi-bucket-mnexus/backups-index-$(date +\%Y\%m\%d).db
```

Con `--storage-class STANDARD_IA` (Infrequent Access) ahorras ~60% en storage
para datos que se acceden raramente.

### A otro server con rsync sobre SSH

```bash
# /etc/cron.d/mnexus-remote-sync
0 4 * * * mnexus rsync -avz --delete \
  /var/lib/mnexus/backups/ \
  backup-user@backup-server:/srv/mnexus-backups/

# Con SSH key dedicado
0 4 * * * mnexus rsync -avz --delete \
  -e "ssh -i /home/mnexus/.ssh/backup_key" \
  /var/lib/mnexus/backups/ \
  backup-user@backup-server:/srv/mnexus-backups/
```

### A un NAS con SMB/CIFS

```bash
# /etc/fstab
//nas.local/mnexus /mnt/nas-mnexus cifs credentials=/etc/samba/mnexus,uid=mnexus 0 0

# Sync
0 5 * * * mnexus rsync -avz --delete /var/lib/mnexus/backups/ /mnt/nas-mnexus/
```

---

## Monitorización y alertas

### Prometheus metrics

El server expone `/metrics` (Prometheus format). Añade un alert en `prometheus.yml`:

```yaml
groups:
  - name: mnexus
    rules:
      - alert: MnexusBackupStorageFull
        expr: (node_filesystem_avail_bytes{mountpoint="/var/lib/mnexus"} / node_filesystem_size_bytes{mountpoint="/var/lib/mnexus"}) < 0.1
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "M-NEXUS backup disk almost full"

      - alert: MnexusNoBackupsRecently
        expr: time() - mnexus_last_backup_timestamp > 86400
        for: 1h
        labels:
          severity: critical
        annotations:
          summary: "No backups in the last 24h"
```

### Script de health check (cron)

```bash
#!/bin/bash
# /opt/mnexus/scripts/health-check.sh
URL="http://localhost:4000/api/v1/health"
WEBHOOK="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

response=$(curl -s -w "\n%{http_code}" "$URL")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" != "200" ]; then
  curl -s -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"❌ M-NEXUS backend down: HTTP $http_code\"}" \
    "$WEBHOOK"
  exit 1
fi

# Verificar que la versión es 0.28
version=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version', 'unknown'))")
if [ "$version" != "0.28.0" ]; then
  curl -s -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"⚠️ M-NEXUS version mismatch: $version (expected 0.28.0)\"}" \
    "$WEBHOOK"
fi
```

```bash
# Cron cada 5 minutos
*/5 * * * * mnexus /opt/mnexus/scripts/health-check.sh
```

### Verificar espacio en disco

```bash
# Alert si < 10% libre
THRESHOLD=10
USAGE=$(df -P /var/lib/mnexus | tail -1 | awk '{print $5}' | sed 's/%//')

if [ "$USAGE" -gt $((100 - THRESHOLD)) ]; then
  echo "ALERTA: Disco al ${USAGE}% de uso" | mail -s "M-NEXUS: Disco casi lleno" admin@example.com
fi
```

---

## Rotación y limpieza

### Política recomendada

| Kind | Retención | Quién rota |
|---|---|---|
| `auto` | 7 diarios + 4 semanales + 10 recientes | Plugin (cliente) |
| `manual` | Indefinido (o hasta N) | Manual (usuario) |
| `emergency` | Indefinido (o hasta N) | Manual (usuario) |

### Forzar rotación server-side (opcional)

Si quieres que el **server** también rote (en vez de depender del cliente):

```bash
# /etc/cron.d/mnexus-server-rotation
SHELL=/bin/bash

# Cada día a las 2am, borrar .auto de más de 30 días
0 2 * * * mnexus find /var/lib/mnexus/backups -name "auto-*.zip" -mtime +30 -delete

# Cada día a las 2:30am, sincronizar índice con disco
30 2 * * * mnexus /opt/mnexus/scripts/sync-index-with-disk.sh
```

Script `sync-index-with-disk.sh`:

```bash
#!/bin/bash
INDEX=/var/lib/mnexus/backups-index.db
STORAGE=/var/lib/mnexus/backups

# Borrar del índice los .zip que ya no existen
sqlite3 $INDEX <<EOF
DELETE FROM backups
WHERE deviceId || '/' || id || '.zip' NOT IN (
  SELECT REPLACE(storagePath, '.zip', '') || '.zip'
  FROM backups
);
EOF

# También: borrar entradas que no apuntan a archivos existentes
for row in $(sqlite3 $INDEX "SELECT deviceId, storagePath FROM backups;"); do
  IFS='|' read -r dev path <<< "$row"
  full="$STORAGE/$path"
  if [ ! -f "$full" ]; then
    echo "Borrando huérfano: $full"
    sqlite3 $INDEX "DELETE FROM backups WHERE deviceId='$dev' AND storagePath='$path';"
  fi
done
```

---

## Migración entre servidores

### Escenario: cambiar de server

```bash
# 1. En el SERVER ORIGEN: stop
sudo systemctl stop mnexus-backend

# 2. Copia el directorio completo
sudo rsync -avz /var/lib/mnexus/ mnexus@new-server:/var/lib/mnexus/

# 3. En el SERVER NUEVO: configurar el mismo JWT_SECRET
echo "JWT_SECRET=tu-mismo-secret" | sudo tee /etc/mnexus/backend.env

# 4. Arrancar
sudo systemctl start mnexus-backend

# 5. Verificar
curl http://new-server:4000/api/v1/health
```

**El JWT_SECRET debe ser el mismo** en origen y destino, o todos los tokens
existentes quedan inválidos y los devices tienen que re-registrarse.

### Migrar solo el índice (sin los .zip)

```bash
# Si solo quieres el .db (por ejemplo, para inspeccionar)
scp user@old-server:/var/lib/mnexus/backups-index.db ./
sqlite3 backups-index.db ".tables"
```

---

## Seguridad

### Permisos del filesystem

```bash
# Owner: usuario dedicado, NO root
sudo chown -R mnexus:mnexus /var/lib/mnexus
sudo chmod 750 /var/lib/mnexus
sudo chmod 640 /var/lib/mnexus/backups-index.db
sudo chmod 750 /var/lib/mnexus/backups

# Directorios de device: solo el usuario mnexus puede escribir
sudo find /var/lib/mnexus/backups -type d -exec chmod 750 {} \;
sudo find /var/lib/mnexus/backups -name "*.zip" -exec chmod 640 {} \;
```

### Cifrado en reposo

Para datos sensibles, cifra el directorio de backups:

```bash
# Usando eCryptfs
sudo apt install ecryptfs-utils
sudo mount -t ecryptfs /var/lib/mnexus /var/lib/mnexus \
  -o key=passphrase:ecryptfs_pam_passphrase,ecryptfs_enable_filename_crypto=yes

# O usando LUKS (mejor para producción)
# Crear volumen LUKS, montar como /var/lib/mnexus
```

### HTTPS obligatorio en producción

Nunca expongas el server sin TLS. Opciones:

1. **Nginx + Let's Encrypt** (recomendado) — ver [BACKUP_INSTALL.md](./BACKUP_INSTALL.md)
2. **Caddy** (auto-TLS)
3. **Cloudflare Tunnel** (sin abrir puertos)
4. **Tailscale** (VPN personal, no expuesto a internet)

### Auth JWT

```bash
# Generar secret fuerte
openssl rand -hex 32
# → 64 caracteres hex, ~256 bits de entropía

# En /etc/mnexus/backend.env
JWT_SECRET=<el resultado de arriba>
chmod 600 /etc/mnexus/backend.env
```

### Auditoría

```bash
# Ver log de accesos del server
journalctl -u mnexus-backend --since "1 day ago"

# O si usas archivo
tail -f /var/log/mnexus/audit.log

# Buscar intentos de auth fallidos
grep "auth.failed" /var/log/mnexus/audit.log | tail -20
```

---

## Multi-tenancy y aislamiento

Por defecto, cada `deviceId` solo ve sus propios backups. El índice usa
`(deviceId, id)` como PRIMARY KEY, lo que garantiza aislamiento.

### Verificar aislamiento

```bash
# Device A lista sus backups
curl -H "Authorization: Bearer $TOKEN_A" -H "X-Device-Id: device-A" \
  http://server:4000/api/v1/backup/list
# → Solo backups de A

# Device B intenta listar los de A
curl -H "Authorization: Bearer $TOKEN_B" -H "X-Device-Id: device-B" \
  http://server:4000/api/v1/backup/list
# → Solo backups de B (no ve los de A)

# Device B intenta descargar uno de A
curl -H "Authorization: Bearer $TOKEN_B" -H "X-Device-Id: device-B" \
  http://server:4000/api/v1/backup/download/manual-2026-09-01-abc
# → 404 (porque A no es B)
```

El server siempre filtra por `auth.sub` (que es el `deviceId`), no por lo que
dice el header `X-Device-Id`. Esto previene suplantación.

---

## Capacity planning

### Tamaño esperado

```bash
# Para 1GB de notas en el vault:
# - ZIP con DEFLATE: ~150-300KB
# - ZIP con STORE: ~1.1GB (sin comprimir)
# - 10 backups automáticos: ~1.5-3GB (DEFLATE) o 11GB (STORE)

# Calculadora rápida
NOTES=$(find /path/to/vault -name "*.md" | wc -l)
AVG_SIZE=$(find /path/to/vault -name "*.md" -exec stat -c%s {} \; | awk '{s+=$1} END {print int(s/NR)}')
TOTAL_MB=$((NOTES * AVG_SIZE / 1024))
DEFLATE_BACKUPS=$((TOTAL_MB * 3 / 10))  # 30% de raw con DEFLATE
echo "Vault: $NOTES notas, ${TOTAL_MB}MB raw"
echo "Por backup: ~${DEFLATE_BACKUPS}MB"
echo "10 backups: ~$((DEFLATE_BACKUPS * 10))MB"
```

### Recomendación de disco

Para uso típico (vault de 1000 notas, 10 backups, 1 mes de retención):

- **Mínimo**: 5GB
- **Recomendado**: 20GB (margen para crecimiento)
- **Con rule 3-2-1**: 100GB (5GB local + 50GB server + 45GB off-site)

---

## Siguiente

- **[BACKUP_TROUBLESHOOTING.md](./BACKUP_TROUBLESHOOTING.md)** — Si algo va mal
- **[BACKUP_DOCKER.md](./BACKUP_DOCKER.md)** — Deployment alternativo con Docker
- **[BACKUP_INSTALL.md](./BACKUP_INSTALL.md)** — Instalación desde cero
