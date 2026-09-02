# M-NEXUS Backup System — Documentación

**v0.28.0** · Sistema de backups ultrarrápido con ZIP binario y drag-and-drop

5 guías completas para instalar, usar y administrar el sistema de backups.

---

## 🚀 Empezar aquí

¿Primera vez? Sigue este orden:

1. **[BACKUP_INSTALL.md](./BACKUP_INSTALL.md)** (15 min)
   Instalación del backend, plugin de Obsidian, y opcionalmente la app móvil.
   4 opciones: local, systemd, Docker, o app Android.

2. **[BACKUP_USER_GUIDE.md](./BACKUP_USER_GUIDE.md)** (10 min)
   Cómo usar el día a día: crear backups, drag-and-drop, restaurar.

3. **[BACKUP_ADMIN_GUIDE.md](./BACKUP_ADMIN_GUIDE.md)** (cuando lo necesites)
   Mantenimiento del server: SQLite, dumps, automatización, S3, monitorización.

---

## 📚 Todas las guías

| Guía | Para quién | Tiempo de lectura |
|---|---|---|
| **[INSTALL](./BACKUP_INSTALL.md)** | Sysadmin / DevOps | 15 min |
| **[USER GUIDE](./BACKUP_USER_GUIDE.md)** | Usuario final | 10 min |
| **[ADMIN](./BACKUP_ADMIN_GUIDE.md)** | Sysadmin / DBA | 20 min |
| **[DOCKER](./BACKUP_DOCKER.md)** | DevOps / Container | 15 min |
| **[TROUBLESHOOTING](./BACKUP_TROUBLESHOOTING.md)** | Cualquiera (cuando algo falla) | 5 min |

---

## 🎯 Por caso de uso

### "Quiero instalar M-NEXUS con backups"
→ [BACKUP_INSTALL.md](./BACKUP_INSTALL.md) → opción A, B, o C

### "Quiero desplegar con Docker"
→ [BACKUP_DOCKER.md](./BACKUP_DOCKER.md)

### "¿Cómo creo un backup?"
→ [BACKUP_USER_GUIDE.md#crear-un-backup-manual](./BACKUP_USER_GUIDE.md#crear-un-backup-manual)

### "¿Cómo subo un .zip arrastrándolo?"
→ [BACKUP_USER_GUIDE.md#drag--drop-subrir-un-zip](./BACKUP_USER_GUIDE.md#drag--drop-subir-un-zip)

### "¿Cómo restauro un backup viejo?"
→ [BACKUP_USER_GUIDE.md#restaurar-un-backup](./BACKUP_USER_GUIDE.md#restaurar-un-backup)

### "¿Cómo hago backup del server a S3?"
→ [BACKUP_ADMIN_GUIDE.md#a-s3-con-aws-cli](./BACKUP_ADMIN_GUIDE.md#a-s3-con-aws-cli)

### "El drag-and-drop no funciona"
→ [BACKUP_TROUBLESHOOTING.md#drag-and-drop-no-funciona](./BACKUP_TROUBLESHOOTING.md#drag-and-drop-no-funciona)

### "El server no arranca"
→ [BACKUP_TROUBLESHOOTING.md#el-server-no-arranca](./BACKUP_TROUBLESHOOTING.md#el-server-no-arranca)

### "El plugin no se conecta al server"
→ [BACKUP_TROUBLESHOOTING.md#el-plugin-no-se-conecta-al-server](./BACKUP_TROUBLESHOOTING.md#el-plugin-no-se-conecta-al-server)

### "Quiero migrar a otro server"
→ [BACKUP_ADMIN_GUIDE.md#migración-entre-servidores](./BACKUP_ADMIN_GUIDE.md#migración-entre-servidores)

### "Necesito capacidad para 10TB de backups"
→ [BACKUP_ADMIN_GUIDE.md#capacity-planning](./BACKUP_ADMIN_GUIDE.md#capacity-planning)

### "¿Qué hace el endpoint /api/v1/backup/dump?"
→ [BACKUP_USER_GUIDE.md#drag--drop-copia-el-índice-completo](./BACKUP_ADMIN_GUIDE.md#drag-and-drop-copia-el-índice-completo)

---

## ⚡ Resumen ejecutivo

### ¿Qué hace el sistema?

1. **Crea backups locales** en `<vault>/.mnexus-backups/*.mnexus-backup` (formato ZIP)
2. **Sube al servidor** como `application/zip` binario (no base64-en-JSON)
3. **Almacena** cada backup como un archivo `.zip` separado en `/var/lib/mnexus/backups/{deviceId}/`
4. **Indexa** en una SQLite pequeña (`backups-index.db`, ~16KB para 100 backups)
5. **Permite drag-and-drop**:
   - Arrastrar un `.zip` desde el OS → upload al server
   - Arrastrar un card de la lista → download al OS
   - Botón "Dump" → descargar el `.db` entero

### ¿Por qué es rápido?

- **ZIP binario estándar** (no base64, 3 bytes por char → 1 byte por char)
- **CRC32 calculado en cliente** (verificación antes de subir)
- **Server solo escribe a disco** (sin decode, sin parsear JSON)
- **SQLite como índice** (16KB para 100 backups, query instantánea)
- **Drag-and-drop = mover archivo** (no requiere API especial)

### Medidas típicas

| Operación | Tiempo |
|---|---|
| Crear backup (vault 60KB, 100 notas) | ~14ms STORE / 110ms DEFLATE |
| Subir al server (154KB ZIP) | ~23ms round-trip, 7ms server-side |
| Listar backups (100) | <10ms |
| Descargar backup | <50ms (LAN) |
| Dump del índice completo | <20ms (16KB) |

### Garantías

- ✅ **Atomicidad**: SQLite es ACID, no se corrompe
- ✅ **Integridad**: SHA-256 verificado en cliente y servidor
- ✅ **Aislamiento**: cada device solo ve sus backups
- ✅ **Estandard**: los `.zip` se abren con `unzip`, WinRAR, Finder
- ✅ **Recuperable**: incluso si el `.db` se pierde, los `.zip` siguen siendo válidos
- ✅ **Auditable**: drag-and-drop del `.db` para inspección offline

---

## 🔗 Referencias externas

- [Obsidian Plugin API](https://docs.obsidian.md/)
- [Fastify documentation](https://fastify.dev/)
- [Node.js `node:sqlite` docs](https://nodejs.org/api/sqlite.html)
- [ZIP file format (PKZIP)](https://pkwarefiles.azureedge.net/webdocs/casestudies/APPNOTE.TXT)
- [Tailscale (VPN personal)](https://tailscale.com/)
- [Let's Encrypt (TLS gratis)](https://letsencrypt.org/)

---

**Versión**: 0.28.0
**Última actualización**: 2026-09-01
**Compatibilidad**: Obsidian 1.5+, Node 22+
