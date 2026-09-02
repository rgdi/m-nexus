# M-NEXUS Backend — Deployment con Docker

**v0.28.0** · docker-compose para producción

Esta guía muestra cómo desplegar el backend de M-NEXUS con Docker, incluyendo
el sistema de backups con drag-and-drop.

---

## Tabla de contenidos

1. [Requisitos](#requisitos)
2. [Estructura de archivos](#estructura-de-archivos)
3. [Opción A: docker-compose simple](#opción-a-docker-compose-simple)
4. [Opción B: docker-compose con Nginx + TLS](#opción-b-docker-compose-con-nginx--tls)
5. [Volúmenes y persistencia](#volúmenes-y-persistencia)
6. [Networking](#networking)
7. [Backup del volumen](#backup-del-volumen)
8. [Update / Upgrade](#update--upgrade)
9. [Monitorización](#monitorización)
10. [Troubleshooting Docker](#troubleshooting-docker)

---

## Requisitos

- **Docker Engine** 20.10+
- **Docker Compose** v2.0+ (el plugin, no el legacy)
- **Almacenamiento**: 5GB+ libre
- **RAM**: 512MB mínimo (1GB recomendado)
- **CPU**: 1 core mínimo (2+ recomendado con Whisper)

```bash
# Verificar versiones
docker --version
docker compose version
```

---

## Estructura de archivos

```
mnexus-deploy/
├── docker-compose.yml
├── .env                       ← secrets (NO commitear a git)
├── nginx/
│   ├── nginx.conf
│   └── certs/                 ← certificados TLS (o usar Caddy)
└── README.md
```

---

## Opción A: docker-compose simple

Ideal para:
- Desarrollo local
- Red privada (LAN, Tailscale)
- Pruebas rápidas

### `docker-compose.yml`

```yaml
services:
  backend:
    image: node:22-alpine
    container_name: mnexus-backend
    restart: unless-stopped
    working_dir: /app
    volumes:
      # Montar el código del backend
      - ./backend:/app:ro
      # Volumen nombrado para backups (persiste entre deploys)
      - mnexus-backups:/var/lib/mnexus/backups
      # Volumen nombrado para el índice SQLite
      - mnexus-index:/var/lib/mnexus/backups-index.db
    environment:
      - NODE_ENV=production
      - PORT=4000
      - HOST=0.0.0.0
      - JWT_SECRET=${JWT_SECRET}
      - BACKUP_STORAGE_PATH=/var/lib/mnexus/backups
      - BACKUP_INDEX_PATH=/var/lib/mnexus/backups-index.db
      - MAX_BACKUP_SIZE=${MAX_BACKUP_SIZE:-524288000}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    ports:
      - "${BIND_ADDR:-127.0.0.1}:4000:4000"
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:4000/api/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    # Instalar deps y arrancar (alternativa: bake en una imagen custom)
    command: >
      sh -c "if [ ! -d node_modules ]; then npm ci --omit=dev; fi && node dist/server.js"
    # Si la imagen ya tiene node_modules baked:
    # command: ["node", "dist/server.js"]

volumes:
  mnexus-backups:
    name: mnexus-backups
  mnexus-index:
    name: mnexus-index
```

### `.env`

```bash
# IMPORTANTE: generar uno nuevo
JWT_SECRET=$(openssl rand -hex 32)

# Configuración
MAX_BACKUP_SIZE=524288000  # 500MB
LOG_LEVEL=info

# Bind address (127.0.0.1 para producción con reverse proxy)
BIND_ADDR=127.0.0.1
```

### Setup

```bash
# 1. Crear directorio
mkdir mnexus-deploy && cd mnexus-deploy
mkdir backend nginx

# 2. Copiar el código del backend
cp -r /path/to/m-nexus-backend-v0.28.0/dist backend/
cp /path/to/m-nexus-backend-v0.28.0/package.json backend/

# 3. Crear .env
cat > .env << EOF
JWT_SECRET=$(openssl rand -hex 32)
MAX_BACKUP_SIZE=524288000
LOG_LEVEL=info
BIND_ADDR=127.0.0.1
EOF
chmod 600 .env

# 4. Levantar
docker compose up -d

# 5. Verificar
curl -s http://localhost:4000/api/v1/health
```

### Ver logs

```bash
# Logs en tiempo real
docker compose logs -f backend

# Solo errores
docker compose logs backend | grep -i error | tail -20
```

---

## Opción B: docker-compose con Nginx + TLS

Para producción con HTTPS (recomendado si expones a internet).

### Estructura adicional

```
mnexus-deploy/
├── docker-compose.yml
├── .env
├── nginx/
│   ├── nginx.conf
│   └── certs/                  ← certificados TLS
└── Caddyfile                   ← alternativa con Caddy (auto-TLS)
```

### `docker-compose.yml` (con Nginx)

```yaml
services:
  backend:
    image: node:22-alpine
    container_name: mnexus-backend
    restart: unless-stopped
    working_dir: /app
    volumes:
      - ./backend:/app:ro
      - mnexus-backups:/var/lib/mnexus/backups
      - mnexus-index:/var/lib/mnexus/backups-index.db
    environment:
      - NODE_ENV=production
      - PORT=4000
      - HOST=0.0.0.0
      - JWT_SECRET=${JWT_SECRET}
      - BACKUP_STORAGE_PATH=/var/lib/mnexus/backups
      - BACKUP_INDEX_PATH=/var/lib/mnexus/backups-index.db
      - MAX_BACKUP_SIZE=${MAX_BACKUP_SIZE:-524288000}
      - LOG_LEVEL=${LOG_LEVEL:-info}
    # No exponer directamente — solo accesible vía Nginx
    expose:
      - "4000"
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:4000/api/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    command: >
      sh -c "if [ ! -d node_modules ]; then npm ci --omit=dev; fi && node dist/server.js"

  nginx:
    image: nginx:1.27-alpine
    container_name: mnexus-nginx
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_healthy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certs:/etc/nginx/certs:ro
      - nginx-logs:/var/log/nginx

volumes:
  mnexus-backups:
  mnexus-index:
  nginx-logs:
```

### `nginx/nginx.conf`

```nginx
events {
  worker_connections 1024;
}

http {
  # ... defaults ...
  client_max_body_size 600M;
  proxy_read_timeout 300s;
  proxy_send_timeout 300s;
  proxy_buffering off;
  proxy_request_buffering off;

  # Rate limit
  limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;

  # Upstream
  upstream mnexus_backend {
    server backend:4000;
  }

  # HTTP → HTTPS
  server {
    listen 80;
    server_name mnexus.example.com;
    return 301 https://$host$request_uri;
  }

  # HTTPS
  server {
    listen 443 ssl http2;
    server_name mnexus.example.com;

    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    # CORS para el plugin
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Device-Id, X-Backup-Metadata" always;
    add_header Access-Control-Max-Age 86400;

    if ($request_method = OPTIONS) {
      return 204;
    }

    # Health check (público, sin rate limit)
    location = /api/v1/health {
      proxy_pass http://mnexus_backend;
    }

    # Backup endpoints (con rate limit)
    location /api/v1/backup/ {
      limit_req zone=api burst=20 nodelay;
      proxy_pass http://mnexus_backend;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    # AI endpoints
    location /api/v1/ai/ {
      limit_req zone=api burst=60 nodelay;
      proxy_pass http://mnexus_backend;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
    }

    # Resto
    location / {
      limit_req zone=api burst=20 nodelay;
      proxy_pass http://mnexus_backend;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
}
```

### Generar certificados TLS

**Opción 1: Let's Encrypt con certbot**

```bash
# Instalar certbot
sudo apt install certbot

# Obtener certificados
sudo certbot certonly --standalone -d mnexus.example.com

# Copiar al directorio de nginx
cp /etc/letsencrypt/live/mnexus.example.com/fullchain.pem nginx/certs/
cp /etc/letsencrypt/live/mnexus.example.com/privkey.pem nginx/certs/
chmod 644 nginx/certs/*
```

**Opción 2: Self-signed (solo para LAN)**

```bash
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout nginx/certs/privkey.pem \
  -out nginx/certs/fullchain.pem \
  -days 365 \
  -subj "/CN=mnexus.local" \
  -addext "subjectAltName=DNS:mnexus.local,IP:192.168.1.100"
```

Y en el plugin, marcar "Aceptar certificados self-signed".

### Auto-renovación de Let's Encrypt

```bash
# /etc/cron.d/certbot-renew
0 3 * * * root certbot renew --quiet --deploy-hook "cp /etc/letsencrypt/live/mnexus.example.com/fullchain.pem /path/to/mnexus-deploy/nginx/certs/ && cp /etc/letsencrypt/live/mnexus.example.com/privkey.pem /path/to/mnexus-deploy/nginx/certs/ && docker compose -f /path/to/mnexus-deploy/docker-compose.yml restart nginx"
```

---

## Volúmenes y persistencia

### ¿Qué se guarda y dónde?

| Dato | Volumen | Crítico | Backup |
|---|---|---|---|
| `.zip` de backups | `mnexus-backups` | ✅ Sí | Diario a S3/off-site |
| `backups-index.db` (SQLite) | `mnexus-index` | ✅ Sí | Diario (es pequeño) |
| Código del backend | `./backend` (bind mount) | ❌ No | Está en el ZIP |
| Certs TLS | `./nginx/certs` | ✅ Sí | Asegurar backup |
| `.env` (secretos) | `./.env` | ✅ Sí | Proteger mucho |

### Inspeccionar volúmenes

```bash
# Listar volúmenes
docker volume ls | grep mnexus

# Ver qué hay dentro
docker run --rm -v mnexus-backups:/data alpine ls -la /data
docker run --rm -v mnexus-index:/data alpine ls -la /data

# Tamaño
docker system df -v
```

---

## Networking

### Opción 1: Solo localhost (más seguro)

```yaml
ports:
  - "127.0.0.1:4000:4000"
```

El server solo acepta conexiones de la misma máquina. Usa esto con Nginx en
la misma máquina y un reverse proxy público.

### Opción 2: Toda la red local

```yaml
ports:
  - "0.0.0.0:4000:4000"
```

Útil si el plugin de Obsidian está en otra máquina de la LAN.

### Opción 3: Tailscale (recomendado para multi-device)

```yaml
# docker-compose.yml
services:
  backend:
    # ...
    network_mode: "host"  # <- Tailscale expone en 100.x.x.x

# O más limpio: usar la red de Tailscale
networks:
  mnexus:
    driver: overlay
```

Con Tailscale, no expones el server a internet pero todos tus devices pueden
conectarse como si estuvieran en la misma LAN.

### Opción 4: Cloudflare Tunnel (sin abrir puertos)

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      - backend
```

Configura el tunnel en Cloudflare Dashboard para apuntar a `http://backend:4000`.

---

## Backup del volumen

### Backup automático del volumen Docker

```bash
# /opt/mnexus/scripts/backup-volumes.sh
#!/bin/bash
BACKUP_DIR=/srv/mnexus-backups
DATE=$(date +%Y%m%d-%H%M%S)

mkdir -p $BACKUP_DIR

# Backup del volumen mnexus-backups (puede ser grande)
docker run --rm \
  -v mnexus-backups:/source:ro \
  -v $BACKUP_DIR:/backup \
  alpine tar czf /backup/mnexus-backups-$DATE.tar.gz -C /source .

# Backup del volumen mnexus-index (pequeño)
docker run --rm \
  -v mnexus-index:/source:ro \
  -v $BACKUP_DIR:/backup \
  alpine tar czf /backup/mnexus-index-$DATE.tar.gz -C /source .

# Limpiar backups antiguos (>30 días)
find $BACKUP_DIR -name "mnexus-*-*.tar.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR/mnexus-*-${DATE}.tar.gz"
```

```bash
chmod +x /opt/mnexus/scripts/backup-volumes.sh

# Cron diario
echo "0 4 * * * root /opt/mnexus/scripts/backup-volumes.sh" | sudo tee /etc/cron.d/mnexus-volumes-backup
```

### Restaurar desde backup

```bash
# Detener el server
docker compose down

# Restaurar
docker run --rm \
  -v mnexus-backups:/target \
  -v /srv/mnexus-backups:/backup:ro \
  alpine tar xzf /backup/mnexus-backups-20260901-030000.tar.gz -C /target

# Re-arrancar
docker compose up -d
```

### Sync a S3 (con docker)

```bash
# docker-compose.yml
services:
  s3-sync:
    image: amazon/aws-cli:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
    entrypoint: /bin/sh -c "
      apk add --no-cache dcron &&
      echo '0 5 * * * aws s3 sync /data s3://mi-bucket/mnexus/ --exclude *.tmp --storage-class STANDARD_IA' | crontab - &&
      crond -f -d 0
    "
    volumes_from:
      - backend
```

---

## Update / Upgrade

### Proceso recomendado

```bash
# 1. Backup del estado actual (por si acaso)
./backup-volumes.sh

# 2. Descargar nueva versión
wget https://github.com/.../m-nexus-backend-v0.29.0.zip
unzip m-nexus-backend-v0.29.0.zip -d /tmp/new-version

# 3. Reemplazar el código (los volúmenes NO se tocan)
rm -rf backend
cp -r /tmp/new-version/dist backend/
cp /tmp/new-version/package.json backend/

# 4. Verificar que arranca (sin -d, en foreground)
docker compose up backend

# 5. Si OK, Ctrl+C y arrancar normal
docker compose up -d

# 6. Verificar
curl -s http://localhost:4000/api/v1/health | python3 -m json.tool
```

### Rollback si algo va mal

```bash
# Restaurar desde el backup del volumen
./restore-volumes.sh 20260901-030000

# Arrancar
docker compose up -d
```

---

## Monitorización

### Health check integrado

Docker ya hace health check automático. Ver:

```bash
docker compose ps
# → mnexus-backend     Up (healthy)
#   mnexus-nginx       Up (healthy)
```

### Logs centralizados

```yaml
# docker-compose.yml
services:
  backend:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
        tag: "mnexus-backend"
```

### Prometheus (opcional)

```yaml
# Añadir al docker-compose.yml
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "127.0.0.1:9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
```

```yaml
# prometheus.yml
global:
  scrape_interval: 30s

scrape_configs:
  - job_name: 'mnexus'
    static_configs:
      - targets: ['backend:4000']
    metrics_path: '/metrics'
```

---

## Troubleshooting Docker

### "bind: address already in use"

```bash
# Ver qué usa el puerto
sudo lsof -i :4000

# O cambiar el puerto en .env
echo "BIND_ADDR=127.0.0.1" >> .env
echo "Agregar al docker-compose.yml: ports: - '127.0.0.1:4001:4000'"
```

### El contenedor se reinicia constantemente

```bash
# Ver los logs del último intento
docker compose logs --tail=100 backend

# Común: "EACCES" en /var/lib/mnexus
docker compose exec backend ls -la /var/lib/mnexus
# Si no puede escribir, los permisos del volumen están mal
docker compose down
docker volume rm mnexus-backups mnexus-index
docker compose up -d
```

### "no space left on device"

```bash
# Ver espacio
docker system df
df -h /var/lib/docker

# Limpiar
docker system prune -a
# (cuidado: borra imágenes/volúmenes no usados)
```

### El volumen no persiste

```bash
# Verificar que el volumen existe
docker volume ls

# Si no, recreate
docker compose down -v  # ⚠️ borra el volumen
docker compose up -d
```

### Health check falla

```bash
# Manual
docker compose exec backend wget -q -O- http://localhost:4000/api/v1/health

# Si falla, ver el log
docker compose logs backend
```

---

## Recursos

- [BACKUP_INSTALL.md](./BACKUP_INSTALL.md) — Instalación sin Docker
- [BACKUP_ADMIN_GUIDE.md](./BACKUP_ADMIN_GUIDE.md) — Mantenimiento
- [BACKUP_TROUBLESHOOTING.md](./BACKUP_TROUBLESHOOTING.md) — Problemas comunes
- [Docker Compose docs](https://docs.docker.com/compose/)
- [Node 22 image](https://hub.docker.com/_/node)
